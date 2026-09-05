// Testa as regras do core sem framework: node scripts/smoke.ts via tsx.
import {
  searchFlavors, getFlavor, getShopInfo, quoteOrder, recommendFlavors,
} from "../src/core";
import { flavors } from "../src/data";
import type { CoreError } from "../src/types";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log("  ok   " + label);
  } else {
    failed++;
    console.log("  FALHA " + label);
    if (detail !== undefined) console.log("        " + JSON.stringify(detail));
  }
}

/** Desembrulha um retorno do core, falhando alto se veio { error }. */
function ok<T>(value: T): Exclude<T, CoreError> {
  if (value && typeof value === "object" && "error" in value) {
    throw new Error("esperava sucesso, veio erro: " + JSON.stringify(value));
  }
  return value as Exclude<T, CoreError>;
}

console.log("\n== sabores ==");
const all = ok(searchFlavors({}));
check("por padrao lista so os disponiveis", all.count === flavors.filter((f) => f.available).length);
check("nenhum esgotado no resultado padrao", all.flavors.every((f) => f.available));

const withSoldOut = ok(searchFlavors({ only_available: false }));
check("only_available=false traz o cardapio inteiro", withSoldOut.count === flavors.length);

const acai = ok(searchFlavors({ query: "acai" }));
check("busca sem acento acha 'Acai'", acai.flavors.some((f) => f.id === "acai-com-banana"), acai.flavors.map((f) => f.id));
const caixa = ok(searchFlavors({ query: "CHOCOLATE BELGA" }));
check("busca ignora caixa alta", caixa.flavors.some((f) => f.id === "chocolate-belga-70"));

const veganos = ok(searchFlavors({ dietary: "vegano" }));
check("filtro vegano tem resultado", veganos.count >= 2, veganos.count);
check("todo vegano tem a tag no array dietary", veganos.flavors.every((f) => f.dietary.includes("vegano")));
check("nenhum vegano tem leite nos alergenicos", veganos.flavors.every((f) => !f.allergens.includes("leite")));
check("filtro dietary usa a tag, nao a categoria", veganos.flavors.some((f) => f.category !== "vegano"),
  veganos.flavors.map((f) => f.id + ":" + f.category));

const semCastanha = ok(searchFlavors({ avoid_allergens: ["castanhas"] }));
check("avoid_allergens exclui castanhas", semCastanha.flavors.every((f) => !f.allergens.includes("castanhas")));

const barato = ok(searchFlavors({ max_price: 950 }));
check("max_price respeitado", barato.flavors.every((f) => f.price_cents <= 950));

console.log("\n== erros previsiveis ==");
const semSabor = getFlavor("nao-existe");
check("getFlavor com id invalido retorna erro", "error" in semSabor && semSabor.error.code === "FLAVOR_NOT_FOUND", semSabor);
const um = ok(getFlavor("baunilha-madagascar"));
check("getFlavor com id valido retorna o sabor", um.name === "Baunilha de Madagascar");

console.log("\n== loja ==");
const shopNow = getShopInfo();
check("is_open e booleano", typeof shopNow.is_open === "boolean");
check("sabor do dia resolvido", shopNow.flavor_of_the_day !== null && shopNow.flavor_of_the_day.id === "gelato-stracciatella");
const segunda = getShopInfo("2026-09-07T18:00:00-03:00"); // segunda: fechado
check("segunda-feira aparece fechada", segunda.is_open === false && segunda.today_hours === null, segunda.weekday_name);
const sabado = getShopInfo("2026-09-05T18:00:00-03:00"); // sabado 18h: aberto
check("sabado as 18h aparece aberta", sabado.is_open === true, sabado.weekday_name);
const sabadoCedo = getShopInfo("2026-09-05T09:00:00-03:00"); // antes de abrir
check("sabado as 9h ainda fechada", sabadoCedo.is_open === false);

