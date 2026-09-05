// Validacoes compartilhadas pelos dois modulos de escrita (src/flavors.ts e
// src/customers.ts). Mantem os dois falando a mesma lingua de erro e evita que
// sabor e cliente divirjam em coisas como formato de id ou carimbo de tempo.

import { normalize } from "./core";
import type { CoreError } from "./types";

export function fail(code: string, message: string): CoreError {
  return { error: { code, message } };
}

export function isFail(value: unknown): value is CoreError {
  return typeof value === "object" && value !== null && "error" in value;
}

export function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Slug no mesmo formato dos ids que ja existem em data/flavors.json. */
export function slugify(name: string): string {
  return normalize(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function uniqueId(name: string, taken: Set<string>, fallback: string): string {
  const base = slugify(name) || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = base + "-" + n;
    if (!taken.has(candidate)) return candidate;
  }
  return base + "-" + Date.now();
}

/**
 * Carimbo estritamente posterior ao anterior. Duas escritas no mesmo milissegundo
 * — comum em teste e em chamadas MCP em sequencia — dariam o mesmo ISO, e quem
 * acompanha o cadastro por updated_at nao veria a alteracao.
 */
export function stampAfter(previous: string): string {
  const now = Date.now();
  const before = Date.parse(previous);
  return new Date(Number.isNaN(before) ? now : Math.max(now, before + 1)).toISOString();
}

/** Texto opcional: string vazia e null viram null; acima do limite e erro. */
export function cleanText(value: unknown, max: number, label: string): string | null | CoreError {
  if (value === null) return null;
  if (typeof value !== "string") return fail("INVALID_FIELD", label + " deve ser string ou null.");
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) {
    return fail("INVALID_FIELD", label + " excede o limite de " + max + " caracteres.");
  }
  return trimmed;
}

/** Texto obrigatorio. */
export function requiredText(value: unknown, max: number, label: string, missingCode: string): string | CoreError {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(missingCode, "Informe " + label + ".");
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return fail("INVALID_FIELD", label + " deve ter no maximo " + max + " caracteres.");
  }
  return trimmed;
}

export function cleanEnum<T extends string>(
  value: unknown, allowed: readonly T[], code: string, label: string,
): T | CoreError {
  const tag = normalize(String(value)) as T;
  if (!allowed.includes(tag)) {
    return fail(code, '"' + value + '" nao e um valor valido para ' + label + ". Aceitos: " + allowed.join(", ") + ".");
  }
  return tag;
}

export function cleanEnumList<T extends string>(
  value: unknown, allowed: readonly T[], code: string, label: string,
): T[] | CoreError {
  if (!Array.isArray(value)) {
    return fail("INVALID_FIELD", label + " deve ser uma lista.");
  }
  const out: T[] = [];
  for (const raw of value) {
    const tag = cleanEnum(raw, allowed, code, label);
    if (isFail(tag)) return tag;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

export function cleanInt(
  value: unknown, min: number, max: number, label: string, code = "INVALID_FIELD",
): number | CoreError {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return fail(code, label + " deve ser um numero inteiro.");
  }
  if (n < min || n > max) {
    return fail(code, label + " deve estar entre " + min + " e " + max + "; veio " + n + ".");
  }
  return n;
}

export function cleanBoolean(value: unknown, label: string): boolean | CoreError {
  if (typeof value !== "boolean") return fail("INVALID_FIELD", label + " deve ser true ou false.");
  return value;
}

/** Campos que mudaram de fato entre dois registros, ignorando o carimbo de tempo. */
export function changedFields<T extends object>(before: T, after: T): string[] {
  return (Object.keys(after) as (keyof T)[])
    .filter((k) => k !== "updated_at" && JSON.stringify(after[k]) !== JSON.stringify(before[k]))
    .map(String);
}
