// Leitura e calculo da Sorveteria Polar: busca no cardapio, horario da loja,
// orcamento de pedido e recomendacao. A escrita mora em src/flavors.ts (sabores)
// e src/customers.ts (clientes), que exigem palavra magica.
//
// As rotas /api e o servidor MCP sao wrappers finos sobre estas funcoes.
// Nenhuma funcao lanca excecao: em caso de falha retornam { error: { code, message } }.
// As leituras de sabor sao assincronas porque o cardapio tem CRUD e vem do store.

import { readFlavors, formats, toppings, promos, shop } from "./data";
import { isError } from "./types";
import type { Flavor, Format, Topping, Promo, CoreError, Allergen } from "./types";

// ---------------------------------------------------------------- helpers

/** Minusculas e sem acento, para busca que ignora caixa e diacriticos. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function fail(code: string, message: string): CoreError {
  return { error: { code, message } };
}

/**
 * Le o cardapio do store convertendo qualquer falha em CoreError. Sem isto uma queda
 * do Redis viraria excecao vazando do core, e a entidade inteira e construida sobre a
 * promessa oposta: nenhuma funcao lanca, toda falha volta como { error }.
 */
async function loadMenu(): Promise<Flavor[] | CoreError> {
  try {
    return await readFlavors();
  } catch (err) {
    return fail("STORAGE_ERROR", "Nao foi possivel ler o cardapio: " + ((err as Error)?.message ?? err));
  }
}

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_NAMES_PT = [
  "domingo", "segunda-feira", "terca-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sabado",
];
const SHORT_TO_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface ResolvedNow {
  weekday: number;       // 0 = domingo ... 6 = sabado
  minutes: number;       // minutos desde a meia-noite local
  weekday_name: string;  // em portugues
  iso: string;
}

/**
 * Dia e hora no fuso da loja (America/Sao_Paulo), nao no fuso do servidor.
 * A Vercel roda em UTC, entao usar a hora do servidor daria is_open errado.
 */
