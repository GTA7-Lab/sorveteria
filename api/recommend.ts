import type { VercelRequest, VercelResponse } from "@vercel/node";
import { recommendFlavors } from "../src/core";
import { respond, one, num, list } from "./_respond";

export default function handler(req: VercelRequest, res: VercelResponse) {
  respond(res, recommendFlavors({
    profile: one(req.query.profile),
    dietary: one(req.query.dietary),
    avoid_allergens: list(req.query.avoid_allergens),
    limit: num(req.query.limit),
  }));
}
