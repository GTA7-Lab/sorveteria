import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getShopInfo } from "../src/core";
import { respond, one } from "./_respond";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  respond(res, await getShopInfo(one(req.query.datetime)));
}
