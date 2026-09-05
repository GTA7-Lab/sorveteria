# CLAUDE.md - Sorveteria Polar (entidade `icecream`)

## Entidade
**Sorveteria Polar - Gelato & Sorvetes Artesanais**, entidade `icecream` da cidade GTA7 Lab.
Ponto de comércio e lazer do centro: complementa restaurantes (sobremesa), cinema e eventos
(combos), e é quem responde o que um cidadão com restrição alimentar pode consumir.

## Objetivo
Publicar cardápio, disponibilidade e horário; calcular o preço de um pedido; recomendar sabores.
Funciona sozinha (site + REST) e serve o Core Orchestrator via MCP.

## Estrutura do JSON (`data/`)
| Arquivo | Conteúdo |
|---|---|
| `shop.json` | loja, `hours` por dia (`sun`..`sat`, `null` = fechado), `flavor_of_the_day` |
| `flavors.json` | **seed** de 15 sabores; `category`, `price_cents`, `available`, `dietary[]`, `allergens[]`, `sweetness`, `popularity` |
| `formats.json` | 6 formatos; `included_scoops` (informativo), `max_scoops` (validado), `base_price_cents` |
| `toppings.json` | 7 adicionais com `price_cents` e `allergens[]` |
| `promos.json` | 4 promoções; `weekdays[]` + `rule` (`percent_off`/`fixed_off`, `applies_to` `total`/`format`) |
| `customers.json` | **seed** de 4 clientes; `dietary[]`, `allergens[]`, `favorite_flavor_ids[]`, timestamps |

Chaves em inglês, conteúdo em português.

**Duas naturezas convivem em `data/`.** `formats`, `toppings`, `promos` e `shop` são fixos e
vêm direto do bundle: são a fonte de verdade em si. `flavors` e `customers` têm CRUD e mudam em
runtime, então para eles o JSON é só o **seed** — o estado inicial que `src/store.ts` publica na
primeira leitura. Editar `data/flavors.json` não muda o cardápio de um ambiente que já tem store
populado; para isso existe `update_flavor`.

## MCP tools (`src/mcp/tools.ts`, compartilhadas pelos dois transportes)
- `search_flavors` — `query`, `category`, `dietary`, `avoid_allergens[]`, `max_price` (centavos),
  `max_price_brl` (reais), `limit`, `only_available`
- `quote_order` — `format`, `flavor_ids[]`, `toppings[]`, `weekday`
- `recommend_flavors` — `profile`, `dietary`, `avoid_allergens[]`, `limit`

CRUD de sabores (os produtos) — **exige `magic_word`**:
- `create_flavor` — `name` e `category` obrigatórios + preço (`price_cents` ou `price_brl`)
- `update_flavor` — `id` + campos a mudar; o `id` nunca muda, nem quando o nome muda
- `delete_flavor` — `id`

CRUD de clientes — **exige `magic_word`** nas três de escrita:
- `list_customers` — `query`, `dietary`, `allergen`, `favorite_flavor_id`, `limit`
- `get_customer` — `id`
- `create_customer` — só `name` é obrigatório; `id` é gerado por slug do nome
- `update_customer` — `id` + campos a mudar; chave ausente = campo intocado, `""` limpa
- `delete_customer` — `id`

**As seis tools de escrita exigem `magic_word`; as cinco de leitura, não.** A palavra é conferida
contra `ICECREAM_MAGIC_WORD` no servidor. Sem essa variável a entidade fica somente-leitura.

Dois transportes, mesmas tools:
- **stdio** — `src/mcp/server.ts`, para rodar local (`npm run mcp`)
- **HTTP streamable** — `api/mcp.ts`, em `/api/mcp`; é por aí que o Core Orchestrator consome

## Arquivos principais
- `src/core.ts` — **leitura e cálculo**: busca no cardápio, horário, orçamento, recomendação.
  As leituras de sabor são assíncronas porque o cardápio vem do store.
- `src/flavors.ts` — **escrita do cardápio** (os produtos). Exige palavra mágica.
- `src/customers.ts` — **escrita do cadastro de clientes**. Exige palavra mágica.
- `src/guard.ts` — a palavra mágica. Único portão das escritas.
- `src/store.ts` — persistência das coleções mutáveis, com os três drivers (`kv`/`file`/`memory`).
- `src/validate.ts` — validações compartilhadas pelos dois módulos de escrita.
- `src/data.ts` — separa o fixo (do bundle) do mutável (do store); `src/types.ts` — interfaces.
- `api/*.ts` — rotas REST; `api/_respond.ts` — mapeia `{error}` do core para HTTP.
- `public/index.html` — página única, sem framework.
- `src/mcp/tools.ts` — definição das tools; `src/mcp/server.ts` (stdio) e `api/mcp.ts` (HTTP) só a plugam.
- `scripts/smoke.ts` — 122 asserções; `scripts/test-mcp-http.ts` — 33 asserções no `/api/mcp`,
  49 quando o store persiste **e** o teste conhece a palavra mágica; `scripts/dev-server.ts` — dev local.