export function resolveNow(datetime?: string): ResolvedNow {
  const parsed = datetime ? new Date(datetime) : new Date();
  const base = isNaN(parsed.getTime()) ? new Date() : parsed;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: shop.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(base);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = SHORT_TO_INDEX[get("weekday")] ?? 0;
  const hour = Number(get("hour")) % 24; // algumas ICUs devolvem "24" a meia-noite
  const minutes = hour * 60 + Number(get("minute"));

  return { weekday, minutes, weekday_name: WEEKDAY_NAMES_PT[weekday], iso: base.toISOString() };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------- sabores

export interface SearchFlavorsParams {
  query?: string;
  category?: string;
  dietary?: string;
  max_price?: number;
  avoid_allergens?: string[];
  only_available?: boolean;
}

export interface SearchFlavorsResult {
  count: number;
  filters: SearchFlavorsParams;
  flavors: Flavor[];
}

export async function searchFlavors(
  params: SearchFlavorsParams = {},
): Promise<SearchFlavorsResult | CoreError> {
  const { query, category, dietary, max_price, avoid_allergens } = params;
  const onlyAvailable = params.only_available !== false; // padrao: true

  if (max_price !== undefined && (typeof max_price !== "number" || isNaN(max_price) || max_price < 0)) {
    return fail("INVALID_MAX_PRICE", "max_price deve ser um numero de centavos maior ou igual a zero.");
  }

  const q = query ? normalize(query) : null;
  const cat = category ? normalize(category) : null;
  const diet = dietary ? normalize(dietary) : null;
  const avoid = (avoid_allergens ?? []).map(normalize);

  const menu = await loadMenu();
  if (isError(menu)) return menu;

  const result = menu.filter((f) => {
    if (onlyAvailable && !f.available) return false;
    if (cat && normalize(f.category) !== cat) return false;
    // A dieta vem SEMPRE do array dietary, nunca da categoria nem do texto.
    if (diet && !f.dietary.some((t) => normalize(t) === diet)) return false;
    if (max_price !== undefined && f.price_cents > max_price) return false;
    if (avoid.length && f.allergens.some((a) => avoid.includes(normalize(a)))) return false;
    if (q && !normalize(f.name + " " + f.description).includes(q)) return false;
    return true;
  });

  return {
    count: result.length,
    filters: { ...params, only_available: onlyAvailable },
    flavors: result,
  };
}

export async function getFlavor(id: string): Promise<Flavor | CoreError> {
  if (!id) return fail("MISSING_ID", "Informe o id do sabor.");
  const menu = await loadMenu();
  if (isError(menu)) return menu;

  const found = menu.find((f) => f.id === normalize(id));
  if (!found) {
    return fail("FLAVOR_NOT_FOUND", "Sabor \"" + id + "\" nao existe no cardapio da Sorveteria Polar.");
  }
  return found;
}

// ---------------------------------------------------------------- loja

export async function getShopInfo(datetime?: string) {
  const now = resolveNow(datetime);
  const window = shop.hours[WEEKDAY_KEYS[now.weekday]] ?? null;

  let isOpen = false;
  if (window) {
    const open = toMinutes(window.open);
    const close = toMinutes(window.close);
    isOpen = close > open
      ? now.minutes >= open && now.minutes < close
      : now.minutes >= open || now.minutes < close; // janela que cruza a meia-noite
  }

  // Os dados da loja (endereco, horario, is_open) nao dependem do store, entao uma
  // falha ao ler o cardapio nao derruba a rota: so o sabor do dia fica indisponivel,
  // e o aviso diz por que — melhor que um 500 ou um null silencioso.
  const menu = await loadMenu();
  const featured = isError(menu)
    ? null
    : menu.find((f) => f.id === shop.flavor_of_the_day) ?? null;
  const warnings = isError(menu) ? [menu.error.message] : [];

  return {
    id: shop.id,
    name: shop.name,
    public_name: shop.public_name,
    description: shop.description,
    address: shop.address,
    district: shop.district,
    phone: shop.phone,
    timezone: shop.timezone,
    payment_methods: shop.payment_methods,
    delivery: shop.delivery,
    hours: shop.hours,
    is_open: isOpen,
    weekday: now.weekday,
    weekday_name: now.weekday_name,
    today_hours: window,
    checked_at: now.iso,
    flavor_of_the_day: featured,
    warnings,
  };
}

// ---------------------------------------------------------------- pedido

export interface QuoteOrderParams {
  format: string;
  flavor_ids: string[];
  toppings?: string[];
  weekday?: number;
}

export interface QuoteItem {
  type: "format" | "flavor" | "topping";
  id: string;
  name: string;
  price_cents: number;
}

export interface QuoteOrderResult {
  items: QuoteItem[];
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  currency: "BRL";
  applied_promo: { id: string; name: string; description: string } | null;
  weekday: number;
  weekday_name: string;
  allergens: Allergen[];
  is_open: boolean;
}

/**
 * Desconto que uma promocao daria neste pedido; 0 quando nao se aplica.
 * Em ambos os casos o desconto incide sobre o subtotal: applies_to "format"
 * apenas condiciona a elegibilidade ao formato escolhido, e applies_to "total"
 * a condiciona a um valor minimo de pedido.
 */
function discountFor(promo: Promo, format: Format, subtotal: number): number {
  const rule = promo.rule;

  if (rule.applies_to === "format") {
    if (!rule.format_ids || !rule.format_ids.includes(format.id)) return 0;
  } else if (subtotal < (rule.min_total_cents ?? 0)) {
    return 0;
  }

  return rule.type === "percent_off"
    ? Math.round((subtotal * rule.value) / 100)
    : Math.min(rule.value, subtotal);
}

export async function quoteOrder(params: QuoteOrderParams): Promise<QuoteOrderResult | CoreError> {
  const format = formats.find((f) => f.id === normalize(params.format ?? ""));
  if (!format) {
    return fail(
      "FORMAT_NOT_FOUND",
      "Formato \"" + params.format + "\" nao existe. Disponiveis: " + formats.map((f) => f.id).join(", ") + ".",
    );
  }

  const flavorIds = params.flavor_ids ?? [];
  if (!Array.isArray(flavorIds) || flavorIds.length === 0) {
    return fail("EMPTY_ORDER", "Escolha ao menos um sabor em flavor_ids.");
  }
  if (flavorIds.length > format.max_scoops) {
    return fail(
      "TOO_MANY_SCOOPS",
      "O formato \"" + format.id + "\" aceita no maximo " + format.max_scoops +
        " bola(s); foram pedidas " + flavorIds.length + ".",
    );
  }

  const menu = await loadMenu();
  if (isError(menu)) return menu;

  const chosen: Flavor[] = [];
  const unknown: string[] = [];
  const unavailable: string[] = [];
  for (const id of flavorIds) {
    const f = menu.find((x) => x.id === normalize(String(id)));
    if (!f) unknown.push(String(id));
    else if (!f.available) unavailable.push(f.id);
    else chosen.push(f);
  }
  if (unknown.length) {
    return fail("FLAVOR_NOT_FOUND", "Sabor(es) inexistente(s): " + unknown.join(", ") + ".");
  }
  if (unavailable.length) {
    return fail("FLAVOR_UNAVAILABLE", "Sabor(es) esgotado(s) hoje: " + unavailable.join(", ") + ".");
  }

  const chosenToppings: Topping[] = [];
  const unknownToppings: string[] = [];
  for (const id of params.toppings ?? []) {
    const t = toppings.find((x) => x.id === normalize(String(id)));
    if (!t) unknownToppings.push(String(id));
    else chosenToppings.push(t);
  }
  if (unknownToppings.length) {
    return fail("TOPPING_NOT_FOUND", "Adicional(is) inexistente(s): " + unknownToppings.join(", ") + ".");
  }

  const weekday = params.weekday ?? resolveNow().weekday;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return fail("INVALID_WEEKDAY", "weekday deve ser um inteiro de 0 (domingo) a 6 (sabado).");
  }

  // Preco = base do formato + preco por bola de cada sabor + adicionais.
  const items: QuoteItem[] = [
    { type: "format", id: format.id, name: format.name, price_cents: format.base_price_cents },
    ...chosen.map((f): QuoteItem => ({ type: "flavor", id: f.id, name: f.name, price_cents: f.price_cents })),
    ...chosenToppings.map((t): QuoteItem => ({ type: "topping", id: t.id, name: t.name, price_cents: t.price_cents })),
  ];
  const subtotal = items.reduce((sum, i) => sum + i.price_cents, 0);

  // Uma promocao por pedido: a que der o maior desconto no dia.
  let best: { promo: Promo; value: number } | null = null;
  for (const promo of promos) {
    if (!promo.weekdays.includes(weekday)) continue;
    const value = discountFor(promo, format, subtotal);
    if (value > 0 && (!best || value > best.value)) best = { promo, value };
  }

  const discount = Math.min(best ? best.value : 0, subtotal);
  const allergens = Array.from(new Set([
    ...chosen.flatMap((f) => f.allergens),
    ...chosenToppings.flatMap((t) => t.allergens),
  ])).sort();

  return {
    items,
    subtotal_cents: subtotal,
    discount_cents: discount,
    total_cents: subtotal - discount,
    currency: "BRL",
    applied_promo: best
      ? { id: best.promo.id, name: best.promo.name, description: best.promo.description }
      : null,
    weekday,
    weekday_name: WEEKDAY_NAMES_PT[weekday],
    allergens,
    is_open: (await getShopInfo()).is_open,
  };
}

