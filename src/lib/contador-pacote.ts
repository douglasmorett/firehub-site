import { prisma } from "@/lib/prisma";
import { montarZip, type ArquivoDoZip } from "@/lib/zip";
import type { ConfiguracaoFiscal } from "@/lib/fiscal-emissao";

/**
 * /src/lib/contador-pacote.ts
 *
 * O pacote que o contador recebe: os XMLs das notas do período mais as
 * planilhas que ele usa para lançar.
 *
 * ── O QUE O CONTADOR PRECISA, DE VERDADE ────────────────────────────────────
 *
 * O que ele lança na escrituração é o **XML** — é o documento fiscal, o resto
 * é conferência. Por isso o XML vem sempre, um arquivo por nota, nomeado pela
 * chave de acesso (que é como todo software de contabilidade espera receber).
 *
 * Junto vão dois arquivos de apoio, porque escritório nenhum trabalha só com
 * XML solto:
 *
 *  - `relacao-de-notas.csv` — uma linha por nota, com chave, número, série,
 *    data, valor e forma de pagamento. Serve para bater o total antes de
 *    importar e para achar a nota que faltou.
 *  - `vendas-sem-nota.csv` — os pedidos do período que NÃO tiveram nota. Este
 *    é o arquivo que ninguém pede e todo mundo precisa: é a diferença entre o
 *    que a loja vendeu e o que ela declarou. Omitir isso seria entregar um
 *    relatório que parece completo e não é.
 *
 * ── SEPARAÇÃO POR AMBIENTE ──────────────────────────────────────────────────
 *
 * Nota de homologação NÃO entra no pacote. Ela não existe para o Fisco, e
 * mandá-la para o contador junto com as reais é a forma mais rápida de alguém
 * lançar um documento de teste na escrituração da empresa. Elas são contadas
 * e reportadas à parte, para o lojista saber que existem.
 */

export type PeriodoDoPacote = { de: string; ate: string };

export type PacoteDoContador = {
  arquivos: ArquivoDoZip[];
  /** Números para o corpo do e-mail e para a tela. */
  resumo: {
    notas: number;
    valorDasNotas: number;
    pedidosSemNota: number;
    valorSemNota: number;
    notasDeTesteIgnoradas: number;
    xmlsQueNaoBaixaram: number;
  };
};

const dinheiro = (v: number) => Number(v || 0).toFixed(2).replace(".", ",");

/** CSV para Excel brasileiro: ponto e vírgula, vírgula decimal, BOM no começo. */
function montarCsv(cabecalho: string[], linhas: (string | number)[][]): string {
  const escapar = (c: string | number) => {
    const s = String(c ?? "");
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const corpo = [cabecalho, ...linhas].map((l) => l.map(escapar).join(";")).join("\r\n");
  // O BOM é o que faz o Excel abrir acento certo com duplo clique. Sem ele,
  // "Café" vira "CafÃ©" e o contador acha que o arquivo veio corrompido.
  return "﻿" + corpo;
}

/** Baixa o XML da nota no Focus. Exige Basic auth — por isso é feito no servidor. */
async function baixarXml(url: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const texto = await res.text();
    return texto.trim().startsWith("<") ? texto : null;
  } catch {
    return null;
  }
}

