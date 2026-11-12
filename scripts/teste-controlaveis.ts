/**
 * Trava o Relatório dos controláveis (lib/cmv/controlaveis.ts e o exportar):
 * cada seção, o sinal da diferença (negativo = sumiu), a conversão kg ↔ g, o
 * preparo descendo para o insumo, o insumo de uso livre (condimento e
 * indireto), a refeição da equipe contada uma vez só, a segurança alimentar
 * pelo motivo e pelo lote vencido, a % sobre a venda, o período anterior, o
 * "onde está o dinheiro" e os arquivos (CSV, Excel, A4).
 *
 *   npx tsx scripts/teste-controlaveis.ts
 */
import {
  comparar, converter, ehSegurancaAlimentar, ondeEstaODinheiro, palpiteDaClasse, parteDoMovimento, pctDaVenda, resumir,
  secaoDaEquipe, secoesDaContagem, secoesDosDescartes,
  type DescarteLancado, type IdDaSecao, type InsumoDoRelatorio, type ItemContado, type Movimento, type RelatorioDosControlaveis, type Secao,
} from "../src/lib/cmv/controlaveis";
import { gerarCsv, gerarExcel, gerarHtmlDeImpressao, nomeDoArquivo } from "../src/lib/cmv/controlaveis-exportar";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const perto = (oQue: string, obtido: number | null | undefined, esperado: number, tol = 0.001) => {
  const ok = obtido != null && Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${obtido}, esperava ${esperado}`}`);
};

// ── Unidades, classe, segurança ─────────────────────────────────────────────
console.log("\n── Unidades e classes");
confere("1 kg = 1000 g", converter(1, "kg", "g"), 1000);
confere("500 g = 0,5 kg", converter(500, "g", "kg"), 0.5);
confere("1 l = 1000 ml", converter(1, "L", "ml"), 1000);
confere("un não vira kg", converter(1, "un", "kg"), null);
confere("guardanapo fora da ficha = Indireto", palpiteDaClasse("Guardanapo", false), "INDIRETO");
confere("caixa de pizza na ficha = Embalagem", palpiteDaClasse("Caixa pizza 35cm", true), "EMBALAGEM");
confere("sachê de ketchup fora da ficha = Condimento", palpiteDaClasse("Sachê de ketchup", false), "CONDIMENTO");
confere("ketchup na ficha = Alimento", palpiteDaClasse("Ketchup", true), "ALIMENTO");
confere("salsicha não é sal", palpiteDaClasse("Salsicha", false), "ALIMENTO");
confere("açúcar fora da ficha = Condimento", palpiteDaClasse("Açúcar refinado", false), "CONDIMENTO");
confere("motivo 'Produto VENCIDO' = segurança", ehSegurancaAlimentar("Produto VENCIDO"), true);
confere("motivo 'temperatura da câmara' = segurança", ehSegurancaAlimentar("temperatura da câmara"), true);
confere("motivo 'caiu no chão' não é segurança", ehSegurancaAlimentar("caiu no chão"), false);
confere("lote vencido = segurança mesmo sem motivo", ehSegurancaAlimentar(null, true), true);
confere("% da venda com 2 casas", pctDaVenda(45, 10000), 0.45);
confere("% sem venda = nulo", pctDaVenda(45, 0), null);

