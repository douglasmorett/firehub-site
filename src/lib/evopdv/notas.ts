/**
 * /src/lib/evopdv/notas.ts
 *
 * As NOTAS das vendas do EvoPDV (rotas /api/integracoes/evopdv/notas*): emitir
 * (idempotente por `vendaId`), consultar, listar, cancelar, DANFE e XML. A
 * nota é a de sempre do emissor próprio — reserva do número, contingência,
 * 539/656, cofre de 5 anos, cancelamento —, gravada na tabela VendaExterna
 * (lib/nfce/numeracao → `tabela`).
 *
 * ── Idempotência ────────────────────────────────────────────────────────────
 *
 * Uma venda (franchiseeId + "evopdv" + vendaId) = uma linha, única no banco.
 * O POST repetido devolve a nota que já existe; dois POSTs juntos disputam a
 * reserva do número (a trava da série) e o segundo recebe "processando" — uma
 * reserva só. O mesmo vendaId com OUTRO conteúdo é recusado (409): a nota de
 * uma venda não muda depois de pedida.
 *
 * ── O que NÃO acontece aqui ─────────────────────────────────────────────────
 *
 * A falha não é reemitida sozinha pelo cron (ele só reemite pedido): quem
 * tenta de novo é o EvoPDV, com o mesmo POST. A contingência e o
 * "processando" o cron acompanha (lib/fiscal-automatico → rodadaDaLoja).
 *
 * Só servidor.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { emitirNfceDaVendaExterna, sincronizarNota, idDaNotaDoPedido } from "@/lib/fiscal-automatico";
import { PRAZO_DO_CANCELAMENTO_MIN } from "@/lib/edicao-de-pedido";
import { lerXmlFiscal } from "@/lib/nfce/armazenamento";
import { CSP_DO_DANFE, danfeEmTexto, danfeHtml, viasDoDanfe, type ViaDoDanfe } from "@/lib/nfce/danfe";
import { danfeDoPedido } from "@/lib/nfce/danfe-do-pedido";
import { cancelarNotaDoPedidoNaSefaz, prazoDaContingencia, testarConexaoDaLoja } from "@/lib/nfce/emissao-da-loja";
import { emissaoEmCurso } from "@/lib/nfce/numeracao";
import { situacaoDaAssinatura } from "./assinatura";
import { ORIGEM, type ContaEvopdv, type Resposta } from "./conta";
import { conferirVenda, hashDaVenda, horaDaNota, vendaParaNota, type VendaConferida } from "./venda";

type Registro = Record<string, any>;
const objeto = (v: unknown): Registro => (v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : {});

/** O verProc das notas do EvoPDV (B27: até 20 caracteres). */
export const VERSAO_DO_EMISSOR_EVOPDV = "EvoPDV NFC-e 1.0";

type LinhaDaVenda = {
  id: string;
  franchiseeId: string;
  vendaId: string;
  venda: unknown;
  hashDaVenda: string;
  totalCentavos: number;
  vendaEm: Date;
  fiscalStatus: string | null;
  fiscalInfo: unknown;
  createdAt: Date;
};

const daVenda = (lojaId: string, vendaId: string) => prisma.vendaExterna.findUnique({ where: { franchiseeId_origem_vendaId: { franchiseeId: lojaId, origem: ORIGEM, vendaId } } }) as Promise<LinhaDaVenda | null>;

export type SituacaoDaNota = "autorizada" | "contingencia" | "processando" | "falhou" | "cancelada" | "sem_nota";

