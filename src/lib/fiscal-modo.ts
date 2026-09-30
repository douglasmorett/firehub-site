/**
 * Como a loja emite a NFC-e: sozinha ou pela mão de alguém, no pedido.
 *
 * ── As duas formas (a escolha do módulo fiscal) ─────────────────────────────
 *
 * AUTOMÁTICA: o FireHub emite sozinho, na hora da nota (lib/fiscal-momento),
 * a venda cuja forma de pagamento a loja marcou. Há uma lista para as vendas
 * da própria loja (balcão, mesa, site, robô, totem) e uma para cada
 * integração (iFood, 99Food, Brendi, Wabiz, JotaJá): a loja que quer nota em
 * todo pedido do iFood e só no cartão do balcão consegue dizer isso. O pedido
 * feito no FireHub pergunta o CPF/CNPJ na hora (site, robô, balcão, totem).
 *
 * MANUAL: nenhuma nota sai sozinha. A pessoa abre o pedido no painel, clica em
 * "Emitir NFC-e", digita o CPF/CNPJ se o cliente quiser e emite. O pedido não
 * pergunta nada — o documento é pedido depois, na emissão.
 *
 * Config sem a escolha gravada é AUTOMÁTICA: é como a emissão funcionava antes
 * de a escolha existir, e loja com a emissão ligada não pode parar de emitir
 * porque o código mudou.
 *
 * ── Por que a entrega sem CPF não é "Falhou" ────────────────────────────────
 *
 * A NFC-e de entrega (presença 4) exige o CPF/CNPJ e o endereço de quem
 * recebe (rejeições 787 e 788; Ajuste SINIEF 9/26). Na NIK, 15 de 808
 * entregas em 30 dias tinham CPF (medido em 30/09/2026): com a automática
 * ligada, 98% das entregas virariam "Falhou" na tela fiscal, e a falha de
 * verdade (produto sem NCM, SEFAZ fora) se perderia no meio. A entrega sem
 * documento fica "Falta CPF": não vai à SEFAZ, não gasta número, não entra na
 * retentativa, e a pessoa emite pelo pedido quando o cliente informar.
 *
 * Puro (sem banco): testado em scripts/teste-fiscal-modo.ts, e as telas usam
 * as mesmas funções que o servidor — o obrigatório da tela é o do servidor.
 */
import { chaveDoCanal } from "./canal-do-pedido";
import { documentoDeVerdade } from "./documento-do-cliente";
import {
  chavesDoPagamento,
  deveEmitirNoStatus,
  ehEntregaEmDomicilio,
  formaEntraNaAutomatica,
  listaDaEmissaoAutomatica,
  momentoDaEmissao,
  pedidoDeMesaExigeNotaDaConta,
  JANELA_DA_VARREDURA_MS,
  type ChaveDePagamento,
  type PedidoParaForma,
} from "./fiscal-momento";

// ── O MODO ──────────────────────────────────────────────────────────────────

export type ModoDaEmissao = "automatico" | "manual";

/** "manual" só quando a loja escolheu; o resto (inclusive ausente) é automática. */
export function modoDaEmissao(config: { modoDaEmissao?: unknown } | null | undefined): ModoDaEmissao {
  return String(config?.modoDaEmissao ?? "").trim().toLowerCase() === "manual" ? "manual" : "automatico";
}

// ── AS LISTAS DE FORMAS ─────────────────────────────────────────────────────

/** As integrações que podem ter lista própria, na ordem da tela. */
export const INTEGRACOES_DA_NOTA = [
  { canal: "IFOOD", nome: "iFood" },
  { canal: "99FOOD", nome: "99Food" },
  { canal: "BRENDI", nome: "Brendi" },
  { canal: "WABIZ", nome: "Wabiz" },
  { canal: "JOTAJA", nome: "JotaJá" },
] as const;

export type IntegracaoDaNota = (typeof INTEGRACOES_DA_NOTA)[number]["canal"];

