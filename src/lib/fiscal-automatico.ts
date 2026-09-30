/**
 * /src/lib/fiscal-automatico.ts
 *
 * Emissão automática de NFC-e — quem grava. A decisão de QUANDO e de QUAL
 * forma de pagamento mora em lib/fiscal-momento.ts (pura, testada sem banco);
 * a montagem do corpo e a conversa com o provedor, em lib/fiscal-emissao.ts.
 *
 * A tela fiscal sempre ofereceu "formas de pagamento com emissão automática"
 * (autoEmitPaymentMethods) — mas NENHUM código lia essa lista: o lojista
 * marcava PIX e cartão achando que as notas sairiam sozinhas, e nada
 * acontecia. Este arquivo é quem cumpre a promessa, pelas mesmas funções do
 * botão "Emitir" — mesma validação, mesma ref idempotente, mesmo registro de
 * falha honesto. A nota do pedido é montada por `pedidoParaNota`
 * (lib/fiscal-itens, via `montarNotaDoPedido`), com canal, intermediador e
 * endereço — sem eles nenhuma nota de entrega montava.
 *
 * ── Quem chama ──────────────────────────────────────────────────────────────
 *
 * `emitirNfceAutomatica(id)` é chamada a CADA mudança de status (painel, app
 * do motoboy, rota despachada, WhatsApp do motoboy, eventos do iFood, 99Food,
 * Brendi e JotaJá — `emitirNfceDosPedidos`) e decide sozinha se já é a hora —
 * quem chama não precisa saber de momento nenhum. `emitirNfceDaMesa` no
 * fechamento da conta e, com `manual`, pelo botão Emitir. O cron
 * `api/cron/fiscal-retentativa` (scripts/cron-runner.js, a cada 2 min)
 * consulta o que ficou "processando" ou em contingência, reemite o que falhou
 * por comunicação (e tira da fila, com o motivo, o que não vai sair sozinho) e
 * varre os pedidos que chegaram à hora da nota por um caminho sem gancho
 * (KDS, fechamento de caixa) e as contas de mesa fechadas sem nota.
 *
 * A tela fiscal usa as mesmas peças: `emitirNfceDoPedidoPelaTela` (o botão
 * Emitir de um pedido comum) e `consultarNotaDoPedido` → `sincronizarNota`
 * ("Consultar situação", a mesma consulta do cron). As rotas que cancelam por
 * fora da trava da nota (iFood, 99Food, Brendi, JotaJá, disputa) chamam
 * `alertarCancelamentoComNota`. O feed do painel de pedidos leva o recorte da
 * nota que a trava de edição lê (`notasParaOPainel`).
 *
 * Testes: scripts/teste-fiscal-momento.ts (regras puras) e
 * scripts/teste-fiscal-retentativa.ts (o cron e a conta da mesa contra um
 * banco e um provedor falsos, em memória); o emissor próprio de ponta a ponta
 * em scripts/teste-nfce-integracao.ts.
 *
 * ── Emissor próprio (fiscalConfig.provedor = "sefaz") ───────────────────────
 *
 * O caminho é este mesmo; o que muda mora em lib/nfce/emissao-da-loja. A nota
 * sai direto na SEFAZ, com o número reservado em lib/nfce/numeracao (por isso
 * os pedidos da nota vão para `emitirNfce`), e o que só ele tem (XML no cofre,
 * QR Code, reserva, envio a conferir, número tentado) chega em
 * `gravarNoPedido` e entra em toda gravação de `gravarResultado`. A consulta
 * (`sincronizarNota`) vai pela CHAVE e TRANSMITE a contingência — a Focus
 * fazia isso sozinha. O cron ainda confere os números tentados e faz a
 * inutilização mensal (lib/nfce/rotina-da-sefaz). O cupom fiscal é disparado
 * na autorização (lib/nfce/impressao-do-danfe).
 *
 * Silencioso por desenho: emissão automática não pode travar a operação. Se a
 * loja não está configurada, não faz nada (o aviso já mora na tela fiscal);
 * se a SEFAZ recusar, o pedido fica FAILED com o motivo e aparece na aba
 * Notas fiscais como "Falhou" — nunca um alert no meio do salão.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  emitirNfce,
  consultarNfce,
  pendenciasParaEmitir,
  valoresDaNota,
  type ConfiguracaoFiscal,
  type ResultadoDaEmissao,
} from "./fiscal-emissao";
import { montarItensDaNota, pedidoParaNota, type PedidoDoBanco } from "./fiscal-itens";
import type { Problema } from "./fiscal-validacao";
import { CAMPOS_DA_NOTA_NA_TELA, notaParaTela } from "./edicao-de-pedido";
import { normalizarConfigFiscal } from "./fiscal-config";
import { tokenDoAmbiente } from "./fiscal-credenciais";
import { PROVEDOR_PROPRIO, usaEmissorProprio } from "./nfce/config-da-loja";
import { lerPagamentos, somarPagamentos } from "./pagamentos-da-mesa";
import {
  alertaDoCancelamento,
  chaveDaFormaDePagamento,
  chavesDaConta,
  chavesDoPagamento,
  contaDaMesaEsquecida,
  decidirRetentativa,
  descontoDaContaPeloPago,
  deveEmitirNoStatus,
  ehFalhaTransitoria,
  ehNotaDaConta,
  formaEntraNaAutomatica,
  idDaNotaDaMesa,
  idDaNotaDoPedido,
  inicioDaVarredura,
  momentoDaEmissao,
  montarNotaDaMesa,
  montarNotaDoPedido,
  motivoDasTentativasEsgotadas,
  motivoForaDaAutomatica,
  notasAnterioresComA,
  pagamentosDoRestante,
  pedidoDeMesaExigeNotaDaConta,
  refDaReemissao,
  retentativaCabeNaEmissaoAtual,
  statusQuePodemEmitir,
  JANELA_DA_NOTA_CONSULTADA_MS,
  JANELA_DA_VENDA_CONSULTADA_MS,
  JANELA_MAXIMA_MS,
  MAXIMO_DE_TENTATIVAS_AUTOMATICAS,
  type ChaveDePagamento,
  type LojaParaNota,
  type NotaParaEmitir,
} from "./fiscal-momento";

// Reexportados: quem já importava daqui (e a frente 2, para consultar e
// cancelar pela ref certa) não precisa conhecer o arquivo novo.
export { chaveDaFormaDePagamento, idDaNotaDoPedido };

export type ConfigDaLoja = ConfiguracaoFiscal & {
  enabled?: boolean;
  autoEmitPaymentMethods?: string[];
  /** "aceite" | "saida" (padrão) | "conclusao" — ver lib/fiscal-momento. */
  momentoDaEmissao?: string;
  /** A taxa de serviço da mesa vai na nota? Padrão: não (lib/fiscal-momento). */
  taxaDeServicoNaNota?: boolean;
  /**
   * Quando a loja ligou a emissão (ISO). Se a tela carimbar isto ao salvar
   * enabled=true, a varredura nunca emite para pedido anterior. Sem o carimbo,
   * vale só a janela da varredura.
   */
  emissaoLigadaEm?: string | null;
  /**
   * Emissor próprio: imprimir o cupom fiscal (DANFE NFC-e) sozinho depois da
   * autorização — padrão sim (lib/nfce/impressao-do-danfe).
   */
  imprimirDanfe?: boolean;
};

export type ResultadoAutomatico = {
  acao: "ignorado" | "emitida" | "processando" | "falhou";
  motivo: string;
  /**
   * "ignorado" porque a emissão automática NÃO cobre este pedido (forma fora
   * da lista, pedido cancelado, conta aberta). O cron lê isto para tirar da
   * fila de retentativa a falha do botão Emitir que a automática nunca vai
   * resolver. O "ignorado" sem esta marca é passageiro (erro, cadastro
   * incompleto, status que AINDA não é a hora da nota) e pode mudar na
   * próxima rodada.
   */
  foraDaAutomatica?: boolean;
  /**
   * "falhou" por dados: o que falta, item a item (produto sem NCM, forma de
   * pagamento...). A resposta do botão Emitir do pedido comum sempre trouxe
   * esta lista; a da nota da CONTA da mesa só devolvia a frase genérica ("1
   * problema(s) nos itens…"), sem dizer qual produto — agora as duas trazem.
   */
  pendencias?: Problema[];
  /** O detalhe da rejeição da SEFAZ, quando ela veio. */
  detalhe?: string;
};

const ignorado = (motivo: string): ResultadoAutomatico => ({ acao: "ignorado", motivo });
const foraDaAutomatica = (motivo: string): ResultadoAutomatico => ({ acao: "ignorado", motivo, foraDaAutomatica: true });

/**
 * Exceção dentro da emissão, antes de o provedor receber a nota: não é
 * rejeição nem comunicação — é defeito nosso. Não se reemite sozinha (daria o
 * mesmo erro); vira FAILED com a mensagem, para aparecer em "Falhou".
 */
export type FalhaInterna = { ok: false; motivo: "erro_interno"; mensagem: string };

/**
 * Marcas que só valem até a próxima tentativa: uma tentativa nova as apaga.
 * As `pendencias` também: são as da tentativa que falhou, e a lista velha
 * ficaria mostrando um produto que a loja já corrigiu.
 */
function semMarcasDaTentativaAnterior(info: Record<string, any>): Record<string, any> {
  const { retentativaEncerrada, motivoDoFimDaRetentativa, retentativaEncerradaEm, semNotaAutomatica, pendencias, ...resto } = info;
  void retentativaEncerrada; void motivoDoFimDaRetentativa; void retentativaEncerradaEm; void semNotaAutomatica; void pendencias;
  return resto;
}
const objeto = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};

/** Só as chaves presentes de `info`, das da lista. */
function escolher(info: Record<string, any>, chaves: string[]): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const c of chaves) if (info[c] !== undefined && info[c] !== null) saida[c] = info[c];
  return saida;
}

/** Quem é a nota (a ref, as canceladas que ela substituiu, a conta da mesa): atravessa toda gravação. */
const identidadeGravada = (info: Record<string, any>) => escolher(info, ["idDaNota", "notasAnteriores", "notaDaConta", "contaDaMesa"]);
/** O que a LOJA marcou sobre a nota (aviso do parceiro, devolução registrada): a consulta não apaga. */
const CHAVES_DAS_MARCAS = ["alerta", "devolucao"];
const marcasDaLoja = (info: Record<string, any>) => escolher(info, CHAVES_DAS_MARCAS);
function semAsMarcasDaLoja(info: Record<string, any>): Record<string, any> {
  const resto = { ...info };
  for (const c of CHAVES_DAS_MARCAS) delete resto[c];
  return resto;
}

/** O fiscalInfo como condição de escrita: "o que eu li ainda é o que está lá". */
const oMesmoFiscalInfo = (lido: unknown): Prisma.CustomerOrderWhereInput => ({
  fiscalInfo: { equals: lido == null ? Prisma.AnyNull : (lido as Prisma.InputJsonValue) },
});

/**
 * Grava nos pedidos da nota o que `montar` devolve para as marcas da loja
 * (`alerta`, `devolucao`) que estão NO BANCO na hora da escrita.
 *
 * ── Por que ─────────────────────────────────────────────────────────────────
 *
 * A consulta do cron (e o "Consultar situação") lê o fiscalInfo no começo da
 * rodada, vai ao provedor — até 20 s por nota, 40 notas por rodada — e só
 * então grava. Ela montava a gravação com as marcas daquela leitura antiga,
 * com `where` só por id: o aviso que o iFood gravou no meio (pedido cancelado
 * com a nota de pé — `alertarCancelamentoComNota`) sumia na regravação, e na
 * nota em contingência isso se repetia a cada 2 minutos até a SEFAZ efetivar.
 * O aviso não voltava sozinho: o pedido já estava cancelado, e o alerta só
 * age uma vez.
 *
 * Agora, pedido a pedido: lê o fiscalInfo, monta com as marcas dessa leitura e
 * grava SÓ se ele continua igual (compare-and-swap no `where`). Se alguém
 * escreveu entre a leitura e a escrita, lê de novo e tenta outra vez; se nada
 * mudou e mesmo assim não gravou, quem recusou foi a trava de `onde` (o
 * estado da nota mudou por outro caminho) — e aí fica como está, igual à
 * gravação de sempre.
 *
 * Fora da consulta (`marcasConhecidas`), a falha e o "processando" gravam de
 * uma vez. A nota AUTORIZADA da emissão também passa pela leitura: a reserva
 * do número (lib/nfce/numeracao) já marca o pedido "processando", e o aviso
 * de pedido cancelado com nota vale para "processando" — o iFood que cancela
 * enquanto a nota está na SEFAZ grava o aviso NO MEIO da viagem (reproduzido
 * em 30/09/2026). A gravação da autorizada lê o que está lá, e quem chama
 * refaz o aviso sobre a nota que saiu (`avisarSeCanceladoNaEmissao`).
 *
 * `obrigatorio`: se três leituras seguidas mudaram no meio, grava assim mesmo
 * (sem a condição) — a nota autorizada não pode ficar sem registro.
 */