/** O que o EvoPDV vê da nota de uma venda. */
export function notaParaOEvopdv(v: LinhaDaVenda): Registro {
  const info = objeto(v.fiscalInfo);
  const situacao: SituacaoDaNota =
    v.fiscalStatus === "CANCELED"
      ? "cancelada"
      : v.fiscalStatus === "EMITTED" && info.nfceKey
        ? info.contingencia === true ? "contingencia" : "autorizada"
        : info.processando === true
          ? "processando"
          : v.fiscalStatus === "FAILED"
            ? "falhou"
            : "sem_nota";
  const base = `/api/integracoes/evopdv/notas/${encodeURIComponent(v.vendaId)}`;
  const temDocumento = situacao === "autorizada" || situacao === "contingencia";
  return {
    vendaId: v.vendaId,
    situacao,
    ambiente: Number(info.ambiente) === 1 ? "producao" : "homologacao",
    chave: info.nfceKey ?? null,
    numero: info.nfceNumber ?? null,
    serie: info.serie ?? null,
    protocolo: info.protocol || null,
    emitidaEm: info.emittedAt ?? null,
    contingencia: situacao === "contingencia",
    contingenciaPrazo: situacao === "contingencia" ? info.contingenciaPrazo ?? null : null,
    qrCode: info.qrCode ?? null,
    urlConsulta: info.urlConsulta ?? null,
    totalCentavos: v.totalCentavos,
    vendaEm: v.vendaEm.toISOString(),
    cancelamento:
      situacao === "cancelada"
        ? { em: info.canceladaEm ?? null, protocolo: info.protocoloCancelamento ?? null, justificativa: info.justificativaCancelamento ?? null }
        : null,
    falha:
      situacao === "falhou"
        ? {
            motivo: info.motivo ?? null,
            mensagem: info.ultimoErro ?? null,
            cStat: info.cStat ?? null,
            oQueFazer: info.oQueFazer ?? null,
            pendencias: Array.isArray(info.pendencias) ? info.pendencias : [],
            // Falha de comunicação: o mesmo POST tenta de novo (com o mesmo número).
            tentarDeNovo: info.transitoria === true,
          }
        : null,
    notasAnteriores: (Array.isArray(info.notasAnteriores) ? info.notasAnteriores : []).map((n: unknown) => {
      const a = objeto(n);
      return { chave: a.nfceKey ?? null, numero: a.nfceNumber ?? null, serie: a.serie ?? null, canceladaEm: a.canceladaEm ?? null };
    }),
    danfe: temDocumento ? `${base}/danfe` : null,
    xml: temDocumento || situacao === "cancelada" ? `${base}/xml` : null,
  };
}

/** O status HTTP do POST /notas pelo que a nota é depois dele. */
function statusDoPost(nota: Registro): number {
  if (nota.situacao === "autorizada" || nota.situacao === "contingencia" || nota.situacao === "cancelada") return 200;
  if (nota.situacao === "processando") return 202;
  const motivo = nota.falha?.motivo;
  if (motivo === "erro_de_comunicacao") return 503;
  if (motivo === "nao_configurado") return 409;
  return 422;
}

// ── Emitir ───────────────────────────────────────────────────────────────────

/**
 * POST /notas. Ver o cabeçalho. `agora` só para o teste.
 */
