import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MANIFEST } from "../src/core";
import { respond } from "./_respond";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  respond(res, MANIFEST);
}
