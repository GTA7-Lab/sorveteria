#!/usr/bin/env node
// Servidor MCP da Sorveteria Polar por stdio, para rodar local.
// As tools vivem em src/mcp/tools.ts, compartilhadas com o endpoint HTTP em api/mcp.ts.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createIcecreamServer, TOOLS } from "./tools";

async function main() {
  await createIcecreamServer().connect(new StdioServerTransport());
  // stdout e do protocolo; qualquer log tem que ir para stderr.
  console.error("[icecream] Sorveteria Polar MCP pronto (" + TOOLS.length + " tools)");
}

main().catch((err) => {
  console.error("[icecream] falha ao iniciar:", err);
  process.exit(1);
});
