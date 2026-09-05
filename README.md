# Sorveteria Polar — entidade `icecream` da GTA7 Lab

Sorveteria artesanal da cidade digital GTA7 Lab. Publica cardápio, disponibilidade e horário,
calcula o preço de um pedido e recomenda sabores por perfil e restrição alimentar.

Funciona de forma independente (site + API REST) e oferece as mesmas capacidades ao
Core Orchestrator via **MCP**. Sem banco de dados: os arquivos em `data/` são a única fonte de verdade.

## Rodar local

```bash
npm install
npm run dev:local     # http://localhost:3000
```

`dev:local` sobe um servidor Node que monta os mesmos handlers de `api/` — não exige conta na Vercel.
Com a CLI da Vercel logada, `npm run dev` faz o mesmo pelo runtime real.

```bash
npm run smoke         # 41 asserções sobre as regras do core
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
curl "localhost:3000/api/flavors?dietary=vegano&max_price=1100"
curl "localhost:3000/api/quote?format=casquinha&flavor_ids=baunilha-madagascar&weekday=2"
curl -X POST localhost:3000/api/quote -H "Content-Type: application/json" \
  -d '{"format":"taca","flavor_ids":["chocolate-belga-70","pistache-siciliano"],"toppings":["chantilly"]}'
```

Preços sempre em **centavos** (inteiros), moeda `BRL`. Erros vêm como
`{ "error": { "code": "...", "message": "..." } }` — nunca uma exceção.

## MCP

Servidor stdio com três tools: `search_flavors`, `quote_order` e `recommend_flavors`.

```bash
npm run mcp
```

Registrar no Claude Code (ajuste o caminho absoluto):

```json
{
  "mcpServers": {
    "icecream": {
      "command": "npx",
      "args": ["tsx", "C:/Users/Pichau/Documents/Claude/Projects/GTA7-SORVETERIA/icecream/src/mcp/server.ts"]
    }
  }
}
```

## Repositório e deploy

Esta entidade vive em `icecream/` dentro do monorepo
[`ericmgomes/gta7-lab`](https://github.com/ericmgomes/gta7-lab), ao lado das outras
entidades da cidade. Cada pasta na raiz é uma aplicação independente, com o nome
igual ao `id` do seu `manifest.json`.

No Vercel o projeto usa **Root Directory = `icecream`**. Não há variáveis de ambiente
nem build step: `public/index.html` é servido como estático e cada arquivo em `api/`
vira uma serverless function.

## Integração com o Core Orchestrator

```json
{
  "id": "icecream",
  "name": "Sorveteria Polar",
  "description": "Consulta sabores, precos e disponibilidade da sorveteria da cidade",
  "tools": ["search_flavors", "quote_order", "recommend_flavors"]
}
```

Servido em `/api/manifest`. As rotas REST enviam `Access-Control-Allow-Origin: *`,
então outras entidades da cidade podem consumi-las direto do navegador.
