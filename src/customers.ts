// CRUD dos clientes da Sorveteria Polar.
//
// Ao lado de src/flavors.ts, a parte da regra de negocio que tem estado: as duas
// leem e escrevem colecoes do store, enquanto src/core.ts so calcula. Escrever
// exige a palavra magica (src/guard.ts); ler, nao.
//
// Dieta e alergenico usam a mesma taxonomia dos sabores de proposito: e o que
// permite cruzar o cadastro com o cardapio.

import { customersCollection, readFlavors } from "./data";
import { normalize } from "./core";
import { authorizeWrite } from "./guard";
import { storeInfo } from "./store";
import {
  fail, isFail, digits, uniqueId, stampAfter, cleanText, requiredText,
  cleanEnumList, changedFields,
} from "./validate";
import type { Customer, Flavor, CoreError, DietaryTag, Allergen } from "./types";

const DIETARY_TAGS: DietaryTag[] = ["vegano", "sem_lactose", "sem_gluten", "zero_acucar"];
const ALLERGENS: Allergen[] = ["leite", "amendoim", "castanhas", "soja", "gluten"];

const MAX_NAME = 80;
const MAX_NOTES = 500;

function storeFailure(err: unknown): CoreError {
  return fail("STORAGE_ERROR", "Nao foi possivel acessar o cadastro de clientes: " + ((err as Error)?.message ?? err));
}

// ---------------------------------------------------------------- validacao

function cleanEmail(value: unknown): string | null | CoreError {
  const text = cleanText(value, 120, "email");
  if (typeof text !== "string") return text;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return fail("INVALID_EMAIL", 'Email "' + text + '" nao tem formato valido.');
  }
  return text.toLowerCase();
}

function cleanPhone(value: unknown): string | null | CoreError {
  const text = cleanText(value, 30, "phone");
  if (typeof text !== "string") return text;
  if (digits(text).length < 8) {
    return fail("INVALID_PHONE", 'Telefone "' + text + '" precisa ter ao menos 8 digitos.');
  }
  return text;
}

/** Favoritos sao validados contra o cardapio vivo, nao contra o seed do bundle. */
function cleanFavorites(value: unknown, menu: Flavor[]): string[] | CoreError {
  if (!Array.isArray(value)) {
    return fail("INVALID_FIELD", "favorite_flavor_ids deve ser uma lista.");
  }
  const out: string[] = [];
  const unknown: string[] = [];
  for (const raw of value) {
    const id = normalize(String(raw));
    if (!menu.some((f) => f.id === id)) unknown.push(String(raw));
    else if (!out.includes(id)) out.push(id);
  }
  if (unknown.length) {
    return fail("FLAVOR_NOT_FOUND", "Sabor(es) inexistente(s) em favorite_flavor_ids: " + unknown.join(", ") + ".");
  }
  return out;
}

/**
 * Sabor favorito que colide com um alergenico declarado nao bloqueia o cadastro —
 * pode ser gosto legitimo ou erro de digitacao — mas volta como aviso, porque essa
 * checagem e justamente o que a entidade existe para responder.
 */
function allergenWarnings(customer: Customer, menu: Flavor[]): string[] {
  const warnings: string[] = [];
  for (const id of customer.favorite_flavor_ids) {
    const flavor = menu.find((f) => f.id === id);
    if (!flavor) continue;
    const clash = flavor.allergens.filter((a) => customer.allergens.includes(a));
    if (clash.length) {
      warnings.push(
        'O favorito "' + flavor.name + '" contem ' + clash.join(", ") +
        ", que consta como alergenico de " + customer.name + ".",
      );
    }
  }
  return warnings;
}

/** Telefone e email sao as chaves naturais: repeti-los quase sempre e cadastro duplicado. */
function duplicateOf(
  customers: Customer[],
  candidate: { email: string | null; phone: string | null },
  skipId?: string,
): Customer | undefined {
  return customers.find((c) => {
    if (c.id === skipId) return false;
    if (candidate.email && c.email && c.email.toLowerCase() === candidate.email.toLowerCase()) return true;
    if (candidate.phone && c.phone && digits(c.phone) === digits(candidate.phone)) return true;
    return false;
  });
}

