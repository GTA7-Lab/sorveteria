// Servidor local para rodar o site e a API sem depender do `vercel dev`
// (que exige login). Monta exatamente os mesmos handlers de api/, apenas
// adaptando req/res do node:http para o formato que a Vercel injeta.
//
//   npm run dev:local   ->  http://localhost:3000

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import manifestHandler from "../api/manifest";
import shopHandler from "../api/shop";
import flavorsHandler from "../api/flavors";
import flavorByIdHandler from "../api/flavors/[id]";
import quoteHandler from "../api/quote";
import recommendHandler from "../api/recommend";
import mcpHandler from "../api/mcp";

type Handler = (req: any, res: any) => void | Promise<void>;

const ROUTES: Record<string, Handler> = {
  "/api/manifest": manifestHandler,
  "/api/shop": shopHandler,
  "/api/flavors": flavorsHandler,
  "/api/quote": quoteHandler,
  "/api/recommend": recommendHandler,
  "/api/mcp": mcpHandler,
};

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:" + PORT);
  const pathname = url.pathname;

  // res.status().json() e o formato que os handlers da Vercel usam.
  const shim = res as any;
  shim.status = (code: number) => { res.statusCode = code; return shim; };
  shim.json = (payload: unknown) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload, null, 2));
  };

  const query: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }

  if (pathname.startsWith("/api/")) {
    const proxy = req as any;
    proxy.query = query;
    if (req.method === "POST") {
      const raw = await readBody(req);
      // o transporte MCP espera o corpo ja parseado; as demais rotas aceitam a string
      proxy.body = pathname === "/api/mcp" ? JSON.parse(raw || "{}") : raw;
    }

    const direct = ROUTES[pathname];
    const byId = pathname.match(/^\/api\/flavors\/([^/]+)$/);

    if (direct) return void direct(proxy, shim);
    if (byId) {
      proxy.query = { ...query, id: decodeURIComponent(byId[1]) };
      return void flavorByIdHandler(proxy, shim);
    }
    return void shim.status(404).json({ error: { code: "NOT_FOUND", message: "Rota " + pathname + " nao existe." } });
  }

  // Estatico: so o index.html, que e a unica pagina da entidade.
  const file = path.join(PUBLIC_DIR, "index.html");
  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return void res.end(fs.readFileSync(file));
  }
  res.statusCode = 404;
  res.end("Nao encontrado");
});

server.listen(PORT, () => {
  console.log("Sorveteria Polar rodando em http://localhost:" + PORT);
  console.log("  site      http://localhost:" + PORT + "/");
  console.log("  manifesto http://localhost:" + PORT + "/api/manifest");
});
