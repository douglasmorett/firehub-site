/**
 * Exportar o Relatório dos controláveis: planilha CSV, Excel (.xls no formato
 * SpreadsheetML — o XML do Excel 2003, que o Excel, o LibreOffice e o Google
 * Planilhas abrem sem biblioteca nenhuma) e a página A4 para imprimir / salvar
 * como PDF. Puro (texto entra, texto sai); a tela só baixa ou abre.
 * Testado em scripts/teste-controlaveis.ts.
 */
import {
  COMO_LER_O_RELATORIO, DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO, ORDEM_DAS_SECOES, ROTULO_DA_CLASSE, sumiuOuSobrou, TITULO_DA_SECAO,
  type IdDaSecao, type LinhaDoRelatorio, type RelatorioDosControlaveis, type Secao,
} from "@/lib/cmv/controlaveis";

const DIFERENCA: IdDaSecao[] = ["inventario", "rendimento"];

const diaBr = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
const diaArquivo = (dia: string) => `${dia.slice(8, 10)}-${dia.slice(5, 7)}-${dia.slice(0, 4)}`;
const quandoBr = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** "Controlaveis - Pizzaria X - 01-11-2026 a 30-11-2026" (sem barra: vira nome de arquivo). */
export function nomeDoArquivo(r: Pick<RelatorioDosControlaveis, "loja" | "periodo">): string {
  const loja = r.loja.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Loja";
  return `Controlaveis - ${loja} - ${diaArquivo(r.periodo.de)} a ${diaArquivo(r.periodo.ate)}`;
}

const reais = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** A linha do resumo final, como no fim do relatório em papel. */
export function linhasDoResumo(r: RelatorioDosControlaveis): { rotulo: string; valor: number; pct: number | null; destaque?: boolean }[] {
  const s = r.resumo;
  return [
    ...ORDEM_DAS_SECOES.map((id) => ({ rotulo: TITULO_DA_SECAO[id], valor: s.porSecao[id], pct: s.pct.porSecao[id] })),
    { rotulo: "Diferença de alimentos (inventário + rendimento)", valor: s.diferencaAlimentos, pct: s.pct.diferencaAlimentos, destaque: true },
    { rotulo: "Diferença de embalagens", valor: s.diferencaEmbalagens, pct: s.pct.diferencaEmbalagens, destaque: true },
    { rotulo: "Diferença total", valor: s.diferencaTotal, pct: s.pct.diferencaTotal, destaque: true },
    { rotulo: "Total dos controláveis", valor: s.totalControlaveis, pct: s.pct.totalControlaveis, destaque: true },
  ];
}

