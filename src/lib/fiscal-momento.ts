/**
 * /src/lib/fiscal-momento.ts
 *
 * QUANDO a NFC-e sai, e de que forma de pagamento. Peça pura — sem banco, sem
 * rede — para o teste (scripts/teste-fiscal-momento.ts) conferir a regra
 * inteira sem tocar em loja nenhuma. Quem grava é lib/fiscal-automatico.ts.
 *
 * ── Por que o momento mudou ─────────────────────────────────────────────────
 *
 * A emissão automática rodava no ENTREGUE: o motoboy já tinha levado a comida
 * e só então a nota ia para a SEFAZ. A regra é a outra — a NFC-e tem de estar
 * AUTORIZADA antes da saída da mercadoria (Ajuste SINIEF 19/16, cl. 1ª §1º; no
 * DF o DANFE ainda acompanha a mercadoria). E o cancelamento só vale em até 30
 * minutos e sem a mercadoria ter saído, então nota emitida DEPOIS da entrega
 * era a pior combinação: tarde para acompanhar o pedido e sem volta.
 *
 * O momento agora é configurável em `fiscalConfig.momentoDaEmissao`:
 *
 *   - "saida" (padrão): entrega sai quando o pedido SAI (SAIU_ENTREGA — o
 *     botão "Saiu" do painel, o motoboy puxando pelo QR, a rota despachada, o
 *     evento de despacho do parceiro). Retirada, balcão e totem saem na
 *     CONCLUSÃO (ENTREGUE), que é quando o cliente leva. Se o pedido pular a
 *     etapa da rua e cair direto em ENTREGUE, a conclusão ainda emite — tarde,
 *     mas melhor que nunca.
 *   - "aceite": a nota sai quando a loja aceita o pedido. É o mais seguro
 *     quanto ao "antes da saída", e o mais caro no cancelamento: pedido
 *     cancelado depois dos 30 minutos fica com nota que não se cancela mais.
 *   - "conclusao": o comportamento antigo (ENTREGUE para todo mundo), para a
 *     loja cujo contador pedir assim.
 *
 * Mesa não passa por aqui: a nota é UMA por conta, no fechamento
 * (`montarNotaDaMesa` e lib/fiscal-automatico `emitirNfceDaMesa`).
 */
import type { ItemDaNota, PedidoParaNota } from "./fiscal-emissao";
import { pedidoParaNota, type PedidoDoBanco } from "./fiscal-itens";
import { ehPagoOnline } from "./pagamento-na-entrega";
import { ratearEmCentavos } from "./rateio";
import { documentoDeVerdade } from "./documento-do-cliente";

export type MomentoDaEmissao = "aceite" | "saida" | "conclusao";

/** Sem nada configurado, vale a saída — é o que a regra pede para delivery. */
export const MOMENTO_PADRAO: MomentoDaEmissao = "saida";

export function momentoDaEmissao(config: { momentoDaEmissao?: unknown } | null | undefined): MomentoDaEmissao {
  const m = String(config?.momentoDaEmissao ?? "").trim().toLowerCase();
  return m === "aceite" || m === "saida" || m === "conclusao" ? m : MOMENTO_PADRAO;
}

// Grafias de status — as mesmas de lib/status-pedido.ts e lib/edicao-de-pedido.ts.
// RECEBIDO/PENDENTE/NOVO ainda não foram aceitos pela loja; AGUARDANDO_PAGAMENTO
// e CRIANDO_IA ainda nem são pedido.
const ACEITOS_NA_COZINHA = ["CONFIRMADO", "ACEITO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO"];
const NA_RUA = ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA"];
const FINALIZADOS = ["ENTREGUE", "ENCERRADO"];

/**
 * "DELIVERY" é o que o banco grava; "ENTREGA" aparece em modelo antigo. Todo o
 * resto (RETIRADA, TAKEOUT, PICKUP, BALCAO, MESA) é o cliente levando na mão.
 *
 * Atenção ao SAIU_ENTREGA da retirada: o KDS grava esse status em pedido de
 * retirada para dizer "pronto no balcão" (api/kds). Para retirada ele NÃO é
 * saída — por isso a regra olha o tipo antes do status.
 */
export function ehEntregaEmDomicilio(deliveryType: string | null | undefined): boolean {
  const t = String(deliveryType || "").trim().toUpperCase();
  return t === "DELIVERY" || t === "ENTREGA";
}

export type PedidoParaMomento = {
  status?: string | null;
  deliveryType?: string | null;
  tableSessionId?: string | null;
};

/** Este pedido, neste status, já está no momento de ter nota? */
export function deveEmitirNoStatus(pedido: PedidoParaMomento, momento: MomentoDaEmissao): boolean {
  // A mesa tem UMA nota por conta, emitida no fechamento. Nota por pedido de
  // mesa era o defeito antigo: cinco notas pequenas para a mesma conta.
  if (pedido.tableSessionId) return false;
  const s = String(pedido.status || "").trim().toUpperCase();
  if (momento === "conclusao") return FINALIZADOS.includes(s);
  if (momento === "aceite") return [...ACEITOS_NA_COZINHA, ...NA_RUA, ...FINALIZADOS].includes(s);
  // "saida"
  if (ehEntregaEmDomicilio(pedido.deliveryType)) return [...NA_RUA, ...FINALIZADOS].includes(s);
  return FINALIZADOS.includes(s);
}

/**
 * A mercadoria já saiu da loja? É a outra metade da regra do cancelamento: o
 * Ajuste SINIEF 19/16, cláusula décima quinta (redação do Ajuste SINIEF 7/18),
 * só admite cancelar a NFC-e "desde que não tenha havido a saída da
 * mercadoria, em prazo não superior a 30 minutos" da autorização. A trava de
 * edição (lib/edicao-de-pedido) lê daqui para não prometer um cancelamento
 * que a SEFAZ não aceita.
 *
 * A régua é a MESMA da emissão (as listas acima), e é de propósito: no modo
 * padrão "saida" a nota da ENTREGA é autorizada justamente no SAIU_ENTREGA —
 * se a trava lesse outra lista, diria "cancele em 30 minutos" para toda nota
 * de entrega, que nasce já depois da saída. Retirada, balcão, totem e mesa
 * saem na conclusão (ENTREGUE): o cliente levou, ou consumiu no salão.
 *
 * `null` = não dá para saber (o status não veio, ou o pedido está na rua e o
 * tipo de entrega não veio): quem chama não promete nada.
 */
export function mercadoriaJaSaiu(pedido: { status?: string | null; deliveryType?: string | null }): boolean | null {
  const s = String(pedido.status || "").trim().toUpperCase();
  if (!s) return null;
  if (FINALIZADOS.includes(s)) return true;
  if (NA_RUA.includes(s)) {
    // SAIU_ENTREGA na retirada é o "pronto no balcão" do KDS, não saída.
    if (pedido.deliveryType == null) return null;
    return ehEntregaEmDomicilio(pedido.deliveryType);
  }
  return false;
}

/**
 * Todos os status em que ALGUM pedido pode ter nota neste momento — o filtro
 * da varredura de pedidos esquecidos (quem decide pedido a pedido continua
 * sendo `deveEmitirNoStatus`, que olha também o tipo de entrega).
 */
export function statusQuePodemEmitir(momento: MomentoDaEmissao): string[] {
  if (momento === "conclusao") return [...FINALIZADOS];
  if (momento === "aceite") return [...ACEITOS_NA_COZINHA, ...NA_RUA, ...FINALIZADOS];
  return [...NA_RUA, ...FINALIZADOS];
}

// ── FORMA DE PAGAMENTO ──────────────────────────────────────────────────────

/**
 * As chaves dos checkboxes da tela fiscal (autoEmitPaymentMethods), mais
 * ONLINE: pago no app do parceiro ou no site, antes de o pedido existir aqui.
 */