export function ehIntegracaoDaNota(canal: unknown): canal is IntegracaoDaNota {
  return INTEGRACOES_DA_NOTA.some((i) => i.canal === canal);
}

export function nomeDaIntegracao(canal: IntegracaoDaNota): string {
  return INTEGRACOES_DA_NOTA.find((i) => i.canal === canal)?.nome ?? canal;
}

/**
 * As listas próprias das integrações, só com canal conhecido e forma
 * conhecida. Canal sem entrada = "igual às vendas da loja": é assim que a
 * loja que nunca abriu esta parte continua com o comportamento de antes (uma
 * lista para tudo).
 */
export function lerFormasPorIntegracao(bruto: unknown): Partial<Record<IntegracaoDaNota, ChaveDePagamento[]>> {
  const origem = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const saida: Partial<Record<IntegracaoDaNota, ChaveDePagamento[]>> = {};
  for (const { canal } of INTEGRACOES_DA_NOTA) {
    if (Array.isArray(origem[canal])) saida[canal] = listaDaEmissaoAutomatica(origem[canal]);
  }
  return saida;
}

/**
 * As formas com nota automática para o pedido deste canal: a lista da
 * integração, quando a loja fez uma, ou a das vendas da loja.
 */
export function formasDoCanal(
  config: { autoEmitPaymentMethods?: unknown; formasPorIntegracao?: unknown } | null | undefined,
  canal: string | null | undefined
): ChaveDePagamento[] {
  if (ehIntegracaoDaNota(canal)) {
    const propria = lerFormasPorIntegracao(config?.formasPorIntegracao)[canal];
    if (propria) return propria;
  }
  return listaDaEmissaoAutomatica(config?.autoEmitPaymentMethods);
}

// ── O CPF/CNPJ NO PEDIDO ────────────────────────────────────────────────────

export type DocumentoNaEntrega = "obrigatorio" | "opcional";

/** "obrigatorio" só quando a loja escolheu; o padrão é pedir sem travar. */
export function documentoNaEntrega(config: { cpfNaEntrega?: unknown } | null | undefined): DocumentoNaEntrega {
  return String(config?.cpfNaEntrega ?? "").trim().toLowerCase() === "obrigatorio" ? "obrigatorio" : "opcional";
}

/**
 * O que o pedido feito no FireHub (site, robô, balcão, totem) faz com o
 * CPF/CNPJ. Vai inteiro para as telas: é pouco, e é público de propósito — o
 * cardápio precisa saber se mostra o campo.
 */
export type DocumentoNoPedido = {
  /** Mostrar o campo "CPF/CNPJ na nota": a loja emite sozinha. */
  perguntar: boolean;
  /** Na entrega paga numa forma com nota automática, o pedido não fecha sem o documento. */
  obrigatorioNaEntrega: boolean;
  /** As formas com nota automática nas vendas da loja. */
  formas: ChaveDePagamento[];
};

export const DOCUMENTO_NAO_PEDIDO: DocumentoNoPedido = { perguntar: false, obrigatorioNaEntrega: false, formas: [] };

export function documentoNoPedido(
  config: { enabled?: unknown; modoDaEmissao?: unknown; cpfNaEntrega?: unknown; autoEmitPaymentMethods?: unknown } | null | undefined
): DocumentoNoPedido {
  if (config?.enabled !== true || modoDaEmissao(config) !== "automatico") return DOCUMENTO_NAO_PEDIDO;
  const formas = listaDaEmissaoAutomatica(config.autoEmitPaymentMethods);
  return {
    perguntar: true,
    obrigatorioNaEntrega: documentoNaEntrega(config) === "obrigatorio" && formas.length > 0,
    formas,
  };
}

/**
 * Este pedido precisa do documento para fechar? Só a entrega (a retirada, o
 * balcão e a mesa saem sem destinatário) e só na forma que tem nota automática
 * — o cliente que paga em dinheiro numa loja que não emite no dinheiro não
 * teria nota nenhuma para receber o CPF.
 */
