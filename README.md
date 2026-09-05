# Sorveteria Polar — entidade `icecream` da GTA7 Lab

**No ar:** https://gta7-icecream.vercel.app · manifesto em
[`/api/manifest`](https://gta7-icecream.vercel.app/api/manifest)

Sorveteria artesanal da cidade digital GTA7 Lab. Publica cardápio, disponibilidade e horário,
calcula o preço de um pedido e recomenda sabores por perfil e restrição alimentar.

Funciona de forma independente (site + API REST) e oferece as mesmas capacidades ao
Core Orchestrator via **MCP**, que também expõe o CRUD do cardápio e do cadastro de clientes —
protegido por uma [palavra mágica](#palavra-mágica). Sem banco: os arquivos em `data/` são o
catálogo fixo e o seed das coleções que mudam em runtime.

## Rodar local

```bash
npm install
npm run dev:local     # http://localhost:3000
```

`dev:local` sobe um servidor Node que monta os mesmos handlers de `api/` — não exige conta na Vercel.
Com a CLI da Vercel logada, `npm run dev` faz o mesmo pelo runtime real.

```bash
npm run smoke         # 122 asserções: catálogo, pedido, CRUD, palavra mágica e driver kv
npm run typecheck     # tsc --noEmit
```

## API REST

| Rota | Descrição |
|---|---|
| `GET /api/manifest` | manifesto da entidade para o Core |
| `GET /api/shop` | dados da loja, `is_open` e sabor do dia |
| `GET /api/flavors` | filtra por `query`, `category`, `dietary`, `avoid_allergens`, `max_price`, `only_available` |
| `GET /api/flavors/:id` | detalhe de um sabor (404 se não existir) |
| `GET/POST /api/quote` | orçamento: `format`, `flavor_ids`, `toppings`, `weekday` |
| `GET /api/recommend` | sugestões: `profile`, `dietary`, `avoid_allergens`, `limit` |

```bash
curl "https://gta7-icecream.vercel.app/api/flavors?dietary=vegano&max_price=1100"
curl "https://gta7-icecream.vercel.app/api/quote?format=casquinha&flavor_ids=baunilha-madagascar&weekday=2"
curl -X POST https://gta7-icecream.vercel.app/api/quote -H "Content-Type: application/json" \
  -d '{"format":"taca","flavor_ids":["chocolate-belga-70","pistache-siciliano"],"toppings":["chantilly"]}'
```

Preços sempre em **centavos** (inteiros), moeda `BRL`. Erros vêm como
`{ "error": { "code": "...", "message": "..." } }` — nunca uma exceção.

## MCP

Onze tools servidas por dois transportes que compartilham a mesma definição
(`src/mcp/tools.ts`):

- **Leitura** (sem palavra mágica): `search_flavors`, `quote_order`, `recommend_flavors`,
  `list_customers`, `get_customer`.
- **Escrita** (exige `magic_word`): `create_flavor`, `update_flavor`, `delete_flavor`,
  `create_customer`, `update_customer`, `delete_customer`.

Os dois transportes:

- **HTTP streamable** em **`/api/mcp`** — é por aí que o Core Orchestrator da cidade consome.
- **stdio**, para rodar local:

```bash
npm run mcp                    # servidor stdio
npm run test:mcp               # 33 asserções no /api/mcp local
ICECREAM_MAGIC_WORD=<palavra> npm run test:mcp   # 49: inclui o CRUD ponta a ponta
npm run test:mcp -- https://gta7-icecream.vercel.app/api/mcp   # contra producao
```

Registrar no Claude Code (ajuste o caminho absoluto):

```json
{
  "mcpServers": {
    "icecream": {
      "command": "npx",
      "args": ["tsx", "<caminho absoluto do repo>/src/mcp/server.ts"]
    }
  }
}
```

## Palavra mágica

`/api/mcp` é público e não tem autenticação. Enquanto a entidade só lia, tudo bem; com CRUD de
sabores e de clientes, qualquer um com a URL poderia reescrever o cardápio. Por isso **as seis
tools de escrita exigem o parâmetro `magic_word`**, conferido contra `ICECREAM_MAGIC_WORD` no
servidor. As cinco de leitura não exigem nada.

```bash
# no projeto da Vercel: Settings -> Environment Variables
ICECREAM_MAGIC_WORD=<a palavra combinada>
```

**Sem essa variável a entidade fica somente-leitura** — toda escrita volta
`MAGIC_WORD_NOT_CONFIGURED`. É o default seguro: uma entidade mal configurada fecha, não abre.

Três detalhes que valem saber:

- A checagem mora na **camada de regra** (`src/guard.ts`, chamado por `src/flavors.ts` e
  `src/customers.ts`), não na camada de tool. Uma rota REST futura herda a proteção sem precisar
  lembrar dela.
- As mensagens de erro nunca repetem a palavra tentada nem revelam a esperada, e a comparação é
  em tempo constante.
- `magic_word` é separado dos dados antes de chegar na regra: é credencial, não campo do
  registro, e não pode acabar gravada dentro de um sabor ou de um cliente.

É um segredo compartilhado, não autenticação de verdade — não há usuários, sessões nem
auditoria de quem escreveu o quê. Para uma entidade de cidade fictícia é proporcional; para
dados reais, não seria.

## Persistência

Formatos, adicionais, promoções e a loja são estáticos e vêm do bundle. Sabores e clientes não:
os dois têm CRUD, mudam em runtime, e o filesystem da Vercel é read-only. `src/store.ts` resolve
isso escolhendo um driver pelo ambiente, sem dependência nova:

| Driver | Quando é escolhido | Persiste? |
|---|---|---|
| `kv` | `UPSTASH_REDIS_REST_URL` + `_TOKEN`, ou o par legado `KV_REST_API_*` | sim |
| `file` | fora da Vercel, gravando `data/<coleção>.local.json` (não versionado) | na máquina local |
| `memory` | fallback | não |

`data/flavors.json` e `data/customers.json` são apenas os **seeds**: o estado inicial que
qualquer driver publica na primeira leitura. Editá-los não muda um ambiente que já tem store
populado — para isso existe `update_flavor`. `ICECREAM_STORE=kv|file|memory` força um driver
(os testes usam `memory`).

Toda resposta de escrita traz um bloco `storage` com `driver`, `persistent` e uma nota. Isso não
é decoração: **em produção sem KV o driver é `memory`**, as leituras funcionam mas cada escrita
se perde na requisição seguinte, e o cliente MCP precisa saber disso para não dizer ao cidadão
que o sabor foi criado.

**Para persistir de verdade**, conecte um Redis ao projeto — você não cria essas variáveis à mão,
elas são injetadas na conexão. A Vercel aposentou o "Vercel KV" como produto próprio; hoje o Redis
vem do Marketplace, fornecido pela Upstash:

> Projeto → aba **Storage** → **Create Database** (ou **Connect Store**) → **Upstash for Redis**
> → escolha o plano gratuito → **Connect to Project** → marque Production, Preview e Development.

Ao terminar, `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` aparecem sozinhas em
Settings → Environment Variables, e o próximo deploy já sobe com o driver `kv`. **Não use prefixo**
ao conectar (`--prefix` na CLI): ele renomeia as variáveis e o store não as encontraria.

Alternativa sem Marketplace: criar a conta direto em [upstash.com](https://upstash.com), copiar
`UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` do painel do banco e colar como variáveis
de ambiente do projeto na mão. O código não distingue os dois caminhos.

## Repositório e deploy

Esta entidade tem repositório próprio:
[`GTA7-Lab/sorveteria`](https://github.com/GTA7-Lab/sorveteria), com o código na raiz.
Até 05/09/2026 ela vivia em `entities/icecream/` do monorepo
[`GTA7-Lab/gta7-lab`](https://github.com/GTA7-Lab/gta7-lab), ao lado de `bank`,
`restaurante-ai-q-fome` e `supermercado` — o histórico foi migrado junto.

No Vercel o projeto é o `gta7-icecream`, no time GTA7 LAB, com **Root Directory na raiz
do repositório**. Não há build step: `public/index.html` é servido como estático e cada arquivo
em `api/` vira uma serverless function. As variáveis de ambiente são opcionais e mudam o que a
entidade consegue fazer — `ICECREAM_MAGIC_WORD` libera a escrita, `UPSTASH_REDIS_REST_*` a faz persistir.
Sem nenhuma delas a entidade roda como somente-leitura, que é o comportamento da v1.

O deploy é automático pela GitHub App do Vercel: push na `main` publica em
https://gta7-icecream.vercel.app

## Integração com o Core Orchestrator

```json
{
  "id": "icecream",
  "name": "Sorveteria Polar",
  "description": "Consulta sabores, precos e disponibilidade da sorveteria da cidade, mantem o cardapio e o cadastro de clientes",
  "tools": [
    "search_flavors", "quote_order", "recommend_flavors",
    "create_flavor", "update_flavor", "delete_flavor",
    "list_customers", "get_customer", "create_customer", "update_customer", "delete_customer"
  ]
}
```

Servido em `/api/manifest`, que também declara `mcp.write_protection` — como o Core (ou
qualquer cliente) descobre que as tools de escrita pedem `magic_word`. As rotas REST enviam
`Access-Control-Allow-Origin: *`, então outras entidades da cidade podem consumi-las direto do
navegador. O Core usa só as tools de leitura: ele não tem a palavra mágica.

A entidade está registrada em `data/entities.json` do repo
[`GTA7-Lab/gta7-lab-core`](https://github.com/GTA7-Lab/gta7-lab-core) com transporte `http`,
endpoint `/api/mcp` e tag `dessert` (acrescentada ao `src/lexicon.ts` de lá, que mapeia
palavras como "sorvete", "gelato" e "sobremesa" para essa tag). O registro guarda a URL de
produção, não um caminho de repositório.
