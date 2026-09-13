/**
 * Prova do VOLTAR em camadas e do rascunho do pedido da mesa.
 *
 *   node scripts/teste-voltar-e-rascunho-da-mesa.mjs
 *
 * As sequências de toques são as do garçom no celular: mapa → mesa → cardápio
 * → carrinho, gesto de voltar do Android, "Lançar para Ana" (fecha uma folha e
 * abre o cardápio no mesmo toque) e enviar o pedido (fecha duas telas juntas).
 */
import { readFileSync } from "fs";
import ts from "typescript";

async function carregar(arquivo) {
  const js = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript," + encodeURIComponent(js));
}
const camadas = await carregar("src/lib/voltar-em-camadas.ts");
const rascunho = await carregar("src/lib/rascunho-da-mesa.ts");

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

// ── Um navegador de mentira: pilha de entradas e um índice ──────────────────
function simulador() {
  const entradas = [null]; // a página
  let i = 0;
  let estado = camadas.SEM_CAMADAS;
  let proximo = 1;
  const abertas = new Set();
  const log = [];
  const topoId = () => entradas[i];
  const api = {
    abrir(nome) {
      const id = proximo++;
      estado = camadas.abrirCamada(estado, { id, nome });
      entradas.splice(i + 1);
      entradas.push(id);
      i++;
      abertas.add(nome);
      return id;
    },
    /** A tela fecha a camada sozinha (botão da tela, envio do pedido). */
    fecharPelaTela(id, nome) {
      const r = camadas.aoFecharPelaTela(estado, id, topoId());
      estado = r.estado;
      abertas.delete(nome);
      if (r.voltarNoNavegador) api.voltar();
    },
    /** Gesto de voltar do celular. */
    voltar() {
      if (i === 0) { log.push("SAIU DA PÁGINA"); return; }
      i--;
      const r = camadas.aoVoltarNoNavegador(estado, topoId());
      estado = r.estado;
      for (const c of r.fechar) { abertas.delete(c.nome); log.push("fechou " + c.nome); }
      if (r.pularOutraVez) api.voltar();
    },
    abertas: () => [...abertas].sort().join(","),
    get estado() { return estado; },
    get indice() { return i; },
    log,
  };
  return api;
}

console.log("\n1) Gesto de voltar fecha a tela de cima, uma por vez");
{
  const n = simulador();
  n.abrir("mesa"); n.abrir("cardapio"); n.abrir("carrinho");
  n.voltar();
  conferir("1º voltar fecha só o carrinho", n.abertas() === "cardapio,mesa", n.abertas());
  n.voltar();
  conferir("2º voltar fecha o cardápio e deixa a mesa", n.abertas() === "mesa", n.abertas());
  n.voltar();
  conferir("3º voltar fecha a mesa e fica no mapa", n.abertas() === "" && !n.log.includes("SAIU DA PÁGINA"), n.log);
  n.voltar();
  conferir("só o 4º voltar sai da página", n.log.at(-1) === "SAIU DA PÁGINA", n.log);
}

console.log("\n2) Botão da tela fecha a camada do topo e consome a entrada");
{
  const n = simulador();
  n.abrir("mesa");
  const c = n.abrir("cardapio");
  n.fecharPelaTela(c, "cardapio");
  conferir("depois do '← Mesa' o navegador está na entrada da mesa", n.indice === 1 && n.abertas() === "mesa", { i: n.indice, abertas: n.abertas() });
  n.voltar();
  conferir("o próximo voltar fecha a mesa (nenhum toque morto)", n.abertas() === "", n.log);
}

console.log("\n3) Enviar pedido fecha carrinho e cardápio juntos");
{
  const n = simulador();
  n.abrir("mesa");
  const c = n.abrir("cardapio");
  const k = n.abrir("carrinho");
  // A tela fecha as duas no mesmo toque: o cardápio primeiro (não é o topo)...
  n.fecharPelaTela(c, "cardapio");
  conferir("fechar o cardápio sem ser o topo deixa a entrada solta", n.estado.soltas.includes(c), n.estado);
  // ...e o carrinho, que é o topo, consome a dele e pula a solta.
  n.fecharPelaTela(k, "carrinho");
  conferir("a entrada solta foi pulada: navegador parou na mesa", n.indice === 1 && n.abertas() === "mesa", { i: n.indice, abertas: n.abertas() });
  conferir("nada solto sobrou", n.estado.soltas.length === 0, n.estado);
  n.voltar();
  conferir("voltar agora fecha a mesa direto", n.abertas() === "" && n.indice === 0, { i: n.indice, abertas: n.abertas() });
}

console.log("\n4) Ordem inversa: fecha o topo primeiro e depois a de baixo");
{
  const n = simulador();
  n.abrir("mesa");
  const c = n.abrir("cardapio");
  const k = n.abrir("carrinho");
  n.fecharPelaTela(k, "carrinho");
  n.fecharPelaTela(c, "cardapio");
  conferir("as duas entradas consumidas, parou na mesa", n.indice === 1 && n.abertas() === "mesa", { i: n.indice, abertas: n.abertas() });
}

