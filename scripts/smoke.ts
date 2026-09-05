// Testa as regras do core sem framework: node scripts/smoke.ts via tsx.
import {
  searchFlavors, getFlavor, getShopInfo, quoteOrder, recommendFlavors,
} from "../src/core";
import {
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
} from "../src/customers";
import { createFlavor, updateFlavor, deleteFlavor } from "../src/flavors";
import { flavorsSeed, customersSeed, flavorsCollection, customersCollection } from "../src/data";
import { storeInfo, resetDriverCache } from "../src/store";
import type { CoreError } from "../src/types";

// O store de memoria mantem os testes isolados: sem isso o driver `file` gravaria
// em data/*.local.json e uma execucao sujaria a proxima. A palavra magica e definida
// aqui porque sem ela toda escrita seria recusada, que e o default seguro do guard.
process.env.ICECREAM_STORE = "memory";
process.env.ICECREAM_MAGIC_WORD = "casquinha-dupla";
const MAGIC = "casquinha-dupla";

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

/** Desembrulha um retorno do core, falhando alto se veio { error }. */
function ok<T>(value: T): Exclude<T, CoreError> {
  if (value && typeof value === "object" && "error" in value) {
    throw new Error("esperava sucesso, veio erro: " + JSON.stringify(value));
  }
  return value as Exclude<T, CoreError>;
}

/**
 * Leitura do catalogo e do pedido. Reseta as colecoes antes de comecar para nao
 * depender de sobra de uma execucao anterior no driver `file`.
 */
