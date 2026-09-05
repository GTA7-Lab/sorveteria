// Estruturas dos arquivos em data/. Chaves em ingles, conteudo em portugues.

export type Category =
  | "creme" | "frutas" | "especial" | "gelato" | "vegano" | "zero_acucar";

export type DietaryTag =
  | "vegano" | "sem_lactose" | "sem_gluten" | "zero_acucar";

export type Allergen =
  | "leite" | "amendoim" | "castanhas" | "soja" | "gluten";

export interface Flavor {
  id: string;
  name: string;
  description: string;
  category: Category;
  price_cents: number;
  available: boolean;
  /** Fonte unica de verdade da dieta. Nunca inferir do texto nem da categoria. */
  dietary: DietaryTag[];
  allergens: Allergen[];
  /** 1 (pouco doce) a 5 (muito doce). */
  sweetness: number;
  /** 0 a 5. */
  popularity: number;
  seasonal: string | null;
}

export interface Format {
  id: string;
  name: string;
  description: string;
  /** Quantidade de bolas que o formato costuma levar (informativo). */
  included_scoops: number;
  /** Limite validado por quoteOrder. */
  max_scoops: number;
  base_price_cents: number;
}

export interface Topping {
  id: string;
  name: string;
  price_cents: number;
  allergens: Allergen[];
}

export interface PromoRule {
  type: "percent_off" | "fixed_off";
  /** Percentual (1-100) para percent_off, centavos para fixed_off. */
  value: number;
  applies_to: "total" | "format";
  /** So em applies_to "format". */
  format_ids?: string[];
  /** So em applies_to "total". */
  min_total_cents?: number;
}

export interface Promo {
  id: string;
  name: string;
  description: string;
  /** 0 = domingo ... 6 = sabado (convencao de Date.getDay()). */
  weekdays: number[];
  rule: PromoRule;
}

export interface OpeningWindow {
  open: string;  // "HH:MM"
  close: string; // "HH:MM"
}

export interface Shop {
  id: string;
  name: string;
  public_name: string;
  description: string;
  address: string;
  district: string;
  phone: string;
  timezone: string;
  payment_methods: string[];
  delivery: boolean;
  flavor_of_the_day: string;
  /** Chaves sun..sat; null = fechado no dia. */
  hours: Record<string, OpeningWindow | null>;
}

/** Erro previsivel: nenhuma funcao do core lanca excecao. */
export interface CoreError {
  error: { code: string; message: string };
}

export function isError(value: unknown): value is CoreError {
  return typeof value === "object" && value !== null && "error" in value;
}
