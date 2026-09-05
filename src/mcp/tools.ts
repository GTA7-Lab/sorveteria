// Definicao das MCP tools da Sorveteria Polar, compartilhada pelos dois transportes:
// stdio (src/mcp/server.ts, para rodar local) e Streamable HTTP (api/mcp.ts, que o
// Core Orchestrator consome em producao). As tools sao wrappers finos sobre src/core.ts.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { searchFlavors, quoteOrder, recommendFlavors, MANIFEST } from "../core";

const DIETARY_ENUM = ["vegano", "sem_lactose", "sem_gluten", "zero_acucar"];
const ALLERGEN_ENUM = ["leite", "amendoim", "castanhas", "soja", "gluten"];
const CATEGORY_ENUM = ["creme", "frutas", "especial", "gelato", "vegano", "zero_acucar"];

export const TOOLS = [
  {
    name: "search_flavors",
    description:
      "Lista e filtra os sabores da Sorveteria Polar por texto, categoria, restricao alimentar, " +
      "alergenico a evitar e preco maximo. Por padrao devolve apenas o que esta disponivel hoje.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto livre no nome ou descricao; ignora acento e caixa." },
        category: { type: "string", enum: CATEGORY_ENUM, description: "Categoria do sabor." },
        dietary: { type: "string", enum: DIETARY_ENUM, description: "Restricao alimentar exigida." },
        avoid_allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Alergenicos que o cidadao nao pode consumir.",
        },
        max_price: { type: "number", description: "Preco maximo por bola, em centavos." },
        max_price_brl: {
          type: "number",
          description: "Preco maximo por bola em reais. Alternativa a max_price para quem pensa em reais.",
        },
        limit: { type: "number", description: "Maximo de sabores a devolver." },
        only_available: { type: "boolean", description: "Padrao true; false inclui os esgotados." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "quote_order",
    description:
      "Calcula o preco de um pedido a partir do formato, dos sabores e dos adicionais, " +
      "aplicando a promocao valida no dia. Devolve itens, subtotal, desconto e total em centavos (BRL).",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Id do formato: casquinha, copo, taca, milkshake, pote_500ml ou pote_1l.",
        },
        flavor_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids dos sabores, uma entrada por bola.",
        },
        toppings: {
          type: "array",
          items: { type: "string" },
          description: "Ids dos adicionais (opcional).",
        },
        weekday: {
          type: "number",
          description: "0 = domingo ... 6 = sabado. Padrao: hoje no fuso da loja.",
        },
      },
      required: ["format", "flavor_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "recommend_flavors",
    description:
      "Recomenda de 1 a 5 sabores conforme um perfil de gosto (leve, cremoso, citrico, chocolatudo, " +
      "refrescante, doce, crocante) e restricoes alimentares. Cada sugestao vem com uma justificativa.",
    inputSchema: {
      type: "object",
      properties: {
        profile: { type: "string", description: "Perfil de gosto em texto curto." },
        dietary: { type: "string", enum: DIETARY_ENUM, description: "Restricao alimentar exigida." },
        avoid_allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Alergenicos a evitar.",
        },
        limit: { type: "number", description: "Quantas sugestoes (1 a 5). Padrao 3." },
      },
      additionalProperties: false,
    },
  },
];

/**
 * O Core Orchestrator procura a lista de resultados nas chaves items/results/data/list.
 * Nossas respostas usam nomes proprios do dominio (flavors, recommendations), entao
 * expomos tambem `items` como apelido para que o Core liste sabor a sabor em vez de
 * tratar a resposta inteira como um unico item.
 */
function withCoreAliases(result: unknown): unknown {
  if (!result || typeof result !== "object" || "error" in result) return result;
  const obj = result as Record<string, unknown>;
  const list = obj.flavors ?? obj.recommendations;
  return Array.isArray(list) ? { ...obj, items: list } : result;
}

/**
 * Adapta os parametros que vem do Core aos da busca do core.ts:
 * - max_price_brl chega em reais; internamente tudo e centavo inteiro;
 * - limit corta o resultado, que searchFlavors nao pagina.
 */
function searchWithCoreParams(args: Record<string, any>) {
  const { max_price_brl, limit, ...rest } = args;
  const params = { ...rest };
  if (params.max_price === undefined && typeof max_price_brl === "number") {
    params.max_price = Math.round(max_price_brl * 100);
  }

  const result = searchFlavors(params);
  if ("error" in result) return result;

  if (typeof limit === "number" && limit > 0 && result.flavors.length > limit) {
    const flavors = result.flavors.slice(0, limit);
    return { ...result, count: flavors.length, flavors };
  }
  return result;
}

export function callTool(name: string, args: Record<string, any>): { result: unknown; isError: boolean } {
  let result: unknown;

  switch (name) {
    case "search_flavors":
      result = withCoreAliases(searchWithCoreParams(args));
      break;
    case "quote_order":
      result = quoteOrder({
        format: args.format,
        flavor_ids: args.flavor_ids ?? [],
        toppings: args.toppings ?? [],
        weekday: args.weekday,
      });
      break;
    case "recommend_flavors":
      result = withCoreAliases(recommendFlavors(args));
      break;
    default:
      result = { error: { code: "UNKNOWN_TOOL", message: 'Tool "' + name + '" nao existe nesta entidade.' } };
  }

  const isError = typeof result === "object" && result !== null && "error" in result;
  return { result, isError };
}

/** Uma instancia nova por conexao: o endpoint HTTP e stateless e cria uma por request. */
export function createIcecreamServer(): Server {
  const server = new Server(
    { name: MANIFEST.id, version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { result, isError } = callTool(
      request.params.name,
      (request.params.arguments ?? {}) as Record<string, any>,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError,
    };
  });

  return server;
}
