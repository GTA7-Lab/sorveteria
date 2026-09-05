// Os arquivos JSON de data/ sao a unica fonte de verdade da entidade.
// Site, API REST e servidor MCP leem daqui, sem duplicar regra.

import flavorsJson from "../data/flavors.json";
import formatsJson from "../data/formats.json";
import toppingsJson from "../data/toppings.json";
import promosJson from "../data/promos.json";
import shopJson from "../data/shop.json";

import type { Flavor, Format, Topping, Promo, Shop } from "./types";

export const flavors = flavorsJson as Flavor[];
export const formats = formatsJson as Format[];
export const toppings = toppingsJson as Topping[];
export const promos = promosJson as Promo[];
export const shop = shopJson as Shop;
