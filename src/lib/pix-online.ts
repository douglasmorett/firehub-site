/**
 * PAGAMENTO PELO SITE (PIX E CARTÃO), NA CONTA ASAAS DO PRÓPRIO LOJISTA —
 * as regras, num lugar só.
 *
 * O lojista cria a conta dele no Asaas, gera uma chave de API e conecta em
 * Integrações → Asaas. Daí em diante o FireHub cria a cobrança de cada pedido
 * do cardápio pago online COM A CHAVE DELE: a cobrança sai no nome da loja, o
 * dinheiro cai na conta Asaas da loja, e o Asaas separa sozinho a taxa do
 * pagamento online (1% do pedido) para a carteira do FireHub, por split
 * (lib/asaas-da-loja.ts, `walletDoFireHub`). Pedido pago na entrega não passa
 * pelo Asaas e não tem taxa nenhuma.
 *
 * Cartão: o cliente digita o cartão na página do próprio Asaas (a "fatura"),
 * nunca no FireHub. Mandar o número do cartão pela API poria o servidor do
 * FireHub no escopo do PCI-DSS (docs.asaas.com/docs/pci-dss-1).
 *
 * Por que não subconta criada pelo FireHub (levantamento de 25/09/2026): o
 * período de avaliação limita a 10 subcontas com R$ 2.000 em cobranças cada, e
 * depois dele a chave da subconta só continua com BaaS acertado com o gerente
 * do Asaas. Conta própria do lojista não passa por nada disso.
 *
 * Este arquivo não tem segredo nem banco: a tela de conexão, o cardápio e o
 * aviso no WhatsApp leem o MESMO texto daqui, para a regra que o lojista
 * aceitou ser a regra que o código cumpre.
 */

export type FormaOnline = "pix" | "cartao";

/** A taxa do pagamento online, sobre o valor do pedido. Vai por split. */
export const SPLIT_FIREHUB_PERCENTUAL = 1;

/**
 * Quanto tempo o cliente tem para pagar. Depois disso o pedido é cancelado e a
 * cobrança é excluída no Asaas — o QR do Asaas por si só valeria 12 meses, e
 * um Pix pago horas depois viraria lanche feito para ninguém.
 */
export const MINUTOS_PARA_PAGAR = 30;

// Tarifas do Asaas (asaas.com/precos-e-taxas, lidas em 27/09/2026).
/** Por Pix recebido. */
export const TARIFA_ASAAS_PIX = 1.99;
/** Por Pix recebido nos 3 primeiros meses da conta Asaas. */
export const TARIFA_ASAAS_PIX_PROMOCIONAL = 0.99;
/** Cartão de crédito à vista: percentual + fixo. */
export const TARIFA_ASAAS_CARTAO_PERCENTUAL = 2.99;
export const TARIFA_ASAAS_CARTAO_PERCENTUAL_PROMOCIONAL = 1.99;
export const TARIFA_ASAAS_CARTAO_FIXA = 0.49;
/** Transferência (Pix de saída) de conta PJ: 30 grátis por mês, depois isto. */
export const TARIFA_ASAAS_SAQUE_PJ = 2.0;

/**
 * Versão das regras. Sobe quando o texto muda de um jeito que o lojista
 * precisa aceitar de novo — a tela compara com a versão que ele aceitou.
 * 2 = cartão pelo site (27/09/2026).
 */
export const VERSAO_DAS_REGRAS = 2;

const arred = (v: number) => Math.round(v * 100) / 100;

/** A tarifa do Asaas numa venda deste valor, na tabela cheia. */
export function tarifaDoAsaas(valor: number, forma: FormaOnline = "pix"): number {
  const v = Number(valor) || 0;
  if (forma === "cartao") return arred((v * TARIFA_ASAAS_CARTAO_PERCENTUAL) / 100 + TARIFA_ASAAS_CARTAO_FIXA);
  return TARIFA_ASAAS_PIX;
}

/**
 * A taxa do pagamento online em reais, calculada AQUI e mandada como valor
 * fixo no split.
 *
 * O `percentualValue` do Asaas incide sobre o valor LÍQUIDO (depois da tarifa):
 * 1% de um Pix de R$ 50 viraria 1% de R$ 48,01. O combinado é 1% do pedido,
 * então o FireHub manda o valor exato. Nunca passa do que sobra depois da
 * tarifa, senão o Asaas bloqueia o recebimento por divergência de split.
 */
export function splitDoFireHub(valorDoPedido: number, forma: FormaOnline = "pix"): number {
  const valor = Number(valorDoPedido) || 0;
  if (valor <= 0) return 0;
  const split = arred((valor * SPLIT_FIREHUB_PERCENTUAL) / 100);
  const teto = arred(valor - tarifaDoAsaas(valor, forma));
  if (teto <= 0) return 0;
  return Math.max(0.01, Math.min(split, teto));
}

/** Quanto sobra para a loja numa venda deste valor, com a tarifa cheia do Asaas. */
export function liquidoDaLoja(valorDoPedido: number, forma: FormaOnline = "pix"): number {
  const valor = Number(valorDoPedido) || 0;
  return arred(Math.max(0, valor - tarifaDoAsaas(valor, forma) - splitDoFireHub(valor, forma)));
}

