import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getShopInfo } from "../src/core";
import { respond, one } from "./_respond";

export default function handler(req: VercelRequest, res: VercelResponse) {
  respond(res, getShopInfo(one(req.query.datetime)));
}