console.log("\n== pedido ==");
const semPromo = ok(quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar"], weekday: 1 }));
check("segunda nao tem promo de casquinha", semPromo.discount_cents === 0 && semPromo.applied_promo === null);
check("subtotal = base 300 + bola 900", semPromo.subtotal_cents === 1200, semPromo.subtotal_cents);
check("total = subtotal - desconto", semPromo.total_cents === semPromo.subtotal_cents - semPromo.discount_cents);

const comPromo = ok(quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar"], weekday: 2 }));
check("terca aplica a Terca da Casquinha", comPromo.applied_promo?.id === "terca-da-casquinha", comPromo.applied_promo);
check("desconto de 20% sobre o subtotal (1200) = 240", comPromo.discount_cents === 240, comPromo.discount_cents);
check("mesmo subtotal, total menor que sem promo", comPromo.total_cents < semPromo.total_cents);

const comAdicional = ok(quoteOrder({
  format: "taca", flavor_ids: ["chocolate-belga-70", "pistache-siciliano"], toppings: ["castanha_caju"], weekday: 1,
}));
check("itens detalhados: 1 formato + 2 sabores + 1 adicional", comAdicional.items.length === 4);
check("alergenicos agregados do pedido", comAdicional.allergens.includes("castanhas") && comAdicional.allergens.includes("leite"), comAdicional.allergens);

const maiorDesconto = ok(quoteOrder({ format: "pote_1l", flavor_ids: ["chocolate-belga-70", "pistache-siciliano", "gelato-avela-piemonte", "doce-de-leite-artesanal", "morango-do-vale"], weekday: 3 }));
check("vence a promo de maior desconto", maiorDesconto.discount_cents > 0, maiorDesconto.applied_promo);

const esgotado = quoteOrder({ format: "copo", flavor_ids: ["pacoca-crocante"], weekday: 1 });
check("sabor esgotado da erro proprio", "error" in esgotado && esgotado.error.code === "FLAVOR_UNAVAILABLE", esgotado);
const demais = quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar", "morango-do-vale", "maracuja-cremoso"], weekday: 1 });
check("bolas acima do limite da erro distinto", "error" in demais && demais.error.code === "TOO_MANY_SCOOPS", demais);
const semFormato = quoteOrder({ format: "banheira", flavor_ids: ["baunilha-madagascar"] });
check("formato inexistente da erro claro", "error" in semFormato && semFormato.error.code === "FORMAT_NOT_FOUND");
const vazio = quoteOrder({ format: "copo", flavor_ids: [] });
check("pedido sem sabor da erro", "error" in vazio && vazio.error.code === "EMPTY_ORDER");
const topInvalido = quoteOrder({ format: "copo", flavor_ids: ["baunilha-madagascar"], toppings: ["ouro"] });
check("adicional inexistente da erro", "error" in topInvalido && topInvalido.error.code === "TOPPING_NOT_FOUND");

console.log("\n== recomendacao ==");
const rec = ok(recommendFlavors({ profile: "chocolatudo", dietary: "vegano" }));
check("no maximo 3 recomendacoes", rec.count <= 3 && rec.count >= 1, rec.count);
check("todas veganas", rec.recommendations.every((f) => f.dietary.includes("vegano")));
check("todas com justificativa", rec.recommendations.every((f) => typeof f.reason === "string" && f.reason.length > 0));
check("chocolate vegano vem em primeiro", rec.recommendations[0].id === "chocolate-vegano-zero", rec.recommendations.map((f) => f.id));

const leve = ok(recommendFlavors({ profile: "algo leve e citrico", limit: 2 }));
check("limit respeitado", leve.count === 2);
check("perfil citrico casa criterios", leve.matched_criteria.length >= 1, leve.matched_criteria);
check("limao siciliano entre os leves e citricos", leve.recommendations.some((f) => f.id === "limao-siciliano"), leve.recommendations.map((f) => f.id));

const vago = ok(recommendFlavors({ profile: "qualquer coisa" }));
check("perfil sem match cai na popularidade", vago.count === 3 && vago.recommendations.every((f) => f.reason.includes("mais pedidos")));

const semNada = recommendFlavors({ dietary: "vegano", avoid_allergens: ["leite", "soja", "castanhas", "amendoim", "gluten"], profile: "chocolate" });
check("restricao impossivel nao quebra", !("error" in semNada) || semNada.error.code === "NO_MATCH");

console.log("\n" + passed + " passaram, " + failed + " falharam\n");
process.exit(failed === 0 ? 0 : 1);