// ---------------------------------------------------------------- recomendacao

interface ProfileRule {
  keys: string[];
  reason: string;
  score: (f: Flavor) => number;
}

/** Recomendacao deterministica: palavras-chave do perfil pontuam contra os dados do sabor. */
const PROFILE_RULES: ProfileRule[] = [
  {
    keys: ["leve", "light", "suave", "pouco doce"],
    reason: "e leve e pouco doce",
    score: (f) => (f.sweetness <= 2 ? 3 : f.sweetness === 3 ? 1 : 0),
  },
  {
    keys: ["cremoso", "cremosa", "encorpado", "encorpada"],
    reason: "tem textura cremosa e encorpada",
    score: (f) => (f.category === "creme" || f.category === "gelato" ? 3 : 0),
  },
  {
    keys: ["citrico", "citrica", "acido", "acida", "azedo"],
    reason: "traz acidez citrica",
    score: (f) => (/limao|maracuja|citric/.test(normalize(f.name + " " + f.description)) ? 3 : 0),
  },
  {
    keys: ["chocolatudo", "chocolate", "cacau"],
    reason: "e puxado para o chocolate",
    score: (f) => (/chocolate|cacau/.test(normalize(f.name + " " + f.description)) ? 3 : 0),
  },
  {
    keys: ["refrescante", "frutado", "fruta", "verao", "fresco"],
    reason: "e refrescante e frutado",
    score: (f) => (f.category === "frutas" ? 3 : 0),
  },
  {
    keys: ["doce", "docinho", "adocicado"],
    reason: "e bem doce",
    score: (f) => (f.sweetness >= 4 ? 3 : 0),
  },
  {
    keys: ["castanha", "nozes", "amendoim", "crocante"],
    reason: "leva castanhas ou amendoim",
    score: (f) => (f.allergens.some((a) => a === "castanhas" || a === "amendoim") ? 3 : 0),
  },
];

