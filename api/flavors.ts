import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchFlavors } from "../src/core";
import { respond, one, num, list } from "./_respond";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const onlyAvailable = one(req.query.only_available);
  respond(res, await searchFlavors({
    query: one(req.query.query),
    category: one(req.query.category),
    dietary: one(req.query.dietary),
    max_price: num(req.query.max_price),
    avoid_allergens: list(req.query.avoid_allergens),
    only_available: onlyAvailable === undefined ? true : onlyAvailable !== "false",
  }));
}