export function documentoObrigatorioNoPedido(
  regra: DocumentoNoPedido | null | undefined,
  pedido: PedidoParaForma & { deliveryType?: string | null }
): boolean {
  if (!regra?.obrigatorioNaEntrega) return false;
  if (!ehEntregaEmDomicilio(pedido.deliveryType)) return false;
  return formaEntraNaAutomatica(chavesDoPagamento(pedido), regra.formas);
}

// ── A ENTREGA SEM DOCUMENTO ─────────────────────────────────────────────────

/**
 * A nota montada é de entrega (presença 4) e não tem CPF/CNPJ? Lê a NOTA
 * (lib/fiscal-itens → pedidoParaNota), não o pedido: é a mesma leitura do
 * emissor — "00000000000" do JotaJá é sem documento, o digitado no modal vale
 * mais que o gravado. Documento presente e inválido NÃO é falta: vai à
 * emissão e volta como "CPF inválido", que a pessoa tem de corrigir.
 */
export function entregaSemDocumento(
  nota: { entregaEmDomicilio?: boolean | null; documentoDoCliente?: string | null },
  config: { entregaComoPresencial?: unknown } | null | undefined
): boolean {
  if (!nota.entregaEmDomicilio || config?.entregaComoPresencial === true) return false;
  return documentoDeVerdade(nota.documentoDoCliente) === null;
}

/** O motivo gravado em `semNotaAutomatica` e mostrado na linha do pedido. */
export const MOTIVO_DA_ENTREGA_SEM_DOCUMENTO =
  "Falta o CPF/CNPJ do cliente: a SEFAZ só aceita a nota de entrega com o documento e o endereço de quem recebe. " +
  "Quando o cliente informar, digite o documento e emita.";

export const MOTIVO_DA_EMISSAO_MANUAL =
  "A loja emite as notas à mão (Fiscal → Configurações → Como a nota é emitida): emita pelo pedido.";

// ── POR QUE O PEDIDO NÃO TEM NOTA ───────────────────────────────────────────

export type SemNotaPorque = {
  /**
   * manual: a loja emite à mão · forma: a forma não tem nota automática no
   * canal · falta_documento: entrega sem CPF/CNPJ · aguardando: ainda não é
   * a hora da nota · mesa: a nota é da conta · antes_de_ligar: venda de antes
   * de a emissão ser ligada · a_caminho: a automática cobre e é a hora, mas
   * a nota ainda não saiu (o cron tenta de novo).
   */
  tipo: "manual" | "forma" | "falta_documento" | "aguardando" | "mesa" | "antes_de_ligar" | "a_caminho";
  texto: string;
};

export type PedidoSemNota = PedidoParaForma & {
  status?: string | null;
  deliveryType?: string | null;
  tableSessionId?: string | null;
  customerCpfCnpj?: string | null;
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | number | null;
  createdAt?: Date | string | null;
};

/**
 * Por que este pedido (ainda) não tem nota, numa frase — a da linha na tela
 * fiscal e a do painel do pedido. `null` só quando não há o que dizer: a
 * emissão desligada ou o pedido cancelado. A falha gravada, quando houve
 * tentativa, é explicada por ela mesma — quem chama só pergunta isto para o
 * pedido sem tentativa nenhuma.
 *
 * A ordem é a da emissão automática (`emitirNfceAutomatica`): mesa, modo,
 * forma do canal, documento da entrega e, por último, a hora. "Ainda não é a
 * hora" vem depois do documento de propósito: a entrega sem CPF não vai ter
 * nota nem quando sair, e é isso que a pessoa precisa saber agora.
 */
