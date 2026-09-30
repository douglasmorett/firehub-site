import { prisma } from "@/lib/prisma";
import { montarZip, type ArquivoDoZip } from "@/lib/zip";
import { tokenDoAmbiente } from "@/lib/fiscal-credenciais";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { agruparPorNota } from "@/lib/fiscal-momento";
import { lerXmlFiscal } from "@/lib/nfce/armazenamento";

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
 * Junto vão o XML do EVENTO de cancelamento de cada nota cancelada e o XML de
 * cada inutilização de numeração homologada no período: sem eles a sequência
 * de números da série tem buracos que ninguém explica.
 *
 * E os arquivos de apoio, porque escritório nenhum trabalha só com XML solto:
 *
 *  - `relacao-de-notas.csv` — uma linha por NOTA (autorizada ou cancelada),
 *    com chave, número, série, data de emissão, situação, valor e forma de
 *    pagamento. Serve para bater o total antes de importar e para achar a
 *    nota que faltou.
 *  - `inutilizacoes.csv` — as faixas inutilizadas no período, com protocolo.
 *  - `vendas-sem-nota.csv` — os pedidos do período que NÃO tiveram nota. É a
 *    diferença entre o que a loja vendeu e o que ela declarou. Omitir isso
 *    seria entregar um relatório que parece completo e não é.
 *
 * ── UMA LINHA POR NOTA, COM O VALOR DA NOTA ─────────────────────────────────
 *
 * A versão anterior percorria PEDIDOS: a nota da conta da mesa, que fica
 * gravada com a mesma chave em todos os pedidos da conta, saía N vezes no zip
 * (o mesmo `xml/<chave>.xml` repetido) e N vezes na relação, e o valor era o
 * `totalAmount` de cada pedido — que ignora o desconto da conta, e no iFood
 * inclui a taxa de serviço da plataforma, que não está na nota. Agora é
 * `agruparPorNota` (lib/fiscal-momento), e o valor é o vNF que foi para a
 * SEFAZ (`fiscalInfo.valorDaNota`).
 *
 * ── O PERÍODO É O DA EMISSÃO ────────────────────────────────────────────────
 *
 * A nota entra no mês em que foi EMITIDA (é a data do XML e a da
 * escrituração), não no da criação do pedido: a conta da mesa que fecha
 * depois da meia-noite do último dia, ou a nota emitida à mão no dia seguinte,
 * iam para o pacote do mês errado. As vendas sem nota continuam pela data do
 * pedido — ali não há outra data.
 *
 * ── PEDIDO CANCELADO DEPOIS DA NOTA ─────────────────────────────────────────
 *
 * A nota autorizada vale até ser cancelada NA SEFAZ. O pedido que o parceiro
 * cancelou depois (e que a loja não conseguiu cancelar a tempo) continua com
 * uma nota que existe para o Fisco — ela vai no pacote. O filtro antigo
 * (`status: { not: "CANCELADO" }`) a escondia do contador.
 *
 * ── SEPARAÇÃO POR AMBIENTE ──────────────────────────────────────────────────
 *
 * Nota de homologação NÃO entra no pacote. Ela não existe para o Fisco, e
 * mandá-la para o contador junto com as reais é a forma mais rápida de alguém
 * lançar um documento de teste na escrituração da empresa. Elas são contadas
 * e reportadas à parte, para o lojista saber que existem.
 *
 * ── EMISSOR PRÓPRIO: O XML ESTÁ NO COFRE ────────────────────────────────────
 *
 * A nota do emissor próprio (fiscalInfo.provedor = "sefaz", lib/nfce) não tem
 * URL na Focus: o nfeProc, o evento de cancelamento e o ProcInutNFe estão no
 * cofre (lib/nfce/armazenamento), cifrados, apontados por `xmlNoCofre`,
 * `xmlCancelamentoNoCofre` e `inutilizacoes[].xmlNoCofre` — lidos daqui, com o
 * SHA-256 conferido. Não precisa de token. Entra também a nota que foi à SEFAZ
 * sem resposta, foi AUTORIZADA e não pôde ser cancelada (a venda saiu na
 * contingência): ela existe para o Fisco até o cancelamento por substituição.
 */

export type PeriodoDoPacote = { de: string; ate: string };

