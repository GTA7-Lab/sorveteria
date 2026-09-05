// Endpoint MCP remoto da Sorveteria Polar (Streamable HTTP).
// URL: /api/mcp -> e o que o Core Orchestrator da GTA7 Lab consome.
// As tools sao as mesmas do servidor stdio; ambas vem de src/mcp/tools.ts.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createIcecreamServer } from "../src/mcp/tools";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // A cidade consome esta entidade a partir de outras origens.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Sem sessao: cada request e independente, que e o que funciona em serverless.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createIcecreamServer();

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[icecream] erro no endpoint MCP:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Erro interno no servidor MCP da Sorveteria Polar." },
        id: null,
      });
    }
  }
}