MCP e REST continuam wrappers finos. A regra se divide por duas fronteiras: **estado** (core lê o
que já existe; flavors/customers escrevem) e **autorização** (só a escrita passa pelo guard).

## Decisões relevantes
- **CommonJS** (`tsconfig` `module: commonjs` + `resolveJsonModule`) para que `import x from "../data/x.json"`
  funcione tanto no bundle da Vercel quanto no MCP local, sem `fs`, `process.cwd()` nem `includeFiles`.
- **Nenhuma função do core lança exceção**: retornam `{ error: { code, message } }`. REST traduz para 400/404,
  MCP devolve o mesmo JSON com `isError: true`.
- **Preços sempre em centavos (inteiros)**; formatação em reais só em `public/index.html`.
- **Dieta vem sempre do array `dietary`**, nunca da categoria nem do texto. `category` e `dietary` se sobrepõem
  de propósito (existe categoria `vegano` e tag `vegano`) — ex.: Limão Siciliano é categoria `frutas` com tag `vegano`.
- **Fórmula do pedido**: `base_price_cents` do formato + `price_cents` de cada bola + adicionais.
- **Promoções**: o desconto incide sobre o subtotal; `applies_to: "format"` apenas condiciona a elegibilidade
  ao formato, `applies_to: "total"` a um valor mínimo. Uma promoção por pedido — a de maior desconto.
- **`is_open` no fuso `America/Sao_Paulo`** via `Intl.DateTimeFormat`, porque a Vercel roda em UTC.
- Tools MCP declaradas com **JSON Schema puro** (API de baixo nível do SDK), sem escrever schemas zod.
- **`/api/mcp` é stateless** (`sessionIdGenerator: undefined`), uma instância de `Server` por request —
  é o que funciona em serverless.
- **Apelido `items`** nas respostas de lista: o Core procura `items`/`results`/`data`/`list`, e sem isso
  trataria a resposta inteira como um único item.
- **`max_price_brl` existe para o Core**, que fala em reais (slot `maxPricePerPerson`); internamente
  tudo continua em centavos.
- **Palavra mágica (`src/guard.ts`)**: `/api/mcp` é público e sem autenticação, então as seis tools
  de escrita exigem o parâmetro `magic_word`, conferido contra `ICECREAM_MAGIC_WORD`. A checagem
  mora na **camada de regra**, não na de tool, para que uma rota REST futura não contorne o portão
  por esquecimento. Comparação em tempo constante; as mensagens de erro nunca repetem a palavra
  tentada nem revelam a esperada. `magic_word` é separado dos dados em `callTool`, antes de chegar
  na regra — é credencial, não campo do registro, e não pode acabar gravada dentro de um sabor.
- **Sem `ICECREAM_MAGIC_WORD` a entidade fica somente-leitura** (`MAGIC_WORD_NOT_CONFIGURED`).
  É o default seguro: uma entidade mal configurada fica fechada, não aberta.
- **Sabores e clientes não cabem no padrão `data/*.json`**: eles mudam em runtime e o filesystem da
  Vercel é read-only. `src/store.ts` escolhe o driver pelo ambiente, sem dependência nova: `kv`
  (Redis REST da Upstash — o único que persiste em produção), `file` (`data/<coleção>.local.json`,
  fora do git) e `memory` (fallback). `ICECREAM_STORE` força um driver.
- **O par `KV_REST_API_*` é legado.** A Vercel aposentou o Vercel KV como produto próprio; hoje o
  Redis vem do Marketplace pela Upstash e injeta `UPSTASH_REDIS_REST_URL`/`_TOKEN`. `kvConfig()`
  aceita os dois pares, com o legado na frente. Conectar com `--prefix` renomeia as variáveis e
  quebra a detecção.
- **O driver `kv` é testado contra um stub do contrato REST da Upstash** (`kvDriverSection` no
  smoke): é o único driver que fala com a rede e o único que roda em produção, então um erro nele
  só apareceria com dado real em jogo.
- **O catálogo virou assíncrono** quando os sabores ganharam CRUD: `searchFlavors`, `getFlavor`,
  `getShopInfo`, `quoteOrder` e `recommendFlavors` passaram a `async`, e com elas as rotas REST.
  Formatos, adicionais e promoções continuam síncronos, direto do bundle — só sabores mudam.