export async function montarPacoteDoContador(
  lojaId: string,
  periodo: PeriodoDoPacote,
  limites: { inicio: Date; fim: Date }
): Promise<PacoteDoContador> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { fiscalConfig: true, storeName: true, name: true },
  });
  const config = (loja?.fiscalConfig as ConfiguracaoFiscal | null) ?? {};
  const token = String(config.tokenDoProvedor ?? "");

  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: lojaId,
      createdAt: { gte: limites.inicio, lte: limites.fim },
      status: { not: "CANCELADO" },
    },
    select: {
      id: true,
      dailyOrderNumber: true,
      createdAt: true,
      totalAmount: true,
      paymentMethod: true,
      deliveryType: true,
      customerName: true,
      customerCpfCnpj: true,
      fiscalStatus: true,
      fiscalInfo: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const comNota: typeof pedidos = [];
  const semNota: typeof pedidos = [];
  let notasDeTesteIgnoradas = 0;

  for (const p of pedidos) {
    const info = (p.fiscalInfo as any) || {};
    if (p.fiscalStatus === "EMITTED" && info.nfceKey) {
      // Homologação fica de fora: não existe para o Fisco e lançar uma nota de
      // teste na escrituração da empresa é estrago difícil de desfazer.
      if (Number(info.ambiente) === 2) { notasDeTesteIgnoradas++; continue; }
      comNota.push(p);
    } else {
      semNota.push(p);
    }
  }

  const arquivos: ArquivoDoZip[] = [];
  let xmlsQueNaoBaixaram = 0;

  if (token) {
    // Em série de propósito: o Focus limita requisições por token, e um lote
    // paralelo de 300 notas leva a bloqueio temporário — que apareceria como
    // "pacote veio faltando XML" sem explicação nenhuma.
    for (const p of comNota) {
      const info = (p.fiscalInfo as any) || {};
      if (!info.xmlUrl) { xmlsQueNaoBaixaram++; continue; }
      const xml = await baixarXml(String(info.xmlUrl), token);
      if (!xml) { xmlsQueNaoBaixaram++; continue; }
      arquivos.push({ nome: `xml/${info.nfceKey}.xml`, conteudo: xml });
    }
  } else {
    xmlsQueNaoBaixaram = comNota.length;
  }

  const fmtData = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);

  arquivos.push({
    nome: "relacao-de-notas.csv",
    conteudo: montarCsv(
      ["Data", "Pedido", "Serie", "Numero NFC-e", "Chave de acesso", "Protocolo", "CPF/CNPJ", "Cliente", "Forma de pagamento", "Valor (R$)"],
      comNota.map((p) => {
        const i = (p.fiscalInfo as any) || {};
        return [
          fmtData(p.createdAt),
          p.dailyOrderNumber ?? "",
          i.serie ?? "",
          i.nfceNumber ?? "",
          // Aspa simples na frente: sem ela o Excel transforma a chave de 44
          // dígitos em notação científica e o número é perdido para sempre.
          `'${i.nfceKey ?? ""}`,
          i.protocol ?? "",
          p.customerCpfCnpj ?? "",
          p.customerName ?? "",
          p.paymentMethod ?? "",
          dinheiro(p.totalAmount),
        ];
      })
    ),
  });

  arquivos.push({
    nome: "vendas-sem-nota.csv",
    conteudo: montarCsv(
      ["Data", "Pedido", "Tipo", "Cliente", "Forma de pagamento", "Situacao fiscal", "Motivo", "Valor (R$)"],
      semNota.map((p) => {
        const i = (p.fiscalInfo as any) || {};
        return [
          fmtData(p.createdAt),
          p.dailyOrderNumber ?? "",
          p.deliveryType === "DELIVERY" ? "Delivery" : "Retirada/Balcão",
          p.customerName ?? "",
          p.paymentMethod ?? "",
          p.fiscalStatus === "FAILED" ? "Falhou" : i.processando ? "Processando" : "Não emitida",
          i.ultimoErro ?? "",
          dinheiro(p.totalAmount),
        ];
      })
    ),
  });

  const valorDasNotas = comNota.reduce((s, p) => s + (p.totalAmount || 0), 0);
  const valorSemNota = semNota.reduce((s, p) => s + (p.totalAmount || 0), 0);

  arquivos.push({
    nome: "LEIA-ME.txt",
    conteudo:
      `Pacote fiscal — ${loja?.storeName || loja?.name || "Loja"}\r\n` +
      `Período: ${periodo.de} a ${periodo.ate}\r\n` +
      `Gerado em: ${fmtData(new Date())}\r\n\r\n` +
      `xml/ .................. ${arquivos.filter((a) => a.nome.startsWith("xml/")).length} XML(s) de NFC-e autorizadas\r\n` +
      `relacao-de-notas.csv .. ${comNota.length} nota(s), R$ ${dinheiro(valorDasNotas)}\r\n` +
      `vendas-sem-nota.csv ... ${semNota.length} pedido(s) sem nota, R$ ${dinheiro(valorSemNota)}\r\n` +
      (notasDeTesteIgnoradas > 0
        ? `\r\nATENÇÃO: ${notasDeTesteIgnoradas} nota(s) do período foram emitidas em HOMOLOGAÇÃO\r\n` +
          `(ambiente de teste da SEFAZ). Elas NÃO valem fiscalmente e por isso ficaram\r\n` +
          `de fora deste pacote. Os pedidos correspondentes aparecem em vendas-sem-nota.csv.\r\n`
        : "") +
      (xmlsQueNaoBaixaram > 0
        ? `\r\nATENÇÃO: ${xmlsQueNaoBaixaram} XML(s) não puderam ser baixados do provedor.\r\n` +
          `As notas existem e estão na relação; só o arquivo não veio. Tente gerar de novo.\r\n`
        : ""),
  });

  return {
    arquivos,
    resumo: {
      notas: comNota.length,
      valorDasNotas,
      pedidosSemNota: semNota.length,
      valorSemNota,
      notasDeTesteIgnoradas,
      xmlsQueNaoBaixaram,
    },
  };
}

/** O pacote pronto para anexar ou baixar. */
export function zipDoPacote(pacote: PacoteDoContador): Buffer {
  return montarZip(pacote.arquivos);
}
