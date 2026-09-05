// Definicao das MCP tools da Sorveteria Polar, compartilhada pelos dois transportes:
// stdio (src/mcp/server.ts, para rodar local) e Streamable HTTP (api/mcp.ts, que o
// Core Orchestrator consome em producao). As tools sao wrappers finos sobre src/core.ts.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { searchFlavors, quoteOrder, recommendFlavors, MANIFEST } from "../core";
import { createFlavor, updateFlavor, deleteFlavor } from "../flavors";
import {
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
} from "../customers";

const DIETARY_ENUM = ["vegano", "sem_lactose", "sem_gluten", "zero_acucar"];
const ALLERGEN_ENUM = ["leite", "amendoim", "castanhas", "soja", "gluten"];
const CATEGORY_ENUM = ["creme", "frutas", "especial", "gelato", "vegano", "zero_acucar"];

/**
 * Toda tool que escreve exige a palavra magica. Ela e um parametro, e nao um header,
 * porque e assim que funciona nos dois transportes e em qualquer cliente MCP: o
 * cidadao diz a palavra na conversa e o modelo a repassa aqui.
 */
const MAGIC_WORD_PROP = {
  magic_word: {
    type: "string",
    description:
      "Palavra magica da Sorveteria Polar. Obrigatoria em toda operacao de escrita; " +
      "sem ela, ou com a palavra errada, a operacao e recusada.",
  },
};

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

  // ------------------------------------------------------------- sabores (CRUD)
  // Escrita do cardapio: exige palavra magica e defende a coerencia entre dieta e
  // alergenico, que e o que faz search_flavors ser confiavel para quem tem restricao.
  {
    name: "create_flavor",
    description:
      "Cria um sabor no cardapio. Exige a palavra magica. Obrigatorios: name, category e o preco " +
      "(price_cents em centavos ou price_brl em reais). Recusa combinacoes incoerentes, como um " +
      "sabor marcado vegano com leite nos alergenicos.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        name: { type: "string", description: "Nome do sabor (obrigatorio); o id vira o slug dele." },
        category: { type: "string", enum: CATEGORY_ENUM, description: "Categoria do sabor (obrigatoria)." },
        price_cents: { type: "number", description: "Preco por bola em centavos." },
        price_brl: { type: "number", description: "Preco por bola em reais; alternativa a price_cents." },
        description: { type: "string", description: "Descricao curta do sabor." },
        available: { type: "boolean", description: "Disponivel hoje. Padrao true." },
        dietary: {
          type: "array",
          items: { type: "string", enum: DIETARY_ENUM },
          description: "Tags de dieta; fonte unica de verdade da restricao alimentar.",
        },
        allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Alergenicos presentes no sabor.",
        },
        sweetness: { type: "number", description: "Doçura de 1 (pouco doce) a 5. Padrao 3." },
        popularity: { type: "number", description: "Popularidade de 0 a 5. Padrao 0." },
        seasonal: { type: "string", description: "Estacao ou periodo, quando for sazonal." },
      },
      required: ["magic_word", "name", "category"],
      additionalProperties: false,
    },
  },
  {
    name: "update_flavor",
    description:
      "Atualiza um sabor do cardapio. Exige a palavra magica. Campo omitido fica intocado. " +
      "O id nunca muda, mesmo quando o nome muda, porque pedidos e favoritos de cliente o referenciam.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        id: { type: "string", description: "Id do sabor a atualizar." },
        name: { type: "string", description: "Novo nome." },
        category: { type: "string", enum: CATEGORY_ENUM, description: "Nova categoria." },
        price_cents: { type: "number", description: "Novo preco em centavos." },
        price_brl: { type: "number", description: "Novo preco em reais." },
        description: { type: "string", description: "Nova descricao." },
        available: { type: "boolean", description: "Marca como disponivel ou esgotado." },
        dietary: {
          type: "array",
          items: { type: "string", enum: DIETARY_ENUM },
          description: "Substitui a lista inteira de tags de dieta.",
        },
        allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Substitui a lista inteira de alergenicos.",
        },
        sweetness: { type: "number", description: "Doçura de 1 a 5." },
        popularity: { type: "number", description: "Popularidade de 0 a 5." },
        seasonal: { type: "string", description: "Estacao; vazio limpa." },
      },
      required: ["magic_word", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_flavor",
    description:
      "Remove um sabor do cardapio. Exige a palavra magica. Recusa remover o sabor do dia, e " +
      "limpa o sabor removido dos favoritos de quem o tinha, informando quais clientes foram afetados.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        id: { type: "string", description: "Id do sabor a remover." },
      },
      required: ["magic_word", "id"],
      additionalProperties: false,
    },
  },

  // ------------------------------------------------------------ clientes (CRUD)
  // Escrita do cadastro: tambem exige palavra magica. Toda resposta traz `storage`,
  // dizendo se o dado persiste no ambiente atual — ver src/store.ts.
  {
    name: "list_customers",
    description:
      "Lista os clientes cadastrados da Sorveteria Polar, com filtro por texto (nome, email, telefone, " +
      "bairro, observacoes), restricao alimentar, alergenico declarado e sabor favorito.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto livre; ignora acento e caixa." },
        dietary: { type: "string", enum: DIETARY_ENUM, description: "So clientes com essa restricao." },
        allergen: {
          type: "string",
          enum: ALLERGEN_ENUM,
          description: "So clientes que declaram esse alergenico.",
        },
        favorite_flavor_id: { type: "string", description: "So clientes que tem esse sabor entre os favoritos." },
        limit: { type: "number", description: "Maximo de clientes a devolver." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_customer",
    description: "Devolve o cadastro completo de um cliente pelo id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do cliente, no formato slug (ex.: marina-alcantara)." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_customer",
    description:
      "Cadastra um cliente novo. Exige a palavra magica; fora ela, so name e obrigatorio e o id "
      + "e gerado a partir do nome. Recusa telefone ou email ja usados por outro cliente e "
      + "sabores favoritos inexistentes.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        name: { type: "string", description: "Nome do cliente (obrigatorio, ate 80 caracteres)." },
        phone: { type: "string", description: "Telefone com ao menos 8 digitos." },
        email: { type: "string", description: "Email do cliente." },
        district: { type: "string", description: "Bairro na cidade GTA7 Lab." },
        dietary: {
          type: "array",
          items: { type: "string", enum: DIETARY_ENUM },
          description: "Restricoes alimentares do cliente.",
        },
        allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Alergenicos que o cliente nao pode consumir.",
        },
        favorite_flavor_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids de sabores do cardapio, validados contra data/flavors.json.",
        },
        notes: { type: "string", description: "Observacoes livres (ate 500 caracteres)." },
      },
      required: ["magic_word", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "update_customer",
    description:
      "Atualiza um cliente existente. Exige a palavra magica. Campo omitido fica intocado; "
      + "string vazia limpa o campo. Devolve changed_fields com o que de fato mudou.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        id: { type: "string", description: "Id do cliente a atualizar." },
        name: { type: "string", description: "Novo nome." },
        phone: { type: "string", description: "Novo telefone; vazio limpa." },
        email: { type: "string", description: "Novo email; vazio limpa." },
        district: { type: "string", description: "Novo bairro; vazio limpa." },
        dietary: {
          type: "array",
          items: { type: "string", enum: DIETARY_ENUM },
          description: "Substitui a lista inteira de restricoes.",
        },
        allergens: {
          type: "array",
          items: { type: "string", enum: ALLERGEN_ENUM },
          description: "Substitui a lista inteira de alergenicos.",
        },
        favorite_flavor_ids: {
          type: "array",
          items: { type: "string" },
          description: "Substitui a lista inteira de favoritos.",
        },
        notes: { type: "string", description: "Novas observacoes; vazio limpa." },
      },
      required: ["magic_word", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_customer",
    description:
      "Remove um cliente do cadastro. Exige a palavra magica. Devolve o registro removido, "
      + "para que a acao possa ser conferida.",
    inputSchema: {
      type: "object",
      properties: {
        ...MAGIC_WORD_PROP,
        id: { type: "string", description: "Id do cliente a remover." },
      },
      required: ["magic_word", "id"],
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
  const list = obj.flavors ?? obj.recommendations ?? obj.customers;
  return Array.isArray(list) ? { ...obj, items: list } : result;
}

/**
 * Adapta os parametros que vem do Core aos da busca do core.ts:
 * - max_price_brl chega em reais; internamente tudo e centavo inteiro;
 * - limit corta o resultado, que searchFlavors nao pagina.
 */
async function searchWithCoreParams(args: Record<string, any>) {
  const { max_price_brl, limit, ...rest } = args;
  const params = { ...rest };
  if (params.max_price === undefined && typeof max_price_brl === "number") {
    params.max_price = Math.round(max_price_brl * 100);
  }

  const result = await searchFlavors(params);
  if ("error" in result) return result;

  if (typeof limit === "number" && limit > 0 && result.flavors.length > limit) {
    const flavors = result.flavors.slice(0, limit);
    return { ...result, count: flavors.length, flavors };
  }
  return result;
}

/**
 * Assincrona porque sabores e clientes agora vem do store. A palavra magica e sempre
 * separada dos dados antes de chegar na regra de negocio: ela e credencial, nao campo
 * do registro, e nao pode acabar gravada dentro de um sabor ou de um cliente.
 */
export async function callTool(
  name: string, args: Record<string, any>,
): Promise<{ result: unknown; isError: boolean }> {
  const { magic_word: magicWord, ...input } = args;
  let result: unknown;

  switch (name) {
    case "search_flavors":
      result = withCoreAliases(await searchWithCoreParams(input));
      break;
    case "quote_order":
      result = await quoteOrder({
        format: input.format,
        flavor_ids: input.flavor_ids ?? [],
        toppings: input.toppings ?? [],
        weekday: input.weekday,
      });
      break;
    case "recommend_flavors":
      result = withCoreAliases(await recommendFlavors(input));
      break;

    case "create_flavor":
      result = await createFlavor(input, magicWord);
      break;
    case "update_flavor": {
      const { id, ...patch } = input;
      result = await updateFlavor(id, patch, magicWord);
      break;
    }
    case "delete_flavor":
      result = await deleteFlavor(input.id, magicWord);
      break;

    case "list_customers":
      result = withCoreAliases(await listCustomers(input));
      break;
    case "get_customer":
      result = await getCustomer(input.id);
      break;
    case "create_customer":
      result = await createCustomer(input, magicWord);
      break;
    case "update_customer": {
      const { id, ...patch } = input;
      result = await updateCustomer(id, patch, magicWord);
      break;
    }
    case "delete_customer":
      result = await deleteCustomer(input.id, magicWord);
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
    const { result, isError } = await callTool(
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