- **Incoerência entre dieta e alergênico é erro, não aviso** (`DIETARY_CONFLICT`): um sabor marcado
  `vegano` com `leite` apareceria numa busca por vegano, que é exatamente a pergunta que a entidade
  existe para responder. Checado sobre o **resultado final** do patch, para que tirar o alergênico e
  pôr a tag em chamadas separadas não abra brecha de ordem.
- **O sabor do dia não pode ser removido nem esgotado** (`FLAVOR_IS_FEATURED`): `shop.json` é fixo e
  aponta para ele, então a vitrine ficaria sem destaque. Trocar `flavor_of_the_day` vem antes.
- **`delete_flavor` limpa os favoritos dos clientes afetados** e devolve `unlinked_from_customers`.
  Deixar a referência pendurada travaria o cliente: `create`/`update_customer` validam
  `favorite_flavor_ids` contra o cardápio, e ele nem poderia mais ser salvo.
- **Toda resposta de escrita traz `storage`** com `driver`, `persistent` e uma nota. Sem isso, um
  `create_flavor` no driver `memory` pareceria ter funcionado e sumiria na requisição seguinte —
  o cliente MCP precisa dessa informação para não mentir para o cidadão.
- **Favorito que colide com alergênico declarado vira aviso, não erro**: pode ser gosto legítimo ou
  erro de digitação, então `warnings[]` sinaliza sem bloquear o cadastro.
- **Telefone e email são as chaves naturais do cliente**: repetir qualquer um dá `CUSTOMER_EXISTS`,
  comparando telefone só por dígitos (formatação diferente é o mesmo número).
- **`updated_at` é estritamente crescente**: duas escritas no mesmo milissegundo dariam o mesmo ISO
  e quem acompanha o cadastro por esse campo não veria a alteração.
- **`query` não é mapeado no registro do Core**: ele manda a frase inteira do cidadão, que nunca casa
  com nome de sabor e zeraria o resultado (limitação conhecida, documentada no `CLAUDE.md` do Core).
  Busca textual segue disponível via `call_entity_tool`.

## Onde vive
Repositório próprio [`GTA7-Lab/sorveteria`](https://github.com/GTA7-Lab/sorveteria), com a
entidade na raiz. Até 05/09/2026 ela era a pasta `entities/icecream/` do monorepo
`GTA7-Lab/gta7-lab`; o histórico veio junto na migração. O Core registra a entidade pela URL
de produção, não por caminho no repo, então a integração não depende de onde o código mora.
No Vercel, projeto `gta7-icecream` (time GTA7 LAB), Root Directory = raiz do repositório.
No ar em https://gta7-icecream.vercel.app

## Status atual
Verificada: 122/122 no smoke, 49/49 no `/api/mcp` local com store persistente e palavra mágica
conhecida (33/33 sem elas, exercitando só o lado da recusa), `tsc --noEmit` limpo.

**Duas variáveis de ambiente decidem o que a entidade consegue fazer em produção:**

| Variável | Sem ela | Com ela |
|---|---|---|
| `ICECREAM_MAGIC_WORD` | somente-leitura: toda escrita volta `MAGIC_WORD_NOT_CONFIGURED` | as seis tools de escrita liberadas para quem souber a palavra |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | driver `memory`: leitura ok, escrita some entre requisições | escrita persiste de verdade |

Hoje **nenhuma das duas está configurada no projeto da Vercel**, então em produção a entidade
segue se comportando como a v1: leitura funcionando, escrita recusada no portão. Isso é seguro,
mas não é o estado final — provisionar o KV e definir a palavra são o próximo passo.
Registrada no Core (`data/entities.json` do repo `GTA7-Lab/gta7-lab-core`, tag `dessert`):
o `npm run smoke` do Core passa com `icecream.search_flavors` devolvendo itens. O registro é
por URL de produção, então a entidade pode mudar de repositório sem mexer no Core.
Deploy automático: push na `main` deste repositório publica em https://gta7-icecream.vercel.app

## Próxima tarefa
1. ~~Definir `ICECREAM_MAGIC_WORD` no projeto da Vercel~~ — feito em 05/09/2026.
2. Conectar um Redis pelo Marketplace (Storage → Create Database → Upstash for Redis → Connect to
   Project, sem prefixo) para que as escritas persistam. Enquanto não houver, o driver é `memory`.
3. Ideias, se houver tempo: rotas REST para o CRUD (hoje só existe em MCP — o guard já está na
   camada de regra, então elas herdam a proteção de graça); `recommend_for_customer`, cruzando
   o cadastro com `recommendFlavors`; `create_order` apoiado no mesmo `src/store.ts`; sabor do
   dia rotativo por data, que hoje é fixo em `shop.json` e por isso trava `delete_flavor`.
