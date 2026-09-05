// Acesso aos dados da entidade.
//
// Duas naturezas convivem aqui:
//
//   Fixo    formats, toppings, promos e shop vem direto do bundle. Nao tem CRUD,
//           entao continuam sincronos e sao a fonte de verdade em si.
//   Mutavel flavors e customers tem CRUD e mudam em runtime, entao passam pelo
//           store (src/store.ts). Para eles, o JSON de data/ e apenas o SEED —
//           o estado inicial que o store publica na primeira leitura.

import flavorsJson from "../data/flavors.json";
import formatsJson from "../data/formats.json";
import toppingsJson from "../data/toppings.json";
import promosJson from "../data/promos.json";
import shopJson from "../data/shop.json";
import customersJson from "../data/customers.json";

import { collection } from "./store";
import type { Flavor, Format, Topping, Promo, Shop, Customer } from "./types";

// ------------------------------------------------------------------- fixo

export const formats = formatsJson as Format[];
export const toppings = toppingsJson as Topping[];
export const promos = promosJson as Promo[];
export const shop = shopJson as Shop;

// ---------------------------------------------------------------- mutavel

export const flavorsSeed = flavorsJson as Flavor[];
export const customersSeed = customersJson as Customer[];

export const flavorsCollection = collection<Flavor>("flavors", flavorsSeed);
export const customersCollection = collection<Customer>("customers", customersSeed);

/** Cardapio vivo. Assincrono porque sabores podem ser criados e removidos via MCP. */
export function readFlavors(): Promise<Flavor[]> {
  return flavorsCollection.read();
}

export function readCustomers(): Promise<Customer[]> {
  return customersCollection.read();
}
