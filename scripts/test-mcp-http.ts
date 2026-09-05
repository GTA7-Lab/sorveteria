// Testa o endpoint /api/mcp falando o protocolo na mao (JSON-RPC sobre Streamable HTTP).
//
//   npm run test:mcp
//   npm run test:mcp -- https://gta7-icecream.vercel.app/api/mcp
//
// Usa fetch em vez do cliente do SDK de proposito: o StreamableHTTPClientTransport
// mantem um stream SSE aberto e, no Windows com Node 24, derruba o processo com
// assertion do libuv ao fechar — o que mascararia o resultado dos testes.
// A integracao com o cliente real do SDK e coberta pelo `npm run smoke` do Core.

const url = process.argv[2] ?? "http://localhost:3000/api/mcp";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log("  ok   " + label);
  } else {
    failed++;
    console.log("  FALHA " + label);
    if (detail !== undefined) console.log("        " + JSON.stringify(detail));
  }
}

let nextId = 1;

/** Um POST JSON-RPC. A resposta vem como SSE de evento unico ("data: {...}"). */
async function rpc(method: string, params?: unknown): Promise<any> {
  const isNotification = method.startsWith("notifications/");
  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  if (!isNotification) body.id = nextId++;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (isNotification) return undefined;
  if (!res.ok) throw new Error(method + " -> HTTP " + res.status + ": " + (await res.text()));

  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const payload = JSON.parse(line ? line.slice(5).trim() : text);
  if (payload.error) throw new Error(method + " -> " + JSON.stringify(payload.error));
  return payload.result;
}

/** Toda tool devolve JSON estruturado dentro de content[0].text. */
function payloadOf(result: any): any {
  return JSON.parse(result.content[0].text);
}

async function main() {
  console.log("\nendpoint: " + url + "\n");

  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "icecream-test", version: "1.0.0" },
  });
  check("initialize responde", init.serverInfo?.name === "icecream", init.serverInfo);
  check("declara capability de tools", init.capabilities?.tools !== undefined);
  await rpc("notifications/initialized");

  const { tools } = await rpc("tools/list");
  const names = tools.map((t: any) => t.name);
  check("expoe as 3 tools", names.length === 3, names);
  check("search_flavors, quote_order e recommend_flavors",
    ["search_flavors", "quote_order", "recommend_flavors"].every((n) => names.includes(n)), names);
  check("toda tool tem descricao", tools.every((t: any) => (t.description ?? "").length > 0));

  const search = payloadOf(await rpc("tools/call", {
    name: "search_flavors",
    arguments: { dietary: "vegano", max_price: 1100 },
  }));
  check("search_flavors devolve resultados", search.count > 0, search.count);
  check("expoe o apelido items que o Core procura", Array.isArray(search.items));
  check("items espelha flavors", JSON.stringify(search.items) === JSON.stringify(search.flavors));
  check("respeita dietary e max_price",
    search.items.every((f: any) => f.dietary.includes("vegano") && f.price_cents <= 1100),
    search.items.map((f: any) => f.id));

  // O Core fala em reais (slot maxPricePerPerson); a tool converte para centavos.
  const brl = payloadOf(await rpc("tools/call", {
    name: "search_flavors",
    arguments: { max_price_brl: 9.5, limit: 3 },
  }));
  check("max_price_brl entende reais", brl.items.every((f: any) => f.price_cents <= 950),
    brl.items.map((f: any) => f.price_cents));
  check("limit corta o resultado", brl.count === 3, brl.count);

  const quote = payloadOf(await rpc("tools/call", {
    name: "quote_order",
    arguments: { format: "casquinha", flavor_ids: ["baunilha-madagascar"], weekday: 2 },
  }));
  check("quote_order aplica a promo de terca", quote.applied_promo?.id === "terca-da-casquinha", quote.applied_promo);
  check("total = subtotal - desconto", quote.total_cents === quote.subtotal_cents - quote.discount_cents);

  const rec = payloadOf(await rpc("tools/call", {
    name: "recommend_flavors",
    arguments: { profile: "chocolatudo", dietary: "vegano" },
  }));
  check("recommend_flavors sugere ate 3", rec.count >= 1 && rec.count <= 3, rec.count);
  check("cada sugestao tem justificativa",
    rec.items.every((f: any) => typeof f.reason === "string" && f.reason.length > 0));

  const err = await rpc("tools/call", {
    name: "quote_order",
    arguments: { format: "copo", flavor_ids: ["pacoca-crocante"] },
  });
  check("sabor esgotado vira isError", err.isError === true);
  check("com codigo de erro previsivel", payloadOf(err).error?.code === "FLAVOR_UNAVAILABLE", payloadOf(err));

  console.log("\n" + passed + " passaram, " + failed + " falharam\n");
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("\nfalhou contra " + url + ": " + (err?.message ?? err) + "\n");
  process.exitCode = 1;
});