export type ChaveDePagamento = "MONEY" | "PIX" | "CREDIT_CARD" | "DEBIT_CARD" | "VOUCHER" | "ONLINE";

/**
 * Traduz o texto da forma (que varia por canal: "PIX", "Dinheiro", "Crédito
 * (Pago Online)", "CREDITO", "VOUCHER_Ticket", "Cartão Deb Master (Cobrar na
 * Entrega)"...) para a chave da tela. Sem correspondência → null.
 *
 * "Cartão" sem dizer qual vira crédito, igual a `formaCanonica`
 * (lib/pagamento-na-entrega.ts) — antes caía em null e o pedido nunca tinha
 * nota automática.
 */
export function chaveDaFormaDePagamento(forma: string | null | undefined): Exclude<ChaveDePagamento, "ONLINE"> | null {
  const f = String(forma || "").toLowerCase();
  if (!f) return null;
  if (f.includes("pix")) return "PIX";
  if (f.includes("dinheiro") || f.includes("money") || f.includes("cash") || f.includes("espécie") || f.includes("especie")) return "MONEY";
  if (f.includes("créd") || f.includes("cred")) return "CREDIT_CARD";
  if (f.includes("déb") || f.includes("deb")) return "DEBIT_CARD";
  if (f.includes("vale") || f.includes("voucher") || f.includes("refei") || f.includes("aliment") || f.includes("meal") || f.includes("ticket")) return "VOUCHER";
  // "cartão", e não "cart": "Carteira DiDi (99Food Pago Online)" é carteira
  // digital, não cartão de crédito.
  if (/cart[aã]o|card|maquin/.test(f)) return "CREDIT_CARD";
  return null;
}

export type PedidoParaForma = {
  paymentMethod?: string | null;
  /** Pagamento dividido do balcão: [{ method, amount }]. */
  paymentMethods?: unknown;
  gatewayPaymentId?: string | null;
};

/** As partes de um pagamento dividido, no formato gravado ({ method, amount }). */
export function partesDoPagamento(bruto: unknown): { forma: string; valor: number }[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((p: any) => ({ forma: String(p?.method ?? p?.metodo ?? "").trim(), valor: Number(p?.amount ?? p?.valor) || 0 }))
    .filter((p) => p.forma && p.valor > 0);
}

/**
 * Todas as chaves que descrevem o pagamento deste pedido.
 *
 * Um pedido pode ter mais de uma: "Pix (Pago Online)" é PIX e ONLINE, e o
 * balcão dividido em Pix + Dinheiro é PIX e MONEY. Pedido do iFood pago na
 * carteira ("iFood App (Pago Online)", 909 pedidos em 30 dias) só casa com
 * ONLINE — sem essa chave ele nunca teria nota automática.
 */
export function chavesDoPagamento(pedido: PedidoParaForma): ChaveDePagamento[] {
  const chaves = new Set<ChaveDePagamento>();
  const partes = partesDoPagamento(pedido.paymentMethods);
  if (partes.length > 0) {
    for (const p of partes) {
      const c = chaveDaFormaDePagamento(p.forma);
      if (c) chaves.add(c);
    }
  } else {
    const c = chaveDaFormaDePagamento(pedido.paymentMethod);
    if (c) chaves.add(c);
  }
  if (ehPagoOnline(pedido)) chaves.add("ONLINE");
  return [...chaves];
}

/** As chaves das formas em que a CONTA da mesa foi paga (TableSession.paymentMethods). */
export function chavesDaConta(pagamentos: { method?: string | null }[]): ChaveDePagamento[] {
  const chaves = new Set<ChaveDePagamento>();
  for (const p of pagamentos) {
    const c = chaveDaFormaDePagamento(p?.method);
    if (c) chaves.add(c);
  }
  return [...chaves];
}

/**
 * A lista da tela, normalizada. "CREDITO_ONLINE" é a chave que a primeira
 * versão da tela gravava (commit 8f9595f1) e ainda está no cadastro da Hakim
 * Centro: vale como ONLINE, que é o que ela queria dizer.
 */
