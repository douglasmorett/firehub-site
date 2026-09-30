/**
 * DANFE NFC-e do emissor próprio: o cupom fiscal em HTML e na bobina.
 *
 *   npx tsx scripts/teste-nfce-danfe.ts
 *   DANFE_EXEMPLOS=<pasta> npx tsx scripts/teste-nfce-danfe.ts   (grava os exemplos .html/.txt ali)
 *
 * As notas passam pelo caminho de produção inteiro, sem rede e sem banco:
 *   montarCorpoDaNfce → XML → assinatura → QR → (SEFAZ falsa ou protocolo de
 *   teste) → nfeProc → dadosDoDanfe → danfeHtml / danfeEmTexto
 * e os XML montados aqui para o teste (nfeProc com protocolo) são validados
 * contra o XSD oficial (procNFe_v4.00.xsd), para o DANFE ser testado em cima
 * de nota com a forma de verdade.
 *
 * Casos: balcão (SEFAZ falsa), entrega com consumidor identificado (produção),
 * pagamento dividido com troco, homologação, contingência pendente (duas vias)
 * e contingência já autorizada, autorização com alerta (cStat 120), CNPJ do
 * consumidor, textos longos — e o que NÃO pode virar DANFE (sem protocolo,
 * denegada, protocolo de outra chave, XML mexido depois de autorizado, modelo
 * 55, sem QR).
 *
 * Confere: todas as mensagens obrigatórias do Manual do DANFE NFC-e 6.0, a
 * ordem das divisões, a chave em blocos, o QR igual ao do XML (no SVG, na
 * bobina e nos bytes ESC/POS do Assistente — no perfil "legacy", a IMAGEM do
 * QR lida de volta módulo a módulo), as linhas cabendo em 32/42/48 colunas, o
 * link público (token válido/inválido), o trabalho da fila, a entrega do DANFE
 * pela CAPACIDADE que o Assistente anuncia (`&danfe=1`), a integridade do
 * server.js e o cofre.
 *
 * O Assistente é testado pelo código que vai para a loja: as funções do
 * DANFE são RECORTADAS do firehub-print-assistant/server.js (como
 * scripts/teste-fiscal-comprovante.ts), sem subir servidor.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";

// Chave fiscal e cofre DE TESTE antes de qualquer uso (lidos na hora da chamada).
process.env.FISCAL_CHAVE = "chave-fiscal-de-teste-do-danfe";
const COFRE = join(tmpdir(), `firehub-danfe-cofre-${process.pid}`);
process.env.FH_FISCAL_DIR = COFRE;

import { montarCorpoDaNfce, type ItemDaNota, type PedidoParaNota } from "../src/lib/fiscal-emissao";
import { digestValueDoXml } from "../src/lib/nfce/assinatura";
import { guardarArquivoFiscal } from "../src/lib/nfce/armazenamento";
import {
  CSP_DO_DANFE,
  ErroDoDanfe,
  TEXTOS_DO_DANFE,
  dadosDoDanfe,
  danfeEmTexto,
  danfeHtml,
  dataHoraLocal,
  moduloDoQr,
  paraOPapel,
  qrEmSvg,
  reais,
  viasDoDanfe,
  type DadosDoDanfe,
  type LinhaDoDanfe,
} from "../src/lib/nfce/danfe";
import { danfeDoPedido, notaDoEmissorProprio } from "../src/lib/nfce/danfe-do-pedido";
import { emitirNfceNaSefaz, prepararNotaAssinada, type ContextoDoEmissor } from "../src/lib/nfce/emissor";
import { lerTokenDoDanfe, linkPublicoDoDanfe, seloDoDanfe, tokenConfere, tokenDoDanfe } from "../src/lib/nfce/link-do-danfe";
import { montarNfeProc } from "../src/lib/nfce/sefaz";
import { KIND_DO_TRABALHO, largurasDasImpressoras, trabalhoDoDanfe } from "../src/lib/nfce/trabalho-do-danfe";
import { lerXml, primeiro } from "../src/lib/nfce/xml";
import { PARAMETRO_DO_DANFE, VERSAO_ASSISTENTE_COM_DANFE, assistenteImprimeDanfe } from "../src/lib/print";
import { CONFIG_NIK, CPF, RAIZ, certificadoDeTeste, confere, responder, sefazFalsa, terminar, validarNoXsd, verdade } from "./nfce-teste-apoio";

const AGORA = new Date("2026-09-29T15:00:00Z"); // 12:00 em Brasília
const cert = certificadoDeTeste();
const CTX: Omit<ContextoDoEmissor, "certificado" | "numero"> = {
  uf: "DF",
  ambiente: 2,
  serie: 1,
  qrCode: { versao: 2, idCsc: "000001", csc: "0123456789ABCDEF0123456789ABCDEF" },
  emitente: { telefone: "(61) 3333-4444", complemento: "Loja 2" },
};
const T = TEXTOS_DO_DANFE;
const LARGURAS = [32, 42, 48];

// ─── Notas ───────────────────────────────────────────────────────────────────

const item = (descricao: string, valorUnitario: number, quantidade = 1, extra: Partial<ItemDaNota> = {}): ItemDaNota => ({
  codigo: descricao.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  descricao,
  ncm: "21069090",
  cfop: "5102",
  unidadeComercial: "UN",
  quantidade,
  valorUnitario,
  valorTotal: Number((valorUnitario * quantidade).toFixed(2)),
  origem: 0,
  csosn: "102",
  ...extra,
});
const pedido = (x: Partial<PedidoParaNota>): PedidoParaNota => ({
  id: "p1",
  numero: 42,
  itens: [item("Esfiha de carne", 3.9, 4)],
  valorTotal: 15.6,
  formaDePagamento: "Dinheiro",
  ...x,
});

let numero = 700;
function corpoDe(p: PedidoParaNota, ambiente: 1 | 2) {
  const m = montarCorpoDaNfce(p, { ...CONFIG_NIK, ambiente }, AGORA);
  if (!m.ok) throw new Error(`corpo não montou: ${JSON.stringify(m.pendencias)}`);
  return m.corpo;
}

/** Monta e assina (normal ou contingência), sem transmitir. */
function assinar(p: PedidoParaNota, opcoes: { ambiente?: 1 | 2; tipoDeEmissao?: 1 | 9 } = {}) {
  const ambiente = opcoes.ambiente ?? 2;
  const tipo = opcoes.tipoDeEmissao ?? 1;
  const r = prepararNotaAssinada(corpoDe(p, ambiente), { ...CTX, ambiente, numero: ++numero }, cert, {
    tipoDeEmissao: tipo,
    agora: AGORA,
    ...(tipo === 9 ? { contingencia: { entradaEm: AGORA, justificativa: "SEFAZ sem resposta na autorizacao (teste)" } } : {}),
  });
  if (!r.ok) throw new Error(`XML não montou: ${JSON.stringify(r.pendencias)}`);
  return r.nota;
}

/**
 * O protNFe de teste, no leiaute do retorno da SVRS (fixture autorizacao-100.xml).
 * `alertas`: os pares cMsg/xMsg da autorização com alerta (NT 2026.002, cStat 120 — até cinco).
 */
function protocolo(
  xmlAssinado: string,
  chave: string,
  ambiente: 1 | 2,
  extra: { cStat?: string; xMotivo?: string; digVal?: string; chNFe?: string; xMsg?: string; alertas?: Array<{ cMsg: string; xMsg: string }> } = {}
) {
  return (
    `<protNFe versao="4.00"><infProt Id="ID353260000000123"><tpAmb>${ambiente}</tpAmb><verAplic>SVRS202509251449</verAplic>` +
    `<chNFe>${extra.chNFe ?? chave}</chNFe><dhRecbto>2026-09-29T12:00:05-03:00</dhRecbto><nProt>353260000000123</nProt>` +
    `<digVal>${extra.digVal ?? digestValueDoXml(xmlAssinado)}</digVal><cStat>${extra.cStat ?? "100"}</cStat>` +
    `<xMotivo>${extra.xMotivo ?? "Autorizado o uso da NF-e"}</xMotivo>` +
    (extra.xMsg ? `<cMsg>1</cMsg><xMsg>${extra.xMsg}</xMsg>` : "") +
    (extra.alertas ?? []).map((a) => `<cMsg>${a.cMsg}</cMsg><xMsg>${a.xMsg}</xMsg>`).join("") +
    `</infProt></protNFe>`
  );
}
const autorizar = (nota: { xml: string; chave: string }, ambiente: 1 | 2, extra: Parameters<typeof protocolo>[3] = {}) =>
  montarNfeProc(nota.xml, protocolo(nota.xml, nota.chave, ambiente, extra));

const qrDoXml = (xml: string) => primeiro(lerXml(xml), "qrCode")?.textContent ?? "";

// ─── Leitura dos bytes ESC/POS (o que a térmica recebe) ────────────────────

/** Onde o QR saiu (comando ou imagem) e onde o papel foi cortado, no meio das linhas lidas de volta. */
const MARCA_DO_QR = "[[QR]]";
const MARCA_DA_IMAGEM = "[[IMAGEM]]";
const MARCA_DO_CORTE = "[[CORTE]]";
/** As linhas de TEXTO do papel (sem as em branco e sem as marcas). */
const soTexto = (linhas: string[]) => linhas.filter((l) => l !== "" && l !== MARCA_DO_QR && l !== MARCA_DA_IMAGEM && l !== MARCA_DO_CORTE);

