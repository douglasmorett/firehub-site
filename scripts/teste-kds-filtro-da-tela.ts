/**
 * O filtro de categoria que o cozinheiro marca NA TELA do KDS tem que filtrar.
 *
 *   npx tsx scripts/teste-kds-filtro-da-tela.ts
 *
 * Hakim Centro, 24/09/2026: as 4 telas salvas sem filtro (o modelo padrão), e
 * a cozinha marcando "Esfirras Salgadas" e "Esfirras Doces" na lista da tela.
 * Continuava aparecendo tudo: o dono de cada categoria saía só dos filtros
 * SALVOS, então as próprias esfirras ficavam "sem dono" — e pedido todo sem
 * dono aparece em toda tela.
 */
import { categoriasComDono, pedidoNaTela, type TelaDoKds } from "../src/lib/kds-telas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

type Item = { nome: string; menuProduct: { category: string } };
const item = (nome: string, category: string): Item => ({ nome, menuProduct: { category } });
const pedido = (...items: Item[]) => ({ items });
/** O que a tela desenha: os nomes que sobraram, ou "—" se o pedido não aparece. */
const naTela = (p: { items: Item[] } | null) => (p ? p.items.map((i) => i.nome) : "—");

// ── Hakim Centro: o modelo padrão, nenhuma tela com filtro salvo ──
const hakim: TelaDoKds[] = [
  { id: "p1", name: "Produção 1", stage: "production", categoryFilter: [] },
  { id: "f1", name: "Finalização 1", stage: "finishing", categoryFilter: [] },
  { id: "p2", name: "Produção 2", stage: "production", categoryFilter: [] },
  { id: "f2", name: "Finalização 2", stage: "finishing", categoryFilter: [] },
];
const esfirras = ["Esfirras Salgadas", "Esfirras Doces"];
const minha = hakim[0];
const donos = new Set([...categoriasComDono(hakim, "production", minha), ...esfirras.map((c) => c.toLowerCase())]);
const telaEsfirra = (p: { items: Item[] }) => naTela(pedidoNaTela(p, { filtroDestaTela: esfirras, donos, estagio: "production", config: null }));

console.log("\n— Hakim Centro, Produção 1 filtrada por esfirras NA TELA —");
confere("pedido de esfirra aparece", telaEsfirra(pedido(item("Carne", "Esfirras Salgadas"), item("Chocolate", "Esfirras Doces"))), ["Carne", "Chocolate"]);
confere("esfirra + bebida: aparece, com a bebida acompanhando (ninguém a produz em outra tela)", telaEsfirra(pedido(item("Carne", "Esfirras Salgadas"), item("Coca", "Bebidas"))), ["Carne", "Coca"]);
confere("pedido só de bebida continua aparecendo (senão não apareceria em tela nenhuma)", telaEsfirra(pedido(item("Coca", "Bebidas"))), ["Coca"]);

// Antes: os donos saíam só do que estava salvo — nada — e o filtro não contava.
const donosAntes = new Set<string>();
for (const t of hakim) if (t.stage === "production") for (const c of t.categoryFilter || []) donosAntes.add(c.toLowerCase());
const antes = pedidoNaTela(pedido(item("Carne", "Esfirras Salgadas"), item("Coca", "Bebidas")), { filtroDestaTela: esfirras, donos: donosAntes, estagio: "production", config: null });
confere("(antes: as esfirras eram 'sem dono' e o pedido saía inteiro pela regra do sem dono)", naTela(antes), ["Carne", "Coca"]);

console.log("\n— Com outra tela reivindicando bebidas, ela sai da tela da esfirra —");
const comBar: TelaDoKds[] = [...hakim.slice(0, 2), { id: "p2", name: "Bar", stage: "production", categoryFilter: ["Bebidas"] }, hakim[3]];
const donosComBar = new Set([...categoriasComDono(comBar, "production", comBar[0]), ...esfirras.map((c) => c.toLowerCase())]);
const naEsfirra = (p: { items: Item[] }) => naTela(pedidoNaTela(p, { filtroDestaTela: esfirras, donos: donosComBar, estagio: "production", config: null }));
confere("esfirra + coca: só a esfirra", naEsfirra(pedido(item("Carne", "Esfirras Salgadas"), item("Coca", "Bebidas"))), ["Carne"]);
confere("só coca: não aparece na da esfirra (o Bar é dono)", naEsfirra(pedido(item("Coca", "Bebidas"))), "—");

console.log("\n— O filtro salvo desta tela não manda quando o cozinheiro troca aqui —");
const salva: TelaDoKds[] = [{ id: "p1", name: "Produção 1", stage: "production", categoryFilter: ["Esfirras Salgadas"] }, { id: "p2", name: "Produção 2", stage: "production", categoryFilter: [] }];
const donosTrocados = new Set([...categoriasComDono(salva, "production", salva[0]), "esfirras doces"]);
confere("salva com Salgadas, usando Doces: a salgada volta a ser 'sem dono' e não some de todas", donosTrocados.has("esfirras salgadas"), false);

console.log("\n— NIK: todas as telas com filtro salvo — nada muda —");
const nik: TelaDoKds[] = [
  { id: "pe", name: "Produção Esfiha", stage: "production", categoryFilter: ["Combos Esfihas", "Esfihas Tradicionais"] },
  { id: "pp", name: "Produção Pizza", stage: "production", categoryFilter: ["Pizzas Tradicionais", "Sabores de Pizza"] },
];
const donosNik = new Set([...categoriasComDono(nik, "production", nik[0]), ...["combos esfihas", "esfihas tradicionais"]]);
const telaEsfiha = (p: { items: Item[] }) => naTela(pedidoNaTela(p, { filtroDestaTela: nik[0].categoryFilter!, donos: donosNik, estagio: "production", config: null }));
confere("pedido só de pizza não aparece na tela da esfiha", telaEsfiha(pedido(item("Calabresa", "Pizzas Tradicionais"))), "—");
confere("esfiha + pizza: só a esfiha", telaEsfiha(pedido(item("Carne", "Esfihas Tradicionais"), item("Calabresa", "Pizzas Tradicionais"))), ["Carne"]);
confere("só refrigerante (ninguém pediu): aparece", telaEsfiha(pedido(item("Guaraná", "Bebidas"))), ["Guaraná"]);
confere("os donos são os mesmos de antes (união dos filtros salvos)", [...donosNik].sort(), ["combos esfihas", "esfihas tradicionais", "pizzas tradicionais", "sabores de pizza"]);

console.log("\n— Finalização: o pedido inteiro —");
confere("na finalização filtrada por esfirras, esfirra + coca sai inteiro", naTela(pedidoNaTela(pedido(item("Carne", "Esfirras Salgadas"), item("Coca", "Bebidas")), { filtroDestaTela: esfirras, donos: donosComBar, estagio: "finishing", config: null })), ["Carne", "Coca"]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