export function porQueSemNota(
  config: {
    enabled?: unknown;
    modoDaEmissao?: unknown;
    autoEmitPaymentMethods?: unknown;
    formasPorIntegracao?: unknown;
    momentoDaEmissao?: unknown;
    entregaComoPresencial?: unknown;
    emissaoLigadaEm?: unknown;
  } | null | undefined,
  pedido: PedidoSemNota,
  agora: number = Date.now()
): SemNotaPorque | null {
  if (config?.enabled !== true) return null;
  // Venda cancelada não tem nota — a tela diz "cancelado", não "falta".
  if (String(pedido.status ?? "").toUpperCase().startsWith("CANCEL")) return null;
  if (pedidoDeMesaExigeNotaDaConta(pedido)) {
    return { tipo: "mesa", texto: "Pedido de mesa: a nota é da conta inteira, emitida quando a conta fecha." };
  }
  if (modoDaEmissao(config) === "manual") {
    return { tipo: "manual", texto: "A loja emite as notas à mão: clique em Emitir NFC-e quando o cliente quiser a nota." };
  }
  const canal = chaveDoCanal(pedido);
  const chaves = chavesDoPagamento(pedido);
  if (!formaEntraNaAutomatica(chaves, formasDoCanal(config, canal))) {
    const forma = chaves.length > 0 ? formasEmTexto(chaves) : `"${String(pedido.paymentMethod ?? "sem forma")}"`;
    const onde = ehIntegracaoDaNota(canal) ? `no ${nomeDaIntegracao(canal)}` : "nas vendas da loja";
    return {
      tipo: "forma",
      texto: `${forma} não tem nota automática ${onde} (Fiscal → Configurações). Se o cliente pedir, emita à mão.`,
    };
  }
  const entrega = String(pedido.deliveryType ?? "").trim().toUpperCase() === "DELIVERY";
  if (entregaSemDocumento({ entregaEmDomicilio: entrega, documentoDoCliente: pedido.customerCpfCnpj ?? null }, config)) {
    return { tipo: "falta_documento", texto: MOTIVO_DA_ENTREGA_SEM_DOCUMENTO };
  }
  const momento = momentoDaEmissao(config);
  if (!deveEmitirNoStatus(pedido, momento)) {
    const texto =
      momento === "aceite"
        ? "A nota sai sozinha quando a loja aceitar o pedido."
        : momento === "saida" && ehEntregaEmDomicilio(pedido.deliveryType)
          ? "A nota sai sozinha quando o pedido sair para a entrega."
          : "A nota sai sozinha quando o pedido for concluído.";
    return { tipo: "aguardando", texto };
  }
  // A automática cobre e já é a hora. A varredura não volta a antes de a
  // emissão ser ligada (lib/fiscal-momento → inicioDaVarredura): a venda
  // antiga fica sem nota, e só a mão resolve.
  const ligadaEm = Date.parse(String(config.emissaoLigadaEm ?? ""));
  const criadoEm = pedido.createdAt ? new Date(pedido.createdAt).getTime() : NaN;
  if (Number.isFinite(ligadaEm) && Number.isFinite(criadoEm) && criadoEm < ligadaEm) {
    return {
      tipo: "antes_de_ligar",
      texto: "Venda de antes de a emissão ser ligada: a nota automática não volta ao passado. Se o cliente pedir, emita à mão.",
    };
  }
  // A varredura do cron olha as últimas 2 horas; o fechamento do caixa, o
  // turno inteiro. A frase diz qual das duas ainda vai passar por esta venda.
  const recente = !Number.isFinite(criadoEm) || agora - criadoEm < JANELA_DA_VARREDURA_MS;
  return {
    tipo: "a_caminho",
    texto: recente
      ? "A nota automática ainda não saiu: o FireHub tenta de novo a cada 2 minutos. Se o cliente está esperando, emita agora."
      : "A nota automática desta venda não saiu: o FireHub confere de novo no fechamento do caixa. Se a nota é devida agora, emita à mão.",
  };
}

// ── EM PALAVRAS ─────────────────────────────────────────────────────────────