// ── 1, 2, 3: descartes ──────────────────────────────────────────────────────
console.log("\n── Desperdício completo, incompleto e segurança alimentar");
const VENDA = 10000;
const d = (x: Partial<DescarteLancado>): DescarteLancado => ({
  quando: "2026-11-05T15:00:00.000Z", item: "?", tipo: "PRODUTO", quantidade: 1, unidade: "un", motivo: "Caiu no chão",
  quem: "Ana", origem: "Estoque", valor: null, estimado: false, ...x,
});
const lancados: DescarteLancado[] = [
  d({ item: "X-Burger", quantidade: 2, valor: 20 }),
  d({ item: "X-Burger", quantidade: 1, valor: 10, motivo: "Queimou", origem: "FireCheck" }),
  d({ item: "Batata frita", quantidade: 1, valor: null }),
  d({ item: "Queijo", tipo: "INSUMO", quantidade: 0.5, unidade: "kg", valor: 25, motivo: "Mofou na borda" }),
  d({ item: "Queijo", tipo: "INSUMO", quantidade: 200, unidade: "g", valor: 10, motivo: "Caiu" }),
  d({ item: "Carne", tipo: "INSUMO", quantidade: 1, unidade: "kg", valor: 40, motivo: "Produto vencido" }),
  d({ item: "Pão", tipo: "INSUMO", quantidade: 5, unidade: "un", valor: 5, motivo: "Etiqueta ABC123", origem: "Perda", loteVencido: true }),
  d({ item: "Salada", quantidade: 1, valor: 12, motivo: "Temperatura da geladeira" }),
];
const unidadeDoInsumo = new Map([["queijo", "g"], ["carne", "kg"], ["pao", "un"]]);
const descartes = secoesDosDescartes({
  lancados, cancelados: [{ numero: "#12", quando: "2026-11-06T20:00:00.000Z", etapaTexto: "Saiu para entrega", motivo: "Cliente desistiu", valor: 15 }],
  unidadeDoInsumo, venda: VENDA,
});
confere("completo: X-Burger agrupado (3 un, R$ 30, R$ 10/un)", descartes.completo.linhas.find((l) => l.nome === "X-Burger") && (({ quantidade, total, custoUnitario }) => ({ quantidade, total, custoUnitario }))(descartes.completo.linhas.find((l) => l.nome === "X-Burger")!), { quantidade: 3, total: 30, custoUnitario: 10 });
confere("completo: lançamentos da linha guardam quem/motivo/origem", descartes.completo.linhas.find((l) => l.nome === "X-Burger")!.lancamentos!.map((l) => l.origem), ["Estoque", "FireCheck"]);
confere("completo: total = produtos + cancelados (30 + 15)", descartes.completo.total, 45);
confere("completo: % da venda", descartes.completo.pct, 0.45);
confere("completo: Batata sem valor conta em semValor", descartes.completo.semValor, 1);
confere("completo: não leva a salada da temperatura", descartes.completo.linhas.some((l) => l.nome === "Salada"), false);
const queijo = descartes.incompleto.linhas.find((l) => l.nome === "Queijo")!;
confere("incompleto: 0,5 kg + 200 g de queijo = 700 g", queijo.quantidade, 700);
confere("incompleto: queijo R$ 35 (R$ 0,05/g)", [queijo.total, queijo.custoUnitario], [35, 0.05]);
confere("incompleto: carne vencida não entra aqui", descartes.incompleto.linhas.some((l) => l.nome === "Carne"), false);
confere("segurança: carne (motivo), pão (lote vencido) e salada (temperatura)", descartes.seguranca.linhas.map((l) => l.nome).sort(), ["Carne", "Pão", "Salada"]);
confere("segurança: total R$ 57", descartes.seguranca.total, 57);

// ── 5: equipe ───────────────────────────────────────────────────────────────
console.log("\n── Refeição da equipe");
const equipe = secaoDaEquipe([
  { nome: "X-Burger", quantidade: 2, custo: 18, quando: "2026-11-05T18:00:00Z", quem: "Motoboy João" },
  { nome: "X-Burger", quantidade: 1, custo: 9, quando: "2026-11-06T18:00:00Z", quem: "Motoboy Zé" },
  { nome: "Refrigerante lata", quantidade: 1, custo: null, quando: "2026-11-06T18:00:00Z", quem: "Motoboy Zé" },
], VENDA);
confere("equipe: X-Burger 3 un, R$ 27, R$ 9/un", (({ quantidade, total, custoUnitario }) => ({ quantidade, total, custoUnitario }))(equipe.linhas[0]), { quantidade: 3, total: 27, custoUnitario: 9 });
confere("equipe: sem custo conta à parte", equipe.semValor, 1);
confere("equipe: total R$ 27 e 0,27%", [equipe.total, equipe.pct], [27, 0.27]);

