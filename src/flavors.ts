// CRUD dos sabores — os produtos da Sorveteria Polar.
//
// Escrita do cardapio. A leitura continua em src/core.ts (searchFlavors, getFlavor),
// que agora le a colecao viva em vez do bundle. Toda funcao daqui exige a palavra
// magica: sao as operacoes que reescrevem o produto da entidade.
//
// Invariantes que este modulo defende, alem das validacoes de campo:
//   1. dieta e alergenico nao podem se contradizer (um sabor "vegano" com leite
//      envenenaria justamente a pergunta que a entidade existe para responder);
//   2. o sabor do dia nao pode ser removido enquanto for o sabor do dia;
//   3. remover um sabor nao deixa referencia pendurada em favorite_flavor_ids.

import { flavorsCollection, customersCollection, shop } from "./data";
import { normalize } from "./core";
import { authorizeWrite } from "./guard";
import { storeInfo } from "./store";
import {
  fail, isFail, slugify, uniqueId, cleanText, requiredText,
  cleanEnum, cleanEnumList, cleanInt, cleanBoolean, changedFields,
} from "./validate";
import type { Flavor, CoreError, Category, DietaryTag, Allergen } from "./types";

const CATEGORIES: Category[] = ["creme", "frutas", "especial", "gelato", "vegano", "zero_acucar"];
const DIETARY_TAGS: DietaryTag[] = ["vegano", "sem_lactose", "sem_gluten", "zero_acucar"];
const ALLERGENS: Allergen[] = ["leite", "amendoim", "castanhas", "soja", "gluten"];

const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;
/** R$ 500,00 por bola: um teto que so pega erro de digitacao (centavos x reais). */
const MAX_PRICE_CENTS = 50_000;

/**
 * Alergenicos que cada tag de dieta proibe. `zero_acucar` nao implica alergenico
 * nenhum — acucar nao esta na lista de alergenicos da entidade.
 */
const FORBIDDEN_BY_DIET: Record<DietaryTag, Allergen[]> = {
  vegano: ["leite"],
  sem_lactose: ["leite"],
  sem_gluten: ["gluten"],
  zero_acucar: [],
};

function storeFailure(err: unknown): CoreError {
  return fail("STORAGE_ERROR", "Nao foi possivel acessar o cardapio: " + ((err as Error)?.message ?? err));
}

/**
 * A regra mais importante do modulo. `dietary` e a unica fonte de verdade da dieta,
 * entao um sabor marcado "vegano" com leite nos alergenicos apareceria numa busca
 * por vegano — e a entidade e exatamente quem responde o que um cidadao com
 * restricao pode consumir. Isso e erro, nao aviso.
 */
function dietaryConflict(dietary: DietaryTag[], allergens: Allergen[]): CoreError | null {
  for (const tag of dietary) {
    for (const forbidden of FORBIDDEN_BY_DIET[tag]) {
      if (allergens.includes(forbidden)) {
        return fail(
          "DIETARY_CONFLICT",
          'Um sabor com a tag "' + tag + '" nao pode ter "' + forbidden + '" nos alergenicos. ' +
          "Corrija dietary ou allergens: a busca por restricao alimentar depende dessa coerencia.",
        );
      }
    }
  }
  return null;
}

/** Aceita price_cents (canonico) ou price_brl, que existe para quem pensa em reais. */
function resolvePrice(input: { price_cents?: unknown; price_brl?: unknown }): number | CoreError | undefined {
  if (input.price_cents !== undefined) {
    return cleanInt(input.price_cents, 1, MAX_PRICE_CENTS, "price_cents", "INVALID_PRICE");
  }
  if (input.price_brl !== undefined) {
    const brl = typeof input.price_brl === "number" ? input.price_brl : Number(input.price_brl);
    if (!Number.isFinite(brl)) return fail("INVALID_PRICE", "price_brl deve ser um numero em reais.");
    return cleanInt(Math.round(brl * 100), 1, MAX_PRICE_CENTS, "price_brl convertido em centavos", "INVALID_PRICE");
  }
  return undefined;
}

export interface FlavorInput {
  name?: unknown;
  description?: unknown;
  category?: unknown;
  price_cents?: unknown;
  price_brl?: unknown;
  available?: unknown;
  dietary?: unknown;
  allergens?: unknown;
  sweetness?: unknown;
  popularity?: unknown;
  seasonal?: unknown;
}

