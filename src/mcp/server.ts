#!/usr/bin/env node
// Servidor MCP da Sorveteria Polar (transporte stdio).
// Cada tool e um wrapper fino sobre src/core.ts: nenhuma regra de negocio aqui.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { searchFlavors, quoteOrder, recommendFlavors, MANIFEST } from "../core";

const DIETARY_ENUM = ["vegano", "sem_lactose", "sem_gluten", "zero_acucar"];
const ALLERGEN_ENUM = ["leite", "amendoim", "castanhas", "soja", "gluten"];
const CATEGORY_ENUM = ["creme", "frutas", "especial", "gelato", "vegano", "zero_acucar"];

const TOOLS = [
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

const server = new Server(
  { name: MANIFEST.id, version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Record<string, any>;

  let result: unknown;
  switch (name) {
    case "search_flavors":
      result = searchFlavors(args);
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
      result = recommendFlavors(args);
      break;
    default:
      result = { error: { code: "UNKNOWN_TOOL", message: 'Tool "' + name + '" nao existe nesta entidade.' } };
  }

  const isError = typeof result === "object" && result !== null && "error" in result;
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError,
  };
});

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout e do protocolo; qualquer log tem que ir para stderr.
  console.error("[icecream] Sorveteria Polar MCP pronto (" + TOOLS.length + " tools)");
}

main().catch((err) => {
  console.error("[icecream] falha ao iniciar:", err);
  process.exit(1);
});