function periodoDaSecao(r: RelatorioDosControlaveis, id: IdDaSecao): string {
  if (!["condimentos", "inventario", "rendimento", "indiretos"].includes(id) || !r.contagem) return "";
  return `contagens de ${diaBr(r.contagem.de)} a ${diaBr(r.contagem.ate)}`;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const num = (n: number | null | undefined, casas = 2) =>
  n == null || !Number.isFinite(n) ? "" : n.toFixed(casas).replace(".", ",");
const cel = (s: unknown) => {
  const t = String(s ?? "");
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV com ; e vírgula decimal, e o BOM para o Excel ler os acentos. */
export function gerarCsv(r: RelatorioDosControlaveis): string {
  const L: unknown[][] = [];
  L.push(["Relatório dos controláveis"]);
  L.push(["Loja", r.loja]);
  L.push(["Período", `${diaBr(r.periodo.de)} a ${diaBr(r.periodo.ate)}`]);
  L.push(["Venda líquida (R$)", num(r.venda)]);
  if (r.contagem) L.push(["Contagens (seções de consumo e diferença)", `${diaBr(r.contagem.de)} a ${diaBr(r.contagem.ate)}`, "Venda desses dias (R$)", num(r.contagem.venda)]);
  L.push(["Gerado em", quandoBr(r.geradoEm)]);
  L.push([]);
  L.push(["Resumo", "Valor (R$)", "% da venda"]);
  for (const l of linhasDoResumo(r)) L.push([l.rotulo, num(l.valor), num(l.pct)]);
  L.push([]);
  L.push(["Seção", "Grupo", "Item", "Classe", "Unidade", "Qtde", "Custo unitário (R$)", "Custo total (R$)", "% da venda"]);
  for (const id of ORDEM_DAS_SECOES) {
    const s = r.secoes[id];
    const venda = periodoDaSecao(r, id) && r.contagem ? r.contagem.venda : r.venda;
    for (const l of s.linhas) {
      L.push([s.titulo, rotuloDoGrupo(l), l.nome, l.classe ? ROTULO_DA_CLASSE[l.classe] : l.tipo === "PRODUTO" ? "Produto" : "", l.unidade, num(l.quantidade, 3), num(l.custoUnitario), num(l.total), num(venda > 0 ? (l.total / venda) * 100 : null)]);
    }
    for (const c of s.cancelados || []) L.push([s.titulo, "Pedidos cancelados depois de produzidos", `Pedido ${c.numero}`, c.etapa, "pedido", "1", num(c.valor), num(c.valor), num(venda > 0 && c.valor != null ? (c.valor / venda) * 100 : null)]);
    L.push([`Total — ${s.titulo}`, "", s.falta ? s.falta : "", "", "", "", "", num(s.total), num(s.pct)]);
  }
  return "﻿" + L.map((linha) => linha.map(cel).join(";")).join("\r\n") + "\r\n";
}

function rotuloDoGrupo(l: LinhaDoRelatorio): string {
  return l.grupo === "EMBALAGENS" ? "Embalagens" : l.grupo === "ALIMENTOS" ? "Alimentos" : "";
}

// ── Excel (SpreadsheetML 2003) ──────────────────────────────────────────────

const xml = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Celula = { t: string; estilo?: string } | { n: number | null; estilo: string };
const T = (t: unknown, estilo?: string): Celula => ({ t: String(t ?? ""), estilo });
const N = (n: number | null | undefined, estilo: "reais" | "pct" | "qtd" | "reaisTotal" | "pctTotal"): Celula => ({ n: n == null || !Number.isFinite(n) ? null : n, estilo });

function linhaXml(cs: Celula[]): string {
  return `<Row>${cs.map((c) => {
    const st = c.estilo ? ` ss:StyleID="${c.estilo}"` : "";
    if ("n" in c) return c.n == null ? `<Cell${st}/>` : `<Cell${st}><Data ss:Type="Number">${c.n}</Data></Cell>`;
    return `<Cell${st}><Data ss:Type="String">${xml(c.t)}</Data></Cell>`;
  }).join("")}</Row>`;
}

/** Nome de aba do Excel: até 31 caracteres, sem : \ / ? * [ ]. */
const nomeDaAba = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

function cabecalhoXml(r: RelatorioDosControlaveis, titulo: string, extra?: string): string[] {
  return [
    linhaXml([T(titulo, "titulo")]),
    linhaXml([T("Loja", "rotulo"), T(r.loja)]),
    linhaXml([T("Período", "rotulo"), T(`${diaBr(r.periodo.de)} a ${diaBr(r.periodo.ate)}`)]),
    linhaXml([T("Venda líquida", "rotulo"), N(r.venda, "reais")]),
    ...(extra ? [linhaXml([T("Recorte", "rotulo"), T(extra)])] : []),
    linhaXml([T("Gerado em", "rotulo"), T(quandoBr(r.geradoEm))]),
    linhaXml([]),
  ];
}

function abaXml(nome: string, larguras: number[], linhas: string[]): string {
  return `<Worksheet ss:Name="${xml(nomeDaAba(nome))}"><Table>${larguras.map((w) => `<Column ss:Width="${w}"/>`).join("")}${linhas.join("")}</Table>` +
    `<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/></PageSetup><FitToPage/><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight></Print></WorksheetOptions></Worksheet>`;
}

/** % do Excel é fração: 1,25% vira 0,0125 com o formato 0,00%. */
const fracao = (p: number | null | undefined) => (p == null ? null : Math.round(p * 10000) / 1e6);

export function gerarExcel(r: RelatorioDosControlaveis): string {
  const abas: string[] = [];

  // Resumo
  const resumo = [
    ...cabecalhoXml(r, "Relatório dos controláveis — resumo", r.contagem ? `Seções de contagem: ${diaBr(r.contagem.de)} a ${diaBr(r.contagem.ate)} (venda desses dias: ${reais(r.contagem.venda)})` : undefined),
    linhaXml([T("Como ler este relatório", "rotulo")]),
    ...COMO_LER_O_RELATORIO.map((t) => linhaXml([T(`• ${t}`)])),
    linhaXml([]),
    linhaXml([T("Seção", "th"), T("Valor (R$)", "th"), T("% da venda", "th"), ...(r.anterior ? [T("Período anterior (R$)", "th"), T("% anterior", "th")] : [])]),
  ];
  const ant = r.anterior ? linhasDoResumo({ ...r, resumo: r.anterior.resumo }) : null;
  linhasDoResumo(r).forEach((l, i) => {
    const total = l.destaque;
    resumo.push(linhaXml([
      T(l.rotulo, total ? "rotulo" : undefined), N(l.valor, total ? "reaisTotal" : "reais"), N(fracao(l.pct), total ? "pctTotal" : "pct"),
      ...(ant ? [N(ant[i].valor, "reais"), N(fracao(ant[i].pct), "pct")] : []),
    ]));
  });
  if (r.ondeEstaODinheiro.length) {
    resumo.push(linhaXml([]), linhaXml([T("Onde está o dinheiro (os 10 que mais custaram)", "titulo")]));
    resumo.push(linhaXml([T(DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO)]));
    resumo.push(linhaXml([T("Item", "th"), T("Seção", "th"), T("Valor (R$)", "th")]));
    for (const i of r.ondeEstaODinheiro) resumo.push(linhaXml([T(i.nome), T(TITULO_DA_SECAO[i.secao]), N(i.valor, "reais")]));
  }
  abas.push(abaXml("Resumo", [300, 110, 90, 130, 90], resumo));

  // Uma aba por seção
  for (const id of ORDEM_DAS_SECOES) {
    const s = r.secoes[id];
    const recorte = periodoDaSecao(r, id);
    const venda = recorte && r.contagem ? r.contagem.venda : r.venda;
    const dif = DIFERENCA.includes(id);
    const linhas = [
      ...cabecalhoXml(r, s.titulo, recorte ? `${recorte} (venda desses dias: ${reais(venda)})` : undefined),
      linhaXml([T(s.descricao)]),
      linhaXml([]),
    ];
    if (s.falta) linhas.push(linhaXml([T(s.falta, "rotulo")]));
    const cab = [T("Item", "th"), ...(dif ? [T("Grupo", "th")] : []), T("Classe", "th"), T("Unidade", "th"), T(dif ? "Diferença (qtde)" : "Qtde", "th"), T("Custo unitário", "th"), T(dif ? "Diferença (R$)" : "Custo total", "th"), T("% da venda", "th")];
    if (dif) cab.push(T("Abertura", "th"), T("Entradas", "th"), T("Fechamento", "th"), T("Consumo real", "th"), T("Vendas", "th"), T("Equipe", "th"), T("Perdas", "th"), T("Saídas", "th"), T("Explicado", "th"));
    linhas.push(linhaXml(cab));
    for (const l of s.linhas) {
      const c = l.conta;
      linhas.push(linhaXml([
        T(l.nome), ...(dif ? [T(rotuloDoGrupo(l))] : []), T(l.classe ? ROTULO_DA_CLASSE[l.classe] : l.tipo === "PRODUTO" ? "Produto" : ""), T(l.unidade),
        N(l.quantidade, "qtd"), N(l.custoUnitario, "reais"), N(l.total, "reais"), N(venda > 0 ? Math.round((l.total / venda) * 1e6) / 1e6 : null, "pct"),
        ...(dif && c ? [N(c.abertura, "qtd"), N(c.entradas, "qtd"), N(c.fechamento, "qtd"), N(c.real, "qtd"), N(c.vendas, "qtd"), N(c.equipe, "qtd"), N(c.perdas, "qtd"), N(c.saidas, "qtd"), N(c.explicado, "qtd")] : []),
      ]));
    }
    if (s.cancelados?.length) {
      linhas.push(linhaXml([]), linhaXml([T("Pedidos cancelados depois de produzidos", "rotulo")]));
      linhas.push(linhaXml([T("Pedido", "th"), T("Quando", "th"), T("Etapa", "th"), T("Motivo", "th"), T("Custo", "th")]));
      for (const c of s.cancelados) linhas.push(linhaXml([T(c.numero), T(quandoBr(c.quando)), T(c.etapa), T(c.motivo || ""), N(c.valor, "reais")]));
    }
    linhas.push(linhaXml([]));
    if (s.grupos) {
      linhas.push(linhaXml([T("Diferença de alimentos", "rotulo"), N(s.grupos.alimentos, "reaisTotal"), N(venda > 0 ? Math.round((s.grupos.alimentos / venda) * 1e6) / 1e6 : null, "pctTotal")]));
      linhas.push(linhaXml([T("Diferença de embalagens", "rotulo"), N(s.grupos.embalagens, "reaisTotal"), N(venda > 0 ? Math.round((s.grupos.embalagens / venda) * 1e6) / 1e6 : null, "pctTotal")]));
    }
    linhas.push(linhaXml([T(`Total — ${s.titulo}`, "rotulo"), N(s.total, "reaisTotal"), N(fracao(s.pct), "pctTotal")]));
    abas.push(abaXml(s.titulo, [240, ...(dif ? [90] : []), 90, 60, 90, 90, 100, 80, 80, 80, 80, 90, 80, 80, 80, 80, 90], linhas));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>${xml(nomeDoArquivo(r))}</Title><Author>FireHub</Author></DocumentProperties>
<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="11"/></Style>
<Style ss:ID="titulo"><Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1"/></Style>
<Style ss:ID="rotulo"><Font ss:FontName="Calibri" ss:Bold="1"/></Style>
<Style ss:ID="th"><Font ss:FontName="Calibri" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1C1917" ss:Pattern="Solid"/></Style>
<Style ss:ID="reais"><NumberFormat ss:Format="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/></Style>
<Style ss:ID="reaisTotal"><Font ss:FontName="Calibri" ss:Bold="1"/><NumberFormat ss:Format="&quot;R$&quot;\\ #,##0.00;[Red]\\-&quot;R$&quot;\\ #,##0.00"/></Style>
<Style ss:ID="pct"><NumberFormat ss:Format="0.00%"/></Style>
<Style ss:ID="pctTotal"><Font ss:FontName="Calibri" ss:Bold="1"/><NumberFormat ss:Format="0.00%"/></Style>
<Style ss:ID="qtd"><NumberFormat ss:Format="#,##0.###"/></Style>
</Styles>
${abas.join("\n")}
</Workbook>
`;
}

// ── A4 para imprimir / salvar como PDF ──────────────────────────────────────

const html = xml;

/**
 * A página do relatório para imprimir: A4, cabeçalho repetido em todas as
 * páginas (o thead da tabela externa), uma seção depois da outra, totais e %.
 * O <title> vira o nome do PDF quando a pessoa escolhe "Salvar como PDF".
 */
export function gerarHtmlDeImpressao(r: RelatorioDosControlaveis): string {
  const cab = `<div class="cab"><div><b>Relatório dos controláveis</b> · ${html(r.loja)}</div>
<div>Período ${diaBr(r.periodo.de)} a ${diaBr(r.periodo.ate)} · Venda líquida ${reais(r.venda)}${r.contagem ? ` · Contagens ${diaBr(r.contagem.de)} a ${diaBr(r.contagem.ate)}` : ""} · Gerado em ${quandoBr(r.geradoEm)}</div></div>`;

  const comoLer = `<div class="ler"><b>Como ler este relatório</b><ul>${COMO_LER_O_RELATORIO.map((t) => `<li>${html(t)}</li>`).join("")}</ul></div>`;
  const ehDif = (rotulo: string) => rotulo.startsWith("Diferença") || rotulo === TITULO_DA_SECAO.rendimento;

  const resumo = `<h2>Resumo</h2><table class="t"><thead><tr><th>Seção</th><th class="n">Valor</th><th class="n">% da venda</th>${r.anterior ? `<th class="n">Anterior (${diaBr(r.anterior.de)} a ${diaBr(r.anterior.ate)})</th>` : ""}</tr></thead><tbody>${
    linhasDoResumo(r).map((l, i) => {
      const ant = r.anterior ? linhasDoResumo({ ...r, resumo: r.anterior.resumo })[i] : null;
      return `<tr class="${l.destaque ? "tot" : ""}"><td>${html(l.rotulo)}</td><td class="n${l.valor < 0 ? " neg" : ""}">${reais(l.valor)}${ehDif(l.rotulo) && sumiuOuSobrou(l.valor) ? ` <small>${sumiuOuSobrou(l.valor)}</small>` : ""}</td><td class="n">${pct(l.pct)}</td>${ant ? `<td class="n">${reais(ant.valor)} · ${pct(ant.pct)}</td>` : ""}</tr>`;
    }).join("")
  }</tbody></table>`;

  const top = r.ondeEstaODinheiro.length
    ? `<h2>Onde está o dinheiro</h2><p class="d">${html(DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO)}</p><table class="t"><thead><tr><th>#</th><th>Item</th><th>Seção</th><th class="n">Valor</th></tr></thead><tbody>${
        r.ondeEstaODinheiro.map((i, n) => `<tr><td>${n + 1}</td><td>${html(i.nome)}</td><td>${html(TITULO_DA_SECAO[i.secao])}</td><td class="n">${reais(i.valor)}</td></tr>`).join("")
      }</tbody></table>`
    : "";

  const secoes = ORDEM_DAS_SECOES.map((id) => secaoHtml(r, r.secoes[id], id)).join("");
  const avisos = r.avisos.length ? `<h2>Avisos</h2><ul class="av">${r.avisos.map((a) => `<li>${html(a.texto)}</li>`).join("")}</ul>` : "";

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${html(nomeDoArquivo(r))}</title>
<style>
@page { size: A4; margin: 12mm 10mm; }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9.5pt; margin: 0; }
.pagina { width: 100%; border-collapse: collapse; }
.pagina > thead td { padding-bottom: 6px; }
.cab { border-bottom: 2px solid #111; padding-bottom: 4px; font-size: 8.5pt; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cab b { font-size: 11pt; }
h2 { font-size: 11.5pt; margin: 14px 0 4px; padding: 3px 6px; background: #EEE; border-left: 4px solid #C92E09; break-after: avoid; }
h3 { font-size: 10pt; margin: 8px 0 3px; }
p.d { margin: 0 0 4px; color: #444; font-size: 8.5pt; }
table.t { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
table.t th, table.t td { border-bottom: 1px solid #DDD; padding: 2.5px 4px; text-align: left; vertical-align: top; }
table.t thead th { border-bottom: 1.5px solid #111; font-size: 8.5pt; }
table.t tr { break-inside: avoid; }
.n { text-align: right !important; white-space: nowrap; }
.neg { color: #B91C1C; }
.pos { color: #047857; }
tr.tot td { font-weight: bold; border-top: 1.5px solid #111; border-bottom: none; }
.falta { color: #92400E; font-style: italic; }
.ler { border: 1px solid #BFDBFE; background: #EFF6FF; border-radius: 6px; padding: 5px 8px; font-size: 8.5pt; color: #334155; break-inside: avoid; }
.ler ul { margin: 2px 0 0; padding-left: 16px; }
.av { margin: 0; padding-left: 16px; font-size: 8.5pt; color: #444; }
.botao { position: fixed; bottom: 14px; right: 14px; padding: 8px 14px; font-weight: bold; border: 0; border-radius: 8px; background: #C92E09; color: #fff; cursor: pointer; }
@media print { .botao { display: none; } }
</style></head><body>
<button class="botao" onclick="window.print()">Imprimir / salvar PDF</button>
<table class="pagina"><thead><tr><td>${cab}</td></tr></thead><tbody><tr><td>
${comoLer}${resumo}${top}${secoes}${avisos}
</td></tr></tbody></table>
</body></html>`;
}

function secaoHtml(r: RelatorioDosControlaveis, s: Secao, id: IdDaSecao): string {
  const dif = DIFERENCA.includes(id);
  const recorte = periodoDaSecao(r, id);
  const venda = recorte && r.contagem ? r.contagem.venda : r.venda;
  const p = (v: number) => pct(venda > 0 ? (v / venda) * 100 : null);
  let corpo = "";
  if (s.falta) corpo = `<p class="falta">${html(s.falta)}</p>`;
  else if (!s.linhas.length && !s.cancelados?.length) corpo = `<p class="d">Nada no período.</p>`;
  else {
    const linhas = (ls: LinhaDoRelatorio[]) => ls.map((l) => `<tr><td>${html(l.nome)}${l.classe ? ` <small>(${ROTULO_DA_CLASSE[l.classe]})</small>` : ""}</td><td class="n${dif && l.quantidade < 0 ? " neg" : ""}">${qtd(l.quantidade)} ${html(l.unidade)}</td><td class="n">${reais(l.custoUnitario)}</td><td class="n${l.total < 0 ? " neg" : dif && l.total > 0 ? " pos" : ""}">${l.semCusto ? "sem custo" : reais(l.total)}${dif && sumiuOuSobrou(l.total) ? ` <small>${sumiuOuSobrou(l.total)}</small>` : ""}</td><td class="n">${p(l.total)}</td></tr>`).join("");
    const cabecalho = `<thead><tr><th>Item</th><th class="n">${dif ? "Diferença" : "Qtde"}</th><th class="n">Custo unit.</th><th class="n">${dif ? "Diferença R$" : "Custo total"}</th><th class="n">% venda</th></tr></thead>`;
    if (id === "inventario") {
      const al = s.linhas.filter((l) => l.grupo !== "EMBALAGENS"), em = s.linhas.filter((l) => l.grupo === "EMBALAGENS");
      corpo = `<h3>Alimentos</h3><table class="t">${cabecalho}<tbody>${linhas(al)}<tr class="tot"><td>Diferença de alimentos</td><td></td><td></td><td class="n">${reais(s.grupos?.alimentos)}</td><td class="n">${p(s.grupos?.alimentos ?? 0)}</td></tr></tbody></table>` +
        `<h3>Embalagens</h3><table class="t">${cabecalho}<tbody>${linhas(em)}<tr class="tot"><td>Diferença de embalagens</td><td></td><td></td><td class="n">${reais(s.grupos?.embalagens)}</td><td class="n">${p(s.grupos?.embalagens ?? 0)}</td></tr></tbody></table>`;
    } else {
      corpo = `<table class="t">${cabecalho}<tbody>${linhas(s.linhas)}</tbody></table>`;
    }
    if (s.cancelados?.length) {
      corpo += `<h3>Pedidos cancelados depois de produzidos</h3><table class="t"><thead><tr><th>Pedido</th><th>Quando</th><th>Etapa</th><th>Motivo</th><th class="n">Custo</th></tr></thead><tbody>${
        s.cancelados.map((c) => `<tr><td>${html(c.numero)}</td><td>${quandoBr(c.quando)}</td><td>${html(c.etapa)}</td><td>${html(c.motivo || "—")}</td><td class="n">${c.valor == null ? "sem ficha" : reais(c.valor)}</td></tr>`).join("")
      }</tbody></table>`;
    }
  }
  return `<h2>${html(s.titulo)}</h2><p class="d">${html(s.descricao)}${recorte ? ` Vale para as ${recorte} (venda desses dias: ${reais(venda)}).` : ""}</p>${corpo}
<table class="t"><tbody><tr class="tot"><td>Total — ${html(s.titulo)}${s.semValor ? ` <small>(${s.semValor} sem valor, fora do total)</small>` : ""}</td><td class="n${s.total < 0 ? " neg" : ""}">${reais(s.total)}${dif && sumiuOuSobrou(s.total) ? ` <small>${sumiuOuSobrou(s.total)}</small>` : ""}</td><td class="n" style="width:80px">${pct(s.pct)}</td></tr></tbody></table>`;
}