export const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** "2,99% + R$ 0,49" */
export const TEXTO_TARIFA_CARTAO = `${pct(TARIFA_ASAAS_CARTAO_PERCENTUAL)} + ${reais(TARIFA_ASAAS_CARTAO_FIXA)}`;

/**
 * O custo de uma venda paga pelo site, SOMADO — tarifa do Asaas + taxa do
 * pagamento online. É o número que o lojista vê em todo lugar (selo, tabela,
 * tela de conectado, WhatsApp), como compara com a maquininha (dono,
 * 28/09/2026). A divisão — 1% do FireHub, o resto do Asaas — fica numa
 * linha só, na regra de custo que ele aceita (REGRAS_DO_PIX_ONLINE): o split
 * aparece no extrato do Asaas com o nome do FireHub, e cobrança fora do
 * aceite vira reclamação. Nunca dizer que o total é tarifa do Asaas.
 */
export const CUSTO_POR_VENDA_PIX = `${reais(TARIFA_ASAAS_PIX)} + ${pct(SPLIT_FIREHUB_PERCENTUAL)}`;
/** "3,99% + R$ 0,49" */
export const CUSTO_POR_VENDA_CARTAO = `${pct(TARIFA_ASAAS_CARTAO_PERCENTUAL + SPLIT_FIREHUB_PERCENTUAL)} + ${reais(TARIFA_ASAAS_CARTAO_FIXA)}`;
/** Nos 3 primeiros meses da conta Asaas, com a tarifa promocional dele. */
export const CUSTO_POR_VENDA_PIX_PROMOCIONAL = `${reais(TARIFA_ASAAS_PIX_PROMOCIONAL)} + ${pct(SPLIT_FIREHUB_PERCENTUAL)}`;
export const CUSTO_POR_VENDA_CARTAO_PROMOCIONAL =
  `${pct(TARIFA_ASAAS_CARTAO_PERCENTUAL_PROMOCIONAL + SPLIT_FIREHUB_PERCENTUAL)} + ${reais(TARIFA_ASAAS_CARTAO_FIXA)}`;

/** O custo somado em reais numa venda deste valor (tarifa cheia do Asaas). */
export function custoDaVenda(valorDoPedido: number, forma: FormaOnline = "pix"): number {
  const valor = Number(valorDoPedido) || 0;
  return arred(tarifaDoAsaas(valor, forma) + splitDoFireHub(valor, forma));
}

/** Uma regra, com o título curto e a explicação. */
export type Regra = { titulo: string; texto: string };

/**
 * As regras que o lojista aceita ao conectar. Mesma lista na tela e no aviso
 * de WhatsApp de quando ele liga o pagamento pelo site.
 */
export const REGRAS_DO_PIX_ONLINE: Regra[] = [
  {
    titulo: "O dinheiro cai na sua conta Asaas",
    texto:
      "Pix: na hora — o Asaas confirma em segundos e o valor já fica disponível. Cartão de crédito à vista: em até 2 dias úteis. " +
      "Para levar ao seu banco, faça um Pix de saída no app do Asaas (imediato). Conta PJ tem 30 transferências grátis por mês " +
      `e paga ${reais(TARIFA_ASAAS_SAQUE_PJ)} por transferência depois disso.`,
  },
  {
    titulo: "Custo por venda paga pelo site",
    texto:
      `Pix: ${CUSTO_POR_VENDA_PIX}. Cartão: ${CUSTO_POR_VENDA_CARTAO}. Já sai descontado do que cai na sua conta — nada é cobrado à parte. ` +
      `Nos 3 primeiros meses da sua conta Asaas: Pix ${CUSTO_POR_VENDA_PIX_PROMOCIONAL} e cartão ${CUSTO_POR_VENDA_CARTAO_PROMOCIONAL}. ` +
      // A ÚNICA linha que divide o custo — ver CUSTO_POR_VENDA_PIX.
      `Desse custo, a taxa do pagamento online de ${SPLIT_FIREHUB_PERCENTUAL}% do pedido é do FireHub e o resto é a tarifa do Asaas. ` +
      "Pedido pago na entrega não tem custo nenhum.",
  },
  {
    titulo: "O pedido só vai para a cozinha depois de pago",
    texto:
      "Pedido pago pelo site fica esperando o pagamento e entra sozinho no painel, na impressora e no KDS quando o Pix cai ou o cartão é aprovado. " +
      "Você não precisa conferir comprovante nem aceitar nada à mão.",
  },
  {
    titulo: `O cliente tem ${MINUTOS_PARA_PAGAR} minutos para pagar`,
    texto:
      `Passou de ${MINUTOS_PARA_PAGAR} minutos sem pagamento, o FireHub cancela o pedido e exclui a cobrança no Asaas: o QR Code e o link do cartão deixam de valer.`,
  },
  {
    titulo: "O cartão é digitado na página segura do Asaas",
    texto:
      "No cartão, o cliente é levado à página de pagamento do Asaas, no nome da sua loja, e volta para o cardápio. " +
      "O número do cartão não passa pelo FireHub nem pela sua loja.",
  },
  {
    titulo: "O CPF do cliente é pedido na finalização",
    texto:
      "O Asaas só gera a cobrança com o CPF de quem paga. O FireHub pede o CPF quando o cliente escolhe Pix ou cartão pelo site, " +
      "e ele também serve para a nota fiscal do pedido.",
  },
  {
    titulo: "Cancelou pedido pago? O dinheiro volta para o cliente sozinho",
    texto:
      "Ao cancelar um pedido já pago, o FireHub pede o estorno ao Asaas: o Pix volta para a conta do cliente e o cartão é estornado na fatura dele. " +
      "Se não houver saldo, ou se o Asaas pedir que você autorize o estorno no app, ele fica pendente e avisamos você no WhatsApp.",
  },
  {
    titulo: "Contestação de cartão é com a loja",
    texto:
      "Se o dono do cartão contestar a compra no banco (chargeback), o Asaas pode segurar ou descontar o valor do seu saldo até a disputa acabar. " +
      "Guarde o comprovante de entrega dos pedidos pagos com cartão.",
  },
  {
    titulo: "Sua chave de API fica guardada com segurança",
    texto:
      "A chave dá acesso à sua conta Asaas. O FireHub guarda a chave criptografada e só a usa para gerar as cobranças do cardápio, " +
      "conferir pagamentos, fazer estornos e manter os avisos de pagamento ligados. Você pode desconectar quando quiser e excluir a chave no Asaas.",
  },
  {
    titulo: "Chave parada é desativada pelo Asaas",
    texto:
      "O Asaas desativa chave sem uso por 3 meses. O FireHub consulta sua conta todo dia para isso não acontecer; " +
      "se mesmo assim a chave for desativada ou excluída, o pagamento pelo site sai do cardápio sozinho e avisamos você.",
  },
  {
    titulo: "Pagamento na entrega continua",
    texto: "Pix na entrega, dinheiro e maquininha continuam no cardápio. O pagamento pelo site é uma opção a mais.",
  },
];