/** Uma imagem raster (GS v 0), com as faixas seguidas juntas: `linhas[y]` = os bytes da linha de pontos y. */
type ImagemDoPapel = { porLinha: number; linhas: Buffer[] };
type Papel = { linhas: string[]; qrs: Array<{ dados: string; modulo: number }>; imagens: ImagemDoPapel[]; cortes: number };
function lerEscPos(buf: Buffer): Papel {
  const linhas: string[] = [];
  const qrs: Papel["qrs"] = [];
  const imagens: ImagemDoPapel[] = [];
  let emImagem = false;
  let atual = "";
  let modulo = 0;
  let cortes = 0;
  for (let i = 0; i < buf.length; ) {
    const c = buf[i];
    if (c === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      // GS v 0 m xL xH yL yH d1...dk: uma faixa de imagem raster. Faixas
      // seguidas (sem nada entre elas) são a mesma imagem.
      const porLinha = buf[i + 4] + buf[i + 5] * 256;
      const altura = buf[i + 6] + buf[i + 7] * 256;
      const inicio = i + 8;
      if (!emImagem) {
        imagens.push({ porLinha, linhas: [] });
        atual += MARCA_DA_IMAGEM;
      }
      for (let y = 0; y < altura; y++) imagens[imagens.length - 1].linhas.push(buf.subarray(inicio + y * porLinha, inicio + (y + 1) * porLinha));
      emImagem = true;
      i = inicio + porLinha * altura;
      continue;
    }
    emImagem = false;
    if (c === 0x1b) {
      i += buf[i + 1] === 0x40 || buf[i + 1] === 0x32 ? 2 : 3; // ESC @ / ESC 2; o resto tem 1 parâmetro
      continue;
    }
    if (c === 0x1d) {
      const cmd = buf[i + 1];
      if (cmd === 0x28 && buf[i + 2] === 0x6b) {
        // GS ( k pL pH cn fn [parâmetros]
        const tam = buf[i + 3] + buf[i + 4] * 256;
        const fn = buf[i + 6];
        if (fn === 0x43) modulo = buf[i + 7];
        if (fn === 0x50) {
          qrs.push({ dados: buf.subarray(i + 8, i + 5 + tam).toString("latin1"), modulo });
          atual += MARCA_DO_QR;
        }
        i += 5 + tam;
        continue;
      }
      if (cmd === 0x56) {
        cortes++;
        if (atual) linhas.push(atual);
        atual = "";
        linhas.push(MARCA_DO_CORTE);
      }
      i += cmd === 0x4c || cmd === 0x57 ? 4 : 3; // GS L / GS W têm 2 parâmetros
      continue;
    }
    if (c === 0x0a) {
      linhas.push(atual);
      atual = "";
      i++;
      continue;
    }
    atual += String.fromCharCode(c);
    i++;
  }
  if (atual) linhas.push(atual);
  return { linhas, qrs, imagens, cortes };
}

/**
 * A matriz de módulos da imagem do QR, lida de volta dos pontos: a caixa dos
 * pontos pretos é o QR (o canto de cima à esquerda é sempre preto — o
 * localizador) e cada módulo é lido no centro dele.
 */
function matrizDaImagem(img: ImagemDoPapel, modulo: number): boolean[][] {
  const preto = (x: number, y: number) => ((img.linhas[y][x >> 3] >> (7 - (x & 7))) & 1) === 1;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.linhas.length; y++) {
    for (let x = 0; x < img.porLinha * 8; x++) {
      if (!preto(x, y)) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  const n = Math.round((x1 - x0 + 1) / modulo);
  return Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => preto(x0 + c * modulo + (modulo >> 1), y0 + l * modulo + (modulo >> 1))));
}

/** A matriz do QR (nível M, conteúdo em bytes UTF-8) pelo pacote `qrcode` do site — a referência. */
function matrizDeReferencia(conteudo: string): boolean[][] {
  const q = QRCode.create([{ data: Buffer.from(conteudo, "utf8"), mode: "byte" }], { errorCorrectionLevel: "M" }).modules;
  return Array.from({ length: q.size }, (_, l) => Array.from({ length: q.size }, (_, c) => Boolean(q.get(l, c))));
}

// ─── O Assistente: as funções do DANFE recortadas do server.js ─────────────

const fonteDoAssistente = readFileSync(join(RAIZ, "firehub-print-assistant", "server.js"), "utf8").replace(/\r\n/g, "\n");
function recortar(nome: string): string {
  const inicio = fonteDoAssistente.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`não achei function ${nome} em server.js`);
  let nivel = 0;
  let i = fonteDoAssistente.indexOf("{", inicio);
  for (; i < fonteDoAssistente.length; i++) {
    if (fonteDoAssistente[i] === "{") nivel++;
    else if (fonteDoAssistente[i] === "}") {
      nivel--;
      if (nivel === 0) break;
    }
  }
  return fonteDoAssistente.slice(inicio, i + 1);
}
// O gerador de QR do Assistente (arquivo local dele, que o server.js carrega com require).
const qrDoAssistente = require(join(RAIZ, "firehub-print-assistant", "qr-code.js")) as { matrizDoQrCode: (texto: string) => unknown };
const assistente = new Function(
  "matrizDoQrCode",
  `${["cleanAscii", "ehTrabalhoDeDanfe", "escolherVarianteDoDanfe", "buildDanfeEscPos"].map(recortar).join("\n\n")}\n` +
    `return { buildDanfeEscPos, escolherVarianteDoDanfe, ehTrabalhoDeDanfe };`
)(qrDoAssistente.matrizDoQrCode) as {
  buildDanfeEscPos: (danfe: unknown, colunas: number, perfil: string) => Buffer | null;
  escolherVarianteDoDanfe: (porColunas: unknown, colunas: number) => any;
  ehTrabalhoDeDanfe: (order: unknown) => boolean;
};
/** O que o Assistente manda na consulta da fila (parametrosDeEstado), com o resto do server.js de mentira. */
const parametrosDoAssistente = new Function(
  "listarPendentes",
  "cacheDeImpressoras",
  "VERSAO_ASSISTENTE",
  "INICIADO_EM",
  "portaAtiva",
  `${recortar("parametrosDeEstado")}\nreturn parametrosDeEstado();`
) as (...args: unknown[]) => string;

// ─── Conferências comuns a toda nota ───────────────────────────────────────

const conta = (texto: string, trecho: string) => texto.split(trecho).length - 1;
const ordemDasDivisoes = (html: string, qual = 0) => {
  const main = html.split("<main")[qual + 1] ?? "";
  return [...main.matchAll(/data-div="([IVX]+)"/g)].map((m) => m[1]);
};
const textoDasLinhas = (linhas: Array<LinhaDoDanfe | { qr: true }>) =>
  linhas.filter((l): l is LinhaDoDanfe => !("qr" in l)).map((l) => l.texto);

