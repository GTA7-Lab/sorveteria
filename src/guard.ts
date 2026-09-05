// Palavra magica: o segredo compartilhado que libera as escritas da entidade.
//
// /api/mcp e publico e sem autenticacao — foi assim que a entidade nasceu, porque
// so tinha leitura. Com CRUD de sabores e de clientes, qualquer um com a URL poderia
// reescrever o cardapio. Este modulo e o unico portao.
//
// A checagem mora na camada de regra (src/flavors.ts, src/customers.ts), nao na
// camada de tool: assim uma rota REST futura nao consegue contornar o portao por
// esquecimento. Toda funcao que escreve recebe a palavra como ultimo parametro.
//
// Configuracao: ICECREAM_MAGIC_WORD no ambiente. Sem ela, TODA escrita e recusada —
// e o default seguro: uma entidade mal configurada fica somente-leitura em vez de
// ficar aberta. Leitura nunca exige palavra magica.

import type { CoreError } from "./types";

/**
 * Comparacao em tempo constante. Sobre HTTPS um ataque de tempo aqui e teorico,
 * mas o custo de nao dar essa brecha e cinco linhas.
 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** true quando o ambiente tem uma palavra magica configurada. */
export function magicWordConfigured(): boolean {
  return (process.env.ICECREAM_MAGIC_WORD ?? "").trim().length > 0;
}

/**
 * Autoriza uma escrita. Devolve null quando pode seguir, ou o CoreError a devolver.
 *
 * As mensagens nunca repetem a palavra recebida nem revelam a esperada: quem erra
 * o segredo nao pode aprender nada sobre ele pela resposta.
 */
export function authorizeWrite(magicWord: unknown, action: string): CoreError | null {
  const expected = (process.env.ICECREAM_MAGIC_WORD ?? "").trim();

  if (expected.length === 0) {
    return {
      error: {
        code: "MAGIC_WORD_NOT_CONFIGURED",
        message:
          "Esta entidade esta somente-leitura: nenhuma palavra magica foi configurada no servidor. " +
          "Defina ICECREAM_MAGIC_WORD no ambiente para liberar as escritas.",
      },
    };
  }

  if (typeof magicWord !== "string" || magicWord.trim().length === 0) {
    return {
      error: {
        code: "MAGIC_WORD_REQUIRED",
        message:
          "Para " + action + " e preciso informar a palavra magica da Sorveteria Polar " +
          "no parametro magic_word.",
      },
    };
  }

  if (!sameSecret(magicWord.trim(), expected)) {
    return {
      error: {
        code: "WRONG_MAGIC_WORD",
        message: "Palavra magica incorreta; a operacao de " + action + " foi recusada.",
      },
    };
  }

  return null;
}