// ---------------------------------------------------------------- leitura

export interface ListCustomersParams {
  query?: string;
  dietary?: string;
  allergen?: string;
  favorite_flavor_id?: string;
  limit?: number;
}

export async function listCustomers(params: ListCustomersParams = {}) {
  const { query, dietary, allergen, favorite_flavor_id, limit } = params;

  if (dietary !== undefined && !DIETARY_TAGS.includes(normalize(dietary) as DietaryTag)) {
    return fail("INVALID_DIETARY", '"' + dietary + '" nao e uma restricao valida. Aceitas: ' + DIETARY_TAGS.join(", ") + ".");
  }
  if (allergen !== undefined && !ALLERGENS.includes(normalize(allergen) as Allergen)) {
    return fail("INVALID_ALLERGEN", '"' + allergen + '" nao e um alergenico valido. Aceitos: ' + ALLERGENS.join(", ") + ".");
  }

  let customers: Customer[];
  try {
    customers = await customersCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const q = query ? normalize(query) : null;
  const diet = dietary ? normalize(dietary) : null;
  const allerg = allergen ? normalize(allergen) : null;
  const favorite = favorite_flavor_id ? normalize(favorite_flavor_id) : null;

  let result = customers.filter((c) => {
    if (diet && !c.dietary.includes(diet as DietaryTag)) return false;
    if (allerg && !c.allergens.includes(allerg as Allergen)) return false;
    if (favorite && !c.favorite_flavor_ids.includes(favorite)) return false;
    if (q) {
      const haystack = normalize([c.name, c.email ?? "", c.phone ?? "", c.district ?? "", c.notes ?? ""].join(" "));
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const total = result.length;
  if (typeof limit === "number" && limit > 0) result = result.slice(0, limit);

  return { count: result.length, total, filters: params, customers: result, storage: storeInfo() };
}

export async function getCustomer(id: string) {
  if (!id) return fail("MISSING_ID", "Informe o id do cliente.");

  let customers: Customer[];
  try {
    customers = await customersCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const found = customers.find((c) => c.id === normalize(id));
  if (!found) {
    return fail("CUSTOMER_NOT_FOUND", 'Cliente "' + id + '" nao esta cadastrado na Sorveteria Polar.');
  }
  return found;
}

// ---------------------------------------------------------------- escrita

export interface CustomerInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  district?: unknown;
  dietary?: unknown;
  allergens?: unknown;
  favorite_flavor_ids?: unknown;
  notes?: unknown;
}

export async function createCustomer(input: CustomerInput = {}, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "cadastrar um cliente");
  if (denied) return denied;

  const name = requiredText(input.name, MAX_NAME, "o nome do cliente em name", "MISSING_NAME");
  if (isFail(name)) return name;

  const phone = input.phone === undefined ? null : cleanPhone(input.phone);
  if (isFail(phone)) return phone;

  const email = input.email === undefined ? null : cleanEmail(input.email);
  if (isFail(email)) return email;

  const district = input.district === undefined ? null : cleanText(input.district, 60, "district");
  if (isFail(district)) return district;

  const notes = input.notes === undefined ? null : cleanText(input.notes, MAX_NOTES, "notes");
  if (isFail(notes)) return notes;

  const dietary = input.dietary === undefined
    ? []
    : cleanEnumList(input.dietary, DIETARY_TAGS, "INVALID_DIETARY", "dietary");
  if (isFail(dietary)) return dietary;

  const allergens = input.allergens === undefined
    ? []
    : cleanEnumList(input.allergens, ALLERGENS, "INVALID_ALLERGEN", "allergens");
  if (isFail(allergens)) return allergens;

  let menu: Flavor[];
  let customers: Customer[];
  try {
    [menu, customers] = await Promise.all([readFlavors(), customersCollection.read()]);
  } catch (err) {
    return storeFailure(err);
  }

  const favorites = input.favorite_flavor_ids === undefined
    ? []
    : cleanFavorites(input.favorite_flavor_ids, menu);
  if (isFail(favorites)) return favorites;

  const clash = duplicateOf(customers, { email, phone });
  if (clash) {
    return fail(
      "CUSTOMER_EXISTS",
      'Ja existe o cliente "' + clash.name + '" (id ' + clash.id + ") com esse telefone ou email.",
    );
  }

  const now = new Date().toISOString();
  const customer: Customer = {
    id: uniqueId(name, new Set(customers.map((c) => c.id)), "cliente"),
    name,
    phone,
    email,
    district,
    dietary,
    allergens,
    favorite_flavor_ids: favorites,
    notes,
    created_at: now,
    updated_at: now,
  };

  try {
    await customersCollection.write([...customers, customer]);
  } catch (err) {
    return storeFailure(err);
  }

  return { created: true, customer, warnings: allergenWarnings(customer, menu), storage: storeInfo() };
}

export async function updateCustomer(id: string, patch: CustomerInput = {}, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "atualizar um cliente");
  if (denied) return denied;

  if (!id) return fail("MISSING_ID", "Informe o id do cliente a atualizar.");

  let menu: Flavor[];
  let customers: Customer[];
  try {
    [menu, customers] = await Promise.all([readFlavors(), customersCollection.read()]);
  } catch (err) {
    return storeFailure(err);
  }

  const index = customers.findIndex((c) => c.id === normalize(id));
  if (index === -1) {
    return fail("CUSTOMER_NOT_FOUND", 'Cliente "' + id + '" nao esta cadastrado na Sorveteria Polar.');
  }

  const current = customers[index];
  const next: Customer = { ...current };

  // Chave ausente = campo intocado; string vazia limpa o campo.
  if (patch.name !== undefined) {
    const name = requiredText(patch.name, MAX_NAME, "o nome do cliente em name", "MISSING_NAME");
    if (isFail(name)) return name;
    next.name = name;
  }
  if (patch.phone !== undefined) {
    const phone = cleanPhone(patch.phone);
    if (isFail(phone)) return phone;
    next.phone = phone;
  }
  if (patch.email !== undefined) {
    const email = cleanEmail(patch.email);
    if (isFail(email)) return email;
    next.email = email;
  }
  if (patch.district !== undefined) {
    const district = cleanText(patch.district, 60, "district");
    if (isFail(district)) return district;
    next.district = district;
  }
  if (patch.notes !== undefined) {
    const notes = cleanText(patch.notes, MAX_NOTES, "notes");
    if (isFail(notes)) return notes;
    next.notes = notes;
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
  if (patch.favorite_flavor_ids !== undefined) {
    const favorites = cleanFavorites(patch.favorite_flavor_ids, menu);
    if (isFail(favorites)) return favorites;
    next.favorite_flavor_ids = favorites;
  }

  const clash = duplicateOf(customers, { email: next.email, phone: next.phone }, current.id);
  if (clash) {
    return fail(
      "CUSTOMER_EXISTS",
      'O telefone ou email informado ja pertence a "' + clash.name + '" (id ' + clash.id + ").",
    );
  }

  const changed = changedFields(current, next);
  // Patch que nao muda nada nao mexe em updated_at.
  next.updated_at = changed.length ? stampAfter(current.updated_at) : current.updated_at;

  const updated = [...customers];
  updated[index] = next;
  try {
    await customersCollection.write(updated);
  } catch (err) {
    return storeFailure(err);
  }

  return {
    updated: changed.length > 0,
    changed_fields: changed,
    customer: next,
    warnings: allergenWarnings(next, menu),
    storage: storeInfo(),
  };
}

export async function deleteCustomer(id: string, magicWord?: unknown) {
  const denied = authorizeWrite(magicWord, "remover um cliente");
  if (denied) return denied;

  if (!id) return fail("MISSING_ID", "Informe o id do cliente a remover.");

  let customers: Customer[];
  try {
    customers = await customersCollection.read();
  } catch (err) {
    return storeFailure(err);
  }

  const found = customers.find((c) => c.id === normalize(id));
  if (!found) {
    return fail("CUSTOMER_NOT_FOUND", 'Cliente "' + id + '" nao esta cadastrado na Sorveteria Polar.');
  }

  try {
    await customersCollection.write(customers.filter((c) => c.id !== found.id));
  } catch (err) {
    return storeFailure(err);
  }

  return { deleted: true, customer: found, remaining: customers.length - 1, storage: storeInfo() };
}
