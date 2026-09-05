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

// As escritas so podem ser exercitadas se o teste souber a palavra magica que o
// SERVIDOR usa. Sem ICECREAM_MAGIC_WORD no ambiente do teste, elas sao verificadas
// apenas pelo lado da recusa — que ja e a metade que importa para seguranca.
const MAGIC = process.env.ICECREAM_MAGIC_WORD ?? null;

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
  check("expoe as 11 tools", names.length === 11, names);
  check("search_flavors, quote_order e recommend_flavors",
    ["search_flavors", "quote_order", "recommend_flavors"].every((n) => names.includes(n)), names);
  check("o CRUD de clientes esta exposto",
    ["list_customers", "get_customer", "create_customer", "update_customer", "delete_customer"]
      .every((n) => names.includes(n)), names);
  check("o CRUD de sabores esta exposto",
    ["create_flavor", "update_flavor", "delete_flavor"].every((n) => names.includes(n)), names);

  const writeTools = tools.filter((t: any) =>
    /^(create|update|delete)_/.test(t.name));
  check("toda tool de escrita exige magic_word no schema",
    writeTools.length === 6 && writeTools.every((t: any) =>
      t.inputSchema?.properties?.magic_word && (t.inputSchema.required ?? []).includes("magic_word")),
    writeTools.map((t: any) => t.name + ":" + JSON.stringify(t.inputSchema?.required)));
  check("nenhuma tool de leitura pede magic_word",
    tools.filter((t: any) => !/^(create|update|delete)_/.test(t.name))
      .every((t: any) => !t.inputSchema?.properties?.magic_word));
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

  // ---------------------------------------------------------------- clientes
  const lista = payloadOf(await rpc("tools/call", { name: "list_customers", arguments: {} }));
  check("list_customers devolve o cadastro", lista.total >= 1, lista.total);
  check("expoe o apelido items tambem em clientes", Array.isArray(lista.items) && lista.items.length === lista.count);
  check("informa o driver de persistencia", typeof lista.storage?.persistent === "boolean", lista.storage);

  const veganos = payloadOf(await rpc("tools/call", {
    name: "list_customers", arguments: { dietary: "vegano" },
  }));
  check("filtro dietary em clientes",
    veganos.items.every((c: any) => c.dietary.includes("vegano")), veganos.items.map((c: any) => c.id));

  const semCliente = await rpc("tools/call", { name: "get_customer", arguments: { id: "nao-existe" } });
  check("cliente inexistente vira isError", semCliente.isError === true);
  check("com CUSTOMER_NOT_FOUND", payloadOf(semCliente).error?.code === "CUSTOMER_NOT_FOUND", payloadOf(semCliente));

  // ------------------------------------------------------ portao da palavra magica
  const semPalavra = await rpc("tools/call", {
    name: "create_flavor", arguments: { name: "Invasor", category: "creme", price_cents: 900 },
  });
  const codigoSemPalavra = payloadOf(semPalavra).error?.code;
  check("escrita sem palavra magica e recusada", semPalavra.isError === true, payloadOf(semPalavra));
  check("com codigo de portao, nao de validacao",
    codigoSemPalavra === "MAGIC_WORD_REQUIRED" || codigoSemPalavra === "MAGIC_WORD_NOT_CONFIGURED",
    codigoSemPalavra);

  const palavraErrada = payloadOf(await rpc("tools/call", {
    name: "delete_flavor", arguments: { id: "baunilha-madagascar", magic_word: "abracadabra" },
  }));
  check("palavra magica errada e recusada",
    palavraErrada.error?.code === "WRONG_MAGIC_WORD" || palavraErrada.error?.code === "MAGIC_WORD_NOT_CONFIGURED",
    palavraErrada);
  check("o erro nao ecoa a palavra tentada",
    !JSON.stringify(palavraErrada).includes("abracadabra"), palavraErrada);

  const cardapioIntacto = payloadOf(await rpc("tools/call", {
    name: "search_flavors", arguments: { query: "baunilha" },
  }));
  check("nenhuma escrita recusada tocou o cardapio",
    cardapioIntacto.items.some((f: any) => f.id === "baunilha-madagascar"), cardapioIntacto.count);

  // O round-trip completo depende de duas coisas: um store que persista entre
  // requisicoes e o teste conhecer a palavra magica do servidor. Faltando qualquer
  // uma, a metade da recusa (acima) ja foi verificada e o resto e pulado.
  const persistente = lista.storage?.persistent === true;
  if (!persistente || !MAGIC) {
    const motivo = !persistente
      ? "store nao persistente (" + lista.storage?.driver + ")"
      : "ICECREAM_MAGIC_WORD nao definida no ambiente do teste";
    check("condicoes do round-trip sao reportadas com clareza", typeof lista.storage?.note === "string", lista.storage);
    console.log("\n  aviso: " + motivo + " - create/update/delete nao foram testados ponta a ponta.");
    if (!persistente) {
      console.log("         conecte um Redis ao projeto (UPSTASH_REDIS_REST_URL/_TOKEN) para o store persistir.");
    }
    if (!MAGIC) {
      console.log("         rode com ICECREAM_MAGIC_WORD=<a palavra do servidor> para exercitar as escritas.");
    }
  } else {
    // ---------------------------------------------------------- sabores (CRUD)
    const sufixo = Date.now();
    const nomeSabor = "Sabor Teste " + sufixo;
    const sabor = payloadOf(await rpc("tools/call", {
      name: "create_flavor",
      arguments: {
        magic_word: MAGIC, name: nomeSabor, category: "frutas", price_brl: 11,
        dietary: ["vegano"], description: "Criado pelo teste automatizado.",
      },
    }));
    check("create_flavor cria e devolve o sabor", sabor.created === true && !!sabor.flavor?.id, sabor);
    const saborId = sabor.flavor.id;
    check("price_brl vira centavos", sabor.flavor.price_cents === 1100, sabor.flavor.price_cents);

    const naBusca = payloadOf(await rpc("tools/call", {
      name: "search_flavors", arguments: { query: String(sufixo) },
    }));
    check("sabor novo aparece em search_flavors",
      naBusca.items.some((f: any) => f.id === saborId), naBusca.items.map((f: any) => f.id));

    const orcamento = payloadOf(await rpc("tools/call", {
      name: "quote_order", arguments: { format: "copo", flavor_ids: [saborId], weekday: 1 },
    }));
    check("quote_order ja precifica o sabor novo",
      orcamento.subtotal_cents === 400 + 1100, orcamento.subtotal_cents);

    const incoerente = payloadOf(await rpc("tools/call", {
      name: "update_flavor", arguments: { magic_word: MAGIC, id: saborId, allergens: ["leite"] },
    }));
    check("sabor vegano nao aceita leite", incoerente.error?.code === "DIETARY_CONFLICT", incoerente);

    const reajustado = payloadOf(await rpc("tools/call", {
      name: "update_flavor", arguments: { magic_word: MAGIC, id: saborId, price_cents: 1250 },
    }));
    check("update_flavor altera so o campo enviado",
      reajustado.flavor.price_cents === 1250 && reajustado.flavor.name === nomeSabor, reajustado.flavor);

    const destaque = payloadOf(await rpc("tools/call", {
      name: "delete_flavor", arguments: { magic_word: MAGIC, id: "gelato-stracciatella" },
    }));
    check("o sabor do dia nao pode ser removido", destaque.error?.code === "FLAVOR_IS_FEATURED", destaque);

    const saborRemovido = payloadOf(await rpc("tools/call", {
      name: "delete_flavor", arguments: { magic_word: MAGIC, id: saborId },
    }));
    check("delete_flavor remove e devolve o registro",
      saborRemovido.deleted === true && saborRemovido.flavor.id === saborId, saborRemovido);
    const foiEmbora = payloadOf(await rpc("tools/call", {
      name: "search_flavors", arguments: { query: String(sufixo), only_available: false },
    }));
    check("sabor removido some do cardapio", foiEmbora.count === 0, foiEmbora.count);

    // --------------------------------------------------------- clientes (CRUD)
    const semNome = payloadOf(await rpc("tools/call", {
      name: "create_customer", arguments: { magic_word: MAGIC, phone: "(11) 90000-1111" },
    }));
    check("create_customer sem nome e rejeitado", semNome.error?.code === "MISSING_NAME", semNome);

    const nome = "Cliente Teste " + sufixo;
    const criado = payloadOf(await rpc("tools/call", {
      name: "create_customer",
      arguments: {
        magic_word: MAGIC, name: nome, district: "Centro",
        dietary: ["vegano"], favorite_flavor_ids: ["limao-siciliano"],
      },
    }));
    check("create_customer cria e devolve o registro", criado.created === true && !!criado.customer?.id, criado);
    const id = criado.customer.id;
    check("a palavra magica nao e gravada no registro",
      !JSON.stringify(criado.customer).includes(MAGIC), criado.customer);

    const lido = payloadOf(await rpc("tools/call", { name: "get_customer", arguments: { id } }));
    check("get_customer acha o que foi criado", lido.id === id && lido.name === nome, lido);

    const alterado = payloadOf(await rpc("tools/call", {
      name: "update_customer", arguments: { magic_word: MAGIC, id, district: "Beira-Rio" },
    }));
    check("update_customer altera so o campo enviado",
      alterado.customer.district === "Beira-Rio" && alterado.customer.name === nome, alterado.customer);
    check("update_customer reporta changed_fields",
      JSON.stringify(alterado.changed_fields) === JSON.stringify(["district"]), alterado.changed_fields);

    const removido = payloadOf(await rpc("tools/call", {
      name: "delete_customer", arguments: { magic_word: MAGIC, id },
    }));
    check("delete_customer remove e devolve o registro", removido.deleted === true && removido.customer.id === id, removido);

    const sumiu = await rpc("tools/call", { name: "get_customer", arguments: { id } });
    check("cliente removido nao volta no get", payloadOf(sumiu).error?.code === "CUSTOMER_NOT_FOUND", payloadOf(sumiu));
  }

  console.log("\n" + passed + " passaram, " + failed + " falharam\n");
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("\nfalhou contra " + url + ": " + (err?.message ?? err) + "\n");
  process.exitCode = 1;
});