const NOME_DA_FORMA: Record<ChaveDePagamento, string> = {
  MONEY: "Dinheiro",
  PIX: "Pix",
  CREDIT_CARD: "Crédito",
  DEBIT_CARD: "Débito",
  VOUCHER: "Vale-refeição",
  ONLINE: "Pago online",
};

/** A ordem da tela, para a frase não mudar de ordem conforme o clique. */
export const ORDEM_DAS_FORMAS: ChaveDePagamento[] = ["MONEY", "PIX", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER", "ONLINE"];

export function nomeDaForma(chave: ChaveDePagamento): string {
  return NOME_DA_FORMA[chave];
}

/** "Pix, Crédito e Débito" — na ordem da tela. */
export function formasEmTexto(formas: ChaveDePagamento[]): string {
  const nomes = ORDEM_DAS_FORMAS.filter((f) => formas.includes(f)).map(nomeDaForma);
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * O que as escolhas querem dizer, em frases para quem não é do fiscal ler —
 * a tela mostra embaixo das opções, e muda enquanto a pessoa marca. É a
 * conferência de "entendi o que eu fiz" que a tela não tinha: com seis caixas
 * e uma coluna por integração, só a frase diz que o dinheiro do balcão ficou
 * sem nota.
 *
 * `integracoes`: as que a loja usa (a tela mostra só essas).
 */
export function resumoDaEmissao(
  config: {
    modoDaEmissao?: unknown;
    autoEmitPaymentMethods?: unknown;
    formasPorIntegracao?: unknown;
    cpfNaEntrega?: unknown;
  } | null | undefined,
  integracoes: IntegracaoDaNota[] = []
): string[] {
  if (modoDaEmissao(config) === "manual") {
    return [
      "Nenhuma nota sai sozinha.",
      "Para emitir: em Pedidos, abra o pedido (🧾 Nota fiscal), digite o CPF/CNPJ se o cliente quiser e clique em Emitir NFC-e.",
      "Na entrega, a SEFAZ exige o CPF/CNPJ e o endereço do cliente — sem o documento, a nota da entrega não sai.",
      "Mesa: a nota é da conta inteira, emitida depois que a conta fecha.",
    ];
  }
  const daLoja = listaDaEmissaoAutomatica(config?.autoEmitPaymentMethods);
  const linhas: string[] = [];
  linhas.push(
    daLoja.length > 0
      ? `Vendas da loja (balcão, mesa, site, robô e totem): a nota sai sozinha em ${formasEmTexto(daLoja)}.`
      : "Vendas da loja (balcão, mesa, site, robô e totem): nenhuma forma marcada — nenhuma nota sai sozinha."
  );
  for (const canal of integracoes) {
    const formas = formasDoCanal(config, canal);
    linhas.push(
      formas.length > 0
        ? `${nomeDaIntegracao(canal)}: a nota sai sozinha em ${formasEmTexto(formas)}.`
        : `${nomeDaIntegracao(canal)}: nenhuma nota sai sozinha.`
    );
  }
  const semNota = ORDEM_DAS_FORMAS.filter(
    (f) => !daLoja.includes(f) || integracoes.some((canal) => !formasDoCanal(config, canal).includes(f))
  );
  if (semNota.length > 0) {
    linhas.push("A venda numa forma sem nota automática fica sem nota — se o cliente pedir, emita pelo pedido.");
  }
  linhas.push(
    documentoNaEntrega(config) === "obrigatorio"
      ? "Entrega pelo site, robô ou balcão: o pedido só fecha com o CPF/CNPJ do cliente (nas formas com nota automática)."
      : "Entrega: o pedido pergunta o CPF/CNPJ, mas não obriga. A entrega sem documento fica em \"Falta CPF\" e só tem nota se alguém emitir pelo pedido."
  );
  if (integracoes.length > 0) {
    linhas.push("Integrações: a nota da entrega só sai sozinha se o cliente pôs o CPF no app; sem ele, o pedido fica em \"Falta CPF\".");
  }
  return linhas;
}
