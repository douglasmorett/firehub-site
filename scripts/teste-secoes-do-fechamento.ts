/**
 * O que sai no papel do fechamento de caixa (lib/secoes-do-fechamento.ts) —
 * cada seção desliga sozinha, a conferência e o total saem sempre.
 *
 *   npx tsx scripts/teste-secoes-do-fechamento.ts
 *
 * Caso da Divinos Burger (09/10/2026): papel de um metro, "gasta muito papel".
 * Turno sintético com TODAS as seções preenchidas; a prova é sobre o
 * `relatorio` (o que o Assistente imprime), sem banco.
 */
import assert from "node:assert/strict";
import { cupomDeFechamentoDeCaixa, type DetalheDoTurno } from "../src/lib/cupom-do-caixa";
import { FECHAMENTO_RESUMIDO, SECOES_DO_FECHAMENTO, secoesDoFechamento, type SecoesDoFechamento } from "../src/lib/secoes-do-fechamento";

const h = (hh: string) => new Date(`2026-10-09T${hh}:00-03:00`);
const parte = (nome: string, qtd: number, valor: number) => ({ nome, qtd, valor });
const detalhe: DetalheDoTurno = {
  vendas: { qtd: 30, valor: 1500 },
  porForma: [parte("Dinheiro", 10, 400), parte("Pix", 12, 600), parte("Credito", 8, 500)],
  porCanal: [{ ...parte("Site", 20, 1000), formas: [parte("Pix", 12, 600), parte("Dinheiro", 8, 400)] }, { ...parte("iFood", 10, 500), formas: [parte("Credito", 10, 500)] }],
  porTipo: [{
    ...parte("Delivery", 30, 1500), chave: "DELIVERY", formas: [parte("Pix", 12, 600)], canais: [parte("Site", 20, 1000), parte("iFood", 10, 500)],
    produtos: 1410, taxaDeEntrega: { qtd: 30, valor: 90 }, servico: { qtd: 0, valor: 0 }, gorjeta: 0, desconto: { qtd: 0, valor: 0 }, ajustes: 0, troco: { qtd: 0, valor: 0 },
  }],
  cupomDaLoja: { qtd: 1, valor: 10, porCanal: [parte("Site", 1, 10)] },
  cupomDaPlataforma: [parte("iFood", 2, 20)],
  onlinePorCanal: [parte("iFood", 10, 500)],
  taxaDeEntrega: { qtd: 30, valor: 90 },
  mesas: { servico: 0, servicoQtd: 0, gorjeta: 0 },
  gaveta: { vendasEmDinheiro: 400, reforcosQtd: 0, sangriasQtd: 1 },
  movimentacoes: [{ tipo: "SAIDA", valor: 50, descricao: "gas", hora: h("20:00") }],
  fiado: [{ hora: h("19:00"), numero: "12", nome: "Joao", valor: 30 }],
  cancelados: { qtd: 1, valor: 45, lista: [{ hora: h("21:00"), numero: "15", canal: "iFood", referencia: "ABC1", valor: 45, motivo: "cliente desistiu", quem: "cliente" }] },
  entregadores: [{ nome: "Ralph", entregas: 12, dinheiro: 100, cartao: 0, pix: 200, online: 300, outros: 0, taxas: 60, diaria: 20, semDistancia: 0, pelaTaxaDoCliente: 0 }],
  entregaParceira: { qtd: 0, valor: 0 },
  semEntregador: { qtd: 0, valor: 0 },
  maisVendidos: [parte("X-Tudo", 10, 250)],
};

const papel = (secoes?: SecoesDoFechamento) =>
  cupomDeFechamentoDeCaixa({
    sessionId: "c1", loja: "Divinos", fuso: "America/Sao_Paulo", operador: "Luiz",
    abertoEm: h("18:00"), fechadoEm: h("23:30"), trocoInicial: 100,
    valores: {
      esperado: { cash: 450, debit: 0, credit: 0, pix: 600, voucher: 0, total: 1550 },
      contado: { cash: 450, debit: 0, credit: 0, pix: 600, voucher: 0 },
      diferenca: 0, online: { ifood: 500 }, onlineEsperado: 500,
      movimentacoes: { entradas: 0, saidas: 50 },
      pendentes: { valor: 35, quantidade: 1 },
      detalhe,
    },
    secoes,
  }).relatorio!;