// ── 4, 6, 7, 8: contagem ────────────────────────────────────────────────────
console.log("\n── Diferença de inventário, rendimento, condimentos e indiretos");
const ins = (x: Partial<InsumoDoRelatorio> & { id: string; nome: string; unidade: string }): InsumoDoRelatorio => ({
  tipo: null, rendimento: null, unitCost: null, componentes: [], custo: null, entraNoCmv: true, emFicha: true, classeGravada: null, ...x,
});
const insumos: InsumoDoRelatorio[] = [
  ins({ id: "pao", nome: "Pão", unidade: "un", custo: 1 }),
  ins({ id: "carne", nome: "Carne", unidade: "kg", custo: 40 }),
  ins({ id: "queijo", nome: "Queijo", unidade: "g", custo: 0.05 }),
  ins({ id: "caixa", nome: "Caixa de lanche", unidade: "un", custo: 2 }),
  ins({ id: "ketchup", nome: "Sachê de ketchup", unidade: "un", custo: 0.1, emFicha: false }),
  ins({ id: "guardanapo", nome: "Guardanapo", unidade: "un", custo: 0.02, emFicha: false }),
  ins({ id: "tomate", nome: "Tomate", unidade: "kg", custo: 10 }),
  ins({ id: "molho", nome: "Molho da casa", unidade: "g", tipo: "PREPARO", rendimento: 800, componentes: [{ insumoId: "tomate", quantidade: 1 }], custo: 0.0125 }),
  ins({ id: "alface", nome: "Alface", unidade: "kg", custo: 8 }),
  ins({ id: "limpeza", nome: "Detergente", unidade: "un", custo: 5, emFicha: false, entraNoCmv: false }),
];
const c = (quantidade: number, unidade: string, contado = true): ItemContado => ({ quantidade, unidade, contado });
const abertura = new Map<string, ItemContado>([
  ["pao", c(100, "un")], ["carne", c(10, "kg")], ["queijo", c(5, "kg")], ["caixa", c(50, "un")], ["ketchup", c(500, "un")],
  ["guardanapo", c(2000, "un")], ["tomate", c(3, "kg")], ["molho", c(1000, "g")], ["alface", c(2, "kg")], ["limpeza", c(10, "un")],
]);
const fechamento = new Map<string, ItemContado>([
  ["pao", c(40, "un")], ["carne", c(4, "kg")], ["queijo", c(2000, "g")], ["caixa", c(20, "un")], ["ketchup", c(300, "un")],
  ["guardanapo", c(500, "un")], ["tomate", c(1, "kg")], ["molho", c(3400, "g")], ["alface", c(1, "kg", false)], ["limpeza", c(2, "un")],
]);
const m = (stockItemId: string, tipo: string, quantidade: number, extra: Partial<Movimento> = {}): Movimento => ({ stockItemId, tipo, quantidade, ...extra });
const movimentos: Movimento[] = [
  m("pao", "INPUT", 50, { notes: "Compra NF 1" }),
  m("pao", "SALE", -95, { sourceRef: "sale:P1:pao" }),
  m("pao", "SALE", -5, { sourceRef: "sale:E1:pao" }), // refeição da equipe
  m("pao", "INPUT", 2, { notes: "Estorno - Pedido #P1 cancel id: P1" }), // devolução da venda
  m("pao", "WASTE", -3),
  m("pao", "AJUSTE", -9, { sourceRef: "contagem:c2:pao" }), // o acerto da própria contagem: fora
  m("carne", "INPUT", 5),
  m("carne", "SALE", -10.5, { notes: "Baixa automática - Pedido #abc (id: P2)" }),
  m("queijo", "SALE", -3100, { sourceRef: "sale:P1:queijo" }),
  m("caixa", "SALE", -28, { sourceRef: "sale:P1:caixa" }),
  m("ketchup", "INPUT", 1000),
  m("ketchup", "WASTE", -100),
  m("tomate", "INPUT", 2),
  m("molho", "SALE", -700, { sourceRef: "sale:P1:molho" }),
];
const pedidosDaEquipe = new Set(["E1"]);
confere("a SALE do pedido da equipe é 'equipe'", parteDoMovimento(movimentos[2], pedidosDaEquipe), "equipe");
confere("a SALE de venda é 'vendas'", parteDoMovimento(movimentos[1], pedidosDaEquipe), "vendas");
confere("o AJUSTE da contagem fica de fora", parteDoMovimento(movimentos[5], pedidosDaEquipe), null);
confere("a devolução 'cancel id:' é venda (negativa), não entrada", parteDoMovimento(movimentos[3], pedidosDaEquipe), "vendas");

