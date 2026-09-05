import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getFlavor } from "../../src/core";
import { respond, one } from "./../_respond";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  respond(res, await getFlavor(one(req.query.id) ?? ""));
}
