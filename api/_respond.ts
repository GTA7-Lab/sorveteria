// Helper compartilhado pelas rotas REST: converte o retorno do core em HTTP.
import type { VercelRequest, VercelResponse } from "@vercel/node";

const HTTP_BY_CODE: Record<string, number> = {
  FLAVOR_NOT_FOUND: 404,
  FORMAT_NOT_FOUND: 404,
  TOPPING_NOT_FOUND: 404,
  NO_MATCH: 404,
};

export function respond(res: VercelResponse, result: unknown): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // A cidade GTA7 Lab consome esta entidade a partir de outras origens.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (result && typeof result === "object" && "error" in result) {
    const code = (result as { error: { code: string } }).error.code;
    res.status(HTTP_BY_CODE[code] ?? 400).json(result);
    return;
  }
  res.status(200).json(result);
}

/** Le um query param que pode vir repetido (?x=a&x=b) como string simples. */
export function one(value: VercelRequest["query"][string]): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v === "" ? undefined : v;
}

/** Le uma lista separada por virgula: ?flavor_ids=a,b,c */
export function list(value: VercelRequest["query"][string]): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

export function num(value: VercelRequest["query"][string]): number | undefined {
  const v = one(value);
  if (v === undefined) return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}
