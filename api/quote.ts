import type { VercelRequest, VercelResponse } from "@vercel/node";
import { quoteOrder } from "../src/core";
import { respond, one, num, list } from "./_respond";

// Aceita GET (listas separadas por virgula, facil de testar no browser)
// e POST com JSON, para uso pelo Core Orchestrator.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) ?? {};
    respond(res, await quoteOrder({
      format: body.format,
      flavor_ids: body.flavor_ids ?? [],
      toppings: body.toppings ?? [],
      weekday: body.weekday,
    }));
    return;
  }

  respond(res, await quoteOrder({
    format: one(req.query.format) ?? "",
    flavor_ids: list(req.query.flavor_ids),
    toppings: list(req.query.toppings),
    weekday: num(req.query.weekday),
  }));
}