const cont = secoesDaContagem({ insumos, abertura, fechamento, movimentos, pedidosDaEquipe, venda: VENDA, falta: null });
const linha = (s: Secao, id: string) => s.linhas.find((l) => l.insumoId === id)!;
const pao = linha(cont.inventario, "pao");
confere("pão: real 110 (100 + 50 − 40)", pao.conta!.real, 110);
confere("pão: equipe 5 separada da venda (93 = 95 − 2 devolvidos)", [pao.conta!.vendas, pao.conta!.equipe, pao.conta!.perdas], [93, 5, 3]);
confere("pão: explicado 101 — a equipe entra UMA vez", pao.conta!.explicado, 101);
confere("pão: diferença −9 un = R$ −9 (sumiu, negativo)", [pao.quantidade, pao.total], [-9, -9]);
confere("pão: grupo Alimentos", pao.grupo, "ALIMENTOS");
const caixa = linha(cont.inventario, "caixa");
confere("caixa: diferença −2 un, R$ −4, grupo Embalagens", [caixa.quantidade, caixa.total, caixa.grupo], [-2, -4, "EMBALAGENS"]);
const carne = linha(cont.rendimento, "carne");
confere("carne (kg) vai para o Rendimento: −0,5 kg, R$ −20", [carne.quantidade, carne.unidade, carne.total], [-0.5, "kg", -20]);
const queijoR = linha(cont.rendimento, "queijo");
confere("queijo em g: abertura contada em kg convertida (5 kg = 5000 g)", queijoR.conta!.abertura, 5);
confere("queijo sobrou +100 g → +0,1 kg, R$ 50/kg, R$ +5 (positivo = sobrou)", [queijoR.quantidade, queijoR.unidade, queijoR.custoUnitario, queijoR.total], [0.1, "kg", 50, 5]);
const tomate = linha(cont.rendimento, "tomate");
confere("preparo desce para o insumo: tomate −0,125 kg, R$ −1,25", [tomate.quantidade, tomate.total], [-0.125, -1.25]);
confere("o preparo não aparece como linha própria", cont.rendimento.linhas.some((l) => l.insumoId === "molho"), false);
confere("alface sem contagem no fechamento fica de fora e é avisada", [cont.rendimento.linhas.some((l) => l.insumoId === "alface"), cont.naoContados], [false, ["Alface"]]);
confere("inventário: alimentos −9, embalagens −4, total −13", [cont.inventario.grupos, cont.inventario.total], [{ alimentos: -9, embalagens: -4 }, -13]);
perto("rendimento: −20 + 5 − 1,25 = −16,25", cont.rendimento.total, -16.25);
const ketchup = linha(cont.condimentos, "ketchup");
confere("condimento: ketchup 1100 un (1200 − 100 já lançados como perda) = R$ 110", [ketchup.quantidade, ketchup.total, ketchup.classe], [1100, 110, "CONDIMENTO"]);
confere("indireto: guardanapo 1500 un = R$ 30", [linha(cont.indiretos, "guardanapo").quantidade, cont.indiretos.total], [1500, 30]);
confere("fora do CMV (detergente) não entra em nada", [cont.condimentos, cont.indiretos].some((s) => s.linhas.some((l) => l.insumoId === "limpeza")), false);
confere("classe gravada vence o palpite", secoesDaContagem({
  insumos: insumos.map((i) => (i.id === "guardanapo" ? { ...i, classeGravada: "CONDIMENTO" } : i)), abertura, fechamento, movimentos, pedidosDaEquipe, venda: VENDA, falta: null,
}).condimentos.linhas.some((l) => l.insumoId === "guardanapo"), true);
const semContagem = secoesDaContagem({ insumos, abertura: new Map(), fechamento: new Map(), movimentos: [], pedidosDaEquipe, venda: VENDA, falta: "Feche uma contagem completa" });
confere("sem contagem: as quatro seções explicam o que falta", [semContagem.inventario.falta, semContagem.condimentos.linhas.length], ["Feche uma contagem completa", 0]);

// ── Resumo, anterior, onde está o dinheiro ──────────────────────────────────
console.log("\n── Resumo e comparação");
const secoes: Record<IdDaSecao, Secao> = { ...descartes, break: equipe, condimentos: cont.condimentos, inventario: cont.inventario, rendimento: cont.rendimento, indiretos: cont.indiretos };
const resumo = resumir(secoes, VENDA);
perto("diferença de alimentos = inventário (−9) + rendimento (−16,25)", resumo.diferencaAlimentos, -25.25);
confere("diferença de embalagens", resumo.diferencaEmbalagens, -4);
perto("diferença total", resumo.diferencaTotal, -29.25);
perto("total dos controláveis = 45+35+57+110+27+30 + 29,25 que sumiu", resumo.totalControlaveis, 333.25);
confere("% do total sobre a venda", resumo.pct.totalControlaveis, 3.33);
confere("% da diferença de alimentos", resumo.pct.diferencaAlimentos, -0.25);