export async function emitirNotaDaVenda(conta: ContaEvopdv, corpo: unknown, agora: Date = new Date()): Promise<Resposta> {
  const conferida = conferirVenda(corpo, agora);
  if (!conferida.ok) return { status: 422, corpo: { error: "venda_invalida", erros: conferida.erros } };
  const venda = conferida.venda;
  const hash = hashDaVenda(venda);
  const reemitir = objeto(corpo).reemitir === true;

  let linha = await daVenda(conta.lojaId, venda.vendaId);
  if (linha && linha.hashDaVenda !== hash) {
    return { status: 409, corpo: { error: "venda_diferente", mensagem: `A venda ${venda.vendaId} já foi enviada com outro conteúdo: a nota de uma venda não muda depois de pedida.`, nota: notaParaOEvopdv(linha) } };
  }

  // A nota que já existe (ou está saindo) volta como está: idempotência.
  if (linha) {
    const atual = notaParaOEvopdv(linha);
    if (atual.situacao === "autorizada" || atual.situacao === "contingencia") return { status: 200, corpo: { repetida: true, nota: atual } };
    if (atual.situacao === "cancelada" && !reemitir) {
      return { status: 409, corpo: { error: "nota_cancelada", mensagem: "A nota desta venda foi cancelada. Para emitir outra para a mesma venda, mande `reemitir: true`.", nota: atual } };
    }
    if (atual.situacao === "processando") {
      if (emissaoEmCurso(linha.fiscalInfo, new Date())) return { status: 202, corpo: { nota: atual } };
      // Parou no meio (o processo caiu): a mesma consulta do "Consultar situação".
      await sincronizarNota({ ids: [linha.id], info: objeto(linha.fiscalInfo), fiscalStatus: linha.fiscalStatus, lojaId: conta.lojaId, tabela: "VendaExterna" }, idDaNotaDoPedido(linha), conta.config as any, { manual: true });
      const depois = (await daVenda(conta.lojaId, venda.vendaId))!;
      const nota = notaParaOEvopdv(depois);
      if (nota.situacao !== "falhou" || nota.falha?.tentarDeNovo !== true) return { status: statusDoPost(nota), corpo: { nota } };
      linha = depois;
    }
  }

  // Nota NOVA (primeira, falhou ou reemissão): só com a assinatura fiscal ativa.
  const assinatura = await situacaoDaAssinatura(conta.email, conta.assinatura, agora);
  if (assinatura.gravar) {
    await prisma.integracaoEvopdv.update({ where: { id: conta.integracaoId }, data: { assinatura: assinatura.gravar as Prisma.InputJsonValue } }).catch(() => {});
  }
  if (!assinatura.ativa) {
    return {
      status: 402,
      corpo: {
        error: "assinatura_inativa",
        mensagem: "A assinatura da Nota Fiscal do EvoPDV não está ativa: nenhuma nota nova sai. Consultar, cancelar, DANFE e XML das notas já emitidas continuam.",
        fonte: assinatura.fonte,
      },
    };
  }

  // A hora da venda decide normal × contingência (lib/evopdv/venda → horaDaNota).
  const vendaEm = linha ? linha.vendaEm : venda.dataEmissao ? new Date(venda.dataEmissao) : agora;
  const uf = String(conta.config.uf ?? "").toUpperCase();
  const hora = horaDaNota(vendaEm, agora, (em) => prazoDaContingencia(uf, em));
  if (hora.tipo === "fora_do_prazo") {
    return {
      status: 422,
      corpo: {
        error: "fora_do_prazo",
        mensagem:
          `A venda de ${hora.vendaEm.toISOString()} passou do prazo legal da contingência (${hora.prazo.toISOString()}): ` +
          "a nota não pode mais sair com a data da venda. Fale com o contador.",
      },
    };
  }

  if (!linha) {
    try {
      linha = (await prisma.vendaExterna.create({
        data: { franchiseeId: conta.lojaId, origem: ORIGEM, vendaId: venda.vendaId, venda: venda as unknown as Prisma.InputJsonValue, hashDaVenda: hash, totalCentavos: venda.totalCentavos, vendaEm },
      })) as LinhaDaVenda;
    } catch (e: any) {
      // Dois POSTs ao mesmo tempo: o outro criou a linha — segue com ela.
      if (e?.code !== "P2002") throw e;
      linha = (await daVenda(conta.lojaId, venda.vendaId))!;
      if (linha.hashDaVenda !== hash) return { status: 409, corpo: { error: "venda_diferente", mensagem: `A venda ${venda.vendaId} já foi enviada com outro conteúdo.`, nota: notaParaOEvopdv(linha) } };
    }
  }

  await emitirNfceDaVendaExterna(linha, vendaParaNota(linha.id, venda as VendaConferida), conta.config as any, {
    vendaSemConexao: hora.tipo === "sem_conexao" ? { em: hora.em, motivo: hora.motivo } : null,
    verProc: VERSAO_DO_EMISSOR_EVOPDV,
  });
  const depois = (await daVenda(conta.lojaId, venda.vendaId))!;
  const nota = notaParaOEvopdv(depois);
  return { status: statusDoPost(nota), corpo: { nota } };
}

// ── Consultar e listar ───────────────────────────────────────────────────────

/** GET /notas/{vendaId}. `consultar`: pergunta à SEFAZ agora (processando ou contingência), no ritmo que ela tolera. */
export async function consultarNotaDaVenda(conta: ContaEvopdv, vendaId: string, opcoes: { consultar?: boolean } = {}): Promise<Resposta> {
  const linha = await daVenda(conta.lojaId, vendaId);
  if (!linha) return { status: 404, corpo: { error: "venda_nao_encontrada", mensagem: "Nenhuma nota pedida para esta venda." } };
  const nota = notaParaOEvopdv(linha);
  if (opcoes.consultar && (nota.situacao === "processando" || nota.situacao === "contingencia" || nota.situacao === "autorizada")) {
    const r = await sincronizarNota(
      { ids: [linha.id], info: objeto(linha.fiscalInfo), fiscalStatus: linha.fiscalStatus, lojaId: conta.lojaId, tabela: "VendaExterna" },
      idDaNotaDoPedido(linha),
      conta.config as any,
      { manual: true }
    );
    const depois = (await daVenda(conta.lojaId, vendaId))!;
    return { status: 200, corpo: { nota: notaParaOEvopdv(depois), sefaz: { mensagem: r.resultado.ok ? null : r.resultado.mensagem, gravou: r.gravou } } };
  }
  return { status: 200, corpo: { nota } };
}