console.log("\n5) Voltar do navegador de uma camada já fechada não fecha outra por engano");
{
  const n = simulador();
  const m = n.abrir("mesa");
  n.abrir("cardapio");
  const r = camadas.aoVoltarNoNavegador(n.estado, m);
  conferir("volta para a entrada da mesa fecha só o cardápio", r.fechar.map((x) => x.nome).join() === "cardapio" && r.estado.pilha.length === 1, r);
  const r2 = camadas.aoFecharPelaTela(camadas.SEM_CAMADAS, 99, 99);
  conferir("fechar camada que não está aberta não mexe no histórico", r2.voltarNoNavegador === false, r2);
}

console.log("\n6) Rascunho: guarda e devolve o pedido montado");
const produtos = [
  { id: "coca", name: "Coca-Cola Lata", price: 7 },
  { id: "pizza", name: "Pizza Calabresa", price: 69.9 },
  { id: "combo", name: "Combo Pastel", price: 30, isCombo: true },
];
const agora = Date.UTC(2026, 8, 13, 22, 0, 0);
const carrinho = [
  { uid: "a", item: produtos[0], qty: 2, unitPrice: 7, guestId: null },
  { uid: "b", item: produtos[1], qty: 1, unitPrice: 69.9, guestId: "ana", notes: "sem cebola" },
  { uid: "c", item: produtos[2], qty: 1, unitPrice: 36.5, guestId: "leo", comboSelections: [{ name: "Carne", quantity: 2 }] },
];
const texto = rascunho.guardarRascunho(carrinho, agora);
const volta = rascunho.restaurarRascunho(texto, { produtos, pessoas: ["ana", "leo"], agora: agora + 5 * 60_000 });
conferir("3 linhas voltam", volta.linhas.length === 3, volta);
conferir("quantidade, dono e observação preservados", volta.linhas[1].qty === 1 && volta.linhas[1].guestId === "ana" && volta.linhas[1].notes === "sem cebola", volta.linhas[1]);
conferir("combo mantém escolhas e o preço somado", volta.linhas[2].unitPrice === 36.5 && volta.linhas[2].comboSelections?.[0]?.quantity === 2, volta.linhas[2]);
conferir("o item volta como o produto de agora (mesmo objeto do cardápio)", volta.linhas[0].item === produtos[0]);
conferir("não guarda o objeto inteiro do produto (só o id)", !texto.includes("price"), texto);

console.log("\n7) Rascunho contra o cardápio e a mesa de agora");
{
  const novoPreco = [{ ...produtos[0], price: 7.5 }, produtos[1]];
  const r = rascunho.restaurarRascunho(texto, { produtos: novoPreco, pessoas: ["ana"], agora: agora + 60_000 });
  conferir("item simples pega o preço novo", r.linhas[0].unitPrice === 7.5, r.linhas[0]);
  conferir("combo que saiu do cardápio fica de fora e é avisado", r.linhas.length === 2 && r.foraDoCardapio.join() === "Combo Pastel", r);
  const r2 = rascunho.restaurarRascunho(texto, { produtos, pessoas: ["leo"], agora: agora + 60_000 });
  conferir("pessoa que saiu da mesa: item volta para a mesa e é contado", r2.linhas[1].guestId === null && r2.semDono === 1, r2);
}

console.log("\n8) Rascunho estragado, vencido ou de outro formato vira vazio");
{
  const ctx = { produtos, pessoas: [], agora };
  conferir("nulo", rascunho.restaurarRascunho(null, ctx).linhas.length === 0);
  conferir("JSON quebrado", rascunho.restaurarRascunho("{oi", ctx).linhas.length === 0);
  conferir("versão desconhecida", rascunho.restaurarRascunho(JSON.stringify({ v: 2, em: agora, linhas: [] }), ctx).linhas.length === 0);
  conferir("mais de 12 horas", rascunho.restaurarRascunho(texto, { ...ctx, agora: agora + 12 * 3600_000 + 1 }).linhas.length === 0);
  conferir("12 horas em ponto ainda vale", rascunho.restaurarRascunho(texto, { ...ctx, pessoas: ["ana", "leo"], agora: agora + 12 * 3600_000 }).linhas.length === 3);
  conferir("relógio do aparelho no futuro", rascunho.restaurarRascunho(texto, { ...ctx, agora: agora - 10 * 60_000 }).linhas.length === 0);
  const ruim = JSON.stringify({ v: 1, em: agora, linhas: [{ uid: "x", itemId: "coca", nome: "Coca", qty: 0 }, { uid: "y", itemId: "coca", nome: "Coca", qty: "abc" }, { uid: "z", itemId: "coca", nome: "Coca", qty: 500 }, null] });
  const r = rascunho.restaurarRascunho(ruim, ctx);
  conferir("quantidade zero, texto e nula são ignoradas; 500 vira 99", r.linhas.length === 1 && r.linhas[0].qty === 99, r);
  const repetido = JSON.stringify({ v: 1, em: agora, linhas: [{ uid: "a", itemId: "coca", nome: "Coca", qty: 1 }, { uid: "a", itemId: "pizza", nome: "Pizza", qty: 1 }] });
  const r3 = rascunho.restaurarRascunho(repetido, ctx);
  conferir("uid repetido ganha identidade própria (mexer em um não mexe no outro)", r3.linhas.length === 2 && r3.linhas[0].uid !== r3.linhas[1].uid, r3.linhas.map((l) => l.uid));
}
conferir("a chave é por mesa aberta", rascunho.chaveDoRascunho("s1") !== rascunho.chaveDoRascunho("s2"));

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
