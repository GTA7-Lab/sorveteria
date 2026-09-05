// Persistencia das colecoes mutaveis da entidade.
//
// Formatos, adicionais, promocoes e a loja continuam fixos, lidos do bundle em
// src/data.ts. Sabores e clientes nao: os dois tem CRUD e mudam em runtime, e o
// filesystem da Vercel e read-only. Dai esta camada, com tres drivers escolhidos
// pelo ambiente, sem dependencia nova:
//
//   kv     Redis REST (Upstash, via Marketplace da Vercel). Unico que persiste em producao.
//   file   data/<colecao>.local.json, para desenvolvimento local. Nao versionado.
//   memory Fallback. Vive so enquanto o processo vive — em serverless, praticamente
//          uma requisicao. E por isso que toda resposta de escrita informa o driver.
//
// Forcar um driver: ICECREAM_STORE=kv|file|memory (usado pelos testes).

export type StoreDriver = "kv" | "file" | "memory";

export interface StoreInfo {
  driver: StoreDriver;
  /** false = os dados somem entre requisicoes; o cliente MCP precisa saber disso. */
  persistent: boolean;
  note: string;
}

// ---------------------------------------------------------------- driver kv

/**
 * O Redis da Vercel hoje vem do Marketplace, fornecido pela Upstash, e injeta
 * UPSTASH_REDIS_REST_URL/_TOKEN. Projetos da epoca do Vercel KV (produto proprio,
 * aposentado) tem KV_REST_API_URL/_TOKEN. Os dois pares servem, com o legado na
 * frente para nao mudar o comportamento de quem ja estava configurado.
 *
 * Atencao ao conectar pela CLI: `vercel integration resource connect --prefix X_`
 * renomeia as variaveis e nenhum dos dois pares seria encontrado.
 */
function kvConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function kvGet(key: string): Promise<string | null> {
  const cfg = kvConfig();
  if (!cfg) throw new Error("driver kv sem UPSTASH_REDIS_REST_URL/_TOKEN (ou KV_REST_API_URL/_TOKEN).");

  const res = await fetch(cfg.url + "/get/" + key, {
    headers: { Authorization: "Bearer " + cfg.token },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("KV GET " + key + " -> HTTP " + res.status);

  const body = (await res.json()) as { result: string | null };
  return body.result ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  const cfg = kvConfig();
  if (!cfg) throw new Error("driver kv sem UPSTASH_REDIS_REST_URL/_TOKEN (ou KV_REST_API_URL/_TOKEN).");

  const res = await fetch(cfg.url + "/set/" + key, {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "text/plain" },
    body: value,
  });
  if (!res.ok) throw new Error("KV SET " + key + " -> HTTP " + res.status);
}

// ---------------------------------------------------------------- driver file

function localPath(name: string): string {
  const path = require("node:path") as typeof import("node:path");
  return path.join(__dirname, "..", "data", name + ".local.json");
}

function fileGet(name: string): string | null {
  const fs = require("node:fs") as typeof import("node:fs");
  const target = localPath(name);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
}

function fileSet(name: string, value: string): void {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.writeFileSync(localPath(name), value + "\n", "utf8");
}

function fileUsable(): boolean {
  // Na Vercel o filesystem e read-only, e data/ nem existe no bundle das funcoes.
  if (process.env.VERCEL) return false;
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    fs.accessSync(path.join(__dirname, "..", "data"), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- selecao

let driver: StoreDriver | null = null;

/** Preguicoso de proposito: os testes ajustam ICECREAM_STORE antes do primeiro acesso. */
function currentDriver(): StoreDriver {
  if (driver) return driver;

  const forced = process.env.ICECREAM_STORE as StoreDriver | undefined;
  if (forced === "kv" || forced === "file" || forced === "memory") {
    driver = forced;
  } else if (kvConfig()) {
    driver = "kv";
  } else if (fileUsable()) {
    driver = "file";
  } else {
    driver = "memory";
  }
  return driver;
}

const NOTES: Record<StoreDriver, string> = {
  kv: "Redis REST (Upstash): as alteracoes sobrevivem a reinicios e sao vistas por todos.",
  file: "Arquivos locais data/<colecao>.local.json: persistem na maquina de desenvolvimento, nao em producao.",
  memory:
    "Somente memoria: as alteracoes somem quando o processo termina. Em producao serverless isso " +
    "significa praticamente cada requisicao. Conecte um Redis ao projeto (as variaveis "
    + "UPSTASH_REDIS_REST_URL/_TOKEN sao injetadas sozinhas) para persistir.",
};

export function storeInfo(): StoreInfo {
  const d = currentDriver();
  return { driver: d, persistent: d !== "memory", note: NOTES[d] };
}

/** Existe so para os testes, que trocam de driver dentro do mesmo processo. */
export function resetDriverCache(): void {
  driver = null;
}

// ---------------------------------------------------------------- colecoes

const memory = new Map<string, string>();

/**
 * Uma colecao persistida. O JSON versionado em data/ e o seed: o estado inicial que
 * qualquer driver publica na primeira leitura, nunca o dado vivo.
 */
export interface Collection<T> {
  name: string;
  read(): Promise<T[]>;
  write(items: T[]): Promise<void>;
  reset(): Promise<void>;
}

export function collection<T>(name: string, seed: readonly T[]): Collection<T> {
  const key = "icecream:" + name;
  const seedCopy = (): T[] => JSON.parse(JSON.stringify(seed)) as T[];

  async function readRaw(): Promise<string | null> {
    switch (currentDriver()) {
      case "kv": return kvGet(key);
      case "file": return fileGet(name);
      default: return memory.get(key) ?? null;
    }
  }

  async function writeRaw(value: string): Promise<void> {
    switch (currentDriver()) {
      case "kv": return kvSet(key, value);
      case "file": return fileSet(name, value);
      default: memory.set(key, value);
    }
  }

  return {
    name,
    async read() {
      const raw = await readRaw();
      if (raw === null) {
        const initial = seedCopy();
        await writeRaw(JSON.stringify(initial, null, 2));
        return initial;
      }
      return JSON.parse(raw) as T[];
    },
    async write(items) {
      await writeRaw(JSON.stringify(items, null, 2));
    },
    async reset() {
      await writeRaw(JSON.stringify(seedCopy(), null, 2));
    },
  };
}