export function listaDaEmissaoAutomatica(bruto: unknown): ChaveDePagamento[] {
  if (!Array.isArray(bruto)) return [];
  const saida = new Set<ChaveDePagamento>();
  for (const k of bruto) {
    const chave = String(k || "").trim().toUpperCase();
    if (chave === "CREDITO_ONLINE" || chave === "ONLINE") saida.add("ONLINE");
    else if (["MONEY", "PIX", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"].includes(chave)) saida.add(chave as ChaveDePagamento);
  }
  return [...saida];
}

/**
 * Basta UMA das formas estar marcada. A conta dividida em cartão e dinheiro
 * tem nota se a loja marcou cartão: a nota é da venda inteira (não se emite
 * meia nota), e a parte no cartão já chega à SEFAZ pela administradora (DIMP)
 * — venda no cartão sem nota é exatamente o cruzamento que a fiscalização faz.
 */
export function formaEntraNaAutomatica(chaves: ChaveDePagamento[], lista: unknown): boolean {
  const marcadas = new Set(listaDaEmissaoAutomatica(lista));
  return chaves.some((c) => marcadas.has(c));
}

// ── IDENTIDADE DA NOTA ──────────────────────────────────────────────────────

/**
 * O id que vira a `ref` no provedor (`firehub-<id>`, lib/fiscal-emissao). Para
 * pedido comum é o id do pedido — o mesmo de sempre. Para a conta da mesa é
 * `mesa-<id da sessão>`: uma ref que nenhum pedido usa, então a nota da conta
 * nunca colide com uma emissão avulsa de um dos pedidos dela.
 *
 * `versao` > 1 é a REEMISSÃO depois de a loja cancelar a nota da conta
 * (`mesa-<sessão>-2`, `-3`...). A ref é a idempotência do provedor: reenviar
 * `mesa-<sessão>` depois do cancelamento devolveria a nota CANCELADA, nunca
 * uma nova — era por isso que a conta cancelada não tinha como ganhar nota.
 */
export function idDaNotaDaMesa(tableSessionId: string, versao = 1): string {
  return versao > 1 ? `mesa-${tableSessionId}-${versao}` : `mesa-${tableSessionId}`;
}

/** Esta ref é de uma nota da conta desta mesa (a primeira ou uma reemissão)? */
export function ehNotaDaConta(idDaNota: unknown, tableSessionId: string): boolean {
  const base = idDaNotaDaMesa(tableSessionId);
  const id = String(idDaNota ?? "");
  return id === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(id);
}

/**
 * A ref da nota que substitui uma nota CANCELADA: `<base>` vira `<base>-2`,
 * `<base>-2` vira `<base>-3`. Vale para a conta da mesa e para o pedido
 * comum (base = id do pedido): nos dois a ref antiga está queimada no
 * provedor, e a nota nova precisa de uma que ninguém usou.
 */
export function refDaReemissao(refCancelada: string, base: string): string {
  if (refCancelada === base) return `${base}-2`;
  const m = refCancelada.startsWith(`${base}-`) ? /^(\d+)$/.exec(refCancelada.slice(base.length + 1)) : null;
  return m ? `${base}-${Number(m[1]) + 1}` : `${base}-2`;
}

/**
 * Qual ref consultar/cancelar para este pedido. As rotas de cancelar e de
 * consultar leem por aqui (lib/fiscal-config → `notaDoPedido`), não por
 * `order.id`: num pedido de mesa a nota é da conta, e `firehub-<id do
 * pedido>` não existe no provedor. Na reemissão de um pedido comum ela é
 * `<id do pedido>-2`.
 */
export function idDaNotaDoPedido(pedido: { id: string; fiscalInfo?: unknown }): string {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : {};
  return typeof info.idDaNota === "string" && info.idDaNota ? info.idDaNota : pedido.id;
}

/**
 * O que fica guardado de uma nota que a loja CANCELOU quando outra a
 * substitui (`fiscalInfo.notasAnteriores`). A nota nova grava o fiscalInfo
 * dela por cima; sem este registro a cancelada sumia do pedido — e com ela o
 * XML do cancelamento, que o contador tem de receber (lib/contador-pacote).
 */
export function registroDaNotaCancelada(pedido: { id: string; fiscalInfo?: unknown }): Record<string, unknown> | null {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : {};
  if (!info.nfceKey) return null;
  const campos = [
    "nfceKey", "nfceNumber", "serie", "protocol", "emittedAt", "ambiente", "xmlUrl", "pdfUrl",
    "valorDaNota", "formaNaNota", "canceladaEm", "protocoloCancelamento", "justificativaCancelamento", "xmlCancelamentoUrl",
    // Emissor próprio (lib/nfce): o XML e o evento moram no cofre, não numa
    // URL. Sem eles a cancelada substituída chegava ao contador sem arquivo.
    "provedor", "xmlNoCofre", "xmlCancelamentoNoCofre", "qrCode", "urlConsulta",
  ];
  const registro: Record<string, unknown> = { idDaNota: idDaNotaDoPedido(pedido) };
  for (const c of campos) if (info[c] != null) registro[c] = info[c];
  return registro;
}

/** As notas canceladas que já estavam guardadas no pedido, mais a que acabou de ser substituída. */
export function notasAnterioresComA(pedido: { id: string; fiscalInfo?: unknown }): Record<string, unknown>[] {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : {};
  const antes = Array.isArray(info.notasAnteriores) ? info.notasAnteriores.filter((n: unknown) => n && typeof n === "object") : [];
  const agora = registroDaNotaCancelada(pedido);
  return agora ? [...antes, agora] : antes;
}

/**
 * Este pedido só pode ter nota PELA CONTA da mesa? Devolve a recusa para o
 * botão "Emitir" de um pedido (nota avulsa), ou null quando a nota avulsa vale.
 *
 * Pedido de mesa não tem nota própria: a NFC-e é UMA por conta, com todas as
 * rodadas, o desconto da conta e as formas em que a mesa pagou
 * (`montarNotaDaMesa`), sob a ref `mesa-<sessão>`. A nota avulsa de uma rodada
 * deixava a mesma venda em duas notas — a da rodada e a da conta — e a
 * emissão da conta, ao achar um pedido com nota própria, desiste
 * (lib/fiscal-automatico, `emitirNfceDaMesa`). Medido em 24/09/2026: o Pastel
 * da Paulista fechou 552 contas em 30 dias, a maior com 13 rodadas.
 *
 * Pura: a rota decide o status HTTP. Quem emite a nota da conta à mão é
 * `emitirNfceDaMesa(tableSessionId, { manual: true })`, pelo botão Emitir de
 * qualquer rodada (lib/fiscal-config → caminhoDaNotaDoPedido). É a ÚNICA
 * fonte desta regra: a emissão automática, a rota do botão e a tela leem
 * daqui (a cópia que morava em lib/fiscal-config, `recusaDaNotaAvulsa`, saiu).
 */
export function pedidoDeMesaExigeNotaDaConta(pedido: {
  tableSessionId?: string | null;
}): { tableSessionId: string; idDaNota: string; mensagem: string } | null {
  const sessao = String(pedido.tableSessionId ?? "").trim();
  if (!sessao) return null;
  return {
    tableSessionId: sessao,
    idDaNota: idDaNotaDaMesa(sessao),
    mensagem:
      "Este pedido é de uma mesa: a NFC-e é uma só para a conta inteira, com todas as rodadas, o desconto " +
      "da conta e as formas em que a mesa pagou. Emitir a nota só deste pedido repetiria estes itens na " +
      "nota da conta. Feche a conta em Mesas e emita a nota da conta.",
  };
}

export type PedidoComNota = {
  id: string;
  totalAmount?: number | null;
  fiscalStatus?: string | null;
  fiscalInfo?: unknown;
};

export type NotaDosPedidos<P extends PedidoComNota> = {
  /** A chave de acesso — a identidade da nota na SEFAZ. */
  chave: string;
  /** O primeiro pedido da nota, na ordem recebida. */
  principal: P;
  pedidos: P[];
  /** O fiscalInfo do principal. */
  info: Record<string, any>;
  /** O valor da nota (vNF), em reais. */
  valor: number;
};

/**
 * Os pedidos com NFC-e autorizada, UMA entrada por nota.
 *
 * A nota da conta da mesa fica gravada em todos os pedidos da conta com a
 * mesma chave — é o que deixa consultar e cancelar a partir de qualquer um
 * deles e travar a edição de todos. Quem lista NOTAS deveria passar por aqui:
 * percorrendo pedidos, a mesa de quatro rodadas vira quatro notas, quatro XML
 * com o mesmo nome e o valor somado dos quatro pedidos — que ignora o desconto
 * da conta e não é o valor da nota.
 *
 * Quem usa: o pacote do contador (lib/contador-pacote), que antes percorria
 * pedidos e mandava a nota da conta N vezes no CSV e no zip, com o total dos
 * pedidos no lugar do vNF.
 *
 * `valor` é o `valorDaNota` gravado na emissão (o vNF que foi para a SEFAZ —
 * a automática, o botão e a consulta gravam). Nota sem ele (anterior a este
 * campo) vale a soma do `totalAmount` dos pedidos dela — o mesmo número de
 * antes.
 *
 * `comCanceladas`: entra também a nota que a loja CANCELOU (fiscalStatus
 * CANCELED com a chave gravada). O contador precisa dela — o XML da nota e o
 * do evento de cancelamento — para a escrituração fechar com a numeração.
 */
export function agruparPorNota<P extends PedidoComNota>(pedidos: P[], opcoes: { comCanceladas?: boolean } = {}): NotaDosPedidos<P>[] {
  const porChave = new Map<string, NotaDosPedidos<P>>();
  const somaEmCentavos = new Map<string, number>();
  for (const p of pedidos) {
    const info = p.fiscalInfo && typeof p.fiscalInfo === "object" && !Array.isArray(p.fiscalInfo)
      ? (p.fiscalInfo as Record<string, any>)
      : {};
    const vale = p.fiscalStatus === "EMITTED" || (opcoes.comCanceladas === true && p.fiscalStatus === "CANCELED");
    if (!vale || !info.nfceKey) continue;
    const chave = String(info.nfceKey);
    const nota = porChave.get(chave);
    somaEmCentavos.set(chave, (somaEmCentavos.get(chave) || 0) + Math.round((Number(p.totalAmount) || 0) * 100));
    if (nota) nota.pedidos.push(p);
    else porChave.set(chave, { chave, principal: p, pedidos: [p], info, valor: 0 });
  }
  for (const nota of porChave.values()) {
    const gravado = nota.info.valorDaNota;
    nota.valor = typeof gravado === "number" && Number.isFinite(gravado)
      ? gravado
      : (somaEmCentavos.get(nota.chave) || 0) / 100;
  }
  return [...porChave.values()];
}

// ── A NOTA DO PEDIDO COMUM ──────────────────────────────────────────────────

export type LojaParaNota = { ifoodMerchantId?: string | null; food99MerchantId?: string | null };

/**
 * A nota de um pedido que não é de mesa, como a emissão automática manda para
 * o provedor: a montagem da frente 1 (`pedidoParaNota`, lib/fiscal-itens), com
 * canal, intermediador, endereço, pagamento dividido, troco, cupom pago pela
 * plataforma e entrega feita pelo iFood.
 *
 * A primeira versão da emissão automática montava o objeto à mão, só com
 * itens, total, taxa, desconto e forma. Sem o canal, o pedido do iFood era
 * tratado como canal próprio, e o `totalAmount` — que traz a taxa de serviço
 * de R$ 0,99 do iFood — não fechava com itens − desconto + entrega; sem o
 * endereço, toda entrega caía na pendência da rejeição 788. Nos 140 pedidos
 * ENTREGUE da Hakim Centro de 21 a 24/09/2026 nenhuma nota de entrega montava
 * (0 de 97 do iFood, 0 de 21 do site), nem a da retirada do iFood. Por esta
 * montagem, a pendência de valor some, a de endereço cai de 97 para 3
 * (endereço de fato incompleto) e a retirada do iFood monta. O que sobra
 * nas entregas é o CPF do cliente (rejeição 787, regra de lib/fiscal-emissao).
 *
 * `loja`: o merchant do iFood / shop do 99Food da loja, para o pedido que não
 * traz o dele. Sem ele o intermediador sai sem identificador (rejeição 438).
 */
export function montarNotaDoPedido(pedido: PedidoDoBanco, loja?: LojaParaNota | null): NotaParaEmitir {
  return pedidoParaNota(pedido, { loja: loja ?? null });
}

// ── A NOTA DA CONTA DA MESA ─────────────────────────────────────────────────

/**
 * O que lib/fiscal-emissao recebe. A mesa paga em mais de uma forma, e o
 * layout tem um `detPag` por forma: vai em `pagamentos` (a soma fecha com o
 * total da nota), com `formaDePagamento` = a de maior valor para quem ainda
 * lê só ela.
 */
export type NotaParaEmitir = PedidoParaNota;

export type PedidoDaMesaParaNota = {
  id: string;
  status?: string | null;
  totalAmount: number;
  customerCpfCnpj?: string | null;
  itens: ItemDaNota[];
};

const centavos = (v: number) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => Math.round(c) / 100;
const ehCancelado = (s: string | null | undefined) => String(s || "").toUpperCase().startsWith("CANCEL");

/**
 * Junta linhas iguais: a mesa de dez pessoas com trinta cervejas vira UMA
 * linha de 30, não trinta linhas de 1. A NFC-e tem teto de 990 itens e o DANFE
 * de uma mesa grande ficava do tamanho da bobina.
 *
 * Só junta quando a linha é exata (valor = quantidade × unitário, ao
 * centavo). A abertura de combo rateia centavos entre as partes, e somar duas
 * linhas "quase exatas" poderia deixar a linha juntada fora da tolerância da
 * SEFAZ (rejeição 629: valor difere de quantidade × unitário).
 */
export function juntarItensIguais(itens: ItemDaNota[]): ItemDaNota[] {
  const saida: ItemDaNota[] = [];
  const porChave = new Map<string, number>();
  for (const item of itens) {
    const exata = centavos(item.valorTotal) === Math.round(item.quantidade * item.valorUnitario * 100);
    const chave = exata
      ? [item.codigo, item.descricao, centavos(item.valorUnitario), item.ncm, item.cest ?? "", item.cfop,
         item.csosn ?? "", item.cst ?? "", item.origem, item.pis ?? "", item.cofins ?? "", item.unidadeComercial].join("|")
      : null;
    const onde = chave != null ? porChave.get(chave) : undefined;
    if (onde != null) {
      const atual = saida[onde];
      atual.quantidade += item.quantidade;
      atual.valorTotal = reais(centavos(atual.valorTotal) + centavos(item.valorTotal));
      continue;
    }
    if (chave != null) porChave.set(chave, saida.length);
    saida.push({ ...item });
  }
  return saida;
}

/**
 * Monta a nota da CONTA da mesa: os itens de todos os pedidos da sessão, o
 * desconto da conta e as formas de TableSession.paymentMethods.
 *
 * ── Taxa de serviço fica FORA da nota (padrão) ─────────────────────────────
 *
 * Os 10% do garçom não são receita da casa: a Lei 13.419/2017 diz que a
 * gorjeta — inclusive a "taxa de serviço" cobrada na conta e distribuída aos
 * empregados — "não constitui receita própria dos empregadores". Pôr na nota
 * seria declarar como venda (e, no Simples, pagar DAS sobre) um dinheiro que é
 * da equipe. A loja cujo contador pedir o contrário liga
 * `fiscalConfig.taxaDeServicoNaNota` e ela entra como outras despesas
 * acessórias. Gorjeta avulsa (waiterTip) nunca entra.
 *
 * ── Os pagamentos: cartão e Pix exatos, o resto sai do dinheiro ────────────
 *
 * A mesa paga consumo + taxa + gorjeta (+ troco), e a nota só declara o
 * consumo. Quem acerta a diferença é `pagamentosDaConta` (logo abaixo): o
 * cartão e o Pix vão pelo valor cobrado, e o troco sai do dinheiro.
 */
export function montarNotaDaMesa(entrada: {
  sessionId: string;
  pedidos: PedidoDaMesaParaNota[];
  pagamentos: { method: string; amount: number }[];
  /** Desconto dado na conta, em reais (a rota de fechamento calcula e não grava na sessão). */
  desconto?: number | null;
  /** TableSession.serviceFee, em reais. */
  taxaDeServico?: number | null;
  taxaDeServicoNaNota?: boolean;
  /** TableSession.waiterTip, em reais: nunca entra na nota, mas foi pago junto. */
  gorjeta?: number | null;
  nomeDoCliente?: string | null;
}): { ok: true; nota: NotaParaEmitir; pedidos: string[]; eletronicoReduzido: number } | { ok: false; motivo: string } {
  const validos = entrada.pedidos.filter((p) => !ehCancelado(p.status));
  if (validos.length === 0) return { ok: false, motivo: "A conta não tem pedido válido." };

  const itens = juntarItensIguais(validos.flatMap((p) => p.itens));
  if (itens.length === 0) return { ok: false, motivo: "Os pedidos da conta não têm itens." };

  const somaDosItens = itens.reduce((s, i) => s + centavos(i.valorTotal), 0);
  const consumo = validos.reduce((s, p) => s + centavos(p.totalAmount), 0);
  const consumoCobrado = Math.max(0, consumo - centavos(entrada.desconto || 0));
  const taxa = entrada.taxaDeServicoNaNota ? Math.max(0, centavos(entrada.taxaDeServico || 0)) : 0;

  // O que o cliente pagou pelo consumo manda. Item somando mais que o cobrado
  // é desconto (o da conta e qualquer abatimento dentro de um pedido); item
  // somando menos é acréscimo que foi cobrado fora das linhas.
  const desconto = Math.max(0, somaDosItens - consumoCobrado);
  const acrescimo = Math.max(0, consumoCobrado - somaDosItens);
  const total = consumoCobrado + taxa;
  if (total <= 0) return { ok: false, motivo: "O total da conta ficou zero — não há venda para a nota." };

  // Pago e não é venda: a taxa de serviço quando fica fora da nota, e a gorjeta.
  const foraDaNota =
    (entrada.taxaDeServicoNaNota ? 0 : Math.max(0, centavos(entrada.taxaDeServico || 0))) +
    Math.max(0, centavos(entrada.gorjeta || 0));
  const conta = pagamentosDaConta({ totalDaNota: reais(total), pagos: entrada.pagamentos, foraDaNota: reais(foraDaNota) });
  const pagamentos = conta.pagamentos;
  const principal = [...pagamentos].sort((a, b) => b.valor - a.valor)[0];
  const emDinheiro = pagamentos.find((p) => chaveDaFormaDePagamento(p.forma) === "MONEY");

  // O primeiro documento DE VERDADE entre as rodadas: o "00000000000" que o
  // JotaJá grava sem CPF não pode ganhar do CPF digitado numa rodada depois.
  const documento = validos.map((p) => documentoDeVerdade(p.customerCpfCnpj)).find(Boolean) || null;

  return {
    ok: true,
    pedidos: validos.map((p) => p.id),
    eletronicoReduzido: conta.eletronicoReduzido,
    nota: {
      id: idDaNotaDaMesa(entrada.sessionId),
      numero: null,
      itens,
      valorTotal: reais(total),
      // `taxaEntrega` é o campo que lib/fiscal-emissao manda como "outras
      // despesas acessórias" — aqui é o acréscimo e, se a loja pediu, a taxa.
      taxaEntrega: reais(acrescimo + taxa),
      desconto: reais(desconto),
      formaDePagamento: principal?.forma || "Não informado",
      pagamentos,
      // O dinheiro ENTREGUE para a venda. Com mais de uma forma,
      // lib/fiscal-emissao acha o troco pela soma (pagamentos − total); com o
      // dinheiro sozinho ele ignora o valor da linha e só declara o troco por
      // aqui ("troco para"). Nos dois casos sai o mesmo valor_troco.
      trocoPara: conta.troco > 0 && emDinheiro ? emDinheiro.valor : null,
      documentoDoCliente: documento,
      nomeDoCliente: entrada.nomeDoCliente || null,
      entregaEmDomicilio: false,
      canal: "MESA",
    },
  };
}

/**
 * Formas cujo valor a SEFAZ recebe por fora: cartão (crédito, débito, vale) e
 * Pix são informados pelas instituições de pagamento na DIMP (Convênio ICMS
 * 134/16, com o Pix desde o Convênio ICMS 50/22), transação a transação.
 */
const FORMAS_COM_DIMP: ChaveDePagamento[] = ["PIX", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"];

export type PagamentosDaConta = {
  /** As formas da nota, em reais, na ordem em que a mesa pagou. */
  pagamentos: { forma: string; valor: number }[];
  /** O troco devolvido em dinheiro, em reais (vai como valor_troco). */
  troco: number;
  /**
   * Quanto de cartão/Pix/vale a nota declara A MENOS do que foi cobrado, em
   * reais. Zero sempre que o dinheiro dá conta da taxa, da gorjeta e do
   * troco; só passa de zero quando o que é "não venda" foi pago no cartão.
   */
  eletronicoReduzido: number;
};

/**
 * As formas de pagamento da nota da conta, a partir das baixas da mesa.
 *
 * ── Antes: tudo proporcional ────────────────────────────────────────────────
 *
 * As formas eram rateadas na proporção até o total da nota: a conta de
 * R$ 143 paga com R$ 100 no cartão e R$ 50 em dinheiro ia para a nota como
 * cartão R$ 95,33 e dinheiro R$ 47,67. Só que o cartão cobrou R$ 100, e é esse
 * número que a administradora informa à SEFAZ pela DIMP (Convênio ICMS
 * 134/16). Nota dizendo cartão R$ 95,33 é exatamente a divergência que o
 * cruzamento NFC-e × DIMP aponta — em TODA conta com troco.
 *
 * ── Agora ───────────────────────────────────────────────────────────────────
 *
 *  - Cartão, Pix e vale vão pelo que foi cobrado.
 *  - O troco sai do DINHEIRO: a linha declara o dinheiro entregue e a nota
 *    leva `valor_troco` (vPag − vTroco = vNF, regras YA03-10/20 do MOC,
 *    rejeições 865/866). A conta de R$ 143: cartão 100, dinheiro 50, troco 7.
 *  - A taxa de serviço fora da nota e a gorjeta também saem primeiro do
 *    dinheiro (e das formas sem instituição, como "Conta Funcionário").
 *  - Só quando o cartão/Pix SOZINHO passa do total da nota — os 10% pagos no
 *    cartão com a taxa fora da nota — a diferença sai dele, na proporção. É o
 *    caso comum no salão (Pastel da Paulista, 30 dias até 24/09/2026: 277 de
 *    552 contas pagaram a taxa sem dinheiro nenhum), e não tem saída melhor:
 *    declarar troco que ninguém recebeu seria falso, e a SEFAZ exige a soma
 *    fechando com a nota. A diferença cartão × nota é a taxa, que a Lei
 *    13.419/2017 diz não ser receita. A loja cujo contador preferir o cartão
 *    exato liga `taxaDeServicoNaNota`. O quanto foi reduzido volta em
 *    `eletronicoReduzido` para ficar registrado no pedido.
 *  - Troco de até 2 centavos (arredondamento) sai direto do dinheiro:
 *    lib/fiscal-emissao acerta diferença de até 2 centavos na MAIOR linha,
 *    que costuma ser o cartão.
 *
 * Tudo em centavos inteiros: um centavo a mais é rejeição, não arredondamento.
 */
export function pagamentosDaConta(entrada: {
  /** vNF, em reais. */
  totalDaNota: number;
  /** As baixas como a mesa gravou: o dinheiro é a nota que o cliente entregou. */
  pagos: { method: string; amount: number }[];
  /** Pago junto e que não é venda (taxa fora da nota + gorjeta), em reais. */
  foraDaNota?: number | null;
}): PagamentosDaConta {
  type Linha = { forma: string; tipo: "dimp" | "dinheiro" | "outra"; c: number };
  const linhas: Linha[] = [];
  for (const p of entrada.pagos) {
    const forma = String(p?.method || "").trim();
    const c = centavos(p?.amount);
    if (!forma || c <= 0) continue;
    const chave = chaveDaFormaDePagamento(forma);
    const tipo: Linha["tipo"] = chave === "MONEY" ? "dinheiro" : chave && FORMAS_COM_DIMP.includes(chave) ? "dimp" : "outra";
    // Todas as baixas em dinheiro viram UMA linha ("Dinheiro" e "dinheiro"
    // inclusive): lib/fiscal-emissao só declara troco com uma linha de dinheiro.
    const mesma = linhas.find((l) => (tipo === "dinheiro" ? l.tipo === "dinheiro" : l.forma === forma));
    if (mesma) mesma.c += c;
    else linhas.push({ forma, tipo, c });
  }
  const dinheiro = linhas.filter((l) => l.tipo === "dinheiro");
  const outras = linhas.filter((l) => l.tipo === "outra");
  const comDimp = linhas.filter((l) => l.tipo === "dimp");

  // Tira até `valor` das linhas, na ordem; devolve o que não coube.
  const tirarEmOrdem = (valor: number, alvo: Linha[]): number => {
    for (const l of alvo) {
      if (valor <= 0) break;
      const t = Math.min(l.c, valor);
      l.c -= t;
      valor -= t;
    }
    return valor;
  };
  // Tira `valor` na proporção de cada linha, sem deixar linha negativa.
  const tirarNaProporcao = (valor: number, alvo: Linha[]): number => {
    const soma = alvo.reduce((s, l) => s + l.c, 0);
    const v = Math.min(Math.max(0, valor), soma);
    if (v <= 0) return valor;
    const partes = ratearEmCentavos(reais(v), alvo.map((l) => l.c)).map(centavos);
    let sobra = 0;
    alvo.forEach((l, i) => {
      const t = Math.min(l.c, partes[i] + sobra);
      sobra = partes[i] + sobra - t;
      l.c -= t;
    });
    return valor - v + tirarEmOrdem(sobra, alvo);
  };

  const total = centavos(entrada.totalDaNota);
  const pago = linhas.reduce((s, l) => s + l.c, 0);
  let excesso = pago - total;
  let reduzido = 0;
  let troco = 0;

  if (excesso > 0) {
    // 1. O que foi pago e não é venda.
    let naoVenda = Math.min(Math.max(0, centavos(entrada.foraDaNota || 0)), excesso);
    excesso -= naoVenda;
    naoVenda = tirarEmOrdem(naoVenda, [...dinheiro, ...outras]);
    if (naoVenda > 0) {
      reduzido += naoVenda;
      tirarNaProporcao(naoVenda, comDimp);
    }
    // 2. O resto é troco.
    if (excesso <= 2) {
      const naoCoube = tirarEmOrdem(excesso, [...dinheiro, ...outras]);
      // Sem dinheiro: fica para lib/fiscal-emissao acertar o centavo.
      excesso = naoCoube;
    } else {
      troco = Math.min(excesso, dinheiro[0]?.c ?? 0);
      // Troco maior que o dinheiro entregue: pagou a mais no cartão/Pix e
      // recebeu a volta de outro jeito. Não há como declarar — sai das
      // outras formas e, por último, do cartão/Pix.
      const resto = tirarEmOrdem(excesso - troco, outras);
      if (resto > 0) {
        reduzido += resto;
        tirarNaProporcao(resto, comDimp);
      }
    }
  } else if (excesso < 0 && excesso >= -2) {
    // Falta de até 2 centavos (a tolerância do fechamento): vai no dinheiro,
    // não no cartão. Falta maior não se inventa — lib/fiscal-emissao aponta.
    const alvo = dinheiro[0] ?? outras[0];
    if (alvo) alvo.c += -excesso;
  }

  return {
    pagamentos: linhas.filter((l) => l.c > 0).map((l) => ({ forma: l.forma, valor: reais(l.c) })),
    troco: reais(troco),
    eletronicoReduzido: reais(reduzido),
  };
}

// ── A NOTA DO RESTANTE DA CONTA ─────────────────────────────────────────────

/** Uma rodada da mesa que JÁ tem NFC-e própria: o que aquela nota declarou. */
export type NotaJaDeclarada = {
  /** "#41", para a frase. */
  nome: string;
  /** O vNF da nota da rodada, em reais. */
  valor: number;
  /** A forma com que ela saiu (`formaNaNota`, ou o `paymentMethod` da rodada). */
  forma: string | null;
};

/**
 * As formas da conta menos o que as notas próprias de rodadas já declararam —
 * o pagamento da nota do RESTANTE da conta.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Rodada de mesa com nota própria é legado (a automática pula mesa, o botão
 * emite a conta), mas quando existe a nota da conta não pode sair inteira: ela
 * repetiria os itens da rodada. A automática recusa e manda "emitir o
 * restante pela tela Fiscal" — e a tela recusava também: não havia caminho.
 * A nota do restante leva as outras rodadas, o desconto da conta (a rodada
 * foi declarada cheia, antes do fechamento, então o desconto é do que
 * sobrou) e o pagamento abaixo.
 *
 * ── Sem adivinhar ───────────────────────────────────────────────────────────
 *
 * O valor da nota da rodada sai da forma com que ELA saiu — cartão e Pix têm
 * de bater com a DIMP, então não se tira de outra forma por conveniência.
 * Conta paga numa forma só: sai dela. Se a forma da rodada não aparece entre
 * as da conta, ou não cabe, a nota do restante não sai e a frase diz por quê:
 * aí o acerto é do contador, não um palpite do FireHub.
 */
export function pagamentosDoRestante(
  pagos: { method: string; amount: number }[],
  declaradas: NotaJaDeclarada[]
): { ok: true; pagos: { method: string; amount: number }[] } | { ok: false; motivo: string } {
  const linhas = pagos
    .map((p) => ({ method: String(p?.method || "").trim(), c: centavos(p?.amount) }))
    .filter((l) => l.method && l.c > 0);
  const umaFormaSo = new Set(linhas.map((l) => chaveDaFormaDePagamento(l.method) ?? l.method.toLowerCase())).size === 1;

  for (const nota of declaradas) {
    let falta = centavos(nota.valor);
    if (falta <= 0) continue;
    const chave = chaveDaFormaDePagamento(nota.forma);
    let alvo = chave ? linhas.filter((l) => chaveDaFormaDePagamento(l.method) === chave) : [];
    if (alvo.length === 0 && umaFormaSo) alvo = linhas;
    if (alvo.length === 0) {
      return {
        ok: false,
        motivo:
          `A nota própria do pedido ${nota.nome} saiu em "${nota.forma || "forma não informada"}", que não está entre as ` +
          `formas em que a conta foi paga (${linhas.map((l) => l.method).join(", ") || "nenhuma"}). O FireHub não sabe de ` +
          "qual pagamento abater aquela nota — a nota do restante da conta fica com o contador.",
      };
    }
    for (const l of alvo) {
      const t = Math.min(l.c, falta);
      l.c -= t;
      falta -= t;
      if (falta <= 0) break;
    }
    if (falta > 0) {
      return {
        ok: false,
        motivo:
          `A nota própria do pedido ${nota.nome} vale mais do que a conta recebeu em "${nota.forma || "forma não informada"}". ` +
          "Sem saber de onde veio a diferença, a nota do restante da conta fica com o contador.",
      };
    }
  }
  return { ok: true, pagos: linhas.filter((l) => l.c > 0).map((l) => ({ method: l.method, amount: reais(l.c) })) };
}

// ── PEDIDO CANCELADO PELO PARCEIRO COM NOTA ─────────────────────────────────

/**
 * O aviso gravado em `fiscalInfo.alerta` quando um pedido com NFC-e que vale
 * é cancelado por um caminho que não passa pela trava da nota
 * (lib/edicao-de-pedido → travaDaNotaFiscal): o cancelamento do iFood, do
 * 99Food, da Brendi, do JotaJá, a disputa aceita.
 *
 * ── Por que avisar e não travar ─────────────────────────────────────────────
 *
 * O parceiro já cancelou do lado dele — o cliente foi estornado lá. Recusar
 * aqui só deixaria o FireHub mostrando como vendido um pedido que não existe
 * mais, e a cozinha produzindo. O que falta é a NOTA: ela continua declarando
 * a venda. Quem resolve é a loja (cancelar a nota em até 30 minutos da
 * autorização se a mercadoria não saiu — Ajuste SINIEF 19/16, cl. 15ª) ou o
 * contador (NF-e de devolução/estorno). O aviso aparece na aba Notas fiscais
 * até a nota ser cancelada ou a devolução ser registrada.
 *
 * Nota de homologação não avisa (é teste); nota já cancelada ou com devolução
 * registrada também não.
 */
export function alertaDoCancelamento(
  pedido: { fiscalStatus?: string | null; fiscalInfo?: unknown },
  origem: string,
  agora: Date = new Date()
): Record<string, unknown> | null {
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as any) : {};
  if (Number(info.ambiente) === 2) return null;
  if (info.devolucao) return null;
  const autorizada = pedido.fiscalStatus === "EMITTED" && Boolean(info.nfceKey);
  const processando = pedido.fiscalStatus !== "EMITTED" && pedido.fiscalStatus !== "CANCELED" && info.processando === true;
  if (!autorizada && !processando) return null;
  const numero = info.nfceNumber ? ` nº ${info.nfceNumber}` : "";
  const qual = processando
    ? "NFC-e em processamento na SEFAZ (consulte a situação: se ela sair autorizada, vale o que segue)"
    : info.contingencia === true
      ? `NFC-e${numero} emitida em contingência`
      : `NFC-e autorizada${numero}`;
  return {
    quando: agora.toISOString(),
    origem,
    ...(info.nfceKey ? { nfceKey: info.nfceKey } : {}),
    mensagem:
      `Pedido cancelado (${origem}) com ${qual}: cancele a nota em Fiscal → Notas fiscais em até 30 minutos da ` +
      "autorização se a mercadoria não saiu; se já saiu ou o prazo passou, fale com o contador (NF-e de " +
      "devolução/estorno) e registre a devolução aqui.",
  };
}

// ── RETENTATIVA ─────────────────────────────────────────────────────────────

/** Quantas vezes o cron reemite sozinho uma nota que falhou por comunicação. */
export const MAXIMO_DE_TENTATIVAS_AUTOMATICAS = 5;

/**
 * Falha que passa sozinha: provedor fora do ar, timeout, SEFAZ lenta. Rejeição
 * da SEFAZ, produto sem NCM ou token recusado NÃO passam — reemitir igual daria
 * o mesmo erro, e quem resolve é a pessoa, pela tela fiscal.
 */
export function ehFalhaTransitoria(motivo: unknown): boolean {
  return motivo === "erro_de_comunicacao";
}

/**
 * O que o cron faz com uma falha:
 *
 *  - "retentar": é hora de reemitir;
 *  - "esperar": ainda na espera dobrando (2, 4, 8, 16 min...);
 *  - "encerrar": sai da fila de vez, com o motivo gravado no pedido
 *    (`retentativaEncerrada`, lib/fiscal-automatico).
 *
 * ── Por que "encerrar" existe ───────────────────────────────────────────────
 *
 * A busca das falhas era `take: 40` sem ordem, e casava por 24 h toda linha
 * com motivo "erro_de_comunicacao" — inclusive a que já esgotou as 5
 * tentativas e a FAILED do botão Emitir de um pedido que a automática não
 * cobre (forma fora da lista: `emitirNfceAutomatica` ignora e não grava
 * nada). Essas nunca mudavam de estado, e 40 delas ocupavam a fila inteira: a
 * falha nova, que ainda dava tempo de sair antes de o motoboy chegar, não
 * entrava. Encerrada, a linha é marcada e a busca a exclui no banco.
 *
 * A primeira tentativa (do gancho de status) não conta espera — quem chama
 * aqui é só o cron.
 */
export type DecisaoDaRetentativa = { acao: "retentar" } | { acao: "esperar" } | { acao: "encerrar"; motivo: string };

export function decidirRetentativa(fiscalInfo: unknown, agora: Date = new Date()): DecisaoDaRetentativa {
  const info = fiscalInfo && typeof fiscalInfo === "object" ? (fiscalInfo as any) : {};
  if (info.retentativaEncerrada === true) {
    return { acao: "encerrar", motivo: String(info.motivoDoFimDaRetentativa || "retentativa já encerrada") };
  }
  if (!ehFalhaTransitoria(info.motivo)) {
    return { acao: "encerrar", motivo: "A falha não é de comunicação: reemitir igual daria o mesmo erro. Corrija e emita pela tela Fiscal." };
  }
  // A SEFAZ bloqueou a loja por consumo indevido (656 — emissor próprio,
  // lib/nfce/emissao-da-loja): nada sai até o bloqueio passar, e reemitir
  // antes só o prolongaria (MOC 7.0, 4.3). Espera, sem gastar tentativa.
  const bloqueadaAte = Date.parse(String(info.esperaSefazAte || ""));
  if (Number.isFinite(bloqueadaAte) && agora.getTime() < bloqueadaAte) return { acao: "esperar" };
  const tentativas = Number(info.tentativasAutomaticas) || 0;
  if (tentativas >= MAXIMO_DE_TENTATIVAS_AUTOMATICAS) {
    return { acao: "encerrar", motivo: motivoDasTentativasEsgotadas(tentativas) };
  }
  const ultima = Date.parse(String(info.ultimaTentativaEm || ""));
  if (!Number.isFinite(ultima)) return { acao: "retentar" };
  const esperaMs = 2 * 60_000 * Math.pow(2, Math.max(0, tentativas - 1));
  return agora.getTime() - ultima >= esperaMs ? { acao: "retentar" } : { acao: "esperar" };
}

export function motivoDasTentativasEsgotadas(tentativas: number = MAXIMO_DE_TENTATIVAS_AUTOMATICAS): string {
  return (
    `${tentativas} tentativas automáticas sem resposta do provedor fiscal. A nota não sai mais sozinha: ` +
    "emita pela tela Fiscal quando o provedor voltar."
  );
}

/** Já é hora de tentar de novo? (`decidirRetentativa` diz também por que não.) */
export function deveRetentar(fiscalInfo: unknown, agora: Date = new Date()): boolean {
  return decidirRetentativa(fiscalInfo, agora).acao === "retentar";
}

/**
 * O motivo de a automática não cobrir um pedido que falhou pelo botão
 * Emitir. Vai para o pedido junto com o fim da retentativa: quem abre a tela
 * sabe que a nota não vai sair sozinha e por quê.
 */
export function motivoForaDaAutomatica(motivoDoIgnorado: string): string {
  return `A emissão automática não cobre este pedido (${motivoDoIgnorado}). Emita pela tela Fiscal se a nota for devida.`;
}

const nomeDoAmbiente = (a: number) => (a === 1 ? "produção" : "homologação");

/**
 * A falha pode ser reemitida pela emissão de AGORA da loja? O cron reemite com
 * o ambiente e o token atuais — então só reemite a falha que nasceu nesse
 * mesmo ambiente e cuja venda é posterior a `emissaoLigadaEm`.
 *
 * ── O caso ──────────────────────────────────────────────────────────────────
 *
 * A loja testa em homologação e uma nota fica "processando"; depois passa
 * para produção (lib/fiscal-config `carimbarEmissaoLigada` recarimba
 * `emissaoLigadaEm` justamente para "o pedido que ficou sem nota em
 * homologação não virar nota de produção depois"). A varredura respeitava o
 * carimbo, a retentativa não: reproduzido em 24/09/2026 com banco e provedor
 * falsos — pedido de 40 min antes, nota processando em homologação, loja em
 * produção desde 5 min antes — a consulta foi a api.focusnfe.com.br (não
 * achou), o pedido virou falha de comunicação e a rodada seguinte fez o POST
 * em PRODUÇÃO: nota de verdade para uma venda anterior à troca.
 *
 * `vendaEm`: o `createdAt` do pedido; na conta da mesa, o fechamento (é ele
 * que manda na nota da conta, igual à varredura das contas esquecidas).
 * Falha sem `ambiente` gravado (o botão Emitir não grava) passa pelo carimbo
 * só.
 */
export function retentativaCabeNaEmissaoAtual(entrada: {
  fiscalInfo: unknown;
  vendaEm: Date | string | null | undefined;
  ambienteAtual: number;
  emissaoLigadaEm?: unknown;
}): { cabe: true } | { cabe: false; motivo: string } {
  const info = entrada.fiscalInfo && typeof entrada.fiscalInfo === "object" ? (entrada.fiscalInfo as any) : {};
  const daFalha = Number(info.ambiente);
  const atual = Number(entrada.ambienteAtual) === 1 ? 1 : 2;
  if ((daFalha === 1 || daFalha === 2) && daFalha !== atual) {
    return {
      cabe: false,
      motivo:
        `A tentativa foi em ${nomeDoAmbiente(daFalha)} e a loja agora emite em ${nomeDoAmbiente(atual)}: a emissão ` +
        "automática não leva a nota para outro ambiente. Emita pela tela Fiscal se a nota for devida.",
    };
  }
  const ligadaEm = Date.parse(String(entrada.emissaoLigadaEm || ""));
  const venda = entrada.vendaEm instanceof Date ? entrada.vendaEm.getTime() : Date.parse(String(entrada.vendaEm || ""));
  if (Number.isFinite(ligadaEm) && Number.isFinite(venda) && venda < ligadaEm) {
    return {
      cabe: false,
      motivo:
        `A venda é anterior a quando a emissão foi ligada em ${nomeDoAmbiente(atual)} (${new Date(ligadaEm).toISOString()}): ` +
        "a emissão automática não emite para trás. Emita pela tela Fiscal se a nota for devida.",
    };
  }
  return { cabe: true };
}

// ── A CONTA DA MESA ESQUECIDA ───────────────────────────────────────────────

/** Chaves do fiscalInfo que registram uma TENTATIVA de nota (ou a decisão de não ter). */
const MARCAS_DE_TENTATIVA = ["nfceKey", "processando", "ultimaTentativaEm", "motivo", "ultimoErro", "semNotaAutomatica"];

/**
 * O pedido já teve tentativa de nota? `contaDaMesa` sozinho NÃO é tentativa:
 * é o desconto da conta, gravado no fechamento antes de qualquer emissão
 * (lib/fiscal-automatico, `emitirNfceDaMesa`), justamente para a varredura
 * ter com o que emitir depois.
 */
export function pedidoTemTentativaDeNota(pedido: { fiscalStatus?: string | null; fiscalInfo?: unknown }): boolean {
  const s = String(pedido.fiscalStatus || "").toUpperCase();
  if (s === "EMITTED" || s === "FAILED" || s === "CANCELED") return true;
  const info = pedido.fiscalInfo && typeof pedido.fiscalInfo === "object" ? (pedido.fiscalInfo as Record<string, unknown>) : {};
  return MARCAS_DE_TENTATIVA.some((k) => info[k] != null && info[k] !== false);
}

/**
 * A conta fechada caiu no buraco: tem pedido válido e NENHUM deles teve
 * tentativa de nota. É o que a varredura da mesa (lib/fiscal-automatico)
 * procura — a nota da mesa era tentada uma vez, disparada sem esperar no
 * fechamento; uma exceção antes de gravar, ou o servidor reiniciando no meio,
 * e a conta ficava sem nota e sem registro, porque a varredura dos
 * esquecidos filtrava `tableSessionId: null`.
 *
 * Conta com QUALQUER tentativa fica fora: a falha transitória é do passo de
 * retentativa, e a outra (rejeição, pedido com nota avulsa) é de uma pessoa.
 */
export function contaDaMesaEsquecida(pedidos: { status?: string | null; fiscalStatus?: string | null; fiscalInfo?: unknown }[]): boolean {
  const validos = pedidos.filter((p) => !ehCancelado(p.status));
  return validos.length > 0 && !validos.some(pedidoTemTentativaDeNota);
}

/**
 * O desconto da conta quando ninguém o gravou (a sessão não tem coluna para
 * ele; o fechamento o passa direto para a emissão e ele vai para
 * `fiscalInfo.contaDaMesa` na primeira tentativa).
 *
 * O consumo cobrado tem dois tetos e vale o MENOR: o lançado (soma dos
 * pedidos) e o pago − taxa − gorjeta. Com desconto e sem troco dá o pago; com
 * troco e sem desconto, o lançado. Só erra com desconto E troco na mesma
 * conta — e erra para cima (nota maior que a venda), nunca escondendo venda.
 * Medido no Pastel da Paulista, 30 dias até 24/09/2026: 552 contas, 1 com
 * pago abaixo do lançado (desconto certo) e 21 com pago acima (troco). É a
 * mesma leitura do relatório Descontos (`descontoNoFechamento`,
 * lib/relatorios/regua-da-venda), que também deduz o desconto do pago e
 * também é um piso quando há troco — a nota e o relatório contam o mesmo
 * desconto para a mesma conta.
 */
export function descontoDaContaPeloPago(entrada: {
  /** Soma do totalAmount dos pedidos válidos da conta, em reais. */
  lancado: number;
  pago: number;
  taxaDeServico?: number | null;
  gorjeta?: number | null;
}): number {
  const lancado = centavos(entrada.lancado);
  const consumoPago = centavos(entrada.pago) - centavos(entrada.taxaDeServico || 0) - centavos(entrada.gorjeta || 0);
  const cobrado = Math.max(0, Math.min(lancado, consumoPago));
  return reais(lancado - cobrado);
}

/** A janela padrão das varreduras: o que caiu no buraco há pouco. */
export const JANELA_DA_VARREDURA_MS = 2 * 60 * 60_000;
/** Nunca além disto, nem no fechamento de um turno longo. */
export const JANELA_MAXIMA_MS = 24 * 60 * 60_000;

/**
 * A nota que o cron acompanha ("processando" ou em contingência): a que se
 * mexeu nas últimas 48 h (`updatedAt` — toda gravação da nota carimba, e cada
 * consulta que responde também), de venda de até 31 dias.
 *
 * A busca era pela idade do PEDIDO (48 h). O botão Emitir alcança venda
 * antiga — as contas de mesa fechadas sem nota do Pastel da Paulista eram de
 * um mês de medição —, e a nota à mão de uma venda da semana passada que
 * terminasse "processando" ou em contingência nunca era consultada: ficava
 * presa (a trava de edição junto), e a recusa da SEFAZ na transmissão da
 * contingência passava em branco.
 *
 * Os 31 dias são o piso do índice (franchiseeId, createdAt): sem ele a busca
 * leria todos os pedidos da loja, de todos os tempos, a cada 2 minutos — o
 * `updatedAt` não tem índice. Nota à mão de venda mais antiga que isso fica
 * com o "Consultar situação" da tela.
 */
export const JANELA_DA_VENDA_CONSULTADA_MS = 31 * 24 * 60 * 60_000;
export const JANELA_DA_NOTA_CONSULTADA_MS = 2 * JANELA_MAXIMA_MS;

/**
 * O cron da NFC-e (api/cron/fiscal-retentativa) pode rodar neste processo?
 * Devolve o motivo para NÃO rodar, ou null.
 *
 * Só em produção. Em development o lib/cron-auth autoriza qualquer chamada, e
 * o .env de desenvolvimento deste projeto é o banco de PRODUÇÃO. Em
 * 24/09/2026 uma conferência chamou a rota no servidor de desenvolvimento
 * (localhost:3002) de um worktree fora do master: só não emitiu nem gravou
 * nada porque nenhuma loja tinha a emissão ligada. Com uma loja ligada, teria
 * reemitido NFC-e reais na SEFAZ e gravado fiscalInfo em pedidos reais com o
 * código de uma branch — e nota fiscal não se desfaz (o cancelamento só vale
 * antes da saída da mercadoria e em até 30 minutos).
 *
 * `FISCAL_CRON_FORA_DE_PRODUCAO=1` libera de propósito (um banco de teste de
 * verdade, por exemplo). A lógica do cron é testada sem a rota, contra banco
 * e provedor falsos (scripts/teste-fiscal-retentativa.ts).
 */
export function motivoParaOCronFiscalNaoRodar(env: { NODE_ENV?: string; FISCAL_CRON_FORA_DE_PRODUCAO?: string }): string | null {
  if (env.NODE_ENV === "production") return null;
  if (env.FISCAL_CRON_FORA_DE_PRODUCAO === "1") return null;
  return (
    `O cron da NFC-e só roda em produção (NODE_ENV=${env.NODE_ENV || "vazio"}): fora dela ele emitiria notas reais ` +
    "com o banco do .env. Para rodar de propósito num banco de teste, defina FISCAL_CRON_FORA_DE_PRODUCAO=1."
  );
}

/**
 * Desde quando a varredura olha. Ligar a emissão numa loja não pode sair
 * emitindo o dia inteiro para trás: o início é `desde` (o fechamento de caixa
 * passa a abertura do turno) ou duas horas, nunca antes de `emissaoLigadaEm`
 * quando existir, e nunca mais que 24 h.
 */
export function inicioDaVarredura(entrada: { agora: number; desde?: Date | null; emissaoLigadaEm?: unknown }): Date {
  const limites = [
    entrada.desde ? entrada.desde.getTime() : entrada.agora - JANELA_DA_VARREDURA_MS,
    entrada.agora - JANELA_MAXIMA_MS,
  ];
  const ligadaEm = Date.parse(String(entrada.emissaoLigadaEm || ""));
  if (Number.isFinite(ligadaEm)) limites.push(ligadaEm);
  return new Date(Math.max(...limites));
}