function conferirNota(nome: string, xml: string, d: DadosDoDanfe) {
  const html = danfeHtml(d, { largura: 80 });

  // Divisões na ordem da figura 1B (QR centralizado); VIII e IX só quando têm conteúdo.
  const temVIII = d.pendenteDeAutorizacao || d.emitidaEmContingencia || d.homologacao || d.mensagensFiscais.length > 0;
  const esperada = ["I", "II", "III", "IV", "VI", "VII", ...(temVIII ? ["VIII"] : []), "V", ...(d.tributos.valor || d.informacoesComplementares ? ["IX"] : [])];
  confere(`${nome}: divisões na ordem do Manual (figura 1B)`, ordemDasDivisoes(html), esperada);

  // I — cabeçalho
  verdade(`${nome}: I — CNPJ formatado, razão social, endereço e o texto do cabeçalho`,
    html.includes("CNPJ: 64.568.087/0001-80") && html.includes("NIK COMERCIO DE ALIMENTOS LTDA") && html.includes("QS 1 Rua 210") && html.includes(T.titulo));

  // II — todo item com código, descrição, quantidade, unidade, unitário e total (nunca o resumido)
  const doc = lerXml(xml);
  const dets = Array.from((doc as any).getElementsByTagName("det")) as Element[];
  confere(`${nome}: II — um item do DANFE por <det>`, d.itens.length, dets.length);
  const itensOk = d.itens.every((it, i) => {
    const prod = primeiro(dets[i], "prod")!;
    const t = (n: string) => primeiro(prod, n)?.textContent ?? "";
    return it.codigo === t("cProd") && it.descricao === t("xProd") && it.unidade === t("uCom") && it.valorTotalEmCentavos === Math.round(Number(t("vProd")) * 100);
  });
  verdade(`${nome}: II — cProd, xProd, uCom e vProd iguais aos do XML`, itensOk);
  const texto48 = textoDasLinhas(danfeEmTexto(d, 48).linhas).join("\n");
  verdade(`${nome}: II — toda descrição está no papel (DANFE completo, nunca o resumido)`,
    d.itens.every((it) => html.includes(esc(it.descricao)) && texto48.replace(/\s+/g, " ").includes(paraOPapel(it.descricao))));

  // III — totais
  const tot = primeiro(doc, "ICMSTot")!;
  const v = (n: string) => Math.round(Number(primeiro(tot, n)?.textContent ?? "0") * 100);
  confere(`${nome}: III — valor total, desconto e valor a pagar do XML`,
    [d.totais.valorTotalEmCentavos, d.totais.descontoEmCentavos, d.totais.valorAPagarEmCentavos, d.totais.quantidadeDeItens],
    [v("vProd"), v("vDesc"), v("vNF"), dets.length]);
  verdade(`${nome}: III — "Qtde. total de itens", "Valor total R$", "FORMA PAGAMENTO" e "VALOR PAGO R$"`,
    ["Qtde. total de itens", "Valor total R$", "FORMA PAGAMENTO", "VALOR PAGO R$"].every((s) => html.includes(s) && texto48.includes(s)));
  const temAjuste = Boolean(d.totais.desconto || d.totais.acrescimos);
  confere(`${nome}: III — "Valor a Pagar R$" só com desconto ou acréscimo`, html.includes("Valor a Pagar R$"), temAjuste);

  // IV — consulta pela chave: texto, urlChave do XML e 11 blocos de 4
  const urlChave = primeiro(doc, "urlChave")?.textContent ?? "";
  verdade(`${nome}: IV — "Consulte pela Chave de Acesso em" + urlChave do XML`, html.includes(T.consulte) && html.replace(/<wbr>/g, "").includes(esc(urlChave)) && d.consulta.url === urlChave);
  confere(`${nome}: IV — chave em 11 blocos de 4 que remontam a chave`, [d.chaveEmBlocos.length, d.chaveEmBlocos.every((b) => b.length === 4), d.chaveEmBlocos.join("")], [11, true, d.chave]);
  verdade(`${nome}: IV — blocos separados por espaço no HTML (6 + 5, sem quebra dentro das metades)`,
    html.replace(/<[^>]+>/g, "").includes(d.chaveEmBlocos.join(" ")) && html.includes(`<span class="nw">${d.chaveEmBlocos.slice(0, 6).join(" ")}</span>`));

  // VI — consumidor
  verdade(`${nome}: VI — consumidor identificado ou "CONSUMIDOR NÃO IDENTIFICADO"`,
    d.consumidor.identificado ? html.includes(esc(d.consumidor.titulo)) && !html.includes(T.naoIdentificado) : html.includes(T.naoIdentificado));

  // VII — número (9), série (3), emissão no fuso da loja, protocolo e data de autorização
  verdade(`${nome}: VII — "NFC-e nº ${d.numeroFormatado}" e "Série ${d.serieFormatada}"`,
    html.includes(`NFC-e nº ${d.numeroFormatado}`) && html.includes(`Série ${d.serieFormatada}`) && d.numeroFormatado.length === 9 && d.serieFormatada.length === 3);
  confere(`${nome}: VII — emissão no horário de Brasília`, d.emitidaEm, "29/09/2026 12:00:00");
  if (d.protocolo) {
    verdade(`${nome}: VII — protocolo e data de autorização`, html.includes(T.protocolo) && html.includes("353260000000123") && html.includes(T.dataDeAutorizacao) && html.includes("29/09/2026 12:00:05"));
  } else {
    verdade(`${nome}: VII — contingência: protocolo SUPRIMIDO`, !html.includes(T.protocolo) && !html.includes(T.dataDeAutorizacao));
  }

  // VIII — mensagens fiscais obrigatórias
  confere(`${nome}: VIII — "${T.homologacao}" ${d.homologacao ? "presente" : "ausente"} (tpAmb ${d.ambiente})`, html.includes(T.homologacao), d.homologacao);
  confere(`${nome}: VIII — "${T.contingencia}" + "${T.pendente}" nos dois lugares (${d.pendenteDeAutorizacao ? "2x" : "0x"})`,
    [conta(html, T.contingencia), conta(html, T.pendente)], d.pendenteDeAutorizacao ? [2, 2] : [0, 0]);
  // Toda nota tpEmis 9 imprime a entrada em contingência (dhCont, com segundos) —
  // Portaria SEEC-DF 387/2019, art. 6º, §1º, I, "b". Na VIII, no HTML e na bobina.
  const desde = `${T.contingenciaDesde} 29/09/2026 12:00:00`;
  const viii = html.split('data-div="VIII"')[1]?.split("</section>")[0] ?? "";
  confere(`${nome}: VIII — "${desde}" ${d.emitidaEmContingencia ? "presente" : "ausente"} (tpEmis ${d.tipoDeEmissao})`,
    [viii.replace(/<[^>]+>/g, "").includes(desde), textoDasLinhas(danfeEmTexto(d, 48).linhas).some((l) => l.includes(paraOPapel(desde)))],
    d.emitidaEmContingencia ? [true, true] : [false, false]);
  // Cada xMsg do protocolo (o alerta do cStat 120) na VIII, no HTML e na bobina.
  for (const m of d.mensagensFiscais) {
    verdade(`${nome}: VIII — mensagem fiscal "${m.slice(0, 40)}" no HTML e na bobina`,
      viii.includes(esc(m)) && textoDasLinhas(danfeEmTexto(d, 48).linhas).join(" ").replace(/\s+/g, " ").includes(paraOPapel(m)));
  }

  // V — QR Code: o do XML, desenhado inteiro
  confere(`${nome}: V — QR do DANFE = qrCode do XML`, d.qrCode, qrDoXml(xml));
  verdade(`${nome}: V — o SVG do HTML é o QR do conteúdo do XML`, html.includes(qrEmSvg(qrDoXml(xml))));
  verdade(`${nome}: V — tocar no QR abre a consulta (href = qrCode)`, html.includes(`href="${esc(d.qrCode)}"`));

  // IX / depois do IX — tributos
  if (d.tributos.valor) verdade(`${nome}: IX — tributos com o valor do XML`, html.includes(`${T.tributos} R$ ${d.tributos.valor}`));
  else verdade(`${nome}: tributos sem vTotTrib — "não informados" DEPOIS do IX, sem número`, html.includes(`data-extra="tributos"`) && html.includes(T.tributosNaoInformados) && !html.includes(`${T.tributos} R$`));

  // Papel térmico: 32, 42 e 48 colunas
  for (const colunas of [...LARGURAS, 24, 64]) {
    for (const via of viasDoDanfe(d)) {
      const t = danfeEmTexto(d, colunas, { via });
      const linhas = textoDasLinhas(t.linhas);
      const larga = linhas.find((l) => l.length > colunas);
      const foraDoAscii = linhas.find((l) => /[^\x20-\x7e]/.test(l));
      if (larga || foraDoAscii || t.linhas.filter((l) => "qr" in l).length !== 1) {
        verdade(`${nome}: bobina de ${colunas} colunas${via ? ` (${via})` : ""}`, false, larga ? `linha com ${larga.length}: "${larga}"` : foraDoAscii ? `fora do ASCII: "${foraDoAscii}"` : "QR não aparece uma vez só");
      }
    }
  }
  verdade(`${nome}: bobina — toda linha cabe em 24/32/42/48/64 colunas, em ASCII, com um QR só`, true);
  for (const colunas of [32, 48]) {
    const t = danfeEmTexto(d, colunas);
    const linhas = textoDasLinhas(t.linhas);
    const chaveNoPapel = linhas.filter((l) => /^\s*(\d{4} ?){5,6}$/.test(l)).map((l) => l.replace(/\s/g, "")).join("");
    confere(`${nome}: bobina ${colunas} — a chave em blocos de 4 remonta a chave`, chaveNoPapel.slice(0, 44), d.chave);
    const i = (s: string) => linhas.findIndex((l) => l.includes(s));
    const iQr = t.linhas.findIndex((l) => "qr" in l);
    verdade(`${nome}: bobina ${colunas} — ordem: consulta, consumidor, NFC-e nº, QR`,
      i(paraOPapel(T.consulte)) < i("CONSUMIDOR") && i("CONSUMIDOR") < i("NFC-e n.") && i("NFC-e n.") < iQr);
    const minimo = QRCode.create(d.qrCode, { errorCorrectionLevel: "M" }).modules.size;
    const maximo = QRCode.create([{ data: Buffer.from(d.qrCode), mode: "byte" }], { errorCorrectionLevel: "M" }).modules.size;
    verdade(`${nome}: bobina ${colunas} — QR com ≥ 22 mm e cabendo na largura (módulo ${t.qr.modulo})`,
      t.qr.modulo * minimo >= 176 && t.qr.modulo * maximo <= colunas * 12 - 48 && t.qr.conteudo === qrDoXml(xml),
      `módulo ${t.qr.modulo}, versões ${minimo}/${maximo}`);
  }
  return html;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Do path do SVG de volta para a matriz — prova que o desenho é o QR, módulo a módulo. */
function matrizDoSvg(svg: string): number[][] {
  const total = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1]);
  const n = total - 8;
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (const [, x, y, w] of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let k = 0; k < Number(w); k++) m[Number(y) - 4][Number(x) - 4 + k] = 1;
  }
  return m;
}

// ─── Exemplos para abrir no navegador ────────────────────────────────────────

