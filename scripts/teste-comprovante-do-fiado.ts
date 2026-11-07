/**
 * O comprovante do fiado para assinar (lib/comprovante-do-fiado.ts).
 *
 *   npx tsx scripts/teste-comprovante-do-fiado.ts
 *
 * Pedido do Douglas (07/11/2026): imprimir o fiado para o funcionário assinar
 * com o nome, e a opção de assinar na tela. O teste prova que o papel leva o
 * que a cobrança precisa (quem, o quê, quanto, o saldo, onde assinar), que ele
 * vai pela fila do CAIXA, e que a assinatura da tela não aceita lixo.
 */
import { cupomDoFiado, htmlDoComprovanteDoFiado, itensDoPedido, problemaDaAssinatura, KIND_DO_COMPROVANTE_DO_FIADO, LINHA_DO_NOME, TRACO_DA_ASSINATURA, TETO_DA_IMAGEM } from "../src/lib/comprovante-do-fiado";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`);
  }
}

const FUSO = "America/Sao_Paulo";
const agora = new Date("2026-11-07T17:40:00Z"); // 14:40 em Brasília
const lancadoEm = new Date("2026-11-07T17:32:00Z"); // 14:32

const itens = itensDoPedido([
  { quantity: 2, price: 15, productName: "X Burger" },
  { quantity: 1, price: 6.5, productName: null, menuProduct: { name: "Coca lata" } },
  { quantity: 1, price: 4, productName: null, menuProduct: null },
]);
console.log("Itens do pedido");
conferir("valor da linha é preço × quantidade, nome do produto na hora do pedido", itens, [
  { nome: "X Burger", qtd: 2, valor: 30 },
  { nome: "Coca lata", qtd: 1, valor: 6.5 },
  { nome: "Item", qtd: 1, valor: 4 },
]);

const base = {
  loja: "Hakim Centro",
  fuso: FUSO,
  operador: "Caixa Ana",
  cliente: { nome: "João Silva", cargo: "Cozinheiro" },
  lancamento: { tipo: "PEDIDO" as const, id: "ped123", numero: "#12", quando: lancadoEm, itens, valorNoFiado: 40.5, obs: null },
  saldo: 112.4,
  agora,
};
const c = cupomDoFiado(base);
const R = c.relatorio || [];
const textos = R.map((l) => ("texto" in l ? l.texto : "") + ("valor" in l && l.valor ? ` | ${l.valor}` : ""));

console.log("\nO papel do pedido no fiado");
conferir("vai pela fila do caixa (kind CAIXA_*: impressora do caixa no print-queue)", [c.kind, c.kind.startsWith("CAIXA_")], [KIND_DO_COMPROVANTE_DO_FIADO, true]);
conferir("título grande no topo", c.dailyOrderNumber, "COMPROVANTE DE FIADO");
conferir("nome e cargo de quem leva", textos.includes("João Silva (Cozinheiro)"), true);
conferir("número do pedido e hora do lançamento (fuso da loja)", [textos.includes("Pedido | #12"), textos.includes("Lancado em | 07/11, 14:32")], [true, true]);
conferir("cada item com o valor", ["2x X Burger | R$ 30,00", "1x Coca lata | R$ 6,50"].every((t) => textos.includes(t)), true);
conferir("o total no fiado em destaque", R.some((l) => l.tipo === "destaque" && l.texto === "NO FIADO" && l.valor === "R$ 40,50"), true);
conferir("saldo devedor acumulado, com a data", textos.includes("Saldo devedor em 07/11, 14:40 | R$ 112,40"), true);
conferir("nome legível e traço da assinatura", [textos.includes(LINHA_DO_NOME), textos.includes(TRACO_DA_ASSINATURA), textos[textos.length - 2]], [true, true, "Assinatura"]);
// Espaço DE VERDADE para assinar: linhas vazias antes do nome e antes do traço.
const iNome = R.findIndex((l) => l.tipo === "texto" && l.texto === LINHA_DO_NOME);
const iTraco = R.findIndex((l) => l.tipo === "texto" && l.texto === TRACO_DA_ASSINATURA);
const vazia = (i: number) => R[i]?.tipo === "linha" && !(R[i] as any).texto && !(R[i] as any).valor;
conferir("2 linhas vazias antes do nome, 3 antes do traço", [vazia(iNome - 1), vazia(iNome - 2), vazia(iTraco - 1), vazia(iTraco - 2), vazia(iTraco - 3)], [true, true, true, true, true]);
conferir("cabe na bobina de 58 mm (32 colunas)", [LINHA_DO_NOME.length <= 32, TRACO_DA_ASSINATURA.length <= 32], [true, true]);
conferir("sem assinatura na tela, o papel não diz que foi assinado", textos.some((t) => t.startsWith("Assinado na tela")), false);
conferir("termina com NÃO É DOCUMENTO FISCAL (envelope do caixa)", textos[textos.length - 1], "NÃO É DOCUMENTO FISCAL");
conferir("Assistente antigo: os itens com preço unitário e o total", [c.items.map((i) => [i.name, i.qty, i.price]), c.totalAmount], [[["X Burger", 2, 15], ["Coca lata", 1, 6.5], ["Item", 1, 4]], 40.5]);
conferir("cada impressão é um pedido de impressão novo", c.id, `caixa_fiado_ped123_${agora.getTime()}`);

console.log("\nAssinado na tela, 2ª via");
const c2 = cupomDoFiado({ ...base, segundaVia: true, assinatura: { nome: "João S.", em: new Date("2026-11-07T17:33:00Z") } });
const t2 = (c2.relatorio || []).map((l) => ("texto" in l ? l.texto : ""));
conferir("2ª via diz que é 2ª via", c2.dailyOrderNumber, "2a VIA - COMPROVANTE DE FIADO");
conferir("o papel diz quem assinou na tela e quando", t2.includes("Assinado na tela por João S. em 07/11, 14:33"), true);
conferir("e continua com o traço para a caneta", t2.includes(TRACO_DA_ASSINATURA), true);

console.log("\nDívida lançada à mão (sem itens)");
const c3 = cupomDoFiado({ ...base, lancamento: { ...base.lancamento, itens: [], valorNoFiado: 25, obs: "Vale de sexta" } });
const t3 = (c3.relatorio || []).map((l) => ("texto" in l ? l.texto : ""));
conferir("sem bloco de itens, com o motivo", [t3.includes("Itens"), t3.includes("Obs: Vale de sexta")], [false, true]);
conferir("Assistente antigo: uma linha 'Divida no fiado'", c3.items.map((i) => [i.name, i.price]), [["Divida no fiado", 25]]);

console.log("\nConta de mesa no fiado");
const c4 = cupomDoFiado({ ...base, lancamento: { tipo: "MESA", id: "fdm1", numero: "Mesa 4", quando: lancadoEm, itens, valorNoFiado: 20 } });
const t4 = (c4.relatorio || []).map((l) => ("texto" in l ? l.texto : "") + ("valor" in l && l.valor ? ` | ${l.valor}` : ""));
conferir("diz 'Conta Mesa 4' e chama os itens de consumo", [t4.includes("Conta | Mesa 4"), t4.includes("Consumo da mesa")], [true, true]);
conferir("o que ele assina é o valor no fiado, não a soma do consumo", t4.includes("NO FIADO | R$ 20,00"), true);

console.log("\nA assinatura da tela");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
conferir("nome + PNG: passa", problemaDaAssinatura({ nome: "João", imagem: png }), null);
conferir("sem nome: pede o nome", problemaDaAssinatura({ nome: " J ", imagem: png }), "Digite o nome de quem está assinando.");
conferir("sem desenho: pede a assinatura", problemaDaAssinatura({ nome: "João", imagem: "" }), "Faça a assinatura na caixa antes de salvar.");
conferir("SVG/HTML no lugar do PNG: recusa (vai parar num <img> do extrato)", problemaDaAssinatura({ nome: "João", imagem: "data:image/svg+xml;base64,PHN2Zz4=" }), "Faça a assinatura na caixa antes de salvar.");
conferir("aspas para fugir do atributo: recusa", problemaDaAssinatura({ nome: "João", imagem: `${png}" onerror="alert(1)` }), "Faça a assinatura na caixa antes de salvar.");
conferir("grande demais: recusa", problemaDaAssinatura({ nome: "João", imagem: `data:image/png;base64,${"A".repeat(TETO_DA_IMAGEM)}` }), "A assinatura ficou grande demais. Limpe e assine de novo.");

console.log("\nO papel pelo navegador");
const nomeMalvado = cupomDoFiado({ ...base, cliente: { nome: "<script>x</script>", cargo: null } });
const html = htmlDoComprovanteDoFiado(nomeMalvado, { loja: "Hakim & Cia", imagemDaAssinatura: png });
conferir("nome do cliente escapado (sem <script> cru)", [html.includes("<script>x</script>"), html.includes("&lt;script&gt;x&lt;/script&gt;")], [false, true]);
conferir("nome da loja no topo, escapado", html.includes("<b>Hakim &amp; Cia</b>"), true);
conferir("o desenho entra logo acima do traço", html.includes(`<img class="ass" src="${png}" alt="Assinatura"><p>${TRACO_DA_ASSINATURA}</p>`), true);
conferir("bobina de 80 mm e janela de impressão sozinha", [html.includes("size: 80mm auto"), html.includes("window.print()")], [true, true]);
const semImg = htmlDoComprovanteDoFiado(c, { loja: "L", imagemDaAssinatura: "javascript:alert(1)" });
conferir("imagem que não é PNG não entra no HTML", semImg.includes('class="ass"'), false);
conferir("mesmas linhas da fila: total e saldo no HTML", [semImg.includes("R$ 40,50"), semImg.includes("R$ 112,40")], [true, true]);

console.log(`\n${ok} ok, ${falhou} falharam`);
if (falhou > 0) process.exit(1);
