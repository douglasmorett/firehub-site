/**
 * O fechamento de um caixa em A4 — a página que vira o PDF para a
 * contabilidade (api/cash-session/fechamento-pdf).
 *
 * Pedido do Victor na Pizzaria 17 (14/10/2026): "Gerar PDF" ao lado do
 * "Imprimir fechamento". O projeto não tem biblioteca de PDF, e acrescentar
 * uma (com fontes, quebra de página, acento) por causa de um relatório é peso
 * e risco que o navegador dispensa: a página abre em A4 e chama a janela de
 * impressão, onde o destino "Salvar como PDF" gera o arquivo. O `<title>` é o
 * nome que o Chrome sugere para o arquivo (fechamento-caixa-2026-10-12.pdf).
 *
 * Puro, sem banco: recebe o que a rota leu. Os números são os MESMOS do
 * Histórico — a conferência gravada (lib/conferencia-do-caixa.ts), as
 * entradas e retiradas (lib/resumo-das-movimentacoes.ts) e as vendas por tipo
 * apuradas pela régua do turno (lib/esperado-do-turno.ts). Nenhuma conta nova.
 */
import type { ConferenciaGravada } from "./conferencia-do-caixa";
import type { BlocoDoTipo, ParteDoRetrato } from "./cupom-do-caixa";
import { composicaoDoDinheiroEsperado, resumoDasMovimentacoes, type MovimentoDoCaixa } from "./resumo-das-movimentacoes";
import { dataDaLoja, FUSO_PADRAO } from "./fuso";

export type VendasDoFechamentoA4 = {
  vendas: { qtd: number; valor: number; ticketMedio?: number };
  recebido?: { qtd: number; valor: number };
  ponte?: { chave: string; rotulo: string; qtd: number; valor: number }[];
  cupomDaPlataforma?: ParteDoRetrato[];
  porTipo: BlocoDoTipo[];
};

export type DadosDoFechamentoA4 = {
  loja: { nome: string; documento?: string | null; endereco?: string | null; telefone?: string | null };
  fuso: string | null | undefined;
  abertoEm: Date;
  fechadoEm: Date | null;
  encerradoPor: string | null;
  trocoInicial: number;
  conf: ConferenciaGravada;
  justificativa: string | null;
  observacoes: string | null;
  /** null = não deu para ler a tabela; aí a seção diz isso, em vez de "nenhuma". */
  movimentos: MovimentoDoCaixa[] | null;
  /** null = a apuração das vendas falhou; o resto do fechamento sai igual. */
  vendas: VendasDoFechamentoA4 | null;
  correcoes: { qtd: number; ultima: { em: Date; por: string } | null };
  emitido: { em: Date; por: string };
};