async function catalogSection() {
  await flavorsCollection.reset();

  console.log("\n== sabores ==");
  const all = ok(await searchFlavors({}));
  check("por padrao lista so os disponiveis", all.count === flavorsSeed.filter((f) => f.available).length);
  check("nenhum esgotado no resultado padrao", all.flavors.every((f) => f.available));

  const withSoldOut = ok(await searchFlavors({ only_available: false }));
  check("only_available=false traz o cardapio inteiro", withSoldOut.count === flavorsSeed.length);

  const acai = ok(await searchFlavors({ query: "acai" }));
  check("busca sem acento acha 'Acai'", acai.flavors.some((f) => f.id === "acai-com-banana"), acai.flavors.map((f) => f.id));
  const caixa = ok(await searchFlavors({ query: "CHOCOLATE BELGA" }));
  check("busca ignora caixa alta", caixa.flavors.some((f) => f.id === "chocolate-belga-70"));

  const veganos = ok(await searchFlavors({ dietary: "vegano" }));
  check("filtro vegano tem resultado", veganos.count >= 2, veganos.count);
  check("todo vegano tem a tag no array dietary", veganos.flavors.every((f) => f.dietary.includes("vegano")));
  check("nenhum vegano tem leite nos alergenicos", veganos.flavors.every((f) => !f.allergens.includes("leite")));
  check("filtro dietary usa a tag, nao a categoria", veganos.flavors.some((f) => f.category !== "vegano"),
    veganos.flavors.map((f) => f.id + ":" + f.category));

  const semCastanha = ok(await searchFlavors({ avoid_allergens: ["castanhas"] }));
  check("avoid_allergens exclui castanhas", semCastanha.flavors.every((f) => !f.allergens.includes("castanhas")));

  const barato = ok(await searchFlavors({ max_price: 950 }));
  check("max_price respeitado", barato.flavors.every((f) => f.price_cents <= 950));

  console.log("\n== erros previsiveis ==");
  const semSabor = await getFlavor("nao-existe");
  check("getFlavor com id invalido retorna erro", "error" in semSabor && semSabor.error.code === "FLAVOR_NOT_FOUND", semSabor);
  const um = ok(await getFlavor("baunilha-madagascar"));
  check("getFlavor com id valido retorna o sabor", um.name === "Baunilha de Madagascar");

  console.log("\n== loja ==");
  const shopNow = await getShopInfo();
  check("is_open e booleano", typeof shopNow.is_open === "boolean");
  check("sabor do dia resolvido", shopNow.flavor_of_the_day !== null && shopNow.flavor_of_the_day.id === "gelato-stracciatella");
  const segunda = await getShopInfo("2026-09-07T18:00:00-03:00"); // segunda: fechado
  check("segunda-feira aparece fechada", segunda.is_open === false && segunda.today_hours === null, segunda.weekday_name);
  const sabado = await getShopInfo("2026-09-05T18:00:00-03:00"); // sabado 18h: aberto
  check("sabado as 18h aparece aberta", sabado.is_open === true, sabado.weekday_name);
  const sabadoCedo = await getShopInfo("2026-09-05T09:00:00-03:00"); // antes de abrir
  check("sabado as 9h ainda fechada", sabadoCedo.is_open === false);

  console.log("\n== pedido ==");
  const semPromo = ok(await quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar"], weekday: 1 }));
  check("segunda nao tem promo de casquinha", semPromo.discount_cents === 0 && semPromo.applied_promo === null);
  check("subtotal = base 300 + bola 900", semPromo.subtotal_cents === 1200, semPromo.subtotal_cents);
  check("total = subtotal - desconto", semPromo.total_cents === semPromo.subtotal_cents - semPromo.discount_cents);

  const comPromo = ok(await quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar"], weekday: 2 }));
  check("terca aplica a Terca da Casquinha", comPromo.applied_promo?.id === "terca-da-casquinha", comPromo.applied_promo);
  check("desconto de 20% sobre o subtotal (1200) = 240", comPromo.discount_cents === 240, comPromo.discount_cents);
  check("mesmo subtotal, total menor que sem promo", comPromo.total_cents < semPromo.total_cents);

  const comAdicional = ok(await quoteOrder({
    format: "taca", flavor_ids: ["chocolate-belga-70", "pistache-siciliano"], toppings: ["castanha_caju"], weekday: 1,
  }));
  check("itens detalhados: 1 formato + 2 sabores + 1 adicional", comAdicional.items.length === 4);
  check("alergenicos agregados do pedido", comAdicional.allergens.includes("castanhas") && comAdicional.allergens.includes("leite"), comAdicional.allergens);

  const maiorDesconto = ok(await quoteOrder({ format: "pote_1l", flavor_ids: ["chocolate-belga-70", "pistache-siciliano", "gelato-avela-piemonte", "doce-de-leite-artesanal", "morango-do-vale"], weekday: 3 }));
  check("vence a promo de maior desconto", maiorDesconto.discount_cents > 0, maiorDesconto.applied_promo);

  const esgotado = await quoteOrder({ format: "copo", flavor_ids: ["pacoca-crocante"], weekday: 1 });
  check("sabor esgotado da erro proprio", "error" in esgotado && esgotado.error.code === "FLAVOR_UNAVAILABLE", esgotado);
  const demais = await quoteOrder({ format: "casquinha", flavor_ids: ["baunilha-madagascar", "morango-do-vale", "maracuja-cremoso"], weekday: 1 });
  check("bolas acima do limite da erro distinto", "error" in demais && demais.error.code === "TOO_MANY_SCOOPS", demais);
  const semFormato = await quoteOrder({ format: "banheira", flavor_ids: ["baunilha-madagascar"] });
  check("formato inexistente da erro claro", "error" in semFormato && semFormato.error.code === "FORMAT_NOT_FOUND");
  const vazio = await quoteOrder({ format: "copo", flavor_ids: [] });
  check("pedido sem sabor da erro", "error" in vazio && vazio.error.code === "EMPTY_ORDER");
  const topInvalido = await quoteOrder({ format: "copo", flavor_ids: ["baunilha-madagascar"], toppings: ["ouro"] });
  check("adicional inexistente da erro", "error" in topInvalido && topInvalido.error.code === "TOPPING_NOT_FOUND");

  console.log("\n== recomendacao ==");
  const rec = ok(await recommendFlavors({ profile: "chocolatudo", dietary: "vegano" }));
  check("no maximo 3 recomendacoes", rec.count <= 3 && rec.count >= 1, rec.count);
  check("todas veganas", rec.recommendations.every((f) => f.dietary.includes("vegano")));
  check("todas com justificativa", rec.recommendations.every((f) => typeof f.reason === "string" && f.reason.length > 0));
  check("chocolate vegano vem em primeiro", rec.recommendations[0].id === "chocolate-vegano-zero", rec.recommendations.map((f) => f.id));

  const leve = ok(await recommendFlavors({ profile: "algo leve e citrico", limit: 2 }));
  check("limit respeitado", leve.count === 2);
  check("perfil citrico casa criterios", leve.matched_criteria.length >= 1, leve.matched_criteria);
  check("limao siciliano entre os leves e citricos", leve.recommendations.some((f) => f.id === "limao-siciliano"), leve.recommendations.map((f) => f.id));

  const vago = ok(await recommendFlavors({ profile: "qualquer coisa" }));
  check("perfil sem match cai na popularidade", vago.count === 3 && vago.recommendations.every((f) => f.reason.includes("mais pedidos")));

  const semNada = await recommendFlavors({ dietary: "vegano", avoid_allergens: ["leite", "soja", "castanhas", "amendoim", "gluten"], profile: "chocolate" });
  check("restricao impossivel nao quebra", !("error" in semNada) || semNada.error.code === "NO_MATCH");
}

async function customersSection() {
  await customersCollection.reset();
  await flavorsCollection.reset();

  console.log("\n== clientes: leitura ==");
  const inicial = ok(await listCustomers());
  check("lista comeca com o seed", inicial.total === customersSeed.length, inicial.total);
  check("driver de memoria nos testes", inicial.storage.driver === "memory", inicial.storage);
  check("driver de memoria se declara nao persistente", inicial.storage.persistent === false);

  const veganos = ok(await listCustomers({ dietary: "vegano" }));
  check("filtro dietary", veganos.customers.every((c) => c.dietary.includes("vegano")) && veganos.count >= 1,
    veganos.customers.map((c) => c.id));

  const comCastanha = ok(await listCustomers({ allergen: "castanhas" }));
  check("filtro allergen", comCastanha.customers.every((c) => c.allergens.includes("castanhas")) && comCastanha.count === 1,
    comCastanha.customers.map((c) => c.id));

  const porFavorito = ok(await listCustomers({ favorite_flavor_id: "limao-siciliano" }));
  check("filtro por sabor favorito", porFavorito.customers.some((c) => c.id === "marina-alcantara"),
    porFavorito.customers.map((c) => c.id));

  const porTexto = ok(await listCustomers({ query: "BEIRA-RIO" }));
  check("busca textual ignora caixa e acento", porTexto.customers.some((c) => c.id === "heitor-vasques"),
    porTexto.customers.map((c) => c.id));

  const cortado = ok(await listCustomers({ limit: 2 }));
  check("limit corta mas total continua o real", cortado.count === 2 && cortado.total === customersSeed.length, cortado);

  const dietaInvalida = await listCustomers({ dietary: "carnivoro" });
  check("dietary invalido da erro proprio", "error" in dietaInvalida && dietaInvalida.error.code === "INVALID_DIETARY", dietaInvalida);

  const umCliente = ok(await getCustomer("marina-alcantara"));
  check("getCustomer devolve o cadastro", umCliente.name === "Marina Alcântara");
  const semCliente = await getCustomer("nao-existe");
  check("getCustomer com id invalido retorna erro", "error" in semCliente && semCliente.error.code === "CUSTOMER_NOT_FOUND", semCliente);

  console.log("\n== clientes: criacao ==");
  const criado = ok(await createCustomer({
    name: "Bruna Sampaio",
    phone: "(11) 91234-5678",
    email: "Bruna.Sampaio@GTA7.city",
    district: "Centro",
    dietary: ["sem_lactose"],
    favorite_flavor_ids: ["acai-com-banana"],
  }, MAGIC));
  check("cria com id em slug a partir do nome", criado.customer.id === "bruna-sampaio", criado.customer.id);
  check("normaliza o email para minusculas", criado.customer.email === "bruna.sampaio@gta7.city", criado.customer.email);
  check("campos nao informados nascem null/vazio",
    criado.customer.notes === null && criado.customer.allergens.length === 0, criado.customer);
  check("created_at e updated_at nascem iguais", criado.customer.created_at === criado.customer.updated_at);
  check("cliente novo aparece na lista", (ok(await listCustomers())).total === customersSeed.length + 1);

  const homonimo = ok(await createCustomer({ name: "Bruna Sampaio" }, MAGIC));
  check("nome repetido gera id sufixado", homonimo.customer.id === "bruna-sampaio-2", homonimo.customer.id);

  const comAviso = ok(await createCustomer({
    name: "Rafael Teles", allergens: ["leite"], favorite_flavor_ids: ["baunilha-madagascar"],
  }, MAGIC));
  check("favorito que colide com alergenico vira aviso, nao erro",
    comAviso.created === true && comAviso.warnings.length === 1, comAviso.warnings);

  console.log("\n== clientes: validacao ==");
  const semNome = await createCustomer({ phone: "(11) 90000-0000" }, MAGIC);
  check("cliente sem nome da erro", "error" in semNome && semNome.error.code === "MISSING_NAME", semNome);
  const emailRuim = await createCustomer({ name: "Teste", email: "arroba-nenhum" }, MAGIC);
  check("email invalido da erro", "error" in emailRuim && emailRuim.error.code === "INVALID_EMAIL", emailRuim);
  const foneRuim = await createCustomer({ name: "Teste", phone: "123" }, MAGIC);
  check("telefone curto da erro", "error" in foneRuim && foneRuim.error.code === "INVALID_PHONE", foneRuim);
  const dietaRuim = await createCustomer({ name: "Teste", dietary: ["low_carb"] }, MAGIC);
  check("dietary fora da taxonomia da erro", "error" in dietaRuim && dietaRuim.error.code === "INVALID_DIETARY", dietaRuim);
  const alergRuim = await createCustomer({ name: "Teste", allergens: ["poeira"] }, MAGIC);
  check("allergens fora da taxonomia da erro", "error" in alergRuim && alergRuim.error.code === "INVALID_ALLERGEN", alergRuim);
  const favRuim = await createCustomer({ name: "Teste", favorite_flavor_ids: ["sorvete-de-cimento"] }, MAGIC);
  check("favorito inexistente da erro", "error" in favRuim && favRuim.error.code === "FLAVOR_NOT_FOUND", favRuim);
  const foneDuplicado = await createCustomer({ name: "Outra Pessoa", phone: "(11) 9 1234 5678" }, MAGIC);
  check("telefone ja cadastrado da erro, mesmo com formatacao diferente",
    "error" in foneDuplicado && foneDuplicado.error.code === "CUSTOMER_EXISTS", foneDuplicado);

  console.log("\n== clientes: atualizacao e remocao ==");
  const antes = ok(await getCustomer("bruna-sampaio"));
  const atualizado = ok(await updateCustomer("bruna-sampaio", { district: "Vila Norte", allergens: ["soja"] }, MAGIC));
  check("update muda so os campos enviados",
    atualizado.customer.district === "Vila Norte" && atualizado.customer.name === antes.name, atualizado.customer);
  check("changed_fields lista o que mudou",
    atualizado.changed_fields.sort().join(",") === "allergens,district", atualizado.changed_fields);
  check("update mexe em updated_at", atualizado.customer.updated_at !== antes.updated_at);
  check("update preserva created_at", atualizado.customer.created_at === antes.created_at);

  const semMudanca = ok(await updateCustomer("bruna-sampaio", { district: "Vila Norte" }, MAGIC));
  check("patch sem mudanca real nao mexe em updated_at",
    semMudanca.updated === false && semMudanca.customer.updated_at === atualizado.customer.updated_at, semMudanca);

  const limpo = ok(await updateCustomer("bruna-sampaio", { district: "" }, MAGIC));
  check("string vazia limpa o campo", limpo.customer.district === null, limpo.customer.district);

  const conflito = await updateCustomer("bruna-sampaio", { email: "clarice.fontes@gta7.city" }, MAGIC);
  check("email de outro cliente da erro", "error" in conflito && conflito.error.code === "CUSTOMER_EXISTS", conflito);
  const fantasma = await updateCustomer("nao-existe", { name: "X" }, MAGIC);
  check("update de id inexistente da erro", "error" in fantasma && fantasma.error.code === "CUSTOMER_NOT_FOUND", fantasma);

  const total = (ok(await listCustomers())).total;
  const removido = ok(await deleteCustomer("bruna-sampaio-2", MAGIC));
  check("delete devolve o registro removido", removido.customer.id === "bruna-sampaio-2", removido.customer.id);
  check("delete atualiza a contagem", removido.remaining === total - 1, removido.remaining);
  check("removido some da lista", !(ok(await listCustomers())).customers.some((c) => c.id === "bruna-sampaio-2"));
  const denovo = await deleteCustomer("bruna-sampaio-2", MAGIC);
  check("delete repetido da erro", "error" in denovo && denovo.error.code === "CUSTOMER_NOT_FOUND", denovo);
}

/** CRUD dos sabores: os produtos. Escrita protegida e coerencia de dieta. */
async function flavorsSection() {
  await flavorsCollection.reset();
  await customersCollection.reset();

  console.log("\n== sabores: criacao ==");
  const criado = ok(await createFlavor({
    name: "Manga com Pimenta",
    category: "especial",
    price_brl: 12.5,
    description: "Manga Palmer com um toque de pimenta rosa.",
    dietary: ["vegano", "sem_lactose"],
    sweetness: 4,
  }, MAGIC));
  check("cria com id em slug", criado.flavor.id === "manga-com-pimenta", criado.flavor.id);
  check("price_brl vira centavos", criado.flavor.price_cents === 1250, criado.flavor.price_cents);
  check("defaults aplicados", criado.flavor.available === true && criado.flavor.popularity === 0, criado.flavor);

  const noCardapio = ok(await searchFlavors({ query: "manga" }));
  check("sabor novo aparece na busca", noCardapio.flavors.some((f) => f.id === "manga-com-pimenta"),
    noCardapio.flavors.map((f) => f.id));

  const orcado = ok(await quoteOrder({ format: "copo", flavor_ids: ["manga-com-pimenta"], weekday: 1 }));
  check("pedido usa o cardapio vivo, nao o bundle", orcado.subtotal_cents === 400 + 1250, orcado.subtotal_cents);

  console.log("\n== sabores: validacao ==");
  const semCategoria = await createFlavor({ name: "Teste", price_cents: 900 }, MAGIC);
  check("sem category da erro", "error" in semCategoria && semCategoria.error.code === "MISSING_CATEGORY", semCategoria);
  const semPreco = await createFlavor({ name: "Teste", category: "creme" }, MAGIC);
  check("sem preco da erro", "error" in semPreco && semPreco.error.code === "MISSING_PRICE", semPreco);
  const precoZero = await createFlavor({ name: "Teste", category: "creme", price_cents: 0 }, MAGIC);
  check("preco zero da erro", "error" in precoZero && precoZero.error.code === "INVALID_PRICE", precoZero);
  const duplicado = await createFlavor({ name: "Manga com Pimenta", category: "frutas", price_cents: 900 }, MAGIC);
  check("nome ja usado da erro", "error" in duplicado && duplicado.error.code === "FLAVOR_EXISTS", duplicado);
  const docura = await createFlavor({ name: "Teste", category: "creme", price_cents: 900, sweetness: 9 }, MAGIC);
  check("sweetness fora de 1..5 da erro", "error" in docura && docura.error.code === "INVALID_FIELD", docura);

  const veganoComLeite = await createFlavor({
    name: "Falso Vegano", category: "vegano", price_cents: 900,
    dietary: ["vegano"], allergens: ["leite"],
  }, MAGIC);
  check("vegano com leite e recusado",
    "error" in veganoComLeite && veganoComLeite.error.code === "DIETARY_CONFLICT", veganoComLeite);
  const semGlutenComGluten = await createFlavor({
    name: "Falso Sem Gluten", category: "creme", price_cents: 900,
    dietary: ["sem_gluten"], allergens: ["gluten"],
  }, MAGIC);
  check("sem_gluten com gluten e recusado",
    "error" in semGlutenComGluten && semGlutenComGluten.error.code === "DIETARY_CONFLICT", semGlutenComGluten);

  console.log("\n== sabores: atualizacao ==");
  const reajuste = ok(await updateFlavor("manga-com-pimenta", { price_brl: 13.9, popularity: 2 }, MAGIC));
  check("update altera so o que foi enviado",
    reajuste.flavor.price_cents === 1390 && reajuste.flavor.name === "Manga com Pimenta", reajuste.flavor);
  check("changed_fields lista o que mudou",
    reajuste.changed_fields.sort().join(",") === "popularity,price_cents", reajuste.changed_fields);

  const renomeado = ok(await updateFlavor("manga-com-pimenta", { name: "Manga Apimentada" }, MAGIC));
  check("id nao muda quando o nome muda", renomeado.flavor.id === "manga-com-pimenta", renomeado.flavor.id);

  // O conflito e checado no resultado final: por caminhos separados nao ha brecha.
  const conflitoEmDuasEtapas = await updateFlavor("baunilha-madagascar", { dietary: ["vegano"] }, MAGIC);
  check("update que criaria incoerencia e recusado",
    "error" in conflitoEmDuasEtapas && conflitoEmDuasEtapas.error.code === "DIETARY_CONFLICT", conflitoEmDuasEtapas);

  const inexistente = await updateFlavor("sorvete-de-cimento", { price_cents: 100 }, MAGIC);
  check("update de sabor inexistente da erro",
    "error" in inexistente && inexistente.error.code === "FLAVOR_NOT_FOUND", inexistente);

  const esgotarDestaque = await updateFlavor("gelato-stracciatella", { available: false }, MAGIC);
  check("nao da para esgotar o sabor do dia",
    "error" in esgotarDestaque && esgotarDestaque.error.code === "FLAVOR_IS_FEATURED", esgotarDestaque);

  console.log("\n== sabores: remocao ==");
  const removerDestaque = await deleteFlavor("gelato-stracciatella", MAGIC);
  check("nao da para remover o sabor do dia",
    "error" in removerDestaque && removerDestaque.error.code === "FLAVOR_IS_FEATURED", removerDestaque);

  // marina-alcantara tem limao-siciliano entre os favoritos no seed.
  const removido = ok(await deleteFlavor("limao-siciliano", MAGIC));
  check("delete devolve o sabor removido", removido.flavor.id === "limao-siciliano");
  check("delete limpa o favorito dos clientes afetados",
    removido.unlinked_from_customers.includes("marina-alcantara"), removido.unlinked_from_customers);
  const marina = ok(await getCustomer("marina-alcantara"));
  check("cliente fica sem referencia pendurada",
    !marina.favorite_flavor_ids.includes("limao-siciliano"), marina.favorite_flavor_ids);
  const sumiu = ok(await searchFlavors({ only_available: false }));
  check("removido some do cardapio", !sumiu.flavors.some((f) => f.id === "limao-siciliano"));
  const denovo = await deleteFlavor("limao-siciliano", MAGIC);
  check("delete repetido da erro", "error" in denovo && denovo.error.code === "FLAVOR_NOT_FOUND", denovo);
}

/** A palavra magica: o portao das escritas. Leitura nunca passa por aqui. */
async function guardSection() {
  await flavorsCollection.reset();
  await customersCollection.reset();

  console.log("\n== palavra magica ==");

  const semPalavra = await createFlavor({ name: "Sorrateiro", category: "creme", price_cents: 900 });
  check("escrita sem palavra magica e recusada",
    "error" in semPalavra && semPalavra.error.code === "MAGIC_WORD_REQUIRED", semPalavra);

  const palavraErrada = await createFlavor(
    { name: "Sorrateiro", category: "creme", price_cents: 900 }, "abracadabra",
  );
  check("palavra magica errada e recusada",
    "error" in palavraErrada && palavraErrada.error.code === "WRONG_MAGIC_WORD", palavraErrada);
  check("o erro nao vaza a palavra esperada",
    "error" in palavraErrada && !palavraErrada.error.message.includes(MAGIC), palavraErrada);
  check("o erro nao ecoa a palavra tentada",
    "error" in palavraErrada && !palavraErrada.error.message.includes("abracadabra"), palavraErrada);

  const naoCriou = ok(await searchFlavors({ query: "sorrateiro", only_available: false }));
  check("nada foi gravado nas tentativas recusadas", naoCriou.count === 0, naoCriou.count);

  const comEspacos = await createFlavor({ name: "Com Espacos", category: "creme", price_cents: 900 }, "  " + MAGIC + " ");
  check("espacos em volta da palavra nao atrapalham", !("error" in comEspacos), comEspacos);

  // Todas as seis tools de escrita passam pelo mesmo portao.
  const barradas = [
    ["create_flavor", await createFlavor({ name: "X", category: "creme", price_cents: 900 })],
    ["update_flavor", await updateFlavor("baunilha-madagascar", { price_cents: 100 })],
    ["delete_flavor", await deleteFlavor("baunilha-madagascar")],
    ["create_customer", await createCustomer({ name: "X" })],
    ["update_customer", await updateCustomer("marina-alcantara", { district: "X" })],
    ["delete_customer", await deleteCustomer("marina-alcantara")],
  ] as const;
  check("as seis escritas exigem a palavra",
    barradas.every(([, r]) => "error" in r && r.error.code === "MAGIC_WORD_REQUIRED"),
    barradas.map(([n, r]) => n + ":" + ("error" in r ? r.error.code : "PASSOU")));

  const leituras = [
    await searchFlavors({}),
    await getFlavor("baunilha-madagascar"),
    await listCustomers(),
    await getCustomer("marina-alcantara"),
    await quoteOrder({ format: "copo", flavor_ids: ["baunilha-madagascar"], weekday: 1 }),
  ];
  check("nenhuma leitura exige palavra magica", leituras.every((r) => !("error" in r)));

  // Sem palavra configurada no ambiente, a entidade fica somente-leitura.
  const guardada = process.env.ICECREAM_MAGIC_WORD;
  delete process.env.ICECREAM_MAGIC_WORD;
  const semConfig = await createFlavor({ name: "Y", category: "creme", price_cents: 900 }, MAGIC);
  check("sem ICECREAM_MAGIC_WORD toda escrita e recusada",
    "error" in semConfig && semConfig.error.code === "MAGIC_WORD_NOT_CONFIGURED", semConfig);
  const leituraSemConfig = await searchFlavors({});
  check("mas a leitura continua funcionando", !("error" in leituraSemConfig));
  process.env.ICECREAM_MAGIC_WORD = guardada;
}

/**
 * Driver `kv` contra um stub do contrato REST da Upstash (o mesmo que a Vercel injeta
 * pelo Marketplace). E o unico driver que persiste em producao e o unico que fala com
 * a rede, entao vale exercitar antes de ligar o banco de verdade: um erro aqui so
 * apareceria em producao, ja com dado real em jogo.
 *
 * Contrato coberto: GET /get/<chave> -> {"result": <string|null>},
 * POST /set/<chave> com o valor no corpo, Bearer token no Authorization.
 */
async function kvDriverSection() {
  console.log("\n== driver kv (stub do contrato Upstash) ==");

  const http = require("node:http") as typeof import("node:http");
  const store = new Map<string, string>();
  const seen: string[] = [];
  let failNext = false;

  const server = http.createServer((req, res) => {
    seen.push(req.method + " " + req.url + " auth=" + (req.headers.authorization ?? "nenhum"));
    if (failNext) {
      failNext = false;
      res.statusCode = 500;
      return void res.end("erro simulado do Redis");
    }

    const [, verb, ...rest] = (req.url ?? "").split("/");
    const key = rest.join("/");

    if (req.method === "GET" && verb === "get") {
      res.setHeader("Content-Type", "application/json");
      return void res.end(JSON.stringify({ result: store.get(key) ?? null }));
    }
    if (req.method === "POST" && verb === "set") {
      let body = "";
      req.on("data", (c) => (body += c));
      return void req.on("end", () => {
        store.set(key, body);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ result: "OK" }));
      });
    }
    res.statusCode = 404;
    res.end("rota nao suportada pelo stub");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  const anterior = { ...process.env };
  process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:" + port;
  process.env.UPSTASH_REDIS_REST_TOKEN = "token-de-teste";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.ICECREAM_STORE = "kv";
  resetDriverCache();

  try {
    check("driver kv e escolhido pelas variaveis UPSTASH_*", storeInfo().driver === "kv", storeInfo());
    check("driver kv se declara persistente", storeInfo().persistent === true);

    // Primeira leitura publica o seed no Redis; a colecao ja nasce util.
    const inicial = ok(await searchFlavors({ only_available: false }));
    check("primeira leitura semeia o store remoto", inicial.count === flavorsSeed.length, inicial.count);
    check("o seed foi gravado com SET", store.has("icecream:flavors"), [...store.keys()]);
    check("o token vai no header Authorization",
      seen.every((s) => s.includes("auth=Bearer token-de-teste")), seen.slice(0, 2));

    const criado = ok(await createFlavor({
      name: "Sabor no Redis", category: "gelato", price_cents: 1500,
    }, MAGIC));
    check("escrita chega ao store remoto",
      JSON.parse(store.get("icecream:flavors")!).some((f: any) => f.id === criado.flavor.id),
      criado.flavor.id);

    const relido = ok(await searchFlavors({ query: "no redis" }));
    check("leitura seguinte enxerga a escrita",
      relido.flavors.some((f) => f.id === "sabor-no-redis"), relido.flavors.map((f) => f.id));

    const removido = ok(await deleteFlavor("sabor-no-redis", MAGIC));
    check("remocao tambem propaga",
      removido.deleted === true &&
      !JSON.parse(store.get("icecream:flavors")!).some((f: any) => f.id === "sabor-no-redis"));

    // Redis fora do ar nao pode virar excecao: a entidade nao lanca, ela devolve erro.
    failNext = true;
    const comFalha = await searchFlavors({});
    check("falha do Redis vira STORAGE_ERROR, nao excecao",
      "error" in comFalha && comFalha.error.code === "STORAGE_ERROR", comFalha);
  } finally {
    // O fetch do Node mantem a conexao em pool: sem derrubar os sockets, server.close()
    // fica pendente e o processo morre com assertion do libuv no Windows.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = anterior;
    resetDriverCache();
  }

  check("volta ao driver de memoria depois do teste", storeInfo().driver === "memory", storeInfo());
}

async function main() {
  await catalogSection();
  await flavorsSection();
  await customersSection();
  await guardSection();
  await kvDriverSection();
}

main()
  .catch((err) => {
    failed++;
    console.log("\n  FALHA o smoke lancou excecao: " + (err?.stack ?? err?.message ?? err));
  })
  .then(() => {
    console.log("\n" + passed + " passaram, " + failed + " falharam\n");
    // exitCode em vez de exit(): deixa o loop drenar em vez de matar handles em fecho.
    process.exitCode = failed === 0 ? 0 : 1;
  });