async function gravarNosPedidos(
  pedidos: string[],
  onde: Prisma.CustomerOrderWhereInput,
  montar: (marcas: Record<string, unknown>) => Prisma.CustomerOrderUpdateManyMutationInput,
  marcasConhecidas: Record<string, unknown> | null,
  opcoes: { obrigatorio?: boolean } = {}
): Promise<void> {
  if (marcasConhecidas) {
    await prisma.customerOrder.updateMany({ where: { id: { in: pedidos }, ...onde }, data: montar(marcasConhecidas) });
    return;
  }
  for (const id of pedidos) {
    let gravou = false;
    let ultimo: unknown = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const lido = (await prisma.customerOrder.findUnique({ where: { id }, select: { fiscalInfo: true } }))?.fiscalInfo;
      ultimo = lido;
      const r = await prisma.customerOrder.updateMany({
        where: { AND: [{ id }, onde, oMesmoFiscalInfo(lido)] },
        data: montar(marcasDaLoja(objeto(lido))),
      });
      if (r.count > 0) {
        gravou = true;
        break;
      }
      const depois = (await prisma.customerOrder.findUnique({ where: { id }, select: { fiscalInfo: true } }))?.fiscalInfo;
      if (JSON.stringify(depois ?? null) === JSON.stringify(lido ?? null)) break;
    }
    if (!gravou && opcoes.obrigatorio) {
      await prisma.customerOrder.updateMany({ where: { AND: [{ id }, onde] }, data: montar(marcasDaLoja(objeto(ultimo))) });
    }
  }
}

/**
 * A nota da EMISSÃO saiu (autorizada ou em contingência) e o pedido está
 * cancelado — o parceiro cancelou enquanto ela estava na SEFAZ, ou logo antes
 * da reserva: o aviso "pedido cancelado com NFC-e" é (re)feito sobre a nota
 * que saiu, com a origem do aviso que a viagem gravou. A gravação da nota
 * monta o fiscalInfo do zero e levava o aviso junto.
 */
async function avisarSeCanceladoNaEmissao(pedidos: string[], origem: string | null): Promise<void> {
  try {
    const depois = await prisma.customerOrder.findMany({ where: { id: { in: pedidos } }, select: { id: true, status: true } });
    const cancelados = depois.filter((o) => String(o.status || "").toUpperCase().startsWith("CANCEL")).map((o) => o.id);
    if (cancelados.length > 0) await alertarCancelamentoComNota({ id: { in: cancelados } }, origem ?? "cancelado durante a emissão da nota");
  } catch (err: any) {
    console.error(`[Fiscal Auto] Não conferi o cancelamento depois da emissão (pedido(s) ${pedidos.join(", ")}):`, err?.message);
  }
}

/**
 * O que gravar quando uma exceção interrompe a emissão, pelo que se sabe da
 * resposta do provedor — a mesma regra da conta da mesa (ver o `catch` de
 * `emitirNfceDaMesa`): sem resposta, é defeito nosso (FAILED "erro_interno",
 * a retentativa não refaz); com a nota autorizada na mão, a exceção foi na
 * gravação e o pedido fica "processando" para a consulta do cron confirmar;
 * com a recusa na mão, grava a recusa.
 */
function oQueGravarNaExcecao(respondido: ResultadoDaEmissao | null, mensagem: string, oQue: string): ResultadoDaEmissao | FalhaInterna {
  if (respondido == null) {
    return { ok: false, motivo: "erro_interno", mensagem: `${oQue} não saiu por um erro interno (${mensagem}). Emita pela tela Fiscal.` };
  }
  if (respondido.ok) {
    return {
      ok: false,
      motivo: "processando",
      mensagem: `Erro ao gravar ${oQue.toLowerCase()} que o provedor já recebeu (${mensagem}). A consulta automática confirma a situação.`,
      // O emissor próprio consulta pela CHAVE (não há ref no provedor): o
      // envio, o XML no cofre e a reserva vão junto, ou o "processando" não
      // teria o que consultar.
      ...(respondido.gravarNoPedido ? { gravarNoPedido: respondido.gravarNoPedido } : {}),
    };
  }
  return respondido;
}

/** Os campos que o provedor pediu para guardar (ver ResultadoDaEmissao.gravarNoPedido). */
function doProvedor(resultado: ResultadoDaEmissao | FalhaInterna): Record<string, unknown> {
  return "gravarNoPedido" in resultado && resultado.gravarNoPedido ? resultado.gravarNoPedido : {};
}

/**
 * O cupom fiscal sai sozinho depois da autorização no emissor próprio
 * (padrão sim). O módulo é da impressão (lib/nfce/impressao-do-danfe): import
 * dinâmico e sem esperar — a impressora fora do ar não pode travar nem
 * desfazer a nota.
 */
function imprimirCupomFiscal(pedidoId: string, opcoes: { forcar?: boolean } = {}): void {
  if (impressoraDeTeste) return impressoraDeTeste(pedidoId, opcoes);
  import("@/lib/nfce/impressao-do-danfe").then((m) => m.imprimirDanfe(pedidoId, opcoes.forcar ? { forcar: true } : {})).catch(() => {});
}
let impressoraDeTeste: ((pedidoId: string, opcoes?: { forcar?: boolean }) => void) | null = null;
/** Para o teste contar os cupons disparados sem a fila de impressão de verdade. */
export function usarImpressoraDeTeste(fn: ((pedidoId: string, opcoes?: { forcar?: boolean }) => void) | null): void {
  impressoraDeTeste = fn;
}

/**
 * O interruptor da impressão: `fiscalConfig.imprimirDanfe` ou
 * `fiscalConfig.sefaz.imprimirDanfe` — `false` em qualquer um desliga (a
 * impressão lê o do bloco `sefaz`; os dois valem até a tela escolher um).
 */
function imprimeODanfe(config: ConfigDaLoja): boolean {
  const doBloco = config.sefaz && typeof config.sefaz === "object" ? (config.sefaz as Record<string, unknown>).imprimirDanfe : undefined;
  return config.imprimirDanfe !== false && doBloco !== false;
}

/**
 * ── A TRAVA DA GRAVAÇÃO ─────────────────────────────────────────────────────
 *
 * Falha e "processando" só gravam em pedido que NÃO tem nota viva. É a mesma
 * trava da rota emitir (updateMany com NOT EMITTED), mais o CANCELED. Sem ela,
 * o ENTREGUE que disparava duas vezes (painel + app do motoboy, duplo toque)
 * punha duas emissões correndo juntas, e a que voltasse por último podia
 * gravar FAILED por cima do EMITTED da outra — apagando a chave de uma nota
 * que existe na SEFAZ.
 *
 * O `fiscalStatus: null` vai explícito porque `NOT IN` do SQL não casa nulo.
 */
const SEM_NOTA_VIVA: Prisma.CustomerOrderWhereInput = {
  OR: [{ fiscalStatus: null }, { fiscalStatus: { notIn: ["EMITTED", "CANCELED"] } }],
};

type LojaFiscal = {
  config: ConfigDaLoja | null;
  /** O identificador da loja no iFood / 99Food: o intermediador da nota precisa dele. */
  ifoodMerchantId: string | null;
  food99MerchantId: string | null;
};

/**
 * O fiscalConfig como a emissão tem de ler: NORMALIZADO (lib/fiscal-config).
 *
 * Cru, o legado da tela antiga (`ambiente: "producao"` por extenso) virava
 * `Number("producao")` = NaN e a nota ia para HOMOLOGAÇÃO sem aviso — a loja
 * que escolheu produção passaria o dia emitindo teste. A normalização também
 * carimba `ambienteDoToken` no token colado à mão ANTES de qualquer rota
 * trocar o `ambiente` do objeto (a consulta e a reemissão usam o da nota).
 * `null` continua null: loja sem cadastro fiscal não emite.
 */
function configNormalizada(bruto: unknown): ConfigDaLoja | null {
  if (!bruto || typeof bruto !== "object") return null;
  return normalizarConfigFiscal(bruto) as ConfigDaLoja;
}

async function lojaFiscal(franchiseeId: string): Promise<LojaFiscal> {
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { fiscalConfig: true, ifoodMerchantId: true, food99MerchantId: true },
  });
  return {
    config: configNormalizada(loja?.fiscalConfig),
    ifoodMerchantId: loja?.ifoodMerchantId ?? null,
    food99MerchantId: loja?.food99MerchantId ?? null,
  };
}

/**
 * A ref da nota de um pedido comum: a gravada (`<pedido>-2` depois de uma
 * reemissão) ou o próprio id. Só vale a gravada que é DESTE pedido — uma
 * `mesa-<sessão>` esquecida num pedido que perdeu a sessão não pode virar a
 * ref de uma nota avulsa.
 */
function refDoPedidoComum(pedidoId: string, info: Record<string, any>): string {
  const gravada = typeof info.idDaNota === "string" ? info.idDaNota : "";
  return gravada && gravada.startsWith(pedidoId) ? gravada : pedidoId;
}

async function configDaLoja(franchiseeId: string): Promise<ConfigDaLoja | null> {
  return (await lojaFiscal(franchiseeId)).config;
}

/**
 * O que a nota DECLAROU, guardado no pedido quando ela existe (autorizada, ou
 * na SEFAZ agora): o valor (vNF) e a forma de pagamento.
 *
 * - `valorDaNota`: o vNF não é o `totalAmount` — no iFood fica fora a taxa de
 *   serviço, na mesa entra o desconto da conta. Quem lista notas
 *   (`agruparPorNota`, lib/fiscal-momento) usa este número.
 * - `formaNaNota`: a troca de forma depois da nota não muda a nota; o aviso
 *   dessa troca (lib/edicao-de-pedido) diz com qual forma ela saiu.
 */
function dadosDaNota(nota: NotaParaEmitir): Record<string, unknown> {
  const partes = (nota.pagamentos ?? []).filter((p) => p && p.valor > 0);
  const forma = partes.length > 1
    ? partes.map((p) => `${p.forma} R$ ${p.valor.toFixed(2).replace(".", ",")}`).join(" + ")
    : nota.formaDePagamento;
  return {
    valorDaNota: valoresDaNota(nota).total / 100,
    formaNaNota: forma || null,
  };
}

/** Os dados da nota já gravados no pedido — a consulta do cron não remonta a nota. */
function dadosGravados(info: Record<string, any>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  if (typeof info.valorDaNota === "number") saida.valorDaNota = info.valorDaNota;
  if (typeof info.formaNaNota === "string") saida.formaNaNota = info.formaNaNota;
  return saida;
}

type EstadoFiscal = "autorizada" | "cancelada" | "processando" | "falhou" | "sem_nota";

function estadoFiscal(fiscalStatus: string | null | undefined, info: Record<string, any>): EstadoFiscal {
  if (fiscalStatus === "EMITTED" && info.nfceKey) return "autorizada";
  if (fiscalStatus === "CANCELED") return "cancelada";
  if (info.processando === true) return "processando";
  if (fiscalStatus === "FAILED") return "falhou";
  return "sem_nota";
}

/**
 * Grava o que o provedor respondeu em TODOS os pedidos da nota — um só, ou os
 * pedidos da conta da mesa, com a mesma chave em todos.
 */