export interface RecommendParams {
  profile?: string;
  dietary?: string;
  avoid_allergens?: string[];
  limit?: number;
}

export async function recommendFlavors(params: RecommendParams = {}) {
  const limit = Math.min(Math.max(params.limit ?? 3, 1), 5);
  const profile = normalize(params.profile ?? "");

  const pool = await searchFlavors({
    dietary: params.dietary,
    avoid_allergens: params.avoid_allergens,
    only_available: true,
  });
  if ("error" in pool) return pool;

  if (pool.flavors.length === 0) {
    return fail(
      "NO_MATCH",
      "Nenhum sabor disponivel atende a essa restricao hoje. Tente sem o filtro de dieta.",
    );
  }

  const matched = PROFILE_RULES.filter((r) => r.keys.some((k) => profile.includes(k)));

  const ranked = pool.flavors
    .map((f) => {
      const reasons = matched.filter((r) => r.score(f) > 0);
      const score = matched.reduce((sum, r) => sum + r.score(f), 0) + f.popularity * 0.5;
      const reason = reasons.length
        ? f.name + " " + reasons.map((r) => r.reason).join(" e ") + "."
        : f.name + " e um dos sabores mais pedidos da casa.";
      return { flavor: f, score, reason };
    })
    .sort((a, b) => b.score - a.score || b.flavor.popularity - a.flavor.popularity)
    .slice(0, limit)
    .map((entry) => ({ ...entry.flavor, reason: entry.reason }));

  return {
    profile: params.profile ?? null,
    dietary: params.dietary ?? null,
    matched_criteria: matched.map((r) => r.keys[0]),
    count: ranked.length,
    recommendations: ranked,
  };
}

// ---------------------------------------------------------------- catalogo e manifesto

export function getCatalog() {
  return { formats, toppings, promos };
}

export const MANIFEST = {
  id: "icecream",
  name: "Sorveteria Polar",
  description: "Consulta sabores, precos e disponibilidade da sorveteria da cidade, mantem o cardapio e o cadastro de clientes",
  tools: [
    "search_flavors", "quote_order", "recommend_flavors",
    "create_flavor", "update_flavor", "delete_flavor",
    "list_customers", "get_customer", "create_customer", "update_customer", "delete_customer",
  ],
  /** As tools de escrita exigem o parametro magic_word; as de leitura, nao. */
  write_tools_require: "magic_word",
};