const antes = resumir({
  ...secoes,
  completo: { ...secoes.completo, total: 20, pct: 0.2 },
  inventario: { ...secoes.inventario, total: -5, pct: -0.05, grupos: { alimentos: -5, embalagens: 0 } },
  condimentos: { ...secoes.condimentos, total: 110, pct: 1.1 },
}, VENDA);
const cmp = comparar(resumo, antes);
confere("completo subiu de 0,20% para 0,45%: pior, +0,25 ponto", [cmp.completo.sentido, cmp.completo.pontos], ["pior", 0.25]);
confere("inventário caiu (sumiu mais): pior", cmp.inventario.sentido, "pior");
confere("condimentos igual", cmp.condimentos.sentido, "igual");
const cmpMelhor = comparar(antes, resumo);
confere("ao contrário: completo melhorou", cmpMelhor.completo.sentido, "melhor");

const top = ondeEstaODinheiro(secoes, 10);
confere("onde está o dinheiro: o ketchup lidera (R$ 110, Condimentos)", [top[0].nome, top[0].secao, top[0].valor], ["Sachê de ketchup", "condimentos", 110]);
confere("onde está o dinheiro: no máximo 10", top.length <= 10, true);
confere("onde está o dinheiro: o queijo que sobrou não entra (não custou)", top.some((t) => t.nome === "Queijo" && t.secao === "rendimento"), false);
confere("onde está o dinheiro: a carne que sumiu entra pelo valor positivo", top.find((t) => t.nome === "Carne" && t.secao === "rendimento")?.valor, 20);

// ── Arquivos ────────────────────────────────────────────────────────────────
console.log("\n── Exportar");
const rel: RelatorioDosControlaveis = {
  loja: "Lanchonete Teste / Centro", periodo: { de: "2026-11-02", ate: "2026-11-08" }, geradoEm: "2026-11-09T12:00:00.000Z",
  venda: VENDA, contagem: { de: "2026-11-02", ate: "2026-11-08", venda: VENDA, parcial: false }, secoes, resumo,
  anterior: { de: "2026-10-26", ate: "2026-11-01", resumo: antes, comparacao: cmp }, ondeEstaODinheiro: top, avisos: [{ tipo: "atencao", texto: "Teste <&>" }],
};
confere("nome do arquivo sem barra", nomeDoArquivo(rel), "Controlaveis - Lanchonete Teste Centro - 02-11-2026 a 08-11-2026");
const csv = gerarCsv(rel);
confere("CSV começa com o BOM", csv.charCodeAt(0), 0xfeff);
confere("CSV usa ; e vírgula decimal", csv.includes("Desperdício completo;45,00;0,45"), true);
confere("CSV traz a linha do pão com diferença negativa", /Diferença de inventário;Alimentos;Pão;Alimento;un;-9,000;1,00;-9,00/.test(csv), true);
const xls = gerarExcel(rel);
confere("Excel: cabeçalho SpreadsheetML", xls.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xls.includes('<?mso-application progid="Excel.Sheet"?>'), true);
confere("Excel: Resumo + 8 seções = 9 abas", (xls.match(/<Worksheet /g) || []).length, 9);
confere("Excel: número é Number (venda)", xls.includes('<Data ss:Type="Number">10000</Data>'), true);
confere("Excel: % como fração (0,45% = 0.0045)", xls.includes('<Data ss:Type="Number">0.0045</Data>'), true);
confere("Excel: nada de & cru (XML válido)", /&(?!amp;|lt;|gt;|quot;)/.test(xls), false);
confere("Excel: abre e fecha as tags principais", [(xls.match(/<Row>/g) || []).length === (xls.match(/<\/Row>/g) || []).length, (xls.match(/<Table>/g) || []).length, (xls.match(/<\/Table>/g) || []).length], [true, 9, 9]);
const a4 = gerarHtmlDeImpressao(rel);
confere("A4: título vira o nome do PDF", a4.includes("<title>Controlaveis - Lanchonete Teste Centro - 02-11-2026 a 08-11-2026</title>"), true);
confere("A4: @page A4 e cabeçalho repetido (thead)", a4.includes("size: A4") && a4.includes('<table class="pagina"><thead>'), true);
confere("A4: todas as seções", ["Desperdício completo", "Desperdício incompleto", "Segurança alimentar", "Condimentos", "Refeição da equipe", "Diferença de inventário", "Rendimento", "Indiretos"].every((t) => a4.includes(`<h2>${t}</h2>`)), true);
confere("A4: escapa o texto", a4.includes("Teste &lt;&amp;&gt;"), true);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