async function gravarResultado(
  pedidos: string[],
  resultado: ResultadoDaEmissao | FalhaInterna,
  contexto: {
    fiscalAtual: Record<string, any>;
    ambiente: number;
    /** Identidade da nota (a da conta da mesa): vai em toda gravação. */
    extra?: Record<string, unknown>;
    /**
     * O que a nota declarou (`dadosDaNota`): só grava onde a nota existe —
     * autorizada, processando ou em contingência. Em falha não há nota.
     */
    nota?: Record<string, unknown>;
    /** Veio de uma CONSULTA (cron), não de uma emissão: não conta tentativa. */
    deConsulta?: boolean;
    /** Pedida por uma pessoa (nota da conta pela tela), não pela automática. */
    manual?: boolean;
    /**
     * A consulta é de uma nota EM CONTINGÊNCIA (EMITTED com `contingencia`):
     * a recusa da SEFAZ na transmissão pode trocar o EMITTED por FAILED. Fora
     * disto a trava SEM_NOTA_VIVA nunca deixa falha gravar por cima de nota.
     */
    deContingencia?: boolean;
    /**
     * Reemissão de uma nota que a loja CANCELOU: os pedidos estão CANCELED, e
     * a falha ou o "processando" da nota NOVA tem de poder gravar neles. Fora
     * disto a trava SEM_NOTA_VIVA protege o CANCELED de propósito — a
     * automática nunca desfaz um cancelamento.
     */
    substituiCancelada?: boolean;
    /**
     * Emissor próprio: dispara o cupom fiscal na impressora quando a nota sai
     * (autorizada ou em contingência) — só na EMISSÃO, nunca na consulta: a
     * contingência efetivada pelo cron horas depois não reimprime nada.
     */
    imprimirDanfe?: boolean;
  }
): Promise<ResultadoAutomatico> {
  // Outra emissão do MESMO pedido está transmitindo agora (lib/nfce/numeracao):
  // é ela que grava. Gravar "processando" aqui poderia cobrir o resultado dela.
  if (!resultado.ok && "naoGravar" in resultado && resultado.naoGravar) {
    return { acao: "processando", motivo: resultado.mensagem };
  }
  const agora = new Date().toISOString();
  const { extra = {} } = contexto;
  // O que só o provedor sabe (emissor próprio: XML no cofre, QR Code, reserva
  // do número, envio a conferir) vai em TODA gravação, antes da identidade.
  const provedor = doProvedor(resultado);
  const semNotaViva: Prisma.CustomerOrderWhereInput = contexto.substituiCancelada
    ? { OR: [...(SEM_NOTA_VIVA.OR as Prisma.CustomerOrderWhereInput[]), { fiscalStatus: "CANCELED" }] }
    : SEM_NOTA_VIVA;
  // A tentativa nova apaga o "fim da retentativa" da anterior: sem isso, a
  // falha transitória de um gancho de status posterior herdaria a marca e
  // ficaria fora da fila do cron.
  const fiscalAtual = semMarcasDaTentativaAnterior(contexto.fiscalAtual);
  const daNota = contexto.nota ?? dadosGravados(fiscalAtual);
  // A SEFAZ bloqueada por consumo indevido (emissor próprio, `esperaSefazAte`):
  // a tentativa não é da nota — não conta, e a retentativa espera o bloqueio
  // passar (lib/fiscal-momento → decidirRetentativa). Sem isso, 5 ganchos de
  // status durante a hora do bloqueio encerravam a nota que sairia depois.
  const bloqueadaNaSefaz = typeof provedor.esperaSefazAte === "string" && provedor.esperaSefazAte !== "";
  const tentativas = (Number(fiscalAtual.tentativasAutomaticas) || 0) + (contexto.deConsulta || bloqueadaNaSefaz ? 0 : 1);
  // As marcas da loja (aviso do parceiro, devolução) não vêm de `fiscalAtual`,
  // lido antes da viagem ao provedor: na consulta elas são lidas do banco na
  // hora de gravar (`gravarNosPedidos`). `base` é o resto do fiscalInfo.
  const base = semAsMarcasDaLoja(fiscalAtual);
  const gravar = (
    onde: Prisma.CustomerOrderWhereInput,
    montar: (marcas: Record<string, unknown>) => Prisma.CustomerOrderUpdateManyMutationInput
  ) => gravarNosPedidos(pedidos, onde, montar, contexto.deConsulta ? null : marcasDaLoja(fiscalAtual));

  // ── CONTINGÊNCIA OFF-LINE: EMITTED, com a marca ──────────────────────────
  //
  // A nota em contingência (lib/fiscal-emissao, `emContingencia`) foi numerada
  // e o cupom VALE para o cliente — o DANFE tem de ser impresso na hora —,
  // mas a SEFAZ ainda vai receber a transmissão (até 24 h) e pode recusar.
  //
  // A versão anterior gravava isso como PENDING/"processando". Só que a rota
  // da aba Notas fiscais (api/store/fiscal/invoices) só devolve `pdfUrl` e a
  // chave para EMITTED, e a tela só mostra o DANFE em EMITTED: o balcão não
  // achava o cupom para imprimir. E a única ação que a tela oferece em
  // "Processando" era "Consultar situação" (GET api/store/fiscal/emitir), que
  // gravava EMITTED em qualquer `ok` sem olhar a contingência — a marca sumia
  // e o cron parava de consultar.
  //
  // Agora: EMITTED com a chave e o DANFE (a tela mostra e imprime), mais
  // `contingencia: true`. A marca é o que (1) faz o cron — e o "Consultar
  // situação", que grava por aqui (`sincronizarNota`) — consultar a nota até a
  // SEFAZ efetivar — aí a gravação de baixo apaga a marca — ou recusar — e aí
  // vira FAILED (`deContingencia`); (2) faz a trava de edição
  // (lib/edicao-de-pedido) falar da contingência; (3) faz a tela rotular
  // "Contingência — aguardando SEFAZ" e não oferecer cancelamento antes de a
  // SEFAZ efetivar. O botão Emitir grava por aqui também (`manual`).
  if (resultado.ok) {
    const emContingencia = resultado.emContingencia === true;
    // A origem do aviso de cancelamento gravado DURANTE a viagem (ver
    // `gravarNosPedidos`): a nota nova não herda a marca, mas o aviso é refeito
    // sobre ela, com a mesma origem.
    const avisosDaViagem: string[] = [];
    await gravarNosPedidos(pedidos, {}, (marcas) => {
      const aviso = objeto(marcas.alerta);
      if (!contexto.deConsulta && typeof aviso.origem === "string") avisosDaViagem.push(aviso.origem);
      return montarAutorizada(marcas);
    }, null, { obrigatorio: true });
    console.log(
      emContingencia
        ? `[Fiscal Auto] ⏳ NFC-e em contingência off-line (${resultado.chaveDeAcesso}) — pedido(s) ${pedidos.join(", ")}; o cron consulta até a SEFAZ efetivar.`
        : `[Fiscal Auto] ✅ NFC-e autorizada (${resultado.chaveDeAcesso}) — pedido(s) ${pedidos.join(", ")}.`
    );
    // O cupom fiscal do emissor próprio (na contingência também: o DANFE
    // "EMITIDA EM CONTINGÊNCIA" é o que o cliente leva). A Focus tem o dela.
    // A contingência RECUSADA e gerada de novo (lib/nfce/emissao-da-loja,
    // `contingenciaRefeita`) reimprime mesmo com a impressão automática
    // desligada e mesmo que o mesmo DANFE tenha saído há pouco: "imprimir o
    // DANFE-NFC-e correspondente [...] no mesmo tipo de papel utilizado para
    // imprimir o DANFE-NFC-e original" (Ajuste SINIEF 19/16, cl. 11ª § 1º III, c).
    const refeita = Boolean(provedor.contingenciaRefeita) && !contexto.deConsulta;
    if (!contexto.deConsulta && (contexto.imprimirDanfe !== false || refeita) && provedor.provedor === PROVEDOR_PROPRIO && pedidos[0]) {
      imprimirCupomFiscal(pedidos[0], refeita ? { forcar: true } : {});
    }
    if (!contexto.deConsulta) await avisarSeCanceladoNaEmissao(pedidos, avisosDaViagem[0] ?? null);
    return { acao: "emitida", motivo: resultado.chaveDeAcesso };
  }

  function montarAutorizada(marcas: Record<string, unknown>): Prisma.CustomerOrderUpdateManyMutationInput {
    if (!resultado.ok) throw new Error("montarAutorizada só serve à nota autorizada");
    const emContingencia = resultado.emContingencia === true;
    return {
      fiscalStatus: "EMITTED",
      fiscalInfo: {
        // A identidade da nota atravessa a gravação: a ref (`idDaNota`) é o
        // que a consulta e o cancelamento usam, e as notas canceladas que
        // esta substituiu vão para o contador. O fiscalInfo da autorizada é
        // montado do zero, e sem isto a reemissão (`<pedido>-2`) voltava a
        // ser consultada e cancelada pela ref queimada.
        ...identidadeGravada(fiscalAtual),
        // A consulta (cron ou "Consultar situação") não apaga o aviso de
        // pedido cancelado pelo parceiro nem a devolução registrada — as
        // que estão no banco AGORA, não as da leitura de antes da consulta.
        // A nota nova (emissão, reemissão) não herda marca da anterior.
        ...(contexto.deConsulta ? marcas : {}),
        nfceKey: resultado.chaveDeAcesso,
        nfceNumber: resultado.numero,
        serie: resultado.serie,
        protocol: resultado.protocolo,
        emittedAt: resultado.emitidaEm,
        ambiente: resultado.ambiente,
        xmlUrl: resultado.urlDoXml,
        pdfUrl: resultado.urlDoDanfe,
        // A consulta do cron não muda quem pediu a nota (a da conta pela
        // tela continua manual depois de efetivada).
        emitidaAutomaticamente:
          contexto.deConsulta && typeof fiscalAtual.emitidaAutomaticamente === "boolean"
            ? fiscalAtual.emitidaAutomaticamente
            : !contexto.manual,
        ...(emContingencia
          ? {
              contingencia: true,
              contingenciaDesde: fiscalAtual.contingenciaDesde ?? agora,
              ...(contexto.deConsulta ? { ultimaConsultaEm: agora } : {}),
            }
          : fiscalAtual.contingencia === true
            ? { contingenciaEfetivadaEm: agora, contingenciaDesde: fiscalAtual.contingenciaDesde ?? null }
            : {}),
        ...daNota,
        ...provedor,
        ...extra,
      } as Prisma.InputJsonValue,
    };
  }

  if (resultado.motivo === "processando") {
    await gravar(semNotaViva, (marcas) => ({
      fiscalStatus: "PENDING",
      fiscalInfo: {
        ...base,
        ...marcas,
        processando: true,
        // O ambiente vai junto: a trava de edição (lib/edicao-de-pedido)
        // não prende pedido por nota de homologação, e a consulta do cron
        // vai ao servidor e ao token DESTE ambiente.
        ambiente: contexto.ambiente,
        ...daNota,
        ultimaTentativaEm: contexto.deConsulta ? (fiscalAtual.ultimaTentativaEm ?? agora) : agora,
        ...(contexto.deConsulta ? { ultimaConsultaEm: agora } : {}),
        tentativasAutomaticas: tentativas,
        ...provedor,
        ...extra,
      } as Prisma.InputJsonValue,
    }));
    console.log(`[Fiscal Auto] ⏳ NFC-e em processamento na SEFAZ — pedido(s) ${pedidos.join(", ")}.`);
    return { acao: "processando", motivo: resultado.mensagem };
  }

  // Consulta que acha a nota CANCELADA (portal da SEFAZ, outro sistema): o
  // estado verdadeiro do documento é cancelado, não falha de emissão — em
  // qualquer estado em que o pedido estivesse, inclusive EMITTED (é o
  // "Consultar situação" de uma nota autorizada que alguém cancelou por fora).
  // Os dados da nota ficam: o contador precisa da cancelada também.
  const cancelada = Boolean(contexto.deConsulta) && resultado.motivo === "rejeitada" && resultado.mensagem.includes("CANCELADA");
  if (cancelada) {
    await gravar({}, (marcas) => ({
      fiscalStatus: "CANCELED",
      fiscalInfo: {
        ...base,
        ...marcas,
        processando: false,
        ...(fiscalAtual.contingencia === true ? { contingencia: false } : {}),
        ambiente: contexto.ambiente,
        canceladaEm: fiscalAtual.canceladaEm ?? agora,
        canceladaForaDoFireHub: true,
        ...(contexto.deConsulta ? { ultimaConsultaEm: agora } : {}),
        ...provedor,
        ...extra,
      } as Prisma.InputJsonValue,
    }));
    console.warn(`[Fiscal Auto] 🚫 A consulta achou a NFC-e CANCELADA na SEFAZ — pedido(s) ${pedidos.join(", ")}.`);
    return { acao: "falhou", motivo: resultado.mensagem };
  }
  // A 5ª falha de comunicação já sai da fila aqui, com o motivo: a busca do
  // cron exclui a linha marcada no banco (ver `retentarNotasFiscais`).
  const esgotou = ehFalhaTransitoria(resultado.motivo) && tentativas >= MAXIMO_DE_TENTATIVAS_AUTOMATICAS;
  if (esgotou) {
    console.warn(`[Fiscal Auto] ⛔ Retentativa encerrada (pedido(s) ${pedidos.join(", ")}): ${tentativas} tentativas sem resposta do provedor.`);
  }
  // A nota em contingência que a SEFAZ recusou na transmissão deixa de valer:
  // só aqui a falha pode ocupar o lugar de um EMITTED — e só o da contingência.
  const contingenciaRecusada = Boolean(contexto.deContingencia) && resultado.motivo === "rejeitada";
  const ondeGravar: Prisma.CustomerOrderWhereInput = contingenciaRecusada
    ? {
        OR: [...(SEM_NOTA_VIVA.OR as Prisma.CustomerOrderWhereInput[]), { fiscalStatus: "EMITTED", fiscalInfo: { path: ["contingencia"], equals: true } }],
      }
    : semNotaViva;
  const mensagem = contingenciaRecusada
    ? `A NFC-e emitida em CONTINGÊNCIA (o cupom já entregue ao cliente) foi recusada pela SEFAZ na transmissão: ${resultado.mensagem} ` +
      "O cupom não vale mais. Corrija e emita de novo pela tela Fiscal."
    : resultado.mensagem;
  // O que falta, item a item, fica gravado com a falha: a tela mostra na
  // linha, e a resposta da nota da conta (lib/fiscal-config →
  // respostaDaNotaDaConta) repassa como a do pedido comum. Teto de 20: é
  // lista para uma pessoa ler, não para crescer sem fim no JSONB.
  const pendencias = "pendencias" in resultado && Array.isArray(resultado.pendencias) ? resultado.pendencias.slice(0, 20) : [];
  const detalhe = "detalheDaRejeicao" in resultado && resultado.detalheDaRejeicao ? resultado.detalheDaRejeicao : undefined;
  await gravar(ondeGravar, (marcas) => ({
    fiscalStatus: "FAILED",
    fiscalInfo: {
      ...base,
      ...marcas,
      processando: false,
      ...(contingenciaRecusada ? { contingencia: false, contingenciaRecusadaEm: agora } : {}),
      ambiente: contexto.ambiente,
      ultimaTentativaEm: agora,
      ultimoErro: mensagem,
      motivo: resultado.motivo,
      // O cron só reemite o que é transitório (lib/fiscal-momento).
      transitoria: ehFalhaTransitoria(resultado.motivo),
      tentativaAutomatica: !contexto.manual,
      tentativasAutomaticas: tentativas,
      ...(esgotou
        ? { retentativaEncerrada: true, motivoDoFimDaRetentativa: motivoDasTentativasEsgotadas(tentativas), retentativaEncerradaEm: agora }
        : {}),
      ...(pendencias.length > 0 ? { pendencias } : {}),
      ...provedor,
      ...extra,
    } as Prisma.InputJsonValue,
  }));
  console.error(`[Fiscal Auto] ❌ NFC-e não autorizada (pedido(s) ${pedidos.join(", ")}): ${mensagem}`);
  return {
    acao: "falhou",
    motivo: mensagem,
    ...(pendencias.length > 0 ? { pendencias } : {}),
    ...(detalhe ? { detalhe } : {}),
  };
}