const titulos = (r: ReturnType<typeof papel>) => r.filter((l) => l.tipo === "titulo").map((l) => (l as any).texto as string);
const tem = (r: ReturnType<typeof papel>, re: RegExp) => r.some((l) => re.test(`${(l as any).texto || ""} ${(l as any).valor || ""}`));

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log(`  ✓ ${nome}`); };

const completo = papel();
const TITULO_DA_SECAO: Record<string, RegExp> = {
  gaveta: /^Dinheiro na gaveta$/, porTipo: /^Vendas Delivery$/, porCanal: /^Vendas por canal$/, cupons: /^Cupons e descontos$/,
  fiado: /^Fiado/, entregadores: /^Entregadores$/, cancelados: /^Cancelados$/, deFora: /^Ficou de fora/, maisVendidos: /^Mais vendidos$/,
};

caso("sem escolha = papel de sempre (todas as seções)", () => {
  for (const re of Object.values(TITULO_DA_SECAO)) assert.ok(titulos(completo).some((t) => re.test(t)), String(re));
  assert.deepEqual(papel(secoesDoFechamento(null)), completo);
});
for (const [chave, re] of Object.entries(TITULO_DA_SECAO)) {
  caso(`desligar "${chave}" tira só essa seção`, () => {
    const r = papel({ ...secoesDoFechamento(null), [chave]: false } as SecoesDoFechamento);
    assert.ok(!titulos(r).some((t) => re.test(t)));
    const outras = Object.entries(TITULO_DA_SECAO).filter(([k]) => k !== chave);
    for (const [, re2] of outras) assert.ok(titulos(r).some((t) => re2.test(t)), `${chave} levou junto ${re2}`);
  });
}
caso("faturamento desligado tira as formas e mantém o TOTAL FATURADO", () => {
  const r = papel({ ...secoesDoFechamento(null), faturamento: false });
  assert.ok(tem(r, /TOTAL FATURADO/));
  // "Credito (8)" só existe no faturamento por forma ("Pix (12)" se repete no bloco do tipo).
  assert.ok(!tem(r, /^Credito \(8\)/));
  assert.ok(tem(completo, /^Credito \(8\)/));
});
caso("resumido: conferência, diferença e total ficam; o papel encolhe", () => {
  const r = papel(FECHAMENTO_RESUMIDO);
  assert.ok(tem(r, /Conferencia da gaveta/) && tem(r, /DIFERENCA/) && tem(r, /TOTAL FATURADO/));
  assert.ok(tem(r, /Entregadores/) && tem(r, /Dinheiro na gaveta/));
  assert.ok(!tem(r, /Vendas Delivery|Vendas por canal|Mais vendidos|Cancelados/));
  console.log(`    linhas: completo ${completo.length} → resumido ${r.length}`);
  assert.ok(r.length < completo.length * 0.75);
});
caso("tudo desligado ainda imprime a conferência", () => {
  const nada = Object.fromEntries(SECOES_DO_FECHAMENTO.map((s) => [s.chave, false])) as SecoesDoFechamento;
  const r = papel(nada);
  assert.ok(tem(r, /Conferencia da gaveta/) && tem(r, /DIFERENCA/) && tem(r, /TOTAL FATURADO/));
  console.log(`    linhas: tudo desligado ${r.length}`);
});
caso("config salva: só false desliga; lixo é ignorado", () => {
  const s = secoesDoFechamento({ fechamentoNoPapel: { porTipo: false, cancelados: 0, maisVendidos: "nao" } });
  assert.equal(s.porTipo, false);
  assert.equal(s.cancelados, true);
  assert.equal(s.maisVendidos, true);
  assert.equal(secoesDoFechamento({ fechamentoNoPapel: [false] }).gaveta, true);
});

console.log(`\n${ok} casos ok`);
