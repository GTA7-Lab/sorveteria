# CLAUDE.md - Sorveteria Polar (entidade `icecream`)

## Entidade
**Sorveteria Polar - Gelato & Sorvetes Artesanais**, entidade `icecream` da cidade GTA7 Lab.
Ponto de comércio e lazer do centro: complementa restaurantes (sobremesa), cinema e eventos
(combos), e é quem responde o que um cidadão com restrição alimentar pode consumir.

## Objetivo
Publicar cardápio, disponibilidade e horário; calcular o preço de um pedido; recomendar sabores.
Funciona sozinha (site + REST) e serve o Core Orchestrator via MCP.

## Estrutura do JSON (`data/` — única fonte de verdade)
| Arquivo | Conteúdo |
|---|---|
| `shop.json` | loja, `hours` por dia (`sun`..`sat`, `null` = fechado), `flavor_of_the_day` |
| `flavors.json` | 15 sabores; `category`, `price_cents`, `available`, `dietary[]`, `allergens[]`, `sweetness`, `popularity` |
| `formats.json` | 6 formatos; `included_scoops` (informativo), `max_scoops` (validado), `base_price_cents` |
| `toppings.json` | 7 adicionais com `price_cents` e `allergens[]` |
| `promos.json` | 4 promoções; `weekdays[]` + `rule` (`percent_off`/`fixed_off`, `applies_to` `total`/`format`) |

Chaves em inglês, conteúdo em português.

## MCP tools (`src/mcp/server.ts`, stdio)
- `search_flavors` — `query`, `category`, `dietary`, `avoid_allergens[]`, `max_price`, `only_available`
- `quote_order` — `format`, `flavor_ids[]`, `toppings[]`, `weekday`
- `recommend_flavors` — `profile`, `dietary`, `avoid_allergens[]`, `limit`

## Arquivos principais
- `src/core.ts` — **toda** a regra de negócio. MCP e REST são wrappers finos.
- `src/data.ts` — importa os JSON; `src/types.ts` — interfaces.
- `api/*.ts` — rotas REST; `api/_respond.ts` — mapeia `{error}` do core para HTTP.
- `public/index.html` — página única, sem framework.
- `scripts/smoke.ts` — 41 asserções sobre o core; `scripts/dev-server.ts` — dev local sem Vercel.

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

## Onde vive
Pasta `entities/icecream/` do monorepo `ericmgomes/gta7-lab`, ao lado de `bank`,
`restaurante-ai-q-fome` e `supermercado`. Convenção do repo: uma pasta por entidade
em `entities/`, com nome igual ao `id` do seu `manifest.json`.
No Vercel, projeto `gta7-icecream` (time GTA7 LAB), Root Directory = `entities/icecream`.
No ar em https://gta7-icecream.vercel.app

## Status atual
v1 completa e verificada: 41/41 smoke tests, `tsc --noEmit` limpo, REST e site testados,
handshake MCP (`initialize` → `tools/list` → `tools/call`) validado.

## Próxima tarefa
Registrar a entidade no Core Orchestrator: `core/src/entities/` hoje só tem
`restaurants.ts` e `venues.ts`, falta o equivalente para `icecream` apontando
para `/api/manifest`.

Deploy ainda é manual (`npx vercel --prod` dentro de `entities/icecream/`): a GitHub App
do Vercel não está instalada no repositório, então push não dispara deploy automático.