/**
 * Os campos que a DECISÃO lê. O pedido inteiro, com os itens, só é buscado
 * quando é para emitir — e aí vem completo, sem lista de campos: a montagem da
 * nota (`montarNotaDoPedido`) lê canal, endereço, descontos da plataforma e
 * troco, e uma lista aqui seria o lugar de um campo novo ficar para trás.
 */
const CAMPOS_DA_DECISAO = {
  id: true,
  franchiseeId: true,
  status: true,
  deliveryType: true,
  tableSessionId: true,
  paymentMethod: true,
  paymentMethods: true,
  gatewayPaymentId: true,
  fiscalStatus: true,
  fiscalInfo: true,
} as const;

/**
 * Emite a NFC-e do pedido se for a hora (lib/fiscal-momento) e a forma de
 * pagamento estiver na lista da loja. Pode ser chamada em QUALQUER mudança de
 * status: o que não é hora volta "ignorado" com duas leituras leves. Nunca
 * lança — quem chama dispara e segue.
 */
export async function emitirNfceAutomatica(orderId: string): Promise<ResultadoAutomatico> {
  // O que o `catch` precisa para registrar a exceção — preenchido à medida
  // que se sabe (o mesmo desenho de `emitirNfceDaMesa`).
  let alvo: AlvoDaGravacao | null = null;
  let respondido: ResultadoDaEmissao | null = null;
  try {
    const order = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: CAMPOS_DA_DECISAO });
    if (!order) return ignorado("pedido não encontrado");
    // Mesa: a nota é da CONTA, emitida no fechamento (emitirNfceDaMesa). A
    // regra "é mesa?" é a de lib/fiscal-momento, a mesma do botão Emitir.
    if (pedidoDeMesaExigeNotaDaConta(order)) return foraDaAutomatica("pedido de mesa — a nota sai no fechamento da conta");

    const loja = await lojaFiscal(order.franchiseeId);
    const config = loja.config;
    if (!config?.enabled) return ignorado("emissão desligada nesta loja");

    const fiscalAtual = objeto(order.fiscalInfo);
    const estado = estadoFiscal(order.fiscalStatus, fiscalAtual);
    // Autorizada não se emite de novo. Processando: reemitir duplicaria — a
    // consulta (o cron, ou "Consultar situação" na tela) resolve o estado.
    // Cancelada: a loja cancelou de propósito; reemitir sozinho desfaria isso.
    if (estado === "autorizada" || estado === "processando" || estado === "cancelada") {
      return ignorado(`nota ${estado}`);
    }

    if (!deveEmitirNoStatus(order, momentoDaEmissao(config))) {
      // Cancelado não volta a ter nota: isso sim tira da fila do cron.
      if (String(order.status || "").toUpperCase().startsWith("CANCEL")) {
        return foraDaAutomatica(`pedido ${order.status}`);
      }
      // "Ainda não é a hora" é PASSAGEIRO, e não pode tirar da fila. Uma
      // versão anterior marcava isto `foraDaAutomatica`, e o cron encerrava de
      // vez a falha do botão Emitir clicado antes da hora. Reproduzido em
      // 24/09/2026 (banco e provedor falsos): retirada em Pix, modo "saida",
      // Emitir em PREPARANDO com o provedor fora → FAILED por comunicação; a
      // 1ª rodada encerrou ("status PREPARANDO ainda não é a hora"); o pedido
      // foi a ENTREGUE por um caminho sem gancho (KDS, rota despachada,
      // fechamento de caixa, Brendi/JotaJá/99Food) e a 2ª rodada não fez
      // nada — a varredura só pega fiscalInfo vazio. A nota nunca saía. Fica
      // "ignorado" sem marca; quem evita que essas linhas ocupem a fila é a
      // busca do cron, que só traz status que já podem ter nota.
      return ignorado(`status ${order.status} ainda não é a hora da nota`);
    }

    const chaves: ChaveDePagamento[] = chavesDoPagamento(order);
    if (!formaEntraNaAutomatica(chaves, config.autoEmitPaymentMethods)) {
      return foraDaAutomatica(`forma "${order.paymentMethod}" fora da emissão automática`);
    }

    // Loja sem cadastro completo: não tenta (e não marca FAILED — a pendência
    // é de configuração, não deste pedido; a tela fiscal já lista o que falta).
    if (pendenciasParaEmitir(config).length > 0) {
      console.log(`[Fiscal Auto] Loja ${order.franchiseeId} com cadastro incompleto — pedido ${orderId} segue pendente.`);
      return ignorado("cadastro fiscal incompleto");
    }

    // A nota pela montagem da frente 1 (lib/fiscal-momento → pedidoParaNota):
    // canal, intermediador, endereço, descontos da plataforma e troco. O
    // objeto montado à mão que estava aqui não levava canal nem endereço, e
    // nenhuma nota de entrega montava (ver `montarNotaDoPedido`).
    const completo = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: { items: { include: { menuProduct: true } } },
    });
    if (!completo) return ignorado("pedido não encontrado");
    // A ref é a gravada quando a nota anterior foi cancelada e esta é a
    // reemissão (`<pedido>-2`): a do pedido está queimada no provedor.
    const ref = refDoPedidoComum(order.id, fiscalAtual);
    alvo = {
      pedidos: [order.id],
      principal: fiscalAtual,
      ambiente: Number(config.ambiente) === 1 ? 1 : 2,
      extra: ref !== order.id ? { idDaNota: ref } : {},
      extraSemResposta: ref !== order.id ? { idDaNota: ref } : {},
    };
    const nota: NotaParaEmitir = { ...montarNotaDoPedido(completo, loja), id: ref };
    alvo.nota = dadosDaNota(nota);

    // Os pedidos da nota vão junto: o emissor próprio reserva o número no
    // fiscalInfo deles (lib/nfce/numeracao). A Focus ignora.
    const resultado = await emitirNfce(config, nota, { lojaId: order.franchiseeId, pedidos: alvo.pedidos });
    respondido = resultado;
    return await gravarResultado(alvo.pedidos, resultado, {
      fiscalAtual,
      ambiente: alvo.ambiente,
      extra: alvo.extra,
      nota: alvo.nota,
      imprimirDanfe: imprimeODanfe(config),
    });
  } catch (err: any) {
    // Nunca propaga: emissão automática não pode derrubar a rota de status.
    // Mas também não some: antes era só um console.error, e o pedido ficava
    // "Não emitida" sem registro nenhum de que a nota foi tentada e por que
    // não saiu. Agora grava como a conta da mesa grava (`gravarExcecao`).
    const mensagem = String(err?.message || err);
    console.error(`[Fiscal Auto] Erro inesperado no pedido ${orderId}:`, mensagem);
    if (alvo) await gravarExcecao(alvo, respondido, mensagem, "A NFC-e do pedido");
    return ignorado(`erro: ${mensagem}`);
  }
}

/** Onde e com o quê gravar o resultado de uma emissão — e a exceção dela. */
type AlvoDaGravacao = {
  pedidos: string[];
  principal: Record<string, any>;
  ambiente: number;
  /** Identidade da nota: vai em toda gravação com resposta do provedor. */
  extra: Record<string, unknown>;
  /** O que vai quando o provedor NÃO respondeu (a ref nova de uma reemissão continua; a da primeira nota da conta, não). */
  extraSemResposta: Record<string, unknown>;
  /** O que a nota declara (`dadosDaNota`), quando ela já foi montada. */
  nota?: Record<string, unknown>;
  manual?: boolean;
  substituiCancelada?: boolean;
};

/**
 * Registra a exceção de uma emissão (ver `oQueGravarNaExcecao`). Se nem isso
 * gravar (o banco caiu junto), fica no log — e a varredura ou a próxima
 * mudança de status tentam de novo.
 */
async function gravarExcecao(alvo: AlvoDaGravacao, respondido: ResultadoDaEmissao | null, mensagem: string, oQue: string): Promise<void> {
  try {
    await gravarResultado(alvo.pedidos, oQueGravarNaExcecao(respondido, mensagem, oQue), {
      fiscalAtual: alvo.principal,
      ambiente: alvo.ambiente,
      extra: respondido ? alvo.extra : alvo.extraSemResposta,
      nota: respondido ? alvo.nota : undefined,
      manual: alvo.manual,
      substituiCancelada: alvo.substituiCancelada,
    });
  } catch (err2: any) {
    console.error(`[Fiscal Auto] Não gravou a exceção da nota (pedido(s) ${alvo.pedidos.join(", ")}):`, err2?.message);
  }
}

/**
 * O botão "Emitir" de um pedido comum (POST api/store/fiscal/emitir).
 *
 * ── Por que mora aqui ───────────────────────────────────────────────────────
 *
 * A rota montava a nota à mão (itens, total, taxa, desconto e o texto da
 * forma) e gravava o resultado por conta própria. Ficava de fora o que decide
 * se a SEFAZ aceita: o canal (o iFood, com a taxa de serviço de R$ 0,99 no
 * `totalAmount`, era tratado como canal próprio e a conferência de total
 * recusava a nota), o intermediador, o endereço da entrega, o pagamento
 * dividido, o troco e quem pagou o cupom. E a gravação não sabia de
 * contingência: a nota off-line virava EMITTED comum e ninguém mais a
 * consultava até a SEFAZ efetivar.
 *
 * Agora a nota é a de `pedidoParaNota` (com o CPF do modal e o merchant da
 * loja) e a gravação é a mesma da automática (`gravarResultado`, `manual`),
 * com a trava de nota viva, a marca de contingência, o ambiente e o que a
 * nota declarou (`valorDaNota`, `formaNaNota`).
 *
 * ── Reemissão ───────────────────────────────────────────────────────────────
 *
 * Nota CANCELADA pela loja (a emitida errado, cancelada dentro do prazo): a
 * nova sai com ref nova (`<pedido>-2`) — a antiga está queimada no provedor e
 * reenviá-la devolveria a cancelada —, e a cancelada fica guardada em
 * `notasAnteriores` para o contador.
 */
export async function emitirNfceDoPedidoPelaTela(
  order: PedidoDoBanco & { franchiseeId: string; fiscalStatus?: string | null; fiscalInfo?: unknown },
  loja: LojaParaNota,
  config: ConfigDaLoja,
  opcoes: { documentoInformado?: string | null } = {}
): Promise<{ resultado: ResultadoDaEmissao | FalhaInterna; reemissao: boolean; ref: string }> {
  const info = objeto(order.fiscalInfo);
  const reemissao = order.fiscalStatus === "CANCELED" && Boolean(info.nfceKey);
  const ref = reemissao ? refDaReemissao(idDaNotaDoPedido(order), order.id) : refDoPedidoComum(order.id, info);
  const identidade: Record<string, unknown> = ref !== order.id ? { idDaNota: ref } : {};
  if (reemissao) identidade.notasAnteriores = notasAnterioresComA(order);
  const alvo: AlvoDaGravacao = {
    pedidos: [order.id],
    // A tentativa nova não herda a nota cancelada (chave, número,
    // cancelamento): ela vive em `notasAnteriores`.
    principal: reemissao ? {} : info,
    ambiente: Number(config.ambiente) === 1 ? 1 : 2,
    extra: identidade,
    extraSemResposta: identidade,
    manual: true,
    substituiCancelada: reemissao,
  };
  let respondido: ResultadoDaEmissao | null = null;
  try {
    const nota: NotaParaEmitir = { ...pedidoParaNota(order, { documentoInformado: opcoes.documentoInformado, loja }), id: ref };
    alvo.nota = dadosDaNota(nota);
    respondido = await emitirNfce(config, nota, { lojaId: order.franchiseeId, pedidos: alvo.pedidos });
    await gravarResultado(alvo.pedidos, respondido, {
      fiscalAtual: alvo.principal,
      ambiente: alvo.ambiente,
      extra: alvo.extra,
      nota: alvo.nota,
      manual: true,
      substituiCancelada: reemissao,
      imprimirDanfe: imprimeODanfe(config),
    });
    return { resultado: respondido, reemissao, ref };
  } catch (err: any) {
    const mensagem = String(err?.message || err);
    console.error(`[Fiscal Emitir] Erro na nota do pedido ${order.id}:`, mensagem);
    await gravarExcecao(alvo, respondido, mensagem, "A NFC-e do pedido");
    return { resultado: oQueGravarNaExcecao(respondido, mensagem, "A NFC-e do pedido"), reemissao, ref };
  }
}