/** GET /notas?desde=&ate=&situacao=&limite=&antesDe= (a mais recente primeiro). */
export async function listarNotas(conta: ContaEvopdv, q: URLSearchParams): Promise<Resposta> {
  const data = (k: string) => {
    const v = q.get(k);
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t) : undefined;
  };
  const desde = data("desde");
  const ate = data("ate");
  const antesDe = data("antesDe");
  if (desde === undefined || ate === undefined || antesDe === undefined) return { status: 400, corpo: { error: "data_invalida", mensagem: "desde, ate e antesDe são datas ISO 8601." } };
  const limite = Math.min(100, Math.max(1, Number(q.get("limite")) || 50));
  const situacao = q.get("situacao");
  const linhas = (await prisma.vendaExterna.findMany({
    where: {
      franchiseeId: conta.lojaId,
      origem: ORIGEM,
      ...(desde || ate || antesDe ? { createdAt: { ...(desde ? { gte: desde } : {}), ...(ate ? { lte: ate } : {}), ...(antesDe ? { lt: antesDe } : {}) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: situacao ? 500 : limite,
  })) as LinhaDaVenda[];
  const notas = linhas.map(notaParaOEvopdv).filter((n) => !situacao || n.situacao === situacao).slice(0, limite);
  const ultima = linhas.length ? linhas[Math.min(linhas.length, limite) - 1] : null;
  return { status: 200, corpo: { notas, proxima: notas.length === limite && ultima ? ultima.createdAt.toISOString() : null } };
}

// ── Cancelar ─────────────────────────────────────────────────────────────────

/**
 * POST /notas/{vendaId}/cancelar { justificativa }. A regra legal (Ajuste
 * SINIEF 19/16): até 30 minutos da autorização e com a mercadoria não
 * entregue — o tempo o FireHub confere; a mercadoria quem garante é o caixa.
 * A contingência ainda não transmitida não se cancela (a SEFAZ não a tem).
 * Homologação cancela livre (é teste).
 */
export async function cancelarNotaDaVenda(conta: ContaEvopdv, vendaId: string, corpo: unknown, agora: Date = new Date()): Promise<Resposta> {
  const justificativa = String(objeto(corpo).justificativa ?? "").replace(/\s+/g, " ").trim();
  if (justificativa.length < 15 || justificativa.length > 255) {
    return { status: 422, corpo: { error: "justificativa_invalida", mensagem: "A justificativa precisa ter de 15 a 255 caracteres — é exigência da SEFAZ." } };
  }
  const linha = await daVenda(conta.lojaId, vendaId);
  if (!linha) return { status: 404, corpo: { error: "venda_nao_encontrada", mensagem: "Nenhuma nota pedida para esta venda." } };
  const nota = notaParaOEvopdv(linha);
  const info = objeto(linha.fiscalInfo);
  if (nota.situacao === "cancelada") return { status: 200, corpo: { repetida: true, nota } };
  if (nota.situacao === "contingencia") {
    return { status: 409, corpo: { error: "em_contingencia", mensagem: "A nota foi emitida em contingência e a SEFAZ ainda não a recebeu: não dá para cancelar agora. Consulte de novo em alguns minutos.", nota } };
  }
  if (nota.situacao !== "autorizada") return { status: 409, corpo: { error: "sem_nota", mensagem: "Esta venda não tem nota autorizada para cancelar.", nota } };
  if (Number(info.ambiente) === 1) {
    const autorizadaEm = Date.parse(String(info.emittedAt ?? ""));
    if (Number.isFinite(autorizadaEm) && agora.getTime() > autorizadaEm + PRAZO_DO_CANCELAMENTO_MIN * 60_000) {
      return {
        status: 409,
        corpo: {
          error: "prazo_encerrado",
          mensagem: `Passaram os ${PRAZO_DO_CANCELAMENTO_MIN} minutos do cancelamento da NFC-e (Ajuste SINIEF 19/16). Para desfazer a venda, fale com o contador sobre a devolução.`,
          nota,
        },
      };
    }
  }
  const r = await cancelarNotaDoPedidoNaSefaz({
    lojaId: conta.lojaId,
    config: conta.config as any,
    pedido: { id: linha.id, fiscalInfo: linha.fiscalInfo },
    pedidosDaNota: [linha.id],
    ambiente: Number(info.ambiente) === 1 ? 1 : Number(info.ambiente) === 2 ? 2 : null,
    justificativa,
    tabela: "VendaExterna",
  });
  const depois = (await daVenda(conta.lojaId, vendaId))!;
  if (r.status !== 200) return { status: r.status, corpo: { ...r.corpo, nota: notaParaOEvopdv(depois) } };
  return { status: 200, corpo: { protocolo: r.corpo.protocolo ?? null, nota: notaParaOEvopdv(depois) } };
}

// ── DANFE e XML ──────────────────────────────────────────────────────────────

/** A resposta de documento (HTML ou XML), já com os cabeçalhos. */
export type Documento = { status: number; corpo: string | Record<string, unknown>; cabecalhos?: Record<string, string> };

/**
 * GET /notas/{vendaId}/danfe?formato=html|texto&largura=80|58&via=consumidor|estabelecimento
 *
 * Montado do XML do cofre (lib/nfce/danfe): só o emitente, a nota e o link
 * de consulta DA SEFAZ — nenhuma marca nem endereço do FireHub. Na
 * contingência pendente saem as duas vias (a do estabelecimento fica no
 * caixa), ou só a pedida em `via`. `texto`: as linhas para a bobina (o
 * `printReceipt` do EvoPDV), uma lista por via, com o lugar do QR.
 */
export async function danfeDaVenda(conta: ContaEvopdv, vendaId: string, q: URLSearchParams): Promise<Documento> {
  const linha = await daVenda(conta.lojaId, vendaId);
  if (!linha) return { status: 404, corpo: { error: "venda_nao_encontrada", mensagem: "Nenhuma nota pedida para esta venda." } };
  const lido = await danfeDoPedido(linha);
  if (!lido.ok) return { status: lido.status, corpo: { error: lido.erro, mensagem: lido.mensagem } };
  const largura: 58 | 80 = q.get("largura") === "58" ? 58 : 80;
  const pedida = q.get("via");
  const vias: Array<ViaDoDanfe | null> =
    lido.dados.pendenteDeAutorizacao && (pedida === "consumidor" || pedida === "estabelecimento") ? [pedida] : viasDoDanfe(lido.dados);
  if (q.get("formato") === "texto") {
    const colunas = largura === 58 ? 32 : 48;
    return { status: 200, corpo: { colunas, largura, vias: vias.map((via) => danfeEmTexto(lido.dados, colunas, { via })) } };
  }
  return {
    status: 200,
    corpo: danfeHtml(lido.dados, { largura, vias }),
    cabecalhos: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": CSP_DO_DANFE,
      "Referrer-Policy": "no-referrer",
    },
  };
}

/** GET /notas/{vendaId}/xml[?evento=cancelamento]: o XML do cofre (nfeProc, a NFe da contingência ou o evento). */
export async function xmlDaVenda(conta: ContaEvopdv, vendaId: string, q: URLSearchParams): Promise<Documento> {
  const linha = await daVenda(conta.lojaId, vendaId);
  if (!linha) return { status: 404, corpo: { error: "venda_nao_encontrada", mensagem: "Nenhuma nota pedida para esta venda." } };
  const info = objeto(linha.fiscalInfo);
  const doEvento = q.get("evento") === "cancelamento";
  const ponteiro = objeto(doEvento ? info.xmlCancelamentoNoCofre : info.xmlNoCofre);
  if (typeof ponteiro.caminho !== "string" || !ponteiro.caminho) {
    return { status: 404, corpo: { error: "sem_documento", mensagem: doEvento ? "Esta nota não tem o XML do cancelamento guardado." : "Esta venda não tem XML de nota guardado." } };
  }
  let xml: string;
  try {
    xml = await lerXmlFiscal(ponteiro.caminho, typeof ponteiro.sha256 === "string" ? ponteiro.sha256 : null);
  } catch (e: any) {
    console.error(`[EvoPDV] venda ${linha.id}: XML ilegível no cofre:`, String(e?.message ?? e).slice(0, 200));
    return { status: 500, corpo: { error: "cofre", mensagem: "Não consegui ler o XML desta nota no cofre fiscal." } };
  }
  const nome = `${info.nfceKey ?? linha.vendaId}-${doEvento ? "cancelamento" : xml.includes("<protNFe") ? "procNFe" : "nfce-contingencia"}.xml`;
  return {
    status: 200,
    corpo: xml,
    cabecalhos: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `inline; filename="${nome}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

// ── Teste da SEFAZ ───────────────────────────────────────────────────────────

/** POST /testar-sefaz { ambiente? }: o status do serviço com o A1 da loja (o "dia 1"). */
export async function testarSefazDaConta(conta: ContaEvopdv, corpo: unknown): Promise<Resposta> {
  const a = objeto(corpo).ambiente;
  const ambiente = a === "producao" || Number(a) === 1 ? 1 : a === "homologacao" || Number(a) === 2 ? 2 : Number(conta.config.ambiente) === 1 ? 1 : 2;
  const r = await testarConexaoDaLoja({ lojaId: conta.lojaId, config: conta.config as any, ambiente });
  return { status: 200, corpo: { ...r, ambiente: r.ambiente === 1 ? "producao" : "homologacao" } };
}