const EXEMPLOS = process.env.DANFE_EXEMPLOS || join(tmpdir(), "firehub-danfe-exemplos");
function gravarExemplo(nome: string, conteudo: string) {
  mkdirSync(EXEMPLOS, { recursive: true });
  writeFileSync(join(EXEMPLOS, nome), conteudo, "utf8");
  return join(EXEMPLOS, nome);
}
/**
 * O papel como sai da térmica — os bytes do Assistente lidos de volta —, para
 * ver o 58/80 mm sem impressora. Cada corte fecha um cupom (as vias da
 * contingência saem uma embaixo da outra).
 */
function papelEmTexto(buf: Buffer, colunas: number): string {
  const p = lerEscPos(buf);
  const moldura = "+" + "-".repeat(colunas) + "+";
  const centro = (r: string) => " ".repeat(Math.max(0, Math.floor((colunas - r.length) / 2))) + r;
  const rotuloDoQr = (q: { modulo: number }) => centro(`[ QR CODE - modulo ${q.modulo} ]`);
  let n = 0;
  let k = 0;
  // Um bloco emoldurado por cupom (cada corte fecha um).
  const cupons: string[][] = [[]];
  for (const l of p.linhas) {
    if (l === MARCA_DO_CORTE) cupons.push([]);
    else if (l === MARCA_DA_IMAGEM) {
      const img = p.imagens[k++];
      cupons[cupons.length - 1].push(`|${centro(`[ QR imagem ${img ? `${img.porLinha * 8}x${img.linhas.length}` : "?"} ]`).padEnd(colunas)}|`);
    } else cupons[cupons.length - 1].push(`|${(l === MARCA_DO_QR ? rotuloDoQr(p.qrs[n++] ?? { modulo: 0 }) : l).padEnd(colunas)}|`);
  }
  const blocos = cupons.filter((c) => c.length).map((c) => [moldura, ...c, moldura].join("\n"));
  return blocos.join("\n\n  - - - - corte do papel - - - -\n\n") + `\n\nConteúdo do QR:\n${p.qrs.map((q) => `  ${q.dados}`).join("\n")}\nCortes de papel: ${p.cortes}\n`;
}

// ─── Os casos ────────────────────────────────────────────────────────────────