/**
 * A loja do pedido tem a emissão LIGADA? O mesmo filtro da lista de lojas do
 * cron (`retentarNotasFiscais`), para ir junto na busca dos pedidos.
 */
const DE_LOJA_COM_EMISSAO: Prisma.CustomerOrderWhereInput = {
  franchisee: { is: { fiscalConfig: { path: ["enabled"], equals: true } } },
};

/**
 * Para quem muda status em lote (updateMany) e não tem os ids na mão — o
 * evento do iFood grava por `ifoodOrderId`. Em sequência, não em paralelo: são
 * poucos, e não há por que abrir dez conexões com o provedor de uma vez.
 *
 * Só vêm pedidos de loja com a emissão ligada, na MESMA busca: o gancho roda
 * em todo evento de status de toda loja, e a loja sem fiscal (quase todas)
 * pagava três leituras por evento — os pedidos, e para cada um o pedido de
 * novo e a loja — para ouvir "emissão desligada". Agora é uma leitura e zero
 * pedidos.
 */
export async function emitirNfceDosPedidos(where: Prisma.CustomerOrderWhereInput, limite = 50): Promise<void> {
  try {
    const pedidos = await prisma.customerOrder.findMany({ where: { AND: [where, DE_LOJA_COM_EMISSAO] }, select: { id: true }, take: limite });
    for (const p of pedidos) await emitirNfceAutomatica(p.id);
  } catch (err: any) {
    console.error("[Fiscal Auto] Erro ao emitir em lote:", err?.message);
  }
}

/**
 * UMA nota para a conta da mesa, no fechamento.
 *
 * ── Antes ───────────────────────────────────────────────────────────────────
 *
 * O fechamento chamava a emissão pedido a pedido, em paralelo: a mesa de cinco
 * rodadas gerava cinco NFC-e, cada uma sem o desconto da conta e com a forma
 * "N/A" do pedido de mesa — que não casa com forma nenhuma da lista, então na
 * prática nenhuma saía (720 pedidos de mesa ENTREGUE em 30 dias, todos "N/A").
 * Agora é uma nota com os itens de todos os pedidos, o desconto da conta e as
 * formas em que a mesa pagou (montarNotaDaMesa), gravada em todos os pedidos
 * da sessão com a MESMA chave e `fiscalInfo.idDaNota = "mesa-<sessão>"`.
 *
 * ── O desconto da conta ─────────────────────────────────────────────────────
 *
 * A rota de fechamento calcula o desconto e não o grava na sessão (não há
 * coluna): ela o passa aqui, em `conta.desconto`. Ele é gravado nos pedidos
 * (`fiscalInfo.contaDaMesa`) ANTES de qualquer coisa que possa dar errado —
 * é de lá que a retentativa e a varredura das contas esquecidas leem. Conta
 * sem desconto gravado (a exceção veio antes até disso) usa o deduzido do
 * pago (`descontoDaContaPeloPago`, lib/fiscal-momento), e a origem fica
 * gravada em `contaDaMesa.origemDoDesconto`.
 *
 * ── Rede de segurança ───────────────────────────────────────────────────────
 *
 * O fechamento dispara isto sem esperar. Uma exceção aqui dentro era só um
 * console.error: a conta ficava sem nota e sem registro, e a varredura dos
 * esquecidos filtrava `tableSessionId: null`. Agora:
 *  - exceção ANTES de o provedor responder (a montagem, dentro ou fora de
 *    `emitirNfce`) → FAILED "erro_interno" com a mensagem (aparece em
 *    "Falhou", e a retentativa não refaz: daria o mesmo erro);
 *  - exceção DEPOIS, na gravação → nota autorizada vira "processando" com a
 *    ref da conta e os dados da nota, e a consulta do cron confirma; falha é
 *    gravada de novo como a falha que foi;
 *  - exceção antes de saber quais são os pedidos (a leitura da sessão) → a
 *    varredura das contas esquecidas (`emitirContasDaMesaEsquecidas`) pega.
 *
 * `conta.manual`: a nota da conta pedida por uma pessoa (tela Fiscal). Não
 * passa pela lista de formas da emissão automática — quem pediu decidiu.
 */
