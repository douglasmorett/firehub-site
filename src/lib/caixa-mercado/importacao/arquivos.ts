/**
 * LER O QUE O MERCADO MANDA: CSV, XLSX e ZIP (de XMLs de nota) — sem
 * dependência nova. O projeto só tinha o lado de ESCREVER (lib/zip.ts,
 * lib/planilha-xlsx.ts); aqui é a leitura, com o zlib do Node.
 *
 * - `lerZip`: diretório central → entradas (stored ou deflate).
 * - `lerXlsx`: a PRIMEIRA aba, como linhas de texto (sharedStrings, string
 *   em linha, número, booleano). Data e fórmula saem como o valor gravado.
 * - `lerCsv`: separador detectado (; , ou tab), aspas, quebra dentro de aspas,
 *   BOM e Latin-1 (o Excel brasileiro salva CSV em Windows-1252).
 * - `lerPlanilha`: decide pelo conteúdo (PK = xlsx; senão CSV).
 *
 * Puro (Buffer e zlib, sem banco).
 */
import { inflateRawSync } from "node:zlib";

export type EntradaDoZip = { nome: string; dados: Buffer };

const LIMITE_DESCOMPACTADO = 200 * 1024 * 1024;

export function lerZip(buf: Buffer): EntradaDoZip[] {
  // O fim do diretório central (EOCD) está nos últimos 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Arquivo .zip inválido.");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entradas: EntradaDoZip[] = [];
  let somado = 0;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Diretório do .zip corrompido.");
    const metodo = buf.readUInt16LE(p + 10);
    const compactado = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + tamNome).toString("utf8");
    p += 46 + tamNome + tamExtra + tamComent;
    if (nome.endsWith("/")) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Entrada do .zip corrompida.");
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const bruto = buf.subarray(inicio, inicio + compactado);
    let dados: Buffer;
    if (metodo === 0) dados = Buffer.from(bruto);
    else if (metodo === 8) dados = inflateRawSync(bruto);
    else continue; // método que não conhecemos: pula a entrada
    somado += dados.length;
    if (somado > LIMITE_DESCOMPACTADO) throw new Error("O .zip é grande demais (mais de 200 MB descompactado).");
    entradas.push({ nome, dados });
  }
  return entradas;
}

const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** "AB12" → índice da coluna (0 = A). */
function indiceDaColuna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] || "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** O texto de um <si> ou <is>: todas as <t> juntas (o rich text vem picado em <r>). */
function textoDosT(xml: string): string {
  let s = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1];
  return desescapar(s);
}

export function lerXlsx(buf: Buffer): string[][] {
  const entradas = lerZip(buf);
  const achar = (nome: string) => entradas.find((e) => e.nome.toLowerCase() === nome.toLowerCase());
  const compartilhadas: string[] = [];
  const ss = achar("xl/sharedStrings.xml");
  if (ss) for (const m of ss.dados.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) compartilhadas.push(textoDosT(m[1]));
  // A primeira aba: a do workbook.xml, ou a sheet1.
  const aba = achar("xl/worksheets/sheet1.xml") || entradas.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.nome));
  if (!aba) throw new Error("A planilha não tem aba.");
  const xml = aba.dados.toString("utf8");
  const linhas: string[][] = [];
  for (const mLinha of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha: string[] = [];
    for (const mCel of mLinha[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = mCel[1];
      const corpo = mCel[2] || "";
      const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /\bt="([^"]+)"/.exec(atributos)?.[1] || "n";
      const col = ref ? indiceDaColuna(ref) : linha.length;
      let valor = "";
      if (tipo === "inlineStr") valor = textoDosT(/<is>([\s\S]*?)<\/is>/.exec(corpo)?.[1] || "");
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
        if (v != null) valor = tipo === "s" ? compartilhadas[Number(v)] ?? "" : desescapar(v);
      }
      while (linha.length < col) linha.push("");
      linha[col] = valor.trim();
    }
    linhas.push(linha);
  }
  return linhas;
}

/** UTF-8 se for válido; senão Windows-1252 (o "Salvar como CSV" do Excel no Brasil). */
export function textoDoArquivo(buf: Buffer): string {
  let s = buf.toString("utf8");
  if (s.includes("�")) s = buf.toString("latin1");
  return s.replace(/^﻿/, "");
}

export function lerCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] || "";
  const contagem = (c: string) => primeira.split(c).length - 1;
  const sep = [";", "\t", ","].sort((a, b) => contagem(b) - contagem(a))[0];
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { celula += '"'; i++; }
      else if (c === '"') aspas = false;
      else celula += c;
      continue;
    }
    if (c === '"') aspas = true;
    else if (c === sep) { linha.push(celula.trim()); celula = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(celula.trim()); celula = "";
      if (linha.some((x) => x !== "")) linhas.push(linha);
      linha = [];
    } else celula += c;
  }
  linha.push(celula.trim());
  if (linha.some((x) => x !== "")) linhas.push(linha);
  return linhas;
}

export function lerPlanilha(buf: Buffer): string[][] {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return lerXlsx(buf).filter((l) => l.some((x) => x !== ""));
  return lerCsv(textoDoArquivo(buf));
}