/**
 * O que conferir no Asaas ANTES de colar a chave. Cada item é algo que, se
 * faltar, faz a conexão falhar ou o pagamento não sair — melhor saber antes.
 */
export const CONFERIR_NO_ASAAS: Regra[] = [
  {
    titulo: "Conta criada e aprovada",
    texto:
      "Crie a conta em asaas.com e envie os documentos que o Asaas pedir. Enquanto a conta estiver em análise, o Asaas não deixa receber.",
  },
  {
    titulo: "Uma chave Pix na conta",
    texto:
      "Em Pix → Minhas chaves. Se você não tiver nenhuma, o FireHub cria uma chave aleatória para você ao conectar.",
  },
  {
    titulo: "Gere a chave de API",
    texto:
      "No site do Asaas (não no app): Integrações → Chaves de API → Gerar chave. Deixe SEM data de expiração. " +
      "Ela aparece uma vez só: copie e cole aqui.",
  },
  {
    titulo: "Deixe a Whitelist de IPs desligada",
    texto:
      "Se ela estiver ligada em Integrações, o Asaas recusa os pedidos do FireHub e a cobrança não é gerada.",
  },
  {
    titulo: "Não precisa mexer em webhook nem em notificações",
    texto:
      "O FireHub configura sozinho o aviso de pagamento na sua conta. Os clientes do cardápio são cadastrados sem notificação " +
      "do Asaas por e-mail/SMS/WhatsApp — cada notificação seria cobrada de você.",
  },
];

/** Texto do WhatsApp de quando o lojista liga o pagamento pelo site. */
export function mensagemDePixOnlineAtivado(nomeDaLoja: string, nomeDaConta: string, formas: { pix: boolean; cartao: boolean } = { pix: true, cartao: false }): string {
  const quais = [formas.pix && "Pix", formas.cartao && "cartão"].filter(Boolean).join(" e ") || "Pix";
  const linhas = [
    `✅ *Pagamento pelo site ligado* — ${nomeDaLoja}`,
    "",
    `Os pedidos do cardápio agora podem ser pagos com ${quais} na hora, direto na sua conta Asaas (${nomeDaConta}).`,
    "",
    "*Como funciona*",
    "• Pix cai na sua conta Asaas na hora; cartão à vista, em até 2 dias úteis. Para levar ao banco, faça um Pix de saída no app do Asaas.",
    `• Custo por venda paga pelo site: ${CUSTO_POR_VENDA_PIX} no Pix e ${CUSTO_POR_VENDA_CARTAO} no cartão, já descontado. Pedido pago na entrega não tem custo.`,
    "• O pedido só entra na cozinha depois de pago. Você não precisa aceitar à mão.",
    `• O cliente tem ${MINUTOS_PARA_PAGAR} min para pagar; depois o pedido é cancelado sozinho.`,
    "• Cancelou pedido pago? O dinheiro volta para o cliente sozinho, do seu saldo no Asaas.",
    "",
    "Vamos avisar você aqui se algum estorno ficar pendente ou se a chave do Asaas parar de funcionar.",
  ];
  return linhas.join("\n");
}