/** "fechamento-caixa-2026-10-12": a data em que o caixa ABRIU, no relógio da loja. */
export function nomeDoArquivoDoFechamento(abertoEm: Date, fuso: string | null | undefined): string {
  return `fechamento-caixa-${dataDaLoja(fuso || FUSO_PADRAO, new Date(abertoEm))}`;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// Com milhar e o sinal antes do "R$", como no Histórico.
const fmt = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// O papel térmico sai em ASCII ("Debito"); a folha fala com acento — os
// mesmos acertos de VendasPorTipoDoCaixa.
const nomeDaForma = (nome: string) =>
  nome
    .replace(/^Debito$/, "Débito")
    .replace(/^Credito$/, "Crédito")
    .replace(/^Vale-refeicao$/, "Vale-refeição")
    .replace(/^Forma nao identificada$/, "Forma não identificada");
const nomeDaPonte = (rotulo: string) =>
  rotulo.replace("servico", "serviço").replace("Lancado", "Lançado").replace("cartao", "cartão").replace("diferencas", "diferenças");
const ROTULO: Record<string, string> = { DELIVERY: "Delivery", RETIRADA: "Retirada", BALCAO: "Balcão", MESA: "Mesas", TOTEM: "Totem" };

const CSS = `
@page { size: A4; margin: 14mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; }
.folha { max-width: 186mm; margin: 0 auto; padding: 16px; }
.barra { max-width: 186mm; margin: 12px auto 0; padding: 10px 14px; border: 1px solid #FDBA74; background: #FFF7ED; border-radius: 10px; font-size: 13px; color: #7C2D12; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; justify-content: space-between; }
.barra button { font: inherit; font-weight: 700; padding: 6px 12px; border-radius: 8px; border: 1px solid #C2410C; background: #EA580C; color: #fff; cursor: pointer; }
.barra button.fraco { background: #fff; color: #7C2D12; }
header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
h1 { font-size: 16pt; margin: 0; }
.sub { color: #444; font-size: 9.5pt; }
h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #111; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 4px 6px; border-bottom: 1px solid #DDD; text-align: left; vertical-align: top; }
th { font-size: 9pt; color: #444; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tfoot td, .forte { font-weight: 700; }
.nota { color: #555; font-size: 9pt; }
.dados { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 16px; margin-top: 8px; }
.dados div span { display: block; color: #555; font-size: 8.5pt; }
.situacao { margin-top: 10px; padding: 8px 10px; border: 1px solid #999; border-radius: 6px; font-weight: 700; }
.tipos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tipo { border: 1px solid #CCC; border-radius: 6px; padding: 6px 8px; break-inside: avoid; }
.tipo td { border-bottom: 0; padding: 2px 4px; }
.tipo .total td { border-top: 1px solid #999; font-weight: 700; }
section { break-inside: avoid; }
footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #999; color: #555; font-size: 8.5pt; }
@media print { .barra { display: none; } .folha { padding: 0; } }
@media (max-width: 640px) { .dados { grid-template-columns: 1fr 1fr; } .tipos { grid-template-columns: 1fr; } }
`;

// O botão da barra e a janela de impressão logo ao abrir: quem clicou em
// "Gerar PDF" quer o arquivo, não a página.
const SCRIPT =
  '(function(){var b=document.getElementById("imprimir");if(b)b.addEventListener("click",function(){window.print()});' +
  'var f=document.getElementById("fechar");if(f)f.addEventListener("click",function(){window.close()});' +
  'window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})})();';

export function htmlDoFechamentoA4(d: DadosDoFechamentoA4): string {
  const tz = d.fuso || FUSO_PADRAO;
  const dataHora = (x: Date) =>
    new Date(x).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const hora = (x: Date) =>
    new Date(x).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: tz });
  const duracao = d.fechadoEm
    ? (() => {
        const m = Math.max(0, Math.round((new Date(d.fechadoEm).getTime() - new Date(d.abertoEm).getTime()) / 60000));
        return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
      })()
    : "—";

  const c = d.conf;
  const semConferencia = c.situacao === "SEM_CONFERENCIA";
  const dif = c.diferenca ?? 0;
  const confere = !semConferencia && Math.abs(dif) < 0.01;
  const situacao = semConferencia ? "Sem conferência" : confere ? "Confere" : dif < 0 ? `Faltou ${fmt(-dif)}` : `Sobrou ${fmt(dif)}`;

  const p: string[] = [];

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  const daLoja = [d.loja.documento ? `CNPJ/CPF ${d.loja.documento}` : "", d.loja.endereco || "", d.loja.telefone || ""].filter(Boolean);
  p.push(
    `<header><div><h1>${esc(d.loja.nome || "Loja")}</h1>${daLoja.length ? `<div class="sub">${daLoja.map(esc).join(" • ")}</div>` : ""}</div>` +
      `<div style="text-align:right"><div class="forte">Fechamento de caixa</div><div class="sub">Caixa de ${esc(dataHora(d.abertoEm))}</div></div></header>`
  );
  p.push(
    `<div class="dados">` +
      `<div><span>Aberto em</span>${esc(dataHora(d.abertoEm))}</div>` +
      `<div><span>Fechado em</span>${d.fechadoEm ? esc(dataHora(d.fechadoEm)) : "—"}</div>` +
      `<div><span>Duração</span>${esc(duracao)}</div>` +
      `<div><span>Encerrado por</span>${esc(d.encerradoPor || "não registrado")}</div>` +
      `<div><span>Troco inicial</span>${esc(fmt(d.trocoInicial))}</div>` +
      `<div><span>Resultado</span>${esc(situacao)}</div>` +
      `</div>`
  );
  const avisos: string[] = [];
  if (d.justificativa) avisos.push(`Justificativa: ${esc(d.justificativa)}`);
  if (d.observacoes) avisos.push(`Observações: ${esc(d.observacoes)}`);
  if (d.correcoes.ultima) {
    avisos.push(
      `Fechamento corrigido em ${esc(dataHora(d.correcoes.ultima.em))} por ${esc(d.correcoes.ultima.por)}` +
        (d.correcoes.qtd > 1 ? ` (${d.correcoes.qtd} correções)` : "") +
        ` — o histórico guarda como estava antes.`
    );
  }
  if (avisos.length) p.push(`<div class="situacao">${avisos.join("<br>")}</div>`);

  // ── Conferência por forma (a mesma tabela do Histórico) ────────────────
  const linhas = c.linhas.filter((l) => Math.abs(l.esperado) > 0.005 || (l.contado != null && Math.abs(l.contado) > 0.005));
  p.push(`<section><h2>Conferência por forma de pagamento</h2>`);
  if (semConferencia) p.push(`<p class="nota">Este caixa foi encerrado sem contagem: abaixo, só o que o sistema esperava.</p>`);
  if (linhas.length === 0) {
    p.push(`<p class="nota">Nenhum valor esperado nas formas da gaveta.</p>`);
  } else {
    p.push(`<table><thead><tr><th>Forma</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Diferença</th></tr></thead><tbody>`);
    for (const l of linhas) {
      const contado = l.contado == null ? (semConferencia ? "—" : "não conferido") : fmt(l.contado);
      const dl = l.diferenca == null ? "—" : Math.abs(l.diferenca) < 0.01 ? "confere" : l.diferenca > 0 ? `+${fmt(l.diferenca)}` : fmt(l.diferenca);
      p.push(`<tr><td>${esc(l.nome)}</td><td class="num">${esc(fmt(l.esperado))}</td><td class="num">${esc(contado)}</td><td class="num">${esc(dl)}</td></tr>`);
    }
    p.push(`</tbody><tfoot><tr><td>${semConferencia ? "Esperado nas formas" : "Conferido"}${c.situacao === "PARCIAL" ? ` <span class="nota">(só as formas contadas)</span>` : ""}</td>` +
      `<td class="num">${esc(fmt(semConferencia ? c.esperadoNasFormas : c.esperadoConferido))}</td>` +
      `<td class="num">${semConferencia ? "—" : esc(fmt(c.contado))}</td>` +
      `<td class="num">${semConferencia ? "—" : confere ? "confere" : esc(dif > 0 ? `+${fmt(dif)}` : fmt(dif))}</td></tr></tfoot></table>`);
  }
  if (c.online > 0.005) {
    p.push(`<p class="nota">Pago online e cobrado pelo app (não se conta na gaveta): <b>${esc(fmt(c.online))}</b> • total do turno ${esc(fmt(c.total))}</p>`);
  }
  p.push(`</section>`);

  // ── Dinheiro esperado e as entradas/retiradas ──────────────────────────
  const esperadoEmDinheiro = c.linhas.find((l) => l.chave === "cash")?.esperado ?? 0;
  p.push(`<section><h2>Entradas e retiradas do caixa</h2>`);
  if (!d.movimentos) {
    p.push(`<p class="nota">Não foi possível ler as entradas e retiradas deste caixa agora.</p>`);
  } else {
    const resumo = resumoDasMovimentacoes(d.movimentos);
    if (d.movimentos.length === 0) {
      p.push(`<p class="nota">Nenhuma entrada ou retirada neste caixa.</p>`);
    } else {
      p.push(`<table><thead><tr><th>Hora</th><th>Tipo</th><th>Motivo</th><th>Quem lançou</th><th class="num">Valor</th></tr></thead><tbody>`);
      for (const m of d.movimentos) {
        const entrada = m.tipo === "ENTRADA";
        p.push(
          `<tr><td class="num" style="text-align:left">${esc(hora(m.em))}</td><td>${entrada ? "Entrada (suprimento)" : "Retirada (sangria)"}` +
            // A esquecida, lançada no Histórico: a hora é a do lançamento.
            (m.depoisDoFechamento ? `<br><span class="nota">lançada depois do fechamento</span>` : "") +
            `</td>` +
            `<td>${m.descricao ? esc(m.descricao) : `<span class="nota">não informado</span>`}</td><td>${esc(m.quem || "—")}</td>` +
            `<td class="num">${entrada ? "+" : "−"}${esc(fmt(m.valor))}</td></tr>`
        );
      }
      p.push(`</tbody><tfoot>` +
        `<tr><td colspan="4">Total de entradas (${resumo.entradas.qtd})</td><td class="num">+${esc(fmt(resumo.entradas.valor))}</td></tr>` +
        `<tr><td colspan="4">Total de retiradas (${resumo.retiradas.qtd})</td><td class="num">−${esc(fmt(resumo.retiradas.valor))}</td></tr>` +
        `</tfoot></table>`);
    }
    // A régua do esperado escrita, com as parcelas: quem confere a tabela
    // acima sabe que o "Sistema" do dinheiro já desconta as retiradas.
    const { vendasEmDinheiro } = composicaoDoDinheiroEsperado(esperadoEmDinheiro, d.trocoInicial, resumo);
    if (vendasEmDinheiro != null) {
      p.push(`<table style="margin-top:8px;max-width:110mm"><tbody>` +
        `<tr><td>Troco inicial</td><td class="num">${esc(fmt(d.trocoInicial))}</td></tr>` +
        `<tr><td>+ Vendas em dinheiro</td><td class="num">${esc(fmt(vendasEmDinheiro))}</td></tr>` +
        `<tr><td>+ Entradas</td><td class="num">${esc(fmt(resumo.entradas.valor))}</td></tr>` +
        `<tr><td>− Retiradas</td><td class="num">${esc(fmt(resumo.retiradas.valor))}</td></tr>` +
        `<tr class="forte"><td>= Dinheiro esperado (o "Sistema" do Dinheiro)</td><td class="num">${esc(fmt(esperadoEmDinheiro))}</td></tr>` +
        `</tbody></table>`);
    } else {
      p.push(`<p class="nota">Dinheiro esperado = troco inicial + vendas em dinheiro + entradas − retiradas.</p>`);
    }
  }
  p.push(`</section>`);

  // ── Vendas por tipo ────────────────────────────────────────────────────
  p.push(`<section><h2>Vendas por tipo</h2>`);
  const v = d.vendas;
  if (!v) {
    p.push(`<p class="nota">Não foi possível somar as vendas deste caixa agora. A conferência acima é a gravada no fechamento.</p>`);
  } else if (v.porTipo.length === 0) {
    p.push(`<p class="nota">Nenhuma venda paga neste caixa.</p>`);
  } else {
    p.push(`<div class="tipos">`);
    for (const b of v.porTipo) {
      const contagem = b.chave === "MESA" ? (b.qtd === 1 ? "conta" : "contas") : b.qtd === 1 ? "pedido" : "pedidos";
      const l: string[] = [];
      const linha = (r: string, val: number, cls = "") => l.push(`<tr${cls ? ` class="${cls}"` : ""}><td>${esc(r)}</td><td class="num">${esc(fmt(val))}</td></tr>`);
      for (const f of b.formas) linha(`${nomeDaForma(f.nome)} (${f.qtd})`, f.valor);
      linha("Valor dos produtos", b.produtos, "nota");
      if (b.taxaDeEntrega.valor > 0.005) linha(`+ Taxa de entrega (${b.taxaDeEntrega.qtd})`, b.taxaDeEntrega.valor, "nota");
      if (b.servico.valor > 0.005) linha(`+ Taxa de serviço (${b.servico.qtd})`, b.servico.valor, "nota");
      if (b.gorjeta > 0.005) linha("+ Gorjeta", b.gorjeta, "nota");
      if (b.desconto.valor > 0.005) linha(`− ${b.chave === "MESA" ? "Desconto no fechamento" : "Desconto da loja"} (${b.desconto.qtd})`, -b.desconto.valor, "nota");
      const cupom = b.cupomDaPlataforma?.valor || 0;
      if (cupom > 0.005) linha(`− Cupom pago pela plataforma (${b.cupomDaPlataforma!.qtd})`, -cupom, "nota");
      if (Math.abs(b.ajustes) > 0.005) linha(`${b.ajustes > 0 ? "+" : "−"} Ajustes (taxa do app, acréscimos)`, b.ajustes, "nota");
      linha(`Total ${ROTULO[b.chave] || b.nome}`, b.valor, "total");
      if (b.troco.valor > 0.005) linha(`Troco devolvido (${b.troco.qtd}) — já fora do dinheiro`, b.troco.valor, "nota");
      p.push(`<div class="tipo"><div class="forte">${esc(ROTULO[b.chave] || b.nome)} <span class="nota">— ${b.qtd} ${contagem}</span></div><table>${l.join("")}</table></div>`);
    }
    p.push(`</div>`);
    const recebido = v.recebido ?? v.vendas;
    const ticket = v.vendas.ticketMedio ?? (v.vendas.qtd > 0 ? v.vendas.valor / v.vendas.qtd : 0);
    p.push(`<table style="margin-top:8px"><tbody>`);
    p.push(`<tr class="forte"><td>Total faturado (${v.vendas.qtd} ${v.vendas.qtd === 1 ? "venda" : "vendas"}) <span class="nota">— ticket médio ${esc(fmt(ticket))}, o mesmo número dos relatórios</span></td><td class="num">${esc(fmt(v.vendas.valor))}</td></tr>`);
    for (const pt of v.ponte || []) {
      p.push(`<tr class="nota"><td>${pt.valor >= 0 ? "+" : "−"} ${esc(nomeDaPonte(pt.rotulo))}${pt.qtd > 0 ? ` (${pt.qtd})` : ""}</td><td class="num">${esc(fmt(pt.valor))}</td></tr>`);
    }
    p.push(`<tr class="forte"><td>${(v.ponte || []).length ? "= " : ""}Total recebido (${recebido.qtd} ${recebido.qtd === 1 ? "pagamento" : "pagamentos"})</td><td class="num">${esc(fmt(recebido.valor))}</td></tr>`);
    p.push(`</tbody></table>`);
    const cupomTotal = (v.cupomDaPlataforma || []).reduce((s, x) => ({ qtd: s.qtd + x.qtd, valor: s.valor + x.valor }), { qtd: 0, valor: 0 });
    if (cupomTotal.valor > 0.005) {
      p.push(`<p class="nota">Cupom pago pelas plataformas: ${esc(fmt(cupomTotal.valor))} (${cupomTotal.qtd} ${cupomTotal.qtd === 1 ? "pedido" : "pedidos"}) — fora dos dois totais: o app repassa à loja.</p>`);
    }
  }
  p.push(`</section>`);

  p.push(
    `<footer>Emitido em ${esc(dataHora(d.emitido.em))}${d.emitido.por ? ` por ${esc(d.emitido.por)}` : ""} pelo FireHub. ` +
      `A conferência é a gravada no fechamento; as vendas por tipo são apuradas de novo na janela do caixa. Não é documento fiscal.</footer>`
  );

  const titulo = nomeDoArquivoDoFechamento(d.abertoEm, d.fuso);
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${esc(titulo)}</title><style>${CSS}</style></head><body>` +
    `<div class="barra"><span>Na janela de impressão, escolha <b>Destino: Salvar como PDF</b> e clique em <b>Salvar</b>. O arquivo sai como <b>${esc(titulo)}.pdf</b>.</span>` +
    `<span style="display:flex;gap:8px"><button type="button" id="imprimir">Salvar como PDF</button><button type="button" id="fechar" class="fraco">Fechar</button></span></div>` +
    `<div class="folha">${p.join("")}</div>` +
    `<script>${SCRIPT}</script></body></html>`
  );
}