// ---------------------------------------------------------------- criacao

export async function createFlavor(input: FlavorInput = {}, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "criar um sabor");
  if (denied) return denied;

  const name = requiredText(input.name, MAX_NAME, "o nome do sabor em name", "MISSING_NAME");
  if (isFail(name)) return name;

  const description = input.description === undefined
    ? null
    : cleanText(input.description, MAX_DESCRIPTION, "description");
  if (isFail(description)) return description;

  if (input.category === undefined) {
    return fail("MISSING_CATEGORY", "Informe a categoria em category. Aceitas: " + CATEGORIES.join(", ") + ".");
  }
  const category = cleanEnum(input.category, CATEGORIES, "INVALID_CATEGORY", "category");
  if (isFail(category)) return category;

  const price = resolvePrice(input);
  if (price === undefined) {
    return fail("MISSING_PRICE", "Informe o preco por bola em price_cents (centavos) ou price_brl (reais).");
  }
  if (isFail(price)) return price;

  const available = input.available === undefined ? true : cleanBoolean(input.available, "available");
  if (isFail(available)) return available;

  const dietary = input.dietary === undefined
    ? []
    : cleanEnumList(input.dietary, DIETARY_TAGS, "INVALID_DIETARY", "dietary");
  if (isFail(dietary)) return dietary;

  const allergens = input.allergens === undefined
    ? []
    : cleanEnumList(input.allergens, ALLERGENS, "INVALID_ALLERGEN", "allergens");
  if (isFail(allergens)) return allergens;

  const conflict = dietaryConflict(dietary, allergens);
  if (conflict) return conflict;

  const sweetness = input.sweetness === undefined ? 3 : cleanInt(input.sweetness, 1, 5, "sweetness");
  if (isFail(sweetness)) return sweetness;

  const popularity = input.popularity === undefined ? 0 : cleanInt(input.popularity, 0, 5, "popularity");
  if (isFail(popularity)) return popularity;

  const seasonal = input.seasonal === undefined ? null : cleanText(input.seasonal, 40, "seasonal");
  if (isFail(seasonal)) return seasonal;

  let menu: Flavor[];
  try {
    menu = await flavorsCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const slug = slugify(name);
  if (menu.some((f) => f.id === slug)) {
    return fail("FLAVOR_EXISTS", 'Ja existe um sabor com o id "' + slug + '". Escolha outro nome.');
  }

  const flavor: Flavor = {
    id: uniqueId(name, new Set(menu.map((f) => f.id)), "sabor"),
    name,
    description: description ?? "",
    category,
    price_cents: price,
    available,
    dietary,
    allergens,
    sweetness,
    popularity,
    seasonal,
  };

  try {
    await flavorsCollection.write([...menu, flavor]);
  } catch (err) {
    return storeFailure(err);
  }

  return { created: true, flavor, storage: storeInfo() };
}

// ---------------------------------------------------------------- atualizacao