export type PacoteDoContador = {
  arquivos: ArquivoDoZip[];
  /** Números para o corpo do e-mail e para a tela. */
  resumo: {
    /** Notas AUTORIZADAS (as canceladas vêm em `notasCanceladas`). */
    notas: number;
    valorDasNotas: number;
    notasCanceladas: number;
    inutilizacoes: number;
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

/**
 * Só os servidores da Focus recebem o token. O endereço do XML vem do
 * fiscalInfo gravado no pedido; um valor adulterado ali não pode fazer o
 * servidor entregar a credencial fiscal da loja a outro host — a mesma trava
 * da rota do DANFE (api/store/fiscal/danfe).
 */
const HOSTS_DA_FOCUS = new Set(["api.focusnfe.com.br", "homologacao.focusnfe.com.br"]);
export function enderecoDaFocus(url: unknown): URL | null {
  try {
    const u = new URL(String(url ?? ""));
    return u.protocol === "https:" && HOSTS_DA_FOCUS.has(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/** Baixa o XML no Focus. Exige Basic auth — por isso é feito no servidor. */
async function baixarXml(url: string, token: string): Promise<string | null> {
  const destino = enderecoDaFocus(url);
  if (!destino) return null;
  try {
    const res = await fetch(destino, {
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

// ── A relação (pura: testada em scripts/teste-fiscal-contador.ts) ──────────

export type PedidoDoPacote = {
  id: string;
  dailyOrderNumber?: number | null;
  createdAt: Date;
  totalAmount: number;
  paymentMethod?: string | null;
  deliveryType?: string | null;
  customerName?: string | null;
  customerCpfCnpj?: string | null;
  status?: string | null;
  fiscalStatus?: string | null;
  fiscalInfo?: unknown;
};

export type NotaDoPacote = {
  chave: string;
  numero: string;
  serie: string;
  protocolo: string;
  emitidaEm: Date;
  situacao: "Autorizada" | "Cancelada" | "Contingência (aguardando a SEFAZ)";
  /** O vNF, em reais. */
  valor: number;
  forma: string;
  /** "#12, #13": os pedidos da nota (a conta da mesa tem vários). */
  pedidos: string;
  documento: string;
  cliente: string;
  xmlUrl: string | null;
  xmlCancelamentoUrl: string | null;
  canceladaEm: string | null;
  /** Emissor próprio: o nfeProc e o evento no cofre (lib/nfce/armazenamento). */
  xmlNoCofre?: PonteiroDoCofre | null;
  xmlCancelamentoNoCofre?: PonteiroDoCofre | null;
};

export type InutilizacaoDoPacote = {
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  protocolo: string;
  homologadaEm: Date;
  justificativa: string;
  xmlUrl: string | null;
  xmlNoCofre?: PonteiroDoCofre | null;
};

export type PonteiroDoCofre = { caminho: string; sha256: string };
const ponteiroDoCofre = (v: unknown): PonteiroDoCofre | null => {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return typeof o.caminho === "string" && o.caminho && typeof o.sha256 === "string" && o.sha256 ? { caminho: o.caminho, sha256: o.sha256 } : null;
};

const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const cancelado = (s: unknown) => String(s || "").toUpperCase().startsWith("CANCEL");
const nomeDoPedido = (p: PedidoDoPacote) => (p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : `#${p.id.slice(-6)}`);
const dataOuNull = (v: unknown): Date | null => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t) : null;
};

/**
 * O que vai no pacote de um período: as notas (uma por chave, pela data de
 * emissão), as inutilizações e as vendas sem nota.
 */
export function relacaoDoPacote(
  pedidos: PedidoDoPacote[],
  limites: { inicio: Date; fim: Date },
  inutilizacoesGravadas: unknown = []
): {
  notas: NotaDoPacote[];
  inutilizacoes: InutilizacaoDoPacote[];
  semNota: PedidoDoPacote[];
  notasDeTesteIgnoradas: number;
  /** Emissor próprio: notas autorizadas em duplicidade com o cupom de contingência (a cancelar por substituição). */
  duplicadasPelaContingencia: number;
} {
  const noPeriodo = (d: Date | null) => d != null && d.getTime() >= limites.inicio.getTime() && d.getTime() <= limites.fim.getTime();
  const notas = new Map<string, NotaDoPacote>();
  const deTeste = new Set<string>();
  const duplicadasPelaContingencia = new Set<string>();

  // 1. As notas que estão no pedido agora: autorizadas, em contingência e as
  //    canceladas que ninguém substituiu. Uma por chave.
  for (const n of agruparPorNota(pedidos, { comCanceladas: true })) {
    const info = n.info;
    if (Number(info.ambiente) === 2) { deTeste.add(n.chave); continue; }
    const emitidaEm = dataOuNull(info.emittedAt) ?? n.principal.createdAt;
    if (!noPeriodo(emitidaEm)) continue;
    const foiCancelada = n.principal.fiscalStatus === "CANCELED";
    notas.set(n.chave, {
      chave: n.chave,
      numero: String(info.nfceNumber ?? ""),
      serie: String(info.serie ?? ""),
      protocolo: String(info.protocol ?? ""),
      emitidaEm,
      situacao: foiCancelada ? "Cancelada" : info.contingencia === true ? "Contingência (aguardando a SEFAZ)" : "Autorizada",
      valor: n.valor,
      forma: String(info.formaNaNota || n.principal.paymentMethod || ""),
      pedidos: n.pedidos.map(nomeDoPedido).join(", "),
      documento: String(n.pedidos.map((p) => p.customerCpfCnpj).find(Boolean) ?? ""),
      cliente: String(n.principal.customerName ?? ""),
      xmlUrl: info.xmlUrl ?? null,
      xmlCancelamentoUrl: foiCancelada ? info.xmlCancelamentoUrl ?? null : null,
      canceladaEm: foiCancelada ? info.canceladaEm ?? null : null,
      xmlNoCofre: ponteiroDoCofre(info.xmlNoCofre),
      xmlCancelamentoNoCofre: foiCancelada ? ponteiroDoCofre(info.xmlCancelamentoNoCofre) : null,
    });
  }

  // 2. As canceladas que uma reemissão substituiu (`notasAnteriores`,
  //    lib/fiscal-automatico): a nota nova gravou por cima, mas a cancelada
  //    existiu, tem número e tem o XML do cancelamento.
  for (const p of pedidos) {
    const anteriores = objeto(p.fiscalInfo).notasAnteriores;
    if (!Array.isArray(anteriores)) continue;
    for (const bruta of anteriores) {
      const a = objeto(bruta);
      const chave = String(a.nfceKey ?? "");
      if (!chave || notas.has(chave)) {
        // A conta da mesa guarda a mesma cancelada em todos os pedidos: soma o pedido na linha.
        const ja = notas.get(chave);
        if (ja && !ja.pedidos.split(", ").includes(nomeDoPedido(p))) ja.pedidos += `, ${nomeDoPedido(p)}`;
        continue;
      }
      if (Number(a.ambiente) === 2) { deTeste.add(chave); continue; }
      const emitidaEm = dataOuNull(a.emittedAt) ?? p.createdAt;
      if (!noPeriodo(emitidaEm)) continue;
      notas.set(chave, {
        chave,
        numero: String(a.nfceNumber ?? ""),
        serie: String(a.serie ?? ""),
        protocolo: String(a.protocol ?? ""),
        emitidaEm,
        situacao: "Cancelada",
        valor: typeof a.valorDaNota === "number" ? a.valorDaNota : Number(p.totalAmount) || 0,
        forma: String(a.formaNaNota || p.paymentMethod || ""),
        pedidos: nomeDoPedido(p),
        documento: String(p.customerCpfCnpj ?? ""),
        cliente: String(p.customerName ?? ""),
        xmlUrl: a.xmlUrl ?? null,
        xmlCancelamentoUrl: a.xmlCancelamentoUrl ?? null,
        canceladaEm: a.canceladaEm ?? null,
        xmlNoCofre: ponteiroDoCofre(a.xmlNoCofre),
        xmlCancelamentoNoCofre: ponteiroDoCofre(a.xmlCancelamentoNoCofre),
      });
    }
  }

  // 2b. Emissor próprio: a nota que foi à SEFAZ sem resposta, saiu AUTORIZADA
  //     e não pôde ser cancelada (a venda saiu no cupom de contingência —
  //     lib/nfce/rotina-da-sefaz). Ela vale para o Fisco até o cancelamento
  //     por substituição: vai na relação, com o XML, para o contador ver.
  for (const p of pedidos) {
    const t = objeto(objeto(p.fiscalInfo).numeroTentado);
    const chave = String(t.nfceKey ?? t.chave ?? "");
    if (t.situacao !== "autorizado" || !chave) continue;
    const ja = notas.get(chave);
    if (ja) {
      if (!ja.pedidos.split(", ").includes(nomeDoPedido(p))) ja.pedidos += `, ${nomeDoPedido(p)}`;
      continue;
    }
    if (Number(t.ambiente) === 2) { deTeste.add(chave); continue; }
    const emitidaEm = dataOuNull(t.emitidaEm) ?? p.createdAt;
    if (!noPeriodo(emitidaEm)) continue;
    const info = objeto(p.fiscalInfo);
    notas.set(chave, {
      chave,
      numero: String(t.numero ?? ""),
      serie: String(t.serie ?? ""),
      protocolo: String(t.protocolo ?? ""),
      emitidaEm,
      situacao: "Autorizada",
      valor: typeof info.valorDaNota === "number" ? info.valorDaNota : Number(p.totalAmount) || 0,
      forma: String(info.formaNaNota || p.paymentMethod || ""),
      pedidos: nomeDoPedido(p),
      documento: String(p.customerCpfCnpj ?? ""),
      cliente: String(p.customerName ?? ""),
      xmlUrl: null,
      xmlCancelamentoUrl: null,
      canceladaEm: null,
      xmlNoCofre: ponteiroDoCofre(t.xmlNoCofre),
      xmlCancelamentoNoCofre: null,
    });
    duplicadasPelaContingencia.add(chave);
  }

  // 3. Vendas sem nota: pedido do período (pela data do pedido), não
  //    cancelado, sem nota de produção que valha — nem autorizada nem em
  //    contingência. A de homologação não conta como nota.
  const semNota = pedidos.filter((p) => {
    if (!noPeriodo(p.createdAt) || cancelado(p.status)) return false;
    const info = objeto(p.fiscalInfo);
    const temNota = p.fiscalStatus === "EMITTED" && Boolean(info.nfceKey) && Number(info.ambiente) !== 2;
    return !temNota;
  });

  // 4. Inutilizações homologadas no período, de produção.
  const inutilizacoes: InutilizacaoDoPacote[] = [];
  for (const bruta of Array.isArray(inutilizacoesGravadas) ? inutilizacoesGravadas : []) {
    const i = objeto(bruta);
    const quando = dataOuNull(i.homologadaEm);
    if (!noPeriodo(quando) || Number(i.ambiente) === 2) continue;
    inutilizacoes.push({
      serie: Number(i.serie) || 0,
      numeroInicial: Number(i.numeroInicial) || 0,
      numeroFinal: Number(i.numeroFinal) || 0,
      protocolo: String(i.protocolo ?? ""),
      homologadaEm: quando!,
      justificativa: String(i.justificativa ?? ""),
      xmlUrl: i.xmlUrl ?? null,
      xmlNoCofre: ponteiroDoCofre(i.xmlNoCofre),
    });
  }

  const ordenadas = [...notas.values()].sort((a, b) => a.emitidaEm.getTime() - b.emitidaEm.getTime());
  return { notas: ordenadas, inutilizacoes, semNota, notasDeTesteIgnoradas: deTeste.size, duplicadasPelaContingencia: duplicadasPelaContingencia.size };
}

/**
 * Quanto antes do período o pedido pode ter sido criado e ainda ter a nota
 * emitida DENTRO dele: a conta que fecha no dia seguinte, a nota emitida à
 * mão dias depois. 31 dias cobre o mês anterior inteiro sem varrer a base.
 */
const MARGEM_DA_EMISSAO_MS = 31 * 24 * 60 * 60_000;

export async function montarPacoteDoContador(
  lojaId: string,
  periodo: PeriodoDoPacote,
  limites: { inicio: Date; fim: Date }
): Promise<PacoteDoContador> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { fiscalConfig: true, storeName: true, name: true },
  });
  // O pacote leva só notas de PRODUÇÃO (as de homologação são puladas), então
  // o token é o de produção — mesmo que a loja esteja hoje testando algo em
  // homologação.
  const config = normalizarConfigFiscal(loja?.fiscalConfig);
  const token = String(tokenDoAmbiente({ ...config, ambiente: 1 }) ?? "");

  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: lojaId,
      OR: [
        // As vendas do período, com ou sem nota — inclusive as canceladas
        // depois da nota: a nota vale até ser cancelada na SEFAZ.
        { createdAt: { gte: limites.inicio, lte: limites.fim } },
        // Pedido de antes cuja nota pode ter saído dentro do período.
        {
          createdAt: { gte: new Date(limites.inicio.getTime() - MARGEM_DA_EMISSAO_MS), lt: limites.inicio },
          fiscalStatus: { in: ["EMITTED", "CANCELED"] },
        },
      ],
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
      status: true,
      fiscalStatus: true,
      fiscalInfo: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const { notas, inutilizacoes, semNota, notasDeTesteIgnoradas, duplicadasPelaContingencia } = relacaoDoPacote(
    pedidos,
    limites,
    (config as Record<string, unknown>).inutilizacoes
  );

  const arquivos: ArquivoDoZip[] = [];
  let xmlsQueNaoBaixaram = 0;

  // Em série de propósito: o Focus limita requisições por token, e um lote
  // paralelo de 300 notas leva a bloqueio temporário — que apareceria como
  // "pacote veio faltando XML" sem explicação nenhuma.
  const baixar = async (url: string | null, nome: string) => {
    if (!url || !token) { xmlsQueNaoBaixaram++; return; }
    const xml = await baixarXml(url, token);
    if (!xml) { xmlsQueNaoBaixaram++; return; }
    arquivos.push({ nome, conteudo: xml });
  };
  // Emissor próprio: o XML está no cofre (cifrado, conferido pelo SHA-256) —
  // lido daqui, sem token e sem provedor. O resto vem da Focus, como sempre.
  const pegar = async (fonte: { url: string | null; cofre?: PonteiroDoCofre | null }, nome: string) => {
    if (fonte.cofre) {
      try {
        arquivos.push({ nome, conteudo: await lerXmlFiscal(fonte.cofre.caminho, fonte.cofre.sha256) });
      } catch {
        xmlsQueNaoBaixaram++;
      }
      return;
    }
    await baixar(fonte.url, nome);
  };
  // O cancelamento feito antes de a rota guardar o endereço do XML do evento
  // não tem de onde baixar: conta à parte, porque "tente de novo" não resolve.
  let cancelamentosSemXml = 0;
  for (const n of notas) {
    await pegar({ url: n.xmlUrl, cofre: n.xmlNoCofre }, `xml/${n.chave}.xml`);
    if (n.situacao !== "Cancelada") continue;
    if (n.xmlCancelamentoNoCofre || n.xmlCancelamentoUrl) {
      await pegar({ url: n.xmlCancelamentoUrl, cofre: n.xmlCancelamentoNoCofre }, `xml/${n.chave}-cancelamento.xml`);
    } else cancelamentosSemXml++;
  }
  for (const i of inutilizacoes) {
    await pegar({ url: i.xmlUrl, cofre: i.xmlNoCofre }, `xml/inutilizacao-serie${i.serie}-${i.numeroInicial}-a-${i.numeroFinal}.xml`);
  }

  const fmtData = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);

  arquivos.push({
    nome: "relacao-de-notas.csv",
    conteudo: montarCsv(
      ["Data de emissao", "Pedido(s)", "Serie", "Numero NFC-e", "Chave de acesso", "Protocolo", "Situacao", "CPF/CNPJ", "Cliente", "Forma de pagamento", "Valor da nota (R$)"],
      notas.map((n) => [
        fmtData(n.emitidaEm),
        n.pedidos,
        n.serie,
        n.numero,
        // Aspa simples na frente: sem ela o Excel transforma a chave de 44
        // dígitos em notação científica e o número é perdido para sempre.
        `'${n.chave}`,
        n.protocolo,
        n.situacao,
        n.documento,
        n.cliente,
        n.forma,
        dinheiro(n.valor),
      ])
    ),
  });

  if (inutilizacoes.length > 0) {
    arquivos.push({
      nome: "inutilizacoes.csv",
      conteudo: montarCsv(
        ["Homologada em", "Serie", "Numero inicial", "Numero final", "Protocolo", "Justificativa"],
        inutilizacoes.map((i) => [fmtData(i.homologadaEm), i.serie, i.numeroInicial, i.numeroFinal, i.protocolo, i.justificativa])
      ),
    });
  }

  arquivos.push({
    nome: "vendas-sem-nota.csv",
    conteudo: montarCsv(
      ["Data", "Pedido", "Tipo", "Cliente", "Forma de pagamento", "Situacao fiscal", "Motivo", "Valor (R$)"],
      semNota.map((p) => {
        const i = objeto(p.fiscalInfo);
        return [
          fmtData(p.createdAt),
          p.dailyOrderNumber ?? "",
          p.deliveryType === "DELIVERY" ? "Delivery" : p.deliveryType === "MESA" ? "Mesa" : "Retirada/Balcão",
          p.customerName ?? "",
          p.paymentMethod ?? "",
          p.fiscalStatus === "FAILED" ? "Falhou"
            : p.fiscalStatus === "CANCELED" ? "Nota cancelada"
            : i.processando ? "Processando"
            : p.fiscalStatus === "EMITTED" && Number(i.ambiente) === 2 ? "Só nota de teste (homologação)"
            : "Não emitida",
          i.ultimoErro ?? "",
          dinheiro(p.totalAmount),
        ];
      })
    ),
  });

  const autorizadas = notas.filter((n) => n.situacao !== "Cancelada");
  const canceladas = notas.length - autorizadas.length;
  // O valor das notas é o das que VALEM: a cancelada não é venda declarada.
  const valorDasNotas = Math.round(autorizadas.reduce((s, n) => s + n.valor * 100, 0)) / 100;
  const valorSemNota = Math.round(semNota.reduce((s, p) => s + (Number(p.totalAmount) || 0) * 100, 0)) / 100;
  const emContingencia = autorizadas.filter((n) => n.situacao !== "Autorizada").length;

  arquivos.push({
    nome: "LEIA-ME.txt",
    conteudo:
      `Pacote fiscal — ${loja?.storeName || loja?.name || "Loja"}\r\n` +
      `Período: ${periodo.de} a ${periodo.ate} (notas pela data de EMISSÃO; vendas sem nota pela data do pedido)\r\n` +
      `Gerado em: ${fmtData(new Date())}\r\n\r\n` +
      `xml/ .................. ${arquivos.filter((a) => a.nome.startsWith("xml/")).length} XML(s): notas, eventos de cancelamento e inutilizações\r\n` +
      `relacao-de-notas.csv .. ${autorizadas.length} nota(s) autorizada(s), R$ ${dinheiro(valorDasNotas)}` +
      (canceladas > 0 ? ` + ${canceladas} cancelada(s) (fora do total)` : "") + `\r\n` +
      (inutilizacoes.length > 0 ? `inutilizacoes.csv ..... ${inutilizacoes.length} faixa(s) inutilizada(s)\r\n` : "") +
      `vendas-sem-nota.csv ... ${semNota.length} pedido(s) sem nota, R$ ${dinheiro(valorSemNota)}\r\n` +
      "\r\nA nota da conta da mesa cobre vários pedidos: ela aparece UMA vez, com todos os pedidos na coluna\r\n" +
      "\"Pedido(s)\" e o valor da nota (com o desconto da conta). No iFood/99Food o valor da nota não inclui\r\n" +
      "a taxa de serviço da plataforma.\r\n" +
      (emContingencia > 0
        ? `\r\nATENÇÃO: ${emContingencia} nota(s) em CONTINGÊNCIA ainda não efetivada(s) pela SEFAZ. Valem para o\r\n` +
          `cliente, mas podem ser recusadas na transmissão — confira a situação antes de escriturar.\r\n`
        : "") +
      (notasDeTesteIgnoradas > 0
        ? `\r\nATENÇÃO: ${notasDeTesteIgnoradas} nota(s) do período foram emitidas em HOMOLOGAÇÃO\r\n` +
          `(ambiente de teste da SEFAZ). Elas NÃO valem fiscalmente e por isso ficaram\r\n` +
          `de fora deste pacote. Os pedidos correspondentes aparecem em vendas-sem-nota.csv.\r\n`
        : "") +
      (xmlsQueNaoBaixaram > 0
        ? `\r\nATENÇÃO: ${xmlsQueNaoBaixaram} XML(s) não puderam ser baixados do provedor (ou lidos do arquivo fiscal do FireHub).\r\n` +
          `As notas existem e estão na relação; só o arquivo não veio. Tente gerar de novo.\r\n`
        : "") +
      (duplicadasPelaContingencia > 0
        ? `\r\nATENÇÃO: ${duplicadasPelaContingencia} nota(s) foram AUTORIZADAS em duplicidade com um cupom de contingência\r\n` +
          `(a SEFAZ não respondeu na hora e a venda saiu na contingência). Elas precisam de cancelamento por\r\n` +
          `substituição (evento 110112) — até lá, a mesma venda aparece em duas notas autorizadas.\r\n`
        : "") +
      (cancelamentosSemXml > 0
        ? `\r\nATENÇÃO: ${cancelamentosSemXml} cancelamento(s) sem o XML do evento guardado no FireHub\r\n` +
          `(anteriores a esta versão). O cancelamento existe na SEFAZ; o XML do evento se baixa no painel da Focus NFe.\r\n`
        : ""),
  });

  return {
    arquivos,
    resumo: {
      notas: autorizadas.length,
      valorDasNotas,
      notasCanceladas: canceladas,
      inutilizacoes: inutilizacoes.length,
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
