/**
 * Planilha .xlsx de verdade, sem biblioteca — o "EXPORTAR EXCEL" dos relatórios.
 *
 * ── Por que não CSV ─────────────────────────────────────────────────────────
 *
 * O CSV do relatório abria numa coluna só no Excel em português (separador
 * vírgula) e não tinha como dizer "isto é dinheiro" nem "esta linha é filha
 * daquela". O lojista que usava a Saipos exporta para "brincar com os dados"
 * (vídeo oficial deles): precisa de número como NÚMERO, R$ formatado e a
 * árvore categoria → produto → opção que abre e fecha.
 *
 * Um .xlsx é um ZIP de XMLs (Office Open XML). O ZIP já existe em lib/zip.ts
 * (sem compressão — qualquer Excel, LibreOffice e Google Planilhas abre). Aqui
 * só se escreve o mínimo do formato: pasta de trabalho, estilos e as abas.
 *
 * ── O que dá para pedir ─────────────────────────────────────────────────────
 *
 * - Células de texto, número, dinheiro (R$), percentual e quantidade.
 * - Negrito, título, cabeçalho de tabela.
 * - `nivel` por linha: o agrupamento de linhas do Excel (os "+" à esquerda),
 *   com o resumo EM CIMA dos detalhes — a categoria acima dos produtos.
 * - Largura das colunas e linhas congeladas (o cabeçalho fica parado ao rolar).
 *
 * Só servidor (usa Buffer).
 */
import { montarZip } from "@/lib/zip";

export type EstiloDaCelula = "texto" | "negrito" | "titulo" | "cabecalho" | "reais" | "reaisNegrito" | "qtd" | "qtdNegrito" | "pct" | "pctNegrito" | "suave";

export type Celula =
  | string
  | number
  | null
  | undefined
  | { v: string | number | null | undefined; estilo?: EstiloDaCelula };

export type LinhaDaPlanilha = { celulas: Celula[]; nivel?: number; estilo?: EstiloDaCelula };

export type AbaDaPlanilha = {
  nome: string;
  linhas: Array<LinhaDaPlanilha | Celula[]>;
  /** Largura de cada coluna, em "caracteres" do Excel. */
  larguras?: number[];
  /** Quantas linhas do topo ficam congeladas. */
  congelarLinhas?: number;
};

// Índice de cada estilo no <cellXfs> de styles.xml, na ordem declarada lá.
const XF: Record<EstiloDaCelula, number> = {
  texto: 0, negrito: 1, titulo: 2, cabecalho: 3, reais: 4, reaisNegrito: 5,
  qtd: 6, qtdNegrito: 7, pct: 8, pctNegrito: 9, suave: 10,
};

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF57534E"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAF6F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE7DDD3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function escaparXml(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // Caracteres de controle não são XML válido (um "\u0008" colado de outro
    // sistema no nome do produto quebraria o arquivo inteiro).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** "A", "B", …, "Z", "AA"… */
function letraDaColuna(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** O nome de aba que o Excel aceita: até 31 caracteres, sem []:*?/\ e único. */
function nomeDeAba(nome: string, usados: Set<string>): string {
  let base = (nome || "Planilha").replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Planilha";
  let n = 2;
  let final = base;
  while (usados.has(final.toLowerCase())) { final = `${base.slice(0, 28)} ${n++}`; }
  usados.add(final.toLowerCase());
  return final;
}

function celulaXml(c: Celula, ref: string, estiloDaLinha?: EstiloDaCelula): string {
  const bruto = c !== null && typeof c === "object" ? c : { v: c as string | number | null | undefined, estilo: undefined };
  const v = bruto.v;
  const estilo = bruto.estilo ?? estiloDaLinha ?? (typeof v === "number" ? "qtd" : "texto");
  const s = XF[estilo] ?? 0;
  if (v === null || v === undefined || v === "") return s ? `<c r="${ref}" s="${s}"/>` : "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(String(v))}</t></is></c>`;
}

function abaXml(aba: AbaDaPlanilha): string {
  const linhas = aba.linhas.map((l) => (Array.isArray(l) ? { celulas: l } : l)) as LinhaDaPlanilha[];
  const maxNivel = Math.min(7, Math.max(0, ...linhas.map((l) => l.nivel || 0)));
  const partes: string[] = [];
  partes.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`);
  partes.push(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`);
  // Resumo ACIMA dos detalhes: a categoria fica na linha de cima dos produtos.
  partes.push(`<sheetPr><outlinePr summaryBelow="0"/></sheetPr>`);
  if (aba.congelarLinhas && aba.congelarLinhas > 0) {
    const n = aba.congelarLinhas;
    partes.push(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${n + 1}" sqref="A${n + 1}"/></sheetView></sheetViews>`);
  } else {
    partes.push(`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`);
  }
  partes.push(`<sheetFormatPr defaultRowHeight="15"${maxNivel ? ` outlineLevelRow="${maxNivel}"` : ""}/>`);
  if (aba.larguras?.length) {
    partes.push(`<cols>${aba.larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(120, w))}" customWidth="1"/>`).join("")}</cols>`);
  }
  partes.push(`<sheetData>`);
  linhas.forEach((linha, i) => {
    const r = i + 1;
    const nivel = Math.min(7, Math.max(0, linha.nivel || 0));
    const celulas = linha.celulas.map((c, j) => celulaXml(c, `${letraDaColuna(j)}${r}`, linha.estilo)).join("");
    partes.push(`<row r="${r}"${nivel ? ` outlineLevel="${nivel}"` : ""}>${celulas}</row>`);
  });
  partes.push(`</sheetData>`);
  partes.push(`</worksheet>`);
  return partes.join("");
}

/** Monta o arquivo .xlsx. */
export function montarPlanilha(abas: AbaDaPlanilha[]): Buffer {
  const usados = new Set<string>();
  const nomes = abas.map((a) => nomeDeAba(a.nome, usados));
  const arquivos = [
    {
      nome: "[Content_Types].xml",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${nomes.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      nome: "_rels/.rels",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nome: "xl/workbook.xml",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nomes.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nome: "xl/styles.xml", conteudo: ESTILOS_XML },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: abaXml(a) })),
  ];
  return montarZip(arquivos);
}

/** A resposta HTTP de download de uma planilha. */
export function respostaDePlanilha(buffer: Buffer, nomeDoArquivo: string): Response {
  const nome = nomeDoArquivo.replace(/[^\w.\-]+/g, "_");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