export async function updateFlavor(id: string, patch: FlavorInput = {}, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "atualizar um sabor");
  if (denied) return denied;

  if (!id) return fail("MISSING_ID", "Informe o id do sabor a atualizar.");

  let menu: Flavor[];
  try {
    menu = await flavorsCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const index = menu.findIndex((f) => f.id === normalize(id));
  if (index === -1) {
    return fail("FLAVOR_NOT_FOUND", 'Sabor "' + id + '" nao existe no cardapio da Sorveteria Polar.');
  }

  const current = menu[index];
  const next: Flavor = { ...current };

  // Chave ausente = campo intocado. O id nunca muda, mesmo se o nome mudar:
  // ele e referenciado por pedidos, favoritos de cliente e pelo sabor do dia.
  if (patch.name !== undefined) {
    const name = requiredText(patch.name, MAX_NAME, "o nome do sabor em name", "MISSING_NAME");
    if (isFail(name)) return name;
    next.name = name;
  }
  if (patch.description !== undefined) {
    const description = cleanText(patch.description, MAX_DESCRIPTION, "description");
    if (isFail(description)) return description;
    next.description = description ?? "";
  }
  if (patch.category !== undefined) {
    const category = cleanEnum(patch.category, CATEGORIES, "INVALID_CATEGORY", "category");
    if (isFail(category)) return category;
    next.category = category;
  }
  if (patch.price_cents !== undefined || patch.price_brl !== undefined) {
    const price = resolvePrice(patch);
    if (price === undefined || isFail(price)) return price ?? fail("INVALID_PRICE", "Preco invalido.");
    next.price_cents = price;
  }
  if (patch.available !== undefined) {
    const available = cleanBoolean(patch.available, "available");
    if (isFail(available)) return available;
    next.available = available;
  }
  if (patch.dietary !== undefined) {
    const dietary = cleanEnumList(patch.dietary, DIETARY_TAGS, "INVALID_DIETARY", "dietary");
    if (isFail(dietary)) return dietary;
    next.dietary = dietary;
  }
  if (patch.allergens !== undefined) {
    const allergens = cleanEnumList(patch.allergens, ALLERGENS, "INVALID_ALLERGEN", "allergens");
    if (isFail(allergens)) return allergens;
    next.allergens = allergens;
  }
  if (patch.sweetness !== undefined) {
    const sweetness = cleanInt(patch.sweetness, 1, 5, "sweetness");
    if (isFail(sweetness)) return sweetness;
    next.sweetness = sweetness;
  }
  if (patch.popularity !== undefined) {
    const popularity = cleanInt(patch.popularity, 0, 5, "popularity");
    if (isFail(popularity)) return popularity;
    next.popularity = popularity;
  }
  if (patch.seasonal !== undefined) {
    const seasonal = cleanText(patch.seasonal, 40, "seasonal");
    if (isFail(seasonal)) return seasonal;
    next.seasonal = seasonal;
  }

  // Checa o resultado final, nao so o que veio no patch: tirar "leite" e por a tag
  // "vegano" em chamadas separadas nao pode passar por uma brecha de ordem.
  const conflict = dietaryConflict(next.dietary, next.allergens);
  if (conflict) return conflict;

  const changed = changedFields(current, next);

  // Despublicar o sabor do dia deixaria a vitrine da loja sem destaque.
  if (!next.available && current.available && shop.flavor_of_the_day === current.id) {
    return fail(
      "FLAVOR_IS_FEATURED",
      'O sabor "' + current.name + '" e o sabor do dia da loja e nao pode ficar indisponivel. ' +
      "Troque flavor_of_the_day em data/shop.json antes.",
    );
  }

  const updated = [...menu];
  updated[index] = next;
  try {
    await flavorsCollection.write(updated);
  } catch (err) {
    return storeFailure(err);
  }

  return { updated: changed.length > 0, changed_fields: changed, flavor: next, storage: storeInfo() };
}

// ---------------------------------------------------------------- remocao

export async function deleteFlavor(id: string, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "remover um sabor");
  if (denied) return denied;

  if (!id) return fail("MISSING_ID", "Informe o id do sabor a remover.");

  let menu: Flavor[];
  try {
    menu = await flavorsCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const found = menu.find((f) => f.id === normalize(id));
  if (!found) {
    return fail("FLAVOR_NOT_FOUND", 'Sabor "' + id + '" nao existe no cardapio da Sorveteria Polar.');
  }

  if (shop.flavor_of_the_day === found.id) {
    return fail(
      "FLAVOR_IS_FEATURED",
      'O sabor "' + found.name + '" e o sabor do dia da loja e nao pode ser removido. ' +
      "Troque flavor_of_the_day em data/shop.json antes.",
    );
  }

  // Remover o sabor sem limpar os favoritos deixaria clientes apontando para um id
  // inexistente — e um cliente nesse estado nem poderia mais ser salvo, porque
  // create/update validam favorite_flavor_ids contra o cardapio.
  let unlinked: string[] = [];
  try {
    const customers = await customersCollection.read();
    const affected = customers.filter((c) => c.favorite_flavor_ids.includes(found.id));
    if (affected.length) {
      unlinked = affected.map((c) => c.id);
      await customersCollection.write(customers.map((c) => (
        c.favorite_flavor_ids.includes(found.id)
          ? { ...c, favorite_flavor_ids: c.favorite_flavor_ids.filter((f) => f !== found.id) }
          : c
      )));
    }
  } catch (err) {
    return storeFailure(err);
  }

  try {
    await flavorsCollection.write(menu.filter((f) => f.id !== found.id));
  } catch (err) {
    return storeFailure(err);
  }

  return {
    deleted: true,
    flavor: found,
    remaining: menu.length - 1,
    unlinked_from_customers: unlinked,
    storage: storeInfo(),
  };
}