async function principal() {
  const exemplos: string[] = [];

  // 1. Balcão, dinheiro com troco — autorizada pela SEFAZ falsa (homologação)
  console.log("\n— 1. Balcão em dinheiro com troco (SEFAZ falsa, homologação) —");
  const balcao = pedido({ canal: "PDV", itens: [item("Esfiha de carne", 3.9, 4), item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405" })], valorTotal: 22, trocoPara: 50 });
  const { transporte } = sefazFalsa((p) => responder("autorizacao-100.xml", p));
  const emitida = await emitirNfceNaSefaz(corpoDe(balcao, 2), { ...CTX, certificado: cert, numero: ++numero, transporte, agora: () => AGORA, esperar: async () => {} });
  if (!emitida.ok || !emitida.xml) throw new Error(`balcão não autorizou: ${JSON.stringify(emitida)}`);
  const xmlBalcao = emitida.xml;
  const dBalcao = dadosDoDanfe(xmlBalcao);
  confere("balcão: chave, número e série do resultado da emissão", [dBalcao.chave, dBalcao.numero, dBalcao.serie], [emitida.chaveDeAcesso, emitida.numero, emitida.serie]);
  confere("balcão: dinheiro 50,00, troco 28,00, total 22,00", [dBalcao.pagamentos.map((p) => [p.descricao, p.valor]), dBalcao.troco, dBalcao.totais.valorAPagar], [[["Dinheiro", "50,00"]], "28,00", "22,00"]);
  confere("balcão: consumidor não identificado", [dBalcao.consumidor.identificado, dBalcao.consumidor.titulo], [false, T.naoIdentificado]);
  confere("balcão: autorizada (protocolo), não é contingência, homologação", [Boolean(dBalcao.protocolo), dBalcao.pendenteDeAutorizacao, dBalcao.homologacao], [true, false, true]);
  const htmlBalcao = conferirNota("balcão", xmlBalcao, dBalcao);
  verdade("balcão: o nome fantasia (xFant) encabeça o cupom", htmlBalcao.includes(">Nik Esfiharia<"));

  // 2. Entrega com consumidor identificado — PRODUÇÃO (nome e endereço reais)
  console.log("\n— 2. Entrega com CPF, nome e endereço (produção), desconto e taxa —");
  const entrega = pedido({
    canal: "SITE",
    itens: [item("Pizza grande calabresa", 59.9), item("Refrigerante 2L", 12, 1, { csosn: "500", cfop: "5405" })],
    taxaEntrega: 5,
    desconto: 7.9,
    valorTotal: 69,
    formaDePagamento: "PIX_ENTREGA",
    documentoDoCliente: "529.982.247-25",
    nomeDoCliente: "Maria Souza",
    entregaEmDomicilio: true,
    enderecoDoCliente: "QS 7 Rua 800, 12 - Areal (Casa 3)",
  });
  const notaEntrega = assinar(entrega, { ambiente: 1 });
  const xmlEntrega = autorizar(notaEntrega, 1);
  const dEntrega = dadosDoDanfe(xmlEntrega);
  confere("entrega: CONSUMIDOR CPF formatado, nome e endereço", [dEntrega.consumidor.titulo, dEntrega.consumidor.nome, /QS 7 Rua 800/.test(dEntrega.consumidor.endereco ?? "")], [`CONSUMIDOR CPF: 529.982.247-25`, "Maria Souza", true]);
  confere("entrega: desconto 7,90, taxa como 'Outras despesas' 5,00, a pagar 69,00", [dEntrega.totais.desconto, dEntrega.totais.acrescimos, dEntrega.totais.valorAPagar], ["7,90", { rotulo: "Outras despesas", valor: "5,00", valorEmCentavos: 500 }, "69,00"]);
  confere("entrega: produção — sem homologação, QR de produção", [dEntrega.homologacao, dEntrega.qrCode.includes("|2|1|1|")], [false, true]);
  const htmlEntrega = conferirNota("entrega", xmlEntrega, dEntrega);
  verdade("entrega: nome e endereço de entrega no papel (obrigatórios na entrega — 3.1.6)", htmlEntrega.includes("Maria Souza") && htmlEntrega.includes("QS 7 Rua 800"));

  // 3. Pagamento dividido com troco (homologação)
  console.log("\n— 3. Pagamento dividido (Pix + dinheiro) com troco —");
  const dividido = pedido({ canal: "PDV", itens: [item("Pizza", 45)], valorTotal: 45, formaDePagamento: "Dividido: PIX R$ 20,00 + Dinheiro R$ 25,00", pagamentos: [{ forma: "PIX", valor: 20 }, { forma: "Dinheiro", valor: 25 }], trocoPara: 50 });
  const notaDividida = assinar(dividido);
  const xmlDividido = autorizar(notaDividida, 2);
  const dDividido = dadosDoDanfe(xmlDividido);
  confere("dividido: cada forma com o seu valor pago, e o troco", [dDividido.pagamentos.map((p) => [p.codigo, p.descricao, p.valor]), dDividido.troco], [[["17", "PIX", "20,00"], ["01", "Dinheiro", "50,00"]], "25,00"]);
  const htmlDividido = conferirNota("dividido", xmlDividido, dDividido);
  verdade("dividido: 'Troco R$' no papel", htmlDividido.includes("Troco R$") && textoDasLinhas(danfeEmTexto(dDividido, 32).linhas).some((l) => l.startsWith("Troco R$") && l.endsWith("25,00")));

  // 4. Contingência off-line pendente (tpEmis 9, sem protocolo) — duas vias
  console.log("\n— 4. Contingência off-line pendente —");
  const balcaoCpf = pedido({ canal: "PDV", itens: [item("Esfiha de carne", 3.9, 6), item("Esfiha de queijo", 4.5, 4), item("Suco de laranja 500ml", 9.9)], valorTotal: 51.3, documentoDoCliente: CPF, trocoPara: 60 });
  const notaCont = assinar(balcaoCpf, { tipoDeEmissao: 9 });
  const dCont = dadosDoDanfe(notaCont.xml);
  confere("contingência: pendente, emitida em contingência, sem protocolo", [dCont.pendenteDeAutorizacao, dCont.emitidaEmContingencia, dCont.protocolo], [true, true, null]);
  confere("contingência: QR offline do XML (com o digest)", [dCont.qrCode === notaCont.qrCode, dCont.qrCode.split("|").length], [true, 8]);
  confere("contingência: CPF na nota sem endereço", [dCont.consumidor.titulo, dCont.consumidor.endereco], [`CONSUMIDOR CPF: 529.982.247-25`, null]);
  conferirNota("contingência", notaCont.xml, dCont);
  confere("contingência: duas vias (Ajuste SINIEF 19/16, cl. 11ª §3º)", viasDoDanfe(dCont), ["consumidor", "estabelecimento"]);
  const htmlDuasVias = danfeHtml(dCont, { largura: 58, vias: viasDoDanfe(dCont) });
  confere("contingência: HTML com as duas vias, cada uma com o rótulo", [conta(htmlDuasVias, "<main"), htmlDuasVias.includes(T.viaDoConsumidor), htmlDuasVias.includes(T.viaDoEstabelecimento)], [2, true, true]);
  confere("contingência: as mensagens nas duas vias (2 lugares x 2 vias)", [conta(htmlDuasVias, T.contingencia), conta(htmlDuasVias, T.pendente)], [4, 4]);
  confere("contingência: ordem das divisões também na 2ª via", ordemDasDivisoes(htmlDuasVias, 1), ["I", "II", "III", "IV", "VI", "VII", "VIII", "V", ...(dCont.informacoesComplementares ? ["IX"] : [])]);
  const texto2via = textoDasLinhas(danfeEmTexto(dCont, 32, { via: "estabelecimento" }).linhas);
  const iEmissao = texto2via.findIndex((l) => l.includes("29/09/2026 12:00:00"));
  verdade("contingência: 'Via do Estabelecimento' logo abaixo da data de emissão (3.1.8)", iEmissao >= 0 && texto2via[iEmissao + 1].includes("Via do Estabelecimento"), texto2via.slice(iEmissao, iEmissao + 2).join(" / "));
  confere("contingência: na bobina, as duas mensagens duas vezes", [texto2via.filter((l) => l.includes("EMITIDA EM CONTINGENCIA")).length, texto2via.filter((l) => l.includes("Pendente de autorizacao")).length], [2, 2]);
  // A entrada em contingência (dhCont, com segundos) no papel — Portaria SEEC-DF 387/2019, art. 6º, §1º, I, "b".
  confere("contingência: dhCont lido no fuso da loja", dCont.contingencia?.entradaEm, "29/09/2026 12:00:00");
  confere("contingência: 'Contingência desde ...' nas DUAS vias do HTML", conta(htmlDuasVias, `${T.contingenciaDesde} <span class="nw">29/09/2026 12:00:00</span>`), 2);
  const iDesde = texto2via.findIndex((l) => l.trim() === "Contingencia desde");
  verdade("contingência: na bobina de 32, 'Contingencia desde' e logo abaixo a data e a hora, juntas", iDesde >= 0 && texto2via[iDesde + 1].trim() === "29/09/2026 12:00:00", texto2via.slice(Math.max(0, iDesde), iDesde + 2).join(" / "));
  verdade("contingência: na bobina de 48, numa linha só", textoDasLinhas(danfeEmTexto(dCont, 48, { via: "consumidor" }).linhas).some((l) => l.trim() === "Contingencia desde 29/09/2026 12:00:00"));

  // 4b. A mesma contingência depois de autorizada: protocolo, sem "pendente"
  const xmlContAutorizada = autorizar(notaCont, 2);
  const dContAut = dadosDoDanfe(xmlContAutorizada);
  confere("contingência autorizada: protocolo, sem pendência, uma via", [Boolean(dContAut.protocolo), dContAut.pendenteDeAutorizacao, dContAut.emitidaEmContingencia, viasDoDanfe(dContAut)], [true, false, true, [null]]);
  conferirNota("contingência autorizada", xmlContAutorizada, dContAut);

  // 5. Consumidor CNPJ, textos longos, "Outros" com descrição, xMsg da SEFAZ, escape de HTML (produção)
  console.log("\n— 5. CNPJ, textos longos, forma 99, xMsg e HTML hostil —");
  const longa = pedido({
    canal: "SITE",
    itens: [
      item("Pizza gigante meio a meio: metade quatro queijos com borda recheada de catupiry e metade frango com requeijão cremoso", 89.9),
      item("Esfiha <img src=x onerror=alert(1)> & companhia", 4.5, 12),
      item("Água mineral sem gás 500ml", 3.5, 3, { csosn: "500", cfop: "5405" }),
    ],
    valorTotal: 89.9 + 54 + 10.5 + 7,
    taxaEntrega: 7,
    formaDePagamento: "Fiado conta do funcionário Joaquim",
    documentoDoCliente: "64.568.087/0001-80",
    nomeDoCliente: "Associação dos Moradores do Condomínio Residencial Parque das Árvores",
    entregaEmDomicilio: true,
    enderecoDoCliente: "Quadra 104 Conjunto 8 Lote 12 Apartamento 1203 Bloco B, 12 - Águas Claras Norte",
  });
  const notaLonga = assinar(longa, { ambiente: 1 });
  const xmlLonga = autorizar(notaLonga, 1, { xMsg: "Obrigado por pedir a nota fiscal" });
  const dLonga = dadosDoDanfe(xmlLonga);
  confere("longa: CONSUMIDOR CNPJ formatado", dLonga.consumidor.titulo, "CONSUMIDOR CNPJ: 64.568.087/0001-80");
  verdade("longa: forma 99 sai com o xPag", dLonga.pagamentos.length === 1 && dLonga.pagamentos[0].codigo === "99" && /Fiado/i.test(dLonga.pagamentos[0].descricao), JSON.stringify(dLonga.pagamentos));
  confere("longa: xMsg do retorno da autorização na mensagem fiscal (VIII)", dLonga.mensagensFiscais, ["Obrigado por pedir a nota fiscal"]);
  const htmlLonga = conferirNota("longa", xmlLonga, dLonga);
  verdade("longa: HTML hostil no nome do produto sai escapado", !htmlLonga.includes("<img") && htmlLonga.includes("&lt;img src=x onerror=alert(1)&gt; &amp; companhia"));
  confere("longa: quantidade 12 e unitário 4,50", [dLonga.itens[1].quantidade, dLonga.itens[1].valorUnitario], ["12", "4,50"]);

  // 5b. Autorizada COM ALERTA (cStat 120 — NT 2026.002 v1.10a, produção em
  // 05/10/2026): é nota autorizada, e cada alerta (xMsg) sai na divisão VIII.
  console.log("\n— 5b. Autorizada com alerta (cStat 120) —");
  const ALERTA_CNPJ = "Alerta: Situação do CNPJ destinatário inabilitado no momento da autorização";
  const xml120 = autorizar(notaLonga, 1, {
    cStat: "120",
    xMotivo: "Autorizado o uso da NF-e, com alerta",
    alertas: [{ cMsg: "172", xMsg: ALERTA_CNPJ }, { cMsg: "999", xMsg: "Segundo alerta de teste da SEFAZ" }],
  });
  let d120: DadosDoDanfe | null = null;
  try {
    d120 = dadosDoDanfe(xml120);
  } catch (e: any) {
    verdade("cStat 120: vira DANFE (é autorizada)", false, e?.message);
  }
  if (d120) {
    confere("cStat 120: autorizada, com o protocolo e o cStat", [d120.protocolo?.cStat, d120.protocolo?.numero, d120.pendenteDeAutorizacao], ["120", "353260000000123", false]);
    confere("cStat 120: os DOIS alertas (todos os xMsg) na mensagem fiscal", d120.mensagensFiscais, [ALERTA_CNPJ, "Segundo alerta de teste da SEFAZ"]);
    const html120 = conferirNota("cStat 120", xml120, d120);
    verdade("cStat 120: o alerta na divisão VIII do HTML", (html120.split('data-div="VIII"')[1] ?? "").split("</section>")[0].includes(esc(ALERTA_CNPJ)));
    const trab120 = trabalhoDoDanfe(d120, { pedidoId: "ped-120" });
    for (const perfil of ["safe", "legacy"]) {
      const papel = soTexto(lerEscPos(assistente.buildDanfeEscPos(trab120.danfe, 48, perfil)!).linhas).join(" ").replace(/\s+/g, " ");
      verdade(`cStat 120: o alerta no papel do Assistente (perfil ${perfil})`, papel.includes(paraOPapel(ALERTA_CNPJ)), papel.slice(0, 200));
    }
    exemplos.push(gravarExemplo("danfe-80mm-alerta-120.txt", papelEmTexto(assistente.buildDanfeEscPos(trab120.danfe, 48, "safe")!, 48)));
  }

  // 6. Tributos (Lei 12.741): com vTotTrib no XML, o valor; sem, "não informados"
  console.log("\n— 6. Tributos aproximados (Lei 12.741/2012) —");
  const xmlComTributos = xmlBalcao.replace("</vNF>", "</vNF><vTotTrib>3.21</vTotTrib>");
  const dTrib = dadosDoDanfe(xmlComTributos);
  confere("com vTotTrib: valor e fonte", [dTrib.tributos.valor, dTrib.tributos.fonte, dTrib.tributos.texto], ["3,21", "vTotTrib", `${T.tributos} R$ 3,21`]);
  const htmlTrib = danfeHtml(dTrib);
  verdade("com vTotTrib: a linha na divisão IX, e nada de 'não informados'", /data-div="IX">[^]*Tributos Totais Incidentes \(Lei Federal 12\.741\/2012\): R\$ 3,21/.test(htmlTrib) && !htmlTrib.includes(T.tributosNaoInformados));
  confere("sem vTotTrib: sem número, com o aviso da causa", [dBalcao.tributos.valor, dBalcao.tributos.fonte, dBalcao.avisos.some((a) => a.includes("vTotTrib"))], [null, null, true]);

  // 7. O que NÃO vira DANFE (Ajuste SINIEF 19/16, cl. 10ª §1º)
  console.log("\n— 7. Recusas —");
  const recusa = (oQue: string, xml: string, trecho: RegExp) => {
    try {
      dadosDoDanfe(xml);
      verdade(oQue, false, "virou DANFE");
    } catch (e: any) {
      verdade(oQue, e instanceof ErroDoDanfe && trecho.test(e.message), e?.message);
    }
  };
  recusa("NFC-e normal assinada SEM protocolo", notaDividida.xml, /sem protocolo de autoriza/i);
  recusa("protocolo 110 (denegada)", autorizar(notaDividida, 2, { cStat: "110", xMotivo: "Uso Denegado" }), /não autorizou/);
  recusa("protocolo de OUTRA chave", autorizar(notaDividida, 2, { chNFe: notaEntrega.chave }), /outra chave/);
  recusa("XML mexido depois de autorizado (digVal ≠ DigestValue)", autorizar(notaDividida, 2, { digVal: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), /não é o que a SEFAZ autorizou/);
  recusa("modelo 55", xmlDividido.replace("<mod>65</mod>", "<mod>55</mod>"), /modelo 55/);
  recusa("sem QR Code", xmlDividido.replace(/<qrCode>[^<]*<\/qrCode>/, ""), /QR Code/);
  recusa("número que não bate com a chave", xmlDividido.replace(/<nNF>(\d+)<\/nNF>/, "<nNF>999</nNF>"), /não batem com a chave/);
  recusa("XML que não é NFC-e", "<consSitNFe/>", /não tem a NFC-e/);
  recusa("texto que não é XML", "isto não é xml", /não pôde ser lido|não tem a NFC-e/);

  // 8. Formatação
  console.log("\n— 8. Formatação —");
  confere("reais com milhar e vírgula", [reais(123456789), reais(5), reais(100000)], ["1.234.567,89", "0,05", "1.000,00"]);
  confere("horário convertido para o fuso da loja (Manaus, −04:00)", dataHoraLocal("2026-09-29T12:00:05-03:00", "America/Manaus"), "29/09/2026 11:00:05");
  confere("horário UTC da SEFAZ em Brasília", dataHoraLocal("2026-09-30T02:30:00Z", "America/Sao_Paulo"), "29/09/2026 23:30:00");
  confere("papel térmico em ASCII", paraOPapel("CONTINGÊNCIA “ok” – nº 1"), 'CONTINGENCIA "ok" - n. 1');
  confere("textos obrigatórios na bobina", [T.contingencia, T.pendente, T.homologacao, T.naoIdentificado].map(paraOPapel),
    ["EMITIDA EM CONTINGENCIA", "Pendente de autorizacao", "EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL", "CONSUMIDOR NAO IDENTIFICADO"]);

  // 9. QR: o SVG é a matriz, módulo a módulo
  console.log("\n— 9. QR Code —");
  for (const [nome, d] of [["balcão", dBalcao], ["contingência", dCont], ["longa", dLonga]] as const) {
    const matriz = QRCode.create(d.qrCode, { errorCorrectionLevel: "M" }).modules;
    const esperada = Array.from({ length: matriz.size }, (_, y) => Array.from({ length: matriz.size }, (_, x) => (matriz.get(y, x) ? 1 : 0)));
    confere(`${nome}: path do SVG = matriz do QR (nível M) do qrCode do XML`, matrizDoSvg(qrEmSvg(d.qrCode)), esperada);
  }
  verdade("módulo cresce na bobina larga e respeita 22 mm na estreita", moduloDoQr(dCont.qrCode, 32) * QRCode.create(dCont.qrCode, { errorCorrectionLevel: "M" }).modules.size >= 176);

  // 10. HTML: 58/80 mm, CSP por hash, nada externo
  console.log("\n— 10. HTML —");
  const html58 = danfeHtml(dBalcao, { largura: 58 });
  confere("largura 58 e 80 pela classe do body", [/<body class="l58"/.test(html58), /<body class="l80"/.test(htmlBalcao)], [true, true]);
  verdade("impressão: @page sem margem, 72 mm (80) e 48 mm (58) — margem lateral ≥ 2 mm (3.3)", html58.includes("@page{margin:0}") && html58.includes(".l80 .danfe{width:72mm") && html58.includes(".l58 .danfe{width:48mm"));
  const estilo = /<style>([^]*?)<\/style>/.exec(htmlBalcao)?.[1] ?? "";
  const script = /<script>([^]*?)<\/script>/.exec(htmlBalcao)?.[1] ?? "";
  const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
  verdade("CSP: o hash do <style> e do <script> da página batem com o cabeçalho", CSP_DO_DANFE.includes(`style-src ${hash(estilo)}`) && CSP_DO_DANFE.includes(`script-src ${hash(script)}`));
  verdade("nada externo: sem src=, sem style=, sem link rel", !/\ssrc=|\sstyle=|<link/i.test(htmlBalcao.replace(/&lt;img src=x/g, "")));
  verdade("?imprimir=1 marca a impressão ao abrir", danfeHtml(dBalcao, { imprimirAoAbrir: true }).includes('data-imprimir="1"'));
  verdade("página fora dos buscadores e sem referrer", htmlBalcao.includes('name="robots" content="noindex,nofollow"') && htmlBalcao.includes('name="referrer" content="no-referrer"'));

  // 11. Link público
  console.log("\n— 11. Link público do DANFE —");
  const pedidoId = "cmg1x2y3z0001ab12cdef3456";
  const token = tokenDoDanfe(pedidoId, dEntrega.chave);
  confere("token = id-selo(32 hex)", [lerTokenDoDanfe(token)?.pedidoId, /^[0-9a-f]{32}$/.test(lerTokenDoDanfe(token)?.selo ?? "")], [pedidoId, true]);
  verdade("token válido para o pedido e a chave", tokenConfere(token, dEntrega.chave));
  const trocado = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  confere("selo com um dígito trocado: inválido", tokenConfere(trocado, dEntrega.chave), false);
  confere("mesmo token, outra chave de acesso (nota reemitida): inválido", tokenConfere(token, dBalcao.chave), false);
  confere("selo de um pedido com o id de outro: inválido", tokenConfere(`cmoutropedido0001ab12cdef-${lerTokenDoDanfe(token)!.selo}`, dEntrega.chave), false);
  confere("formatos errados: não lê", ["", "abc", `${pedidoId}.${seloDoDanfe(pedidoId, dEntrega.chave)}`, token.toUpperCase(), `${pedidoId}-${"a".repeat(31)}`, `../${token}`].map((t) => lerTokenDoDanfe(t)), [null, null, null, null, null, null]);
  const fiscalAntes = process.env.FISCAL_CHAVE;
  process.env.FISCAL_CHAVE = "outra-chave-fiscal";
  confere("outra FISCAL_CHAVE: o link antigo não vale", tokenConfere(token, dEntrega.chave), false);
  process.env.FISCAL_CHAVE = fiscalAntes;
  confere("link público", linkPublicoDoDanfe(pedidoId, dEntrega.chave, "https://firehubfood.com.br/"), `https://firehubfood.com.br/nfce/${token}`);
  const urlAntes = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "[SENSITIVE]";
  verdade("NEXTAUTH_URL mascarado: cai no domínio do FireHub", linkPublicoDoDanfe(pedidoId, dEntrega.chave).startsWith("https://firehubfood.com.br/nfce/"));
  if (urlAntes === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = urlAntes;
  let recusou = false;
  try {
    tokenDoDanfe("id com espaço", dEntrega.chave);
  } catch {
    recusou = true;
  }
  verdade("id de pedido inválido não gera link", recusou);

  // 12. Trabalho da fila (payload do PrintRequest) e o Assistente
  console.log("\n— 12. Fila de impressão e Assistente (server.js) —");
  confere("larguras: as de sempre + as das impressoras cadastradas", largurasDasImpressoras([{ paperWidth: "58mm" }, { columns: 44 }, { paperWidth: "80mm" }, { columns: 99 }]), [32, 42, 44, 48]);
  const trabNormal = trabalhoDoDanfe(dBalcao, { pedidoId: "ped1", larguras: largurasDasImpressoras([{ columns: 44 }]) });
  const trabCont = trabalhoDoDanfe(dCont, { pedidoId: "ped2" });
  confere("trabalho: kind, identidade, vias e larguras", [trabNormal.kind, trabNormal.danfe.identidade, trabNormal.danfe.vias.length, Object.keys(trabNormal.danfe.vias[0].porColunas)], [KIND_DO_TRABALHO, `${dBalcao.chave}:autorizada`, 1, ["32", "42", "44", "48"]]);
  confere("trabalho da contingência: duas vias, identidade própria", [trabCont.danfe.vias.map((v) => v.via), trabCont.danfe.identidade, trabCont.danfe.pendente], [["consumidor", "estabelecimento"], `${dCont.chave}:contingencia`, true]);
  const tamanhos = [trabNormal, trabCont].map((t) => JSON.stringify(t).length);
  verdade(`trabalho: payload enxuto (${tamanhos.map((n) => `${(n / 1024).toFixed(1)} KB`).join(" / ")})`, tamanhos.every((n) => n < 64 * 1024));
  verdade("Assistente reconhece o trabalho do DANFE (e não um pedido)", assistente.ehTrabalhoDeDanfe({ kind: "DANFE_NFCE", danfe: trabNormal.danfe }) && !assistente.ehTrabalhoDeDanfe({ id: "p", items: [] }));
  confere("Assistente escolhe a variante: exata, maior que cabe, ou a menor",
    [48, 44, 42, 64, 24, 32].map((c) => assistente.escolherVarianteDoDanfe(trabNormal.danfe.vias[0].porColunas, c) === trabNormal.danfe.vias[0].porColunas[String(c === 64 ? 48 : c === 24 ? 32 : c)]),
    [true, true, true, true, true, true]);

  for (const [nome, trab, d] of [["balcão", trabNormal, dBalcao], ["contingência", trabCont, dCont]] as const) {
    for (const colunas of [48, 32]) {
      const bytes = assistente.buildDanfeEscPos(trab.danfe, colunas, "safe");
      if (!bytes) {
        verdade(`${nome}: Assistente montou os bytes (${colunas})`, false);
        continue;
      }
      const papel = lerEscPos(bytes);
      const esperado = trab.danfe.vias.flatMap((v) => textoDasLinhas(v.porColunas[String(colunas)].linhas));
      confere(`${nome} ${colunas} col: o papel é exatamente o texto do site`, soTexto(papel.linhas), esperado);
      // O QR sai no lugar marcado: logo depois da última linha da divisão VIII/VII.
      const posicaoNoSite = trab.danfe.vias[0].porColunas[String(colunas)].linhas.findIndex((l) => "qr" in l);
      const antesDoQr = textoDasLinhas(trab.danfe.vias[0].porColunas[String(colunas)].linhas.slice(0, posicaoNoSite));
      const noPapel = papel.linhas.indexOf(MARCA_DO_QR);
      confere(`${nome} ${colunas} col: o QR sai no lugar marcado pelo site`, soTexto(papel.linhas.slice(0, noPapel)), antesDoQr);
      confere(`${nome} ${colunas} col: um QR por via, com o conteúdo do XML (GS ( k)`, papel.qrs.map((q) => q.dados), trab.danfe.vias.map(() => d.qrCode));
      confere(`${nome} ${colunas} col: módulo do QR = o calculado para a largura`, papel.qrs.map((q) => q.modulo), trab.danfe.vias.map((v) => v.porColunas[String(colunas)].qr.modulo));
      confere(`${nome} ${colunas} col: um corte por via`, papel.cortes, trab.danfe.vias.length);
    }
    // Perfil "legacy": a impressora não entende o comando de QR — o Assistente
    // desenha o QR (qr-code.js) e o manda como IMAGEM (GS v 0). Nunca DANFE sem QR.
    for (const colunas of [48, 32]) {
      const legado = lerEscPos(assistente.buildDanfeEscPos(trab.danfe, colunas, "legacy")!);
      const variante = trab.danfe.vias[0].porColunas[String(colunas)];
      confere(`${nome} ${colunas} col: perfil legacy — nenhum comando de QR (GS ( k)`, legado.qrs.length, 0);
      confere(`${nome} ${colunas} col: perfil legacy — uma imagem do QR por via (GS v 0)`, legado.imagens.length, trab.danfe.vias.length);
      confere(
        `${nome} ${colunas} col: perfil legacy — a imagem, lida de volta, é o QR do XML módulo a módulo`,
        legado.imagens.map((img) => JSON.stringify(matrizDaImagem(img, variante.qr.modulo)) === JSON.stringify(matrizDeReferencia(d.qrCode))),
        trab.danfe.vias.map(() => true)
      );
      confere(`${nome} ${colunas} col: perfil legacy — o texto é o mesmo do site`, soTexto(legado.linhas), trab.danfe.vias.flatMap((v) => textoDasLinhas(v.porColunas[String(colunas)].linhas)));
      const antes = textoDasLinhas(variante.linhas.slice(0, variante.linhas.findIndex((l) => "qr" in l)));
      confere(`${nome} ${colunas} col: perfil legacy — a imagem sai no lugar do QR`, soTexto(legado.linhas.slice(0, legado.linhas.indexOf(MARCA_DA_IMAGEM))), antes);
      const img = legado.imagens[0];
      const lado = matrizDaImagem(img, variante.qr.modulo).length * variante.qr.modulo;
      verdade(
        `${nome} ${colunas} col: imagem na largura do papel (${colunas * 12} pontos), QR com ${(lado / 8).toFixed(1)} mm (≥ 22 mm, Manual 3.4)`,
        img.porLinha * 8 === colunas * 12 && lado >= 176 && img.linhas.length >= lado + 8 * variante.qr.modulo,
        `${img.porLinha * 8} pontos de largura, ${img.linhas.length} de altura`
      );
    }
    const full = assistente.buildDanfeEscPos(trab.danfe, 48, "full")!;
    verdade(`${nome}: perfil full — preâmbulo com GS W (área) e o QR`, full.includes(Buffer.from([0x1d, 0x57])) && lerEscPos(full).qrs.length === trab.danfe.vias.length);
  }
  confere("Assistente: trabalho sem via não imprime nada", assistente.buildDanfeEscPos({ vias: [] }, 48, "safe"), null);
  // NUNCA um DANFE sem QR (Ajuste SINIEF 19/16, cl. 10ª, §2º, II): sem o
  // conteúdo, sem o lugar dele, ou com um QR que não dá para desenhar, o
  // trabalho FALHA — com o "imprima pelo navegador" no motivo.
  const lanca = (f: () => unknown): string | null => {
    try {
      f();
      return null;
    } catch (e: any) {
      return String(e?.message ?? e);
    }
  };
  const mexido = (mexer: (v: any) => void) => {
    const copia = JSON.parse(JSON.stringify(trabNormal.danfe));
    for (const via of copia.vias) for (const v of Object.values(via.porColunas) as any[]) mexer(v);
    return copia;
  };
  const semConteudo = mexido((v) => (v.qr.conteudo = ""));
  const semLugar = mexido((v) => (v.linhas = v.linhas.filter((l: any) => !l.qr)));
  const grandeDemais = mexido((v) => (v.qr.conteudo = "x".repeat(3000)));
  const recusas = [
    lanca(() => assistente.buildDanfeEscPos(semConteudo, 48, "safe")),
    lanca(() => assistente.buildDanfeEscPos(semConteudo, 48, "legacy")),
    lanca(() => assistente.buildDanfeEscPos(semLugar, 48, "safe")),
    lanca(() => assistente.buildDanfeEscPos(semLugar, 48, "legacy")),
    lanca(() => assistente.buildDanfeEscPos(grandeDemais, 48, "legacy")),
  ];
  confere("Assistente: DANFE sem QR não sai — falha com 'imprima pelo navegador' (sem conteúdo, sem lugar, QR impossível)", recusas.map((r) => Boolean(r && /QR Code/.test(r) && /imprima pelo navegador/.test(r))), [true, true, true, true, true]);
  verdade("Assistente: a fila serial desvia o DANFE e imprime uma vez só", fonteDoAssistente.includes("buildDanfeEscPos(order.danfe, cols, perfil.profile)") && fonteDoAssistente.includes("const vezes = ehDanfe ? 1 : copies;"));
  verdade("Assistente: DANFE que não monta (sem QR) vira pendente com o motivo, sem ack", /catch \(e\) \{[^}]*markOrderAsPrinted\(order, targetPrinter\);\s*marcado = true;\s*throw e;/.test(fonteDoAssistente));

  // A entrega do DANFE ao Assistente é pela CAPACIDADE que ele anuncia na
  // consulta da fila, não pela versão: as 1.2.24 a 1.2.27 saíram SEM o DANFE.
  const consulta = new URLSearchParams(parametrosDoAssistente(() => [], { lista: [{ name: "POS-80" }] }, "1.2.28", Date.now() - 5000, 7891).replace(/^&/, ""));
  confere("Assistente anuncia na consulta da fila: danfe=1, junto da versão", [consulta.get(PARAMETRO_DO_DANFE), consulta.get("v")], ["1", "1.2.28"]);
  confere(
    "assistenteImprimeDanfe: só quem anunciou (a versão sozinha não conta)",
    [assistenteImprimeDanfe({ versao: "1.2.28", imprimeDanfe: true }), assistenteImprimeDanfe({ versao: "1.2.28" }), assistenteImprimeDanfe({ versao: "1.2.27" }), assistenteImprimeDanfe({ versao: "9.9.9", imprimeDanfe: "sim" }), assistenteImprimeDanfe(null)],
    [true, false, false, false, false]
  );
  const rotaDaFila = readFileSync(join(RAIZ, "src", "app", "api", "store", "print-queue", "route.ts"), "utf8");
  verdade(
    "fila da nuvem: DANFE só para quem anunciou (&danfe=1 → imprimeDanfe), nunca pela versão; na impressora do caixa",
    rotaDaFila.includes("const imprimeDanfe = assistenteImprimeDanfe(estadoDoAssistente);") &&
      rotaDaFila.includes('q.get(PARAMETRO_DO_DANFE) === "1" ? { imprimeDanfe: true }') &&
      !/versaoAtende\(|VERSAO_ASSISTENTE_COM_DANFE/.test(rotaDaFila) &&
      rotaDaFila.includes("(imprimeDanfe ? danfes : [])") &&
      rotaDaFila.includes("!ehDanfe(a)")
  );
  const printTs = readFileSync(join(RAIZ, "src", "lib", "print.ts"), "utf8");
  confere("o kind do trabalho é o KIND_DANFE_NFCE de print.ts (a fila filtra por ele)", /KIND_DANFE_NFCE = "([^"]+)"/.exec(printTs)?.[1], KIND_DO_TRABALHO);
  const pacote = JSON.parse(readFileSync(join(RAIZ, "firehub-print-assistant", "package.json"), "utf8"));
  confere(
    "versões: o aviso pede a 1.2.28 (a do package.json, com o DANFE, não lançada); VERSAO_ASSISTENTE_ATUAL intocada na 1.2.27",
    [VERSAO_ASSISTENTE_COM_DANFE, /VERSAO_ASSISTENTE_COM_DANFE = "([^"]+)"/.exec(printTs)?.[1], pacote.version, /VERSAO_ASSISTENTE_ATUAL = "([^"]+)"/.exec(printTs)?.[1]],
    ["1.2.28", "1.2.28", "1.2.28", "1.2.27"]
  );
  confere("o instalador leva o gerador de QR (package.json → build.files)", pacote.build.files.includes("qr-code.js"), true);

  // 12b. O server.js depois do rebase sobre o master (1.2.24–1.2.27): o que o
  // master trouxe continua inteiro, o que é nosso está lá, nada em dobro.
  console.log("\n— 12b. Integridade do server.js —");
  let sintaxe = "ok";
  try {
    execFileSync(process.execPath, ["--check", join(RAIZ, "firehub-print-assistant", "server.js")], { stdio: "pipe" });
  } catch (e: any) {
    sintaxe = String(e?.stderr ?? e?.message ?? e).slice(0, 300);
  }
  confere("node --check firehub-print-assistant/server.js", sintaxe, "ok");
  const funcoes = [...fonteDoAssistente.matchAll(/^(?:async )?function (\w+)\(/gm)].map((m) => m[1]);
  confere("server.js: nenhuma função declarada duas vezes", funcoes.filter((f, i) => funcoes.indexOf(f) !== i), []);
  confere("server.js: 'NAO E DOCUMENTO FISCAL' uma vez só, no fim do buildEscPos (Ajuste SINIEF 32/24)", conta(fonteDoAssistente, 'centerLine("NAO E DOCUMENTO FISCAL")'), 1);
  const doMaster: Array<[string, string]> = [
    ["1.2.25 teto zero (abertoHaSeg)", "&abertoHaSeg="],
    ["1.2.26 sem valores por impressora", "semValores: destino.semValores === true"],
    ["1.2.27 um Assistente por PC", "async function haOutroAssistenteAntes("],
    ["1.2.27 vigia da duplicata", "async function sairSeForDuplicata("],
    ["via do entregador / mesa (restoDoPedido por destino)", "restoDoPedido: destino.restoDoPedido || undefined"],
  ];
  confere("server.js: o que o master trouxe continua lá", doMaster.filter(([, s]) => !fonteDoAssistente.includes(s)).map(([n]) => n), []);
  const nossas = ["function ehTrabalhoDeDanfe(", "function escolherVarianteDoDanfe(", "function buildDanfeEscPos(", 'require("./qr-code")', '"&danfe=1"'];
  confere("server.js: o DANFE, o QR do perfil legacy e o anúncio da capacidade, uma vez cada", nossas.map((s) => conta(fonteDoAssistente, s)), nossas.map(() => 1));

  // 13. O cofre: fiscalInfo → XML → DANFE (diretório temporário, sem banco)
  console.log("\n— 13. Do pedido ao DANFE, pelo cofre —");
  const guardado = await guardarArquivoFiscal({ lojaId: "loja_teste", tipo: "nota", identificacao: dEntrega.chave, conteudo: xmlEntrega, mes: "202609" });
  const fiscalInfo = { nfceKey: dEntrega.chave, provedor: "sefaz", xmlNoCofre: { caminho: guardado.caminho, sha256: guardado.sha256, tipo: "nota" } };
  confere("notaDoEmissorProprio lê o contrato do fiscalInfo", notaDoEmissorProprio(fiscalInfo), { chave: dEntrega.chave, caminho: guardado.caminho, sha256: guardado.sha256, tipo: "nota" });
  confere("nota da Focus (sem xmlNoCofre): não é do emissor próprio", [notaDoEmissorProprio({ nfceKey: dEntrega.chave, pdfUrl: "https://api.focusnfe.com.br/x.html" }), notaDoEmissorProprio(null)], [null, null]);
  const doPedido = await danfeDoPedido({ id: "ped-cofre", fiscalStatus: "EMITTED", fiscalInfo });
  confere("EMITTED: o DANFE sai do XML do cofre", doPedido.ok && doPedido.dados.chave, dEntrega.chave);
  const estado = async (fiscalStatus: string, info: unknown = fiscalInfo) => {
    const r = await danfeDoPedido({ id: "ped-cofre", fiscalStatus, fiscalInfo: info });
    return r.ok ? "ok" : `${r.status} ${r.erro}`;
  };
  confere("CANCELED → 410 (o DANFE não vale mais)", await estado("CANCELED"), "410 cancelada");
  confere("FAILED (contingência recusada) → 409", await estado("FAILED"), "409 nao_autorizada");
  confere("sha256 que não confere → erro do cofre", await estado("EMITTED", { ...fiscalInfo, xmlNoCofre: { ...fiscalInfo.xmlNoCofre, sha256: "0".repeat(64) } }), "500 cofre");
  confere("nfceKey de outra nota → 409", await estado("EMITTED", { ...fiscalInfo, nfceKey: dBalcao.chave }), "409 xml_de_outra_nota");
  confere("sem xmlNoCofre → 404", await estado("EMITTED", { nfceKey: dEntrega.chave }), "404 sem_documento");

  // Os XML de teste têm a forma de verdade (XSD oficial).
  console.log("\n— XSD: os XML usados no teste —");
  const xsd = validarNoXsd([
    { xsd: "procNFe_v4.00.xsd", xml: xmlBalcao },
    { xsd: "procNFe_v4.00.xsd", xml: xmlEntrega },
    { xsd: "procNFe_v4.00.xsd", xml: xmlDividido },
    { xsd: "procNFe_v4.00.xsd", xml: xmlContAutorizada },
    { xsd: "procNFe_v4.00.xsd", xml: xmlLonga },
    { xsd: "nfe_v4.00.xsd", xml: notaCont.xml },
    // O nfeProc do cStat 120, com os dois pares cMsg/xMsg de alerta no infProt.
    { xsd: "procNFe_v4.00.xsd", xml: xml120 },
  ]);
  confere("nfeProc (5, um deles o 120 com alertas) e NFe de contingência validam no XSD", xsd.map((r) => (r.ok ? "ok" : r.erros.join(" | "))), ["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);

  // ─── Exemplos para o navegador ─────────────────────────────────────────────
  console.log("\n— Exemplos —");
  // 80 mm, homologação: entrega com CPF, desconto, taxa e pagamento dividido com troco.
  const exemplo80 = pedido({
    canal: "SITE",
    itens: [item("Pizza grande calabresa", 59.9), item("Esfiha de carne", 3.9, 6), item("Refrigerante 2L", 12, 1, { csosn: "500", cfop: "5405" })],
    taxaEntrega: 5,
    desconto: 7.9,
    valorTotal: 92.4,
    formaDePagamento: "Dividido: PIX R$ 40,00 + Dinheiro R$ 52,40",
    pagamentos: [{ forma: "PIX", valor: 40 }, { forma: "Dinheiro", valor: 52.4 }],
    trocoPara: 60,
    documentoDoCliente: "529.982.247-25",
    nomeDoCliente: "Maria Souza",
    entregaEmDomicilio: true,
    enderecoDoCliente: "QS 7 Rua 800, 12 - Areal (Casa 3)",
  });
  const nota80 = assinar(exemplo80);
  const xml80 = autorizar(nota80, 2);
  const d80 = dadosDoDanfe(xml80);
  conferirNota("exemplo 80 mm", xml80, d80);
  exemplos.push(gravarExemplo("danfe-80mm-homologacao.html", danfeHtml(d80, { largura: 80 })));
  const t80 = trabalhoDoDanfe(d80, { pedidoId: "exemplo-80" });
  exemplos.push(gravarExemplo("danfe-80mm-homologacao.txt", papelEmTexto(assistente.buildDanfeEscPos(t80.danfe, 48, "safe")!, 48)));
  // 58 mm, contingência pendente: as duas vias.
  exemplos.push(gravarExemplo("danfe-58mm-contingencia.html", danfeHtml(dCont, { largura: 58, vias: viasDoDanfe(dCont) })));
  exemplos.push(gravarExemplo("danfe-58mm-contingencia.txt", papelEmTexto(assistente.buildDanfeEscPos(trabCont.danfe, 32, "safe")!, 32)));
  // 58 mm, perfil legacy: o QR em imagem (GS v 0).
  exemplos.push(gravarExemplo("danfe-58mm-contingencia-legacy.txt", papelEmTexto(assistente.buildDanfeEscPos(trabCont.danfe, 32, "legacy")!, 32)));
  for (const e of exemplos) console.log(`   ${e}`);
}

principal()
  .then(() => {
    rmSync(COFRE, { recursive: true, force: true });
    terminar();
  })
  .catch((e) => {
    rmSync(COFRE, { recursive: true, force: true });
    console.error("❌ exceção:", e);
    process.exit(1);
  });