export async function emitirNfceDaMesa(
  tableSessionId: string,
  conta: { desconto?: number | null; manual?: boolean } = {}
): Promise<ResultadoAutomatico> {
  // O que o `catch` precisa para registrar a falha, preenchido à medida que se sabe.
  let alvo: AlvoDaGravacao | null = null;
  // A resposta do provedor, quando houve. É ELA que diz se a nota pode
  // existir — não o "vou enviar" (ver o `catch`).
  let respondido: ResultadoDaEmissao | null = null;
  try {
    // A loja e o estado da conta ANTES de carregar a sessão com os pedidos e
    // os itens: o fechamento de toda conta de toda loja chama aqui, e a loja
    // sem fiscal carregava a mesa inteira para ouvir "emissão desligada".
    const cabecalho = await prisma.tableSession.findUnique({ where: { id: tableSessionId }, select: { franchiseeId: true, status: true } });
    if (!cabecalho) return ignorado("conta não encontrada");
    // A nota é do que foi PAGO: conta aberta ainda pode ganhar pedido.
    if (cabecalho.status !== "CLOSED") return foraDaAutomatica("conta ainda aberta");
    const config = await configDaLoja(cabecalho.franchiseeId);
    if (!config?.enabled) return ignorado("emissão desligada nesta loja");

    const sessao = await prisma.tableSession.findUnique({
      where: { id: tableSessionId },
      select: {
        id: true,
        franchiseeId: true,
        status: true,
        customerName: true,
        serviceFee: true,
        waiterTip: true,
        paymentMethods: true,
        orders: {
          select: {
            id: true,
            dailyOrderNumber: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            customerCpfCnpj: true,
            fiscalStatus: true,
            fiscalInfo: true,
            items: { include: { menuProduct: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!sessao) return ignorado("conta não encontrada");
    if (sessao.status !== "CLOSED") return foraDaAutomatica("conta ainda aberta");

    const validos = sessao.orders.filter((o) => !String(o.status || "").toUpperCase().startsWith("CANCEL"));
    if (validos.length === 0) return foraDaAutomatica("conta sem pedido válido");

    // `daConta`: a nota gravada é da conta DESTA mesa — a primeira
    // (`mesa-<sessão>`) ou uma reemissão (`mesa-<sessão>-2`...).
    const estados = validos.map((o) => {
      const info = objeto(o.fiscalInfo);
      return { o, info, estado: estadoFiscal(o.fiscalStatus, info), daConta: ehNotaDaConta(info.idDaNota, sessao.id) };
    });
    if (estados.some((e) => e.estado === "autorizada" && e.daConta)) return ignorado("a conta já tem nota");
    if (estados.some((e) => e.estado === "processando")) return ignorado("nota da conta em processamento");

    // ── A ref da nota ───────────────────────────────────────────────────────
    // Nota da conta CANCELADA: só uma pessoa pede outra (a automática nunca
    // desfaz um cancelamento), e ela sai com ref nova — a antiga está queimada
    // no provedor e devolveria a cancelada. A cancelada vai para
    // `notasAnteriores` (o contador precisa dela). Uma tentativa anterior que
    // falhou reusa a MESMA ref: o provedor pode já ter a nota.
    const cancelada = estados.find((e) => e.estado === "cancelada" && e.daConta);
    if (cancelada && !conta.manual) return ignorado("nota da conta cancelada pela loja");
    const tentativaAnterior = estados.find((e) => e.estado !== "autorizada" && e.estado !== "cancelada" && e.daConta);
    const base = idDaNotaDaMesa(sessao.id);
    const idDaNota = cancelada
      ? refDaReemissao(String(cancelada.info.idDaNota), base)
      : tentativaAnterior
        ? String(tentativaAnterior.info.idDaNota)
        : base;
    const notasAnteriores: unknown[] = cancelada
      ? notasAnterioresComA(cancelada.o)
      : Array.isArray(tentativaAnterior?.info.notasAnteriores) ? tentativaAnterior!.info.notasAnteriores : [];

    // A base do fiscalInfo gravado em todos: a de um pedido SEM nota própria —
    // nunca copiar a chave de uma nota avulsa para os outros pedidos. Na
    // reemissão, nem a da nota cancelada: ela vive em `notasAnteriores`.
    const principalBruto = (estados.find((e) => e.estado !== "autorizada") ?? estados[0]).info;
    const principal = cancelada ? escolher(principalBruto, ["contaDaMesa"]) : principalBruto;
    const ambiente = Number(config.ambiente) === 1 ? 1 : 2;
    const pagamentos = lerPagamentos(sessao.paymentMethods);

    // ── O desconto: do fechamento, o gravado, ou o deduzido do pago ─────────
    const gravada = estados.map((e) => objeto(e.info.contaDaMesa)).find((c) => typeof c.desconto === "number");
    const doFechamento = conta.desconto != null && Number.isFinite(Number(conta.desconto)) ? Number(conta.desconto) : null;
    const origemDoDesconto = doFechamento != null ? "fechamento" : gravada ? "gravado" : "pago";
    const desconto =
      doFechamento ??
      (gravada
        ? Number(gravada.desconto)
        : descontoDaContaPeloPago({
            lancado: validos.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0),
            pago: somarPagamentos(pagamentos),
            taxaDeServico: sessao.serviceFee,
            gorjeta: sessao.waiterTip,
          }));
    const contaDaMesa: Record<string, unknown> = {
      desconto,
      taxaDeServico: sessao.serviceFee ?? 0,
      gorjeta: sessao.waiterTip ?? 0,
      origemDoDesconto: gravada?.origemDoDesconto ?? origemDoDesconto,
    };
    // Grava o desconto do fechamento antes de tudo que pode falhar: é o único
    // lugar em que ele existe. Só em pedido ainda sem fiscalInfo — o resto
    // recebe na gravação do resultado.
    if (doFechamento != null && !gravada) {
      await prisma.customerOrder.updateMany({
        where: { id: { in: validos.map((o) => o.id) }, fiscalInfo: { equals: Prisma.AnyNull } },
        data: { fiscalInfo: { contaDaMesa } as Prisma.InputJsonValue },
      });
    }
    // Sem resposta do provedor, a primeira nota da conta não existe: sem
    // `idDaNota` (a próxima tentativa começa limpa). A ref de uma REEMISSÃO
    // fica: a da nota cancelada está queimada, e voltar a ela emperraria a conta.
    const identidadeSemResposta: Record<string, unknown> = {
      contaDaMesa,
      ...(idDaNota !== base ? { idDaNota } : {}),
      ...(notasAnteriores.length > 0 ? { notasAnteriores } : {}),
    };
    alvo = {
      pedidos: validos.map((o) => o.id),
      principal,
      ambiente,
      extra: identidadeSemResposta,
      extraSemResposta: identidadeSemResposta,
      manual: conta.manual,
      substituiCancelada: Boolean(cancelada),
    };

    // ── Rodada com NFC-e própria (legado) ──────────────────────────────────
    // A nota da conta repetiria os itens dela. A automática não adivinha: grava
    // o motivo em "Falhou" e manda a loja à tela. Pedida por uma pessoa, sai a
    // nota do RESTANTE — as outras rodadas, com o pagamento da conta menos o
    // que a nota da rodada declarou (lib/fiscal-momento → pagamentosDoRestante,
    // que recusa em vez de chutar quando não dá para separar).
    const proprias = estados.filter((e) => e.estado === "autorizada" && !e.daConta);
    let pedidosDaNota = validos;
    let pagamentosDaNota: { method: string; amount: number }[] = pagamentos;
    if (proprias.length > 0) {
      const semNota = validos.filter((o) => !proprias.some((p) => p.o.id === o.id));
      if (semNota.length === 0) return foraDaAutomatica("todos os pedidos da conta já têm nota própria");
      alvo.pedidos = semNota.map((o) => o.id);
      if (!conta.manual) {
        return await gravarResultado(
          alvo.pedidos,
          {
            ok: false,
            motivo: "dados_incompletos",
            mensagem:
              "Um pedido desta mesa já tem NFC-e própria, então a nota da conta não saiu sozinha " +
              "(ela repetiria os itens daquele pedido). Emita a nota do restante pela tela Fiscal (botão Emitir de outro pedido da mesa).",
          },
          // Sem `idDaNota`: não existe nota da conta para consultar ou cancelar.
          { fiscalAtual: principal, ambiente, extra: { contaDaMesa } }
        );
      }
      const restante = pagamentosDoRestante(
        pagamentos,
        proprias.map((e) => ({
          nome: e.o.dailyOrderNumber != null ? `#${e.o.dailyOrderNumber}` : `(${e.o.id.slice(-6)})`,
          valor: typeof e.info.valorDaNota === "number" ? e.info.valorDaNota : Number(e.o.totalAmount) || 0,
          forma: typeof e.info.formaNaNota === "string" && e.info.formaNaNota ? e.info.formaNaNota : e.o.paymentMethod ?? null,
        }))
      );
      if (!restante.ok) {
        return await gravarResultado(
          alvo.pedidos,
          { ok: false, motivo: "dados_incompletos", mensagem: restante.motivo },
          { fiscalAtual: principal, ambiente, extra: { contaDaMesa }, manual: true, substituiCancelada: Boolean(cancelada) }
        );
      }
      pedidosDaNota = semNota;
      pagamentosDaNota = restante.pagos;
    }

    if (!conta.manual && !formaEntraNaAutomatica(chavesDaConta(pagamentos), config.autoEmitPaymentMethods)) {
      return foraDaAutomatica(`formas da conta (${pagamentos.map((p) => p.method).join(", ") || "nenhuma"}) fora da emissão automática`);
    }
    if (pendenciasParaEmitir(config).length > 0) return ignorado("cadastro fiscal incompleto");

    const montagem = montarNotaDaMesa({
      sessionId: sessao.id,
      pedidos: pedidosDaNota.map((o) => ({
        id: o.id,
        status: o.status,
        totalAmount: o.totalAmount,
        customerCpfCnpj: o.customerCpfCnpj,
        itens: montarItensDaNota(o.items as any),
      })),
      pagamentos: pagamentosDaNota,
      desconto,
      taxaDeServico: sessao.serviceFee,
      taxaDeServicoNaNota: config.taxaDeServicoNaNota === true,
      gorjeta: sessao.waiterTip,
      nomeDoCliente: sessao.customerName,
    });
    if (!montagem.ok) {
      // Total zero, conta sem itens: é da conta, não muda com o tempo. Fica
      // marcado (sem mudar o status fiscal) para a varredura não tentar a
      // cada 2 minutos uma nota que não existe. Pedido com a nota cancelada
      // não é tocado: o registro dela não pode ser trocado por esta marca.
      await prisma.customerOrder.updateMany({
        where: { id: { in: alvo.pedidos }, ...SEM_NOTA_VIVA },
        data: {
          fiscalInfo: {
            ...semMarcasDaTentativaAnterior(principal),
            contaDaMesa,
            semNotaAutomatica: { motivo: montagem.motivo, em: new Date().toISOString() },
          } as Prisma.InputJsonValue,
        },
      });
      return foraDaAutomatica(montagem.motivo);
    }

    const nota: NotaParaEmitir = { ...montagem.nota, id: idDaNota };
    const extra = {
      idDaNota,
      notaDaConta: {
        tableSessionId: sessao.id,
        pedidos: montagem.pedidos,
        ...(proprias.length > 0 ? { restante: true, pedidosComNotaPropria: proprias.map((e) => e.o.id) } : {}),
      },
      // `eletronicoReduzido`: quanto do cartão/Pix a nota declara a menos do
      // cobrado (a taxa paga no cartão com a taxa fora da nota) — para quem
      // conferir a DIMP saber de onde vem a diferença.
      contaDaMesa: { ...contaDaMesa, eletronicoReduzido: montagem.eletronicoReduzido },
      ...(notasAnteriores.length > 0 ? { notasAnteriores } : {}),
    };
    alvo = { ...alvo, pedidos: montagem.pedidos, extra, nota: dadosDaNota(nota) };
    // A nota da conta também reserva número — em todos os pedidos dela.
    const resultado = await emitirNfce(config, nota, { lojaId: sessao.franchiseeId, pedidos: montagem.pedidos });
    respondido = resultado;
    return await gravarResultado(montagem.pedidos, resultado, {
      fiscalAtual: principal,
      ambiente,
      extra,
      nota: alvo.nota,
      manual: conta.manual,
      substituiCancelada: Boolean(cancelada),
      imprimirDanfe: imprimeODanfe(config),
    });
  } catch (err: any) {
    const mensagem = String(err?.message || err);
    console.error(`[Fiscal Auto] Erro inesperado na conta da mesa ${tableSessionId}:`, mensagem);
    // ── Antes ou depois do provedor ──────────────────────────────────────
    //
    // A marca era "vou enviar", posta ANTES de `emitirNfce` — só que
    // `emitirNfce` só lança antes do fetch (pendências dos itens,
    // `montarCorpoDaNfce`); a parte de rede tem try/catch e devolve
    // `ok: false`. Uma exceção de montagem virava "processando", a consulta
    // respondia "não encontrou", a falha virava transitória e o ciclo se
    // repetia até "5 tentativas sem resposta do provedor", quando o defeito
    // era nosso. Agora vale a RESPOSTA (`oQueGravarNaExcecao`): sem ela, erro
    // interno; com ela, a exceção foi na gravação — e o que se grava é o que o
    // provedor disse (autorizada vira "processando", para a consulta do cron
    // confirmar; falha é gravada de novo como falha).
    //
    // E a nota vai junto (`alvo.nota`): sem ela o "processando" ficava sem
    // `valorDaNota`/`formaNaNota`, e a consulta — que só copia o gravado —
    // levava a EMITTED sem eles. Reproduzido: conta de R$ 50 com R$ 5 de
    // desconto, paga R$ 45 no Pix, banco caindo na gravação do EMITTED →
    // depois da consulta `valorDaNota` undefined, e `agruparPorNota` dava 50
    // para uma nota de vNF 45. Se nem a falha gravar (o banco caiu junto), a
    // varredura das contas esquecidas pega depois.
    if (alvo) await gravarExcecao(alvo, respondido, mensagem, "A nota da conta");
    return ignorado(`erro: ${mensagem}`);
  }
}

/**
 * Pedidos que chegaram à hora da nota por um caminho sem gancho e nunca
 * tiveram tentativa (fiscalInfo vazio): rota despachada, KDS, Brendi, JotaJá,
 * 99Food, o "dar como entregue" do fechamento de caixa. E, desde 24/09/2026,
 * as contas de mesa fechadas sem nota (`emitirContasDaMesaEsquecidas`).
 *
 * A janela é curta de propósito (`inicioDaVarredura`, lib/fiscal-momento):
 * ligar a emissão numa loja não pode sair emitindo o dia inteiro para trás.
 *
 * O filtro fino (tipo de entrega, forma de pagamento) é em memória, com as
 * mesmas funções do gancho: pedido fora da lista não pode ocupar a vez de quem
 * precisa de nota — com um `take` no banco, trinta pedidos em dinheiro
 * prenderiam a varredura nos mesmos trinta para sempre.
 */
export async function emitirNotasEsquecidas(opcoes: {
  franchiseeId: string;
  desde?: Date | null;
  limite?: number;
  config?: ConfigDaLoja | null;
  /** O relógio da rodada do cron: acabou, para (o resto fica para a próxima). */
  acabou?: () => boolean;
}): Promise<number> {
  try {
    const config = opcoes.config ?? (await configDaLoja(opcoes.franchiseeId));
    if (!config?.enabled || pendenciasParaEmitir(config).length > 0) return 0;
    const momento = momentoDaEmissao(config);
    const inicio = inicioDaVarredura({ agora: Date.now(), desde: opcoes.desde, emissaoLigadaEm: config.emissaoLigadaEm });

    const candidatos = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: opcoes.franchiseeId,
        tableSessionId: null,
        createdAt: { gte: inicio },
        status: { in: statusQuePodemEmitir(momento) },
        fiscalInfo: { equals: Prisma.AnyNull },
        OR: [{ fiscalStatus: null }, { fiscalStatus: "PENDING" }],
      },
      select: { id: true, status: true, deliveryType: true, tableSessionId: true, paymentMethod: true, paymentMethods: true, gatewayPaymentId: true },
      // O mais recente primeiro: é o que ainda pode estar saindo da loja.
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const daVez = candidatos
      .filter((c) => deveEmitirNoStatus(c, momento) && formaEntraNaAutomatica(chavesDoPagamento(c), config.autoEmitPaymentMethods))
      .slice(0, opcoes.limite ?? 30);

    let tentadas = 0;
    for (const c of daVez) {
      // Cada emissão pode esperar a SEFAZ inteira (dezenas de segundos): sem
      // olhar o relógio, a rodada passava do orçamento e encostava na próxima.
      if (opcoes.acabou?.()) return tentadas;
      const r = await emitirNfceAutomatica(c.id);
      if (r.acao !== "ignorado") tentadas++;
    }
    if (opcoes.acabou?.()) return tentadas;
    tentadas += await emitirContasDaMesaEsquecidas({ franchiseeId: opcoes.franchiseeId, inicio, config, acabou: opcoes.acabou });
    return tentadas;
  } catch (err: any) {
    console.error(`[Fiscal Auto] Erro na varredura da loja ${opcoes.franchiseeId}:`, err?.message);
    return 0;
  }
}

/**
 * A conta de mesa FECHADA que ficou sem nota e sem registro de tentativa
 * (`contaDaMesaEsquecida`, lib/fiscal-momento), quando a emissão automática
 * da loja cobre as formas em que a conta foi paga. Mesma janela da varredura
 * dos pedidos, contada pelo fechamento (é ele que manda na nota da conta).
 *
 * O filtro é em memória pelo mesmo motivo da varredura dos pedidos: conta
 * paga em forma fora da lista não pode ocupar a vez. O desconto sai do que o
 * fechamento gravou (`contaDaMesa`) — ver `emitirNfceDaMesa`.
 */
async function emitirContasDaMesaEsquecidas(opcoes: {
  franchiseeId: string;
  inicio: Date;
  config: ConfigDaLoja;
  limite?: number;
  acabou?: () => boolean;
}): Promise<number> {
  const contas = await prisma.tableSession.findMany({
    where: { franchiseeId: opcoes.franchiseeId, status: "CLOSED", closedAt: { gte: opcoes.inicio } },
    select: {
      id: true,
      paymentMethods: true,
      orders: { select: { status: true, fiscalStatus: true, fiscalInfo: true } },
    },
    orderBy: { closedAt: "desc" },
    take: 300,
  });
  const daVez = contas
    .filter(
      (c) =>
        contaDaMesaEsquecida(c.orders) &&
        formaEntraNaAutomatica(chavesDaConta(lerPagamentos(c.paymentMethods)), opcoes.config.autoEmitPaymentMethods)
    )
    .slice(0, opcoes.limite ?? 10);

  let tentadas = 0;
  for (const c of daVez) {
    if (opcoes.acabou?.()) break;
    console.log(`[Fiscal Auto] Conta de mesa ${c.id} fechada sem nota — emitindo pela varredura.`);
    const r = await emitirNfceDaMesa(c.id);
    if (r.acao !== "ignorado") tentadas++;
  }
  return tentadas;
}

export type ResumoDaRetentativa = {
  lojas: number;
  consultadas: number;
  reemitidas: number;
  /** Falhas que saíram da fila de vez neste rodada, com o motivo gravado. */
  encerradas: number;
  esquecidas: number;
  parouPeloRelogio: boolean;
  /** Emissor próprio: números tentados que saíram de "a conferir" (inutilizados ou cancelados). */
  tentadosConferidos?: number;
  /** Emissor próprio: envios sem desfecho de pedidos FAILED que foram consultados. */
  enviosReconciliados?: number;
  /** Emissor próprio: faixas inutilizadas pela inutilização mensal. */
  faixasInutilizadas?: number;
  /** Lojas puladas porque outra rodada do cron ainda estava nelas (a concessão). */
  lojasEmOutraRodada?: number;
};

// ── A CONCESSÃO DA RODADA (uma rodada do cron por loja de cada vez) ─────────
//
// O cron-runner chama a cada 2 minutos, e a rota continua rodando depois que
// ele desiste (55 s): uma rodada lenta (SEFAZ esperando o timeout) encostava
// na seguinte, e as duas conferiam, transmitiam e reemitiam as MESMAS notas.
//
// Por que CONCESSÃO com validade, e não trava do Postgres: o
// pg_advisory_lock de SESSÃO fica na conexão, e com o pool do Prisma o
// "unlock" pode sair por outra conexão (a trava fica presa até a conexão
// morrer); o pg_advisory_xact_lock só vale enquanto a transação está aberta —
// segurar uma transação durante as conversas com a SEFAZ (dezenas de
// segundos por loja) prenderia uma conexão do pool e bateria no timeout da
// transação interativa. A concessão é UMA escrita curta, compare-and-set no
// próprio UPDATE (só pega quem acha a vaga livre, vencida ou sua): não prende
// conexão, vale entre processos e instâncias, e se o processo morrer ela
// simplesmente vence. Mora em fiscalConfig.rodadaFiscal = { dono, ate (ms) },
// mesclada pelo jsonb (o PUT da tela é compare-and-swap e preserva a chave).
const CONCESSAO_DA_RODADA_MS = 5 * 60_000;

/** Pega a loja para esta rodada (1 = pegou; 0 = outra rodada está nela). */
export function sqlPegarConcessaoDaRodada(lojaId: string, dono: string, agoraMs: number): Prisma.Sql {
  return Prisma.sql`/* fh:pegar-concessao-da-rodada */ UPDATE "User"
SET "fiscalConfig" = jsonb_set(
      CASE WHEN jsonb_typeof("fiscalConfig") = 'object' THEN "fiscalConfig" ELSE '{}'::jsonb END,
      '{rodadaFiscal}',
      ${JSON.stringify({ dono, ate: agoraMs + CONCESSAO_DA_RODADA_MS })}::jsonb,
      true)
WHERE "id" = ${lojaId}
  AND (
    (CASE WHEN ("fiscalConfig"->'rodadaFiscal'->>'ate') ~ '^[0-9]{1,15}$' THEN ("fiscalConfig"->'rodadaFiscal'->>'ate')::bigint ELSE 0 END) < ${agoraMs}::bigint
    OR "fiscalConfig"->'rodadaFiscal'->>'dono' = ${dono}
  )`;
}

/** Solta a loja — só se a concessão ainda for desta rodada. */
export function sqlSoltarConcessaoDaRodada(lojaId: string, dono: string): Prisma.Sql {
  return Prisma.sql`/* fh:soltar-concessao-da-rodada */ UPDATE "User"
SET "fiscalConfig" = "fiscalConfig" - 'rodadaFiscal'
WHERE "id" = ${lojaId} AND jsonb_typeof("fiscalConfig") = 'object' AND "fiscalConfig"->'rodadaFiscal'->>'dono' = ${dono}`;
}

/**
 * Tira da fila de retentativa, gravando o motivo no pedido. Só em FAILED: se
 * outra tentativa já mudou o estado, a marca não se aplica.
 */
async function encerrarRetentativa(pedidos: { id: string; fiscalInfo: unknown }[], motivo: string): Promise<number> {
  const agora = new Date().toISOString();
  let n = 0;
  for (const p of pedidos) {
    const r = await prisma.customerOrder.updateMany({
      where: { id: p.id, fiscalStatus: "FAILED" },
      data: {
        fiscalInfo: {
          ...objeto(p.fiscalInfo),
          retentativaEncerrada: true,
          motivoDoFimDaRetentativa: motivo,
          retentativaEncerradaEm: agora,
        } as Prisma.InputJsonValue,
      },
    });
    n += r.count;
  }
  if (n > 0) console.warn(`[Fiscal Auto] ⛔ Retentativa encerrada (${pedidos.map((p) => p.id).join(", ")}): ${motivo}`);
  return n;
}

/**
 * O trabalho do cron `api/cron/fiscal-retentativa`, loja a loja:
 *
 *   1. "Processando" e contingência off-line: consulta a ref no provedor, no
 *      ambiente em que a nota saiu. A nota que a SEFAZ demorou a autorizar
 *      ficava PENDING para sempre — ninguém consultava sozinho. Entra a nota
 *      gravada nas últimas 48 h, inclusive a emitida à mão para venda antiga
 *      (até 31 dias — `JANELA_DA_VENDA_CONSULTADA_MS`).
 *   2. FAILED transitório (provedor fora, timeout): reemite com espera
 *      dobrando e teto de tentativas (`decidirRetentativa`), só no mesmo
 *      ambiente e para venda posterior a `emissaoLigadaEm`
 *      (`retentativaCabeNaEmissaoAtual`). Reemitir é seguro: a ref é a
 *      mesma, e o provedor devolve a nota que já existir.
 *   3. Esquecidos: `emitirNotasEsquecidas` (pedidos e contas de mesa).
 *   4. Emissor próprio: número tentado, envios sem desfecho de pedidos que
 *      falharam e inutilização mensal (lib/nfce/rotina-da-sefaz).
 *
 * Só entram lojas com a emissão LIGADA — hoje nenhuma, e o cron custa uma
 * leitura. A config é a NORMALIZADA (`configNormalizada`): com o legado cru,
 * "producao" por extenso virava homologação na reemissão. Cada loja passa
 * pela CONCESSÃO da rodada (ver `sqlPegarConcessaoDaRodada`): duas rodadas
 * nunca trabalham a mesma loja ao mesmo tempo.
 *
 * Agendado em scripts/cron-runner.js a cada 2 minutos (`fiscal-retentativa`).
 */
export async function retentarNotasFiscais(opcoes: { orcamentoMs?: number; agora?: Date } = {}): Promise<ResumoDaRetentativa> {
  const inicio = Date.now();
  const orcamento = opcoes.orcamentoMs ?? 45_000;
  const acabou = () => Date.now() - inicio > orcamento;
  const agora = opcoes.agora ?? new Date();
  const resumo: ResumoDaRetentativa = { lojas: 0, consultadas: 0, reemitidas: 0, encerradas: 0, esquecidas: 0, parouPeloRelogio: false };
  const dono = randomUUID();

  const lojas = await prisma.user.findMany({
    where: { fiscalConfig: { path: ["enabled"], equals: true } },
    select: { id: true, fiscalConfig: true },
  });
  resumo.lojas = lojas.length;

  for (const loja of lojas) {
    if (acabou()) { resumo.parouPeloRelogio = true; break; }
    const config = configNormalizada(loja.fiscalConfig);
    if (!config?.enabled || pendenciasParaEmitir(config).length > 0) continue;
    // O relógio de verdade (não o `agora` da rodada, que o teste adianta): a
    // concessão é sobre rodadas que existem ao mesmo tempo.
    const pegou = Number(await prisma.$executeRaw(sqlPegarConcessaoDaRodada(loja.id, dono, Date.now())).catch(() => 1));
    if (pegou < 1) {
      resumo.lojasEmOutraRodada = (resumo.lojasEmOutraRodada ?? 0) + 1;
      continue;
    }
    let parar = false;
    try {
      parar = await rodadaDaLoja(loja.id, config, resumo, { agora, acabou });
    } finally {
      await prisma.$executeRaw(sqlSoltarConcessaoDaRodada(loja.id, dono)).catch(() => {});
    }
    if (parar) break;
  }

  return resumo;
}

/** O trabalho de UMA loja numa rodada (ver `retentarNotasFiscais`). Devolve true se o relógio acabou. */
async function rodadaDaLoja(
  lojaId: string,
  config: ConfigDaLoja,
  resumo: ResumoDaRetentativa,
  o: { agora: Date; acabou: () => boolean }
): Promise<boolean> {
  const { agora, acabou } = o;
  const loja = { id: lojaId };
  {
    const ambiente = Number(config.ambiente) === 1 ? 1 : 2;

    // ── 1. Processando e contingência ─────────────────────────────────────
    // A nota em contingência off-line é EMITTED com a marca `contingencia`
    // (ver `gravarResultado`): consulta até a SEFAZ efetivar ou recusar. A
    // janela é a da NOTA (a última gravação), não a do pedido: a nota à mão de
    // uma venda antiga também é acompanhada (`JANELA_DA_VENDA_CONSULTADA_MS`).
    const processando = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: loja.id,
        createdAt: { gte: new Date(agora.getTime() - JANELA_DA_VENDA_CONSULTADA_MS) },
        updatedAt: { gte: new Date(agora.getTime() - JANELA_DA_NOTA_CONSULTADA_MS) },
        OR: [
          { fiscalStatus: "PENDING", fiscalInfo: { path: ["processando"], equals: true } },
          { fiscalStatus: "EMITTED", fiscalInfo: { path: ["contingencia"], equals: true } },
        ],
      },
      select: { id: true, fiscalStatus: true, fiscalInfo: true },
      // O mais recente primeiro: é o que o balcão e o motoboy estão esperando.
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    // Os pedidos da mesma nota (a conta da mesa) viram UMA consulta.
    const porNota = new Map<string, NotaParaConsultar>();
    for (const p of processando) {
      const id = idDaNotaDoPedido(p);
      const grupo = porNota.get(id) ?? { ids: [], info: objeto(p.fiscalInfo), fiscalStatus: p.fiscalStatus, lojaId: loja.id };
      grupo.ids.push(p.id);
      porNota.set(id, grupo);
    }
    for (const [idDaNota, grupo] of porNota) {
      if (acabou()) { resumo.parouPeloRelogio = true; break; }
      await sincronizarNota(grupo, idDaNota, config);
      resumo.consultadas++;
    }

    // ── 2. Falhas transitórias ────────────────────────────────────────────
    // A linha marcada `retentativaEncerrada` (esgotou as tentativas, ou a
    // automática não cobre o pedido) fica FORA da busca, no banco — antes
    // ela voltava a cada rodada e 40 dessas ocupavam a fila inteira.
    // `equals: AnyNull` no caminho casa a chave AUSENTE: o SQL do Prisma é
    // `#> '{retentativaEncerrada}' = 'null' OR ... IS NULL` (conferido em
    // 24/09/2026). Um `NOT: { equals: true }` não serviria: sem a chave o
    // `#>` dá NULL, `NOT (NULL = true)` é NULL e a linha sumiria da busca.
    //
    // Só vem pedido cujo status JÁ pode ter nota (a mesma lista da varredura)
    // ou de mesa (a nota é da conta, que já fechou). "Ainda não é a hora" é
    // passageiro e não sai da fila (`emitirNfceAutomatica`); filtrar aqui é o
    // que impede essas linhas de ocupar os 40 lugares enquanto o pedido está
    // na cozinha — e elas entram sozinhas quando o status chega à hora, por
    // qualquer caminho. Pedido cancelado nunca entra.
    const falhas = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: loja.id,
        fiscalStatus: "FAILED",
        AND: [
          { fiscalInfo: { path: ["motivo"], equals: "erro_de_comunicacao" } },
          { fiscalInfo: { path: ["retentativaEncerrada"], equals: Prisma.AnyNull } },
        ],
        OR: [{ tableSessionId: { not: null } }, { status: { in: statusQuePodemEmitir(momentoDaEmissao(config)) } }],
        createdAt: { gte: new Date(agora.getTime() - JANELA_MAXIMA_MS) },
      },
      select: { id: true, tableSessionId: true, fiscalInfo: true, createdAt: true },
      // O mais recente primeiro, como no passo 1.
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    // Uma nota, uma reemissão: os pedidos da mesma conta de mesa andam juntos.
    const porGrupo = new Map<string, typeof falhas>();
    for (const f of falhas) {
      const chave = f.tableSessionId ? idDaNotaDaMesa(f.tableSessionId) : idDaNotaDoPedido(f);
      porGrupo.set(chave, [...(porGrupo.get(chave) ?? []), f]);
    }
    for (const grupo of porGrupo.values()) {
      if (acabou()) { resumo.parouPeloRelogio = true; break; }
      const f = grupo[0];
      const decisao = decidirRetentativa(f.fiscalInfo, agora);
      if (decisao.acao === "esperar") continue;
      if (decisao.acao === "encerrar") {
        resumo.encerradas += await encerrarRetentativa(grupo, decisao.motivo);
        continue;
      }
      // Reemitir é com o ambiente e o token de AGORA: só a falha do mesmo
      // ambiente e de venda posterior ao carimbo `emissaoLigadaEm` — o mesmo
      // carimbo que a varredura respeita (lib/fiscal-momento).
      const vendaEm = f.tableSessionId
        ? (await prisma.tableSession.findUnique({ where: { id: f.tableSessionId }, select: { closedAt: true } }))?.closedAt ?? f.createdAt
        : f.createdAt;
      const cabe = retentativaCabeNaEmissaoAtual({ fiscalInfo: f.fiscalInfo, vendaEm, ambienteAtual: ambiente, emissaoLigadaEm: config.emissaoLigadaEm });
      if (!cabe.cabe) {
        resumo.encerradas += await encerrarRetentativa(grupo, cabe.motivo);
        continue;
      }
      const r = f.tableSessionId ? await emitirNfceDaMesa(f.tableSessionId) : await emitirNfceAutomatica(f.id);
      if (r.acao !== "ignorado") resumo.reemitidas++;
      // A falha do botão Emitir num pedido que a automática não cobre: a
      // reemissão sempre volta "ignorado" sem gravar nada — sai da fila, com
      // o motivo. O "ignorado" passageiro (erro, cadastro) fica para a próxima.
      else if (r.foraDaAutomatica) resumo.encerradas += await encerrarRetentativa(grupo, motivoForaDaAutomatica(r.motivo));
    }

    // ── 3. Esquecidos ─────────────────────────────────────────────────────
    if (acabou()) { resumo.parouPeloRelogio = true; return true; }
    resumo.esquecidas += await emitirNotasEsquecidas({ franchiseeId: loja.id, config, acabou });

    // ── 4. Emissor próprio: número tentado, envios sem desfecho e
    // inutilização mensal ──────────────────────────────────────────────────
    // A Focus cuidava disso do lado dela; com a transmissão direta, é nosso:
    // conferir o número que foi sem resposta (cancelar ou inutilizar), o
    // envio que ficou sem desfecho num pedido que falhou, e inutilizar os
    // buracos do mês anterior até o dia 10 (lib/nfce/rotina-da-sefaz).
    if (usaEmissorProprio(config)) {
      if (acabou()) { resumo.parouPeloRelogio = true; return true; }
      const { rotinaDoEmissorProprio } = await import("./nfce/rotina-da-sefaz");
      const r = await rotinaDoEmissorProprio({ lojaId: loja.id, config, agora, acabou });
      resumo.tentadosConferidos = (resumo.tentadosConferidos ?? 0) + r.tentadosConferidos;
      resumo.enviosReconciliados = (resumo.enviosReconciliados ?? 0) + r.enviosReconciliados;
      resumo.faixasInutilizadas = (resumo.faixasInutilizadas ?? 0) + r.faixasInutilizadas;
    }
  }
  return false;
}

// ── CONSULTA DE UMA NOTA (cron e "Consultar situação") ─────────────────────

/**
 * Os pedidos de UMA nota, com o fiscalInfo e o status fiscal de um deles. A
 * loja vai junto para o emissor próprio (o cofre dos XMLs é por loja).
 */
export type NotaParaConsultar = { ids: string[]; info: Record<string, any>; fiscalStatus: string | null | undefined; lojaId?: string };

/**
 * A nota é do emissor próprio? A gravada diz (`provedor: "sefaz"`); a que
 * ainda não tem gravação dele segue o provedor da loja. Nota antiga da Focus
 * continua sendo consultada na Focus mesmo depois de a loja trocar.
 */
function notaVaiPelaSefaz(info: Record<string, any>, config: ConfigDaLoja): boolean {
  if (info.provedor === PROVEDOR_PROPRIO) return true;
  if (info.nfceKey || info.processando === true) return false;
  return usaEmissorProprio(config);
}

/**
 * Consulta a nota no provedor e grava o que ela é de verdade — em TODOS os
 * pedidos dela.
 *
 * ── Um caminho só ───────────────────────────────────────────────────────────
 *
 * O "Consultar situação" da tela (GET api/store/fiscal/emitir) tinha a sua
 * própria gravação: EMITTED em qualquer resposta autorizada, sem olhar a
 * contingência, e com o fiscalInfo montado do zero. A nota off-line consultada
 * pela tela perdia a marca `contingencia` (e o cron parava de acompanhá-la até
 * a SEFAZ efetivar), e a identidade da nota da conta, o `valorDaNota` e a
 * forma declarada sumiam. Agora a tela e o cron gravam pela mesma função —
 * `gravarResultado` com `deConsulta` — e a regra é uma:
 *
 *  - no AMBIENTE DA NOTA (fiscalInfo.ambiente), com o token dele: a nota de
 *    homologação continua em homologação depois que a loja passa a produção;
 *  - em CONTINGÊNCIA a nota existe e o cupom vale: só a efetivação ou a
 *    recusa da SEFAZ mudam alguma coisa. "Não encontrou", processando ou
 *    falha de rede não desfazem nada — nem pela ação da tela;
 *  - falha ao CONSULTAR não diz nada sobre a nota; a exceção é "não
 *    encontrou nenhuma nota com esta referência" (a SEFAZ nunca recebeu):
 *    vira falha transitória, e a retentativa reemite com a mesma ref.
 *
 * `manual`: pedida por uma pessoa (tela). No emissor próprio, não espera o
 * recuo das consultas automáticas (lib/nfce/emissao-da-loja).
 */
export async function sincronizarNota(
  grupo: NotaParaConsultar,
  idDaNota: string,
  config: ConfigDaLoja,
  opcoes: { manual?: boolean } = {}
): Promise<{ resultado: ResultadoDaEmissao; gravou: boolean }> {
  // ── Emissor próprio ────────────────────────────────────────────────────
  // Sem ref no provedor: consulta pela CHAVE, e a contingência é
  // TRANSMITIDA daqui (a Focus transmitia sozinha; agora é a gente). A
  // gravação é a mesma de sempre (`gravarResultado`, `deConsulta`).
  if (grupo.lojaId && notaVaiPelaSefaz(grupo.info, config)) {
    const { sincronizarNotaNaSefaz } = await import("./nfce/emissao-da-loja");
    const s = await sincronizarNotaNaSefaz(grupo, config, grupo.lojaId, opcoes);
    if (!s.gravar) return { resultado: s.resultado, gravou: false };
    await gravarResultado(grupo.ids, s.resultado, {
      fiscalAtual: grupo.info,
      ambiente: s.ambiente,
      deConsulta: true,
      deContingencia: s.deContingencia,
    });
    return { resultado: s.resultado, gravou: true };
  }

  const emContingencia = grupo.fiscalStatus === "EMITTED" && grupo.info.contingencia === true;
  const daNota = Number(grupo.info.ambiente);
  const ambienteDaNota = daNota === 1 || daNota === 2 ? daNota : Number(config.ambiente) === 1 ? 1 : 2;
  const r = await consultarNfce({ ...config, ambiente: ambienteDaNota }, idDaNota);
  if (emContingencia && !r.ok && r.motivo !== "rejeitada") return { resultado: r, gravou: false };
  if (!r.ok && r.motivo === "erro_de_comunicacao" && !/n[ãa]o encontrou nenhuma nota/i.test(r.mensagem)) return { resultado: r, gravou: false };
  if (!r.ok && r.motivo === "nao_configurado") return { resultado: r, gravou: false };
  await gravarResultado(grupo.ids, r, {
    fiscalAtual: grupo.info,
    ambiente: ambienteDaNota,
    deConsulta: true,
    deContingencia: emContingencia,
  });
  return { resultado: r, gravou: true };
}

/**
 * "Consultar situação" de um pedido pela tela: a nota dele (a da conta, na
 * mesa), com a config normalizada da loja. Devolve o que o provedor disse e
 * o estado gravado depois.
 */
export async function consultarNotaDoPedido(
  pedido: { id: string; fiscalStatus?: string | null; fiscalInfo?: unknown },
  lojaId: string
): Promise<{ resultado: ResultadoDaEmissao | null; semToken: boolean }> {
  const loja = await lojaFiscal(lojaId);
  const config = loja.config ?? ({} as ConfigDaLoja);
  const info = objeto(pedido.fiscalInfo);
  const idDaNota = idDaNotaDoPedido(pedido);
  // Os pedidos da mesma nota (a conta da mesa grava a chave em todos).
  const daConta = Array.isArray(info.notaDaConta?.pedidos)
    ? (info.notaDaConta.pedidos as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const ids = [...new Set([pedido.id, ...daConta])];
  const daMesmaLoja = ids.length > 1
    ? (await prisma.customerOrder.findMany({ where: { id: { in: ids }, franchiseeId: lojaId }, select: { id: true } })).map((p) => p.id)
    : ids;
  const daNota = Number(info.ambiente);
  // O emissor próprio não tem token: quem fala com a SEFAZ é o certificado da
  // loja (a falta dele volta como `nao_configurado`, com a pendência).
  const pelaSefaz = notaVaiPelaSefaz(info, config);
  if (!pelaSefaz && !tokenDoAmbiente({ ...config, ambiente: daNota === 1 || daNota === 2 ? daNota : config.ambiente })) {
    return { resultado: null, semToken: true };
  }
  const { resultado } = await sincronizarNota({ ids: daMesmaLoja, info, fiscalStatus: pedido.fiscalStatus, lojaId }, idDaNota, config, { manual: true });
  return { resultado, semToken: false };
}

// ── PEDIDO CANCELADO PELO PARCEIRO COM NOTA ─────────────────────────────────

/**
 * Marca `fiscalInfo.alerta` nos pedidos que o parceiro (ou a disputa)
 * cancelou com NFC-e que vale — ver `alertaDoCancelamento`
 * (lib/fiscal-momento). NÃO bloqueia nada: é chamada depois do cancelamento,
 * sem esperar, pelas rotas que cancelam por fora da trava da nota.
 *
 * A gravação só vale sobre o que foi lido — o mesmo status fiscal e o mesmo
 * fiscalInfo (compare-and-swap, como a da consulta em `gravarNosPedidos`).
 * Antes ela conferia só o status: a efetivação da contingência que o cron
 * gravasse entre a leitura e a escrita (EMITTED → EMITTED) era desfeita pelo
 * fiscalInfo velho; e quando o cron trocava o "processando" por EMITTED, a
 * marca simplesmente não era gravada — num pedido já cancelado, nenhum
 * evento novo viria marcá-la. Agora, se o pedido mudou, relê e decide de novo
 * com o estado novo (até 3 vezes).
 */
export async function alertarCancelamentoComNota(where: Prisma.CustomerOrderWhereInput, origem: string): Promise<number> {
  try {
    const comNotaQueVale: Prisma.CustomerOrderWhereInput = {
      OR: [{ fiscalStatus: "EMITTED" }, { fiscalInfo: { path: ["processando"], equals: true } }],
    };
    const pedidos = await prisma.customerOrder.findMany({
      where: { AND: [where, comNotaQueVale] },
      select: { id: true, fiscalStatus: true, fiscalInfo: true },
      take: 20,
    });
    let marcados = 0;
    for (const primeiro of pedidos) {
      let p: { id: string; fiscalStatus: string | null; fiscalInfo: unknown } | null = primeiro;
      for (let tentativa = 0; p && tentativa < 3; tentativa++) {
        const info = objeto(p.fiscalInfo);
        if (info.alerta) break; // o primeiro aviso fica: é o que diz quando o cancelamento chegou
        const alerta = alertaDoCancelamento(p, origem);
        if (!alerta) break;
        const r = await prisma.customerOrder.updateMany({
          where: { AND: [{ id: p.id, fiscalStatus: p.fiscalStatus }, oMesmoFiscalInfo(p.fiscalInfo)] },
          data: { fiscalInfo: { ...info, alerta } as Prisma.InputJsonValue },
        });
        if (r.count > 0) { marcados += r.count; break; }
        // Mudou entre a leitura e a escrita: relê (só se a nota ainda vale).
        p = await prisma.customerOrder.findFirst({
          where: { AND: [{ id: p.id }, comNotaQueVale] },
          select: { id: true, fiscalStatus: true, fiscalInfo: true },
        });
      }
    }
    if (marcados > 0) console.warn(`[Fiscal] ⚠️ ${marcados} pedido(s) cancelado(s) (${origem}) com NFC-e que vale — aviso na aba Notas fiscais.`);
    return marcados;
  } catch (err: any) {
    console.error(`[Fiscal] Erro ao marcar o aviso de cancelamento (${origem}):`, err?.message);
    return 0;
  }
}

// ── A NOTA NO FEED DO PAINEL DE PEDIDOS ─────────────────────────────────────

/**
 * O recorte da nota (lib/edicao-de-pedido → `notaParaTela`) de cada pedido do
 * feed do painel (api/customer-order/poll), por id. É o que a trava de edição
 * lê na tela — a mesma `avaliarEdicao` da API.
 *
 * ── Por que uma consulta à parte ────────────────────────────────────────────
 *
 * O feed manda 200 pedidos a cada poucos segundos, com `select` explícito para
 * não arrastar as 87 colunas. O fiscalInfo inteiro (URLs, lista de pedidos da
 * conta da mesa, notas anteriores) seria o maior campo do feed; o Prisma não
 * seleciona pedaço de JSON, então o recorte é feito no próprio Postgres
 * (`jsonb_build_object` só com `CAMPOS_DA_NOTA_NA_TELA`) e só para os pedidos
 * que TÊM fiscalInfo.
 *
 * Loja que nunca emitiu (todas as de hoje): nenhum pedido do feed tem status
 * fiscal além do PENDING padrão, e a consulta nem é feita. A primeira nota de
 * uma loja que ainda está "processando" fica sem o recorte até alguma nota
 * sair — a tela mostra o lápis e a API recusa com a frase da trava, como antes.
 */
export async function notasParaOPainel(
  pedidos: { id: string; fiscalStatus?: string | null }[]
): Promise<Map<string, Record<string, unknown>>> {
  const notas = new Map<string, Record<string, unknown>>();
  if (!pedidos.some((p) => p.fiscalStatus && p.fiscalStatus !== "PENDING")) return notas;
  // As chaves vão como parâmetro ($n::text), não coladas no SQL.
  const campos = Prisma.join(CAMPOS_DA_NOTA_NA_TELA.map((c) => Prisma.sql`${c}::text, "fiscalInfo" -> ${c}::text`));
  const linhas = await prisma.$queryRaw<{ id: string; nota: unknown }[]>(Prisma.sql`
    SELECT "id", jsonb_build_object(${campos}) AS "nota"
    FROM "CustomerOrder"
    WHERE "id" = ANY(${pedidos.map((p) => p.id)}) AND "fiscalInfo" IS NOT NULL`);
  for (const l of linhas) {
    const nota = notaParaTela(l.nota);
    if (nota) notas.set(l.id, nota);
  }
  return notas;
}
