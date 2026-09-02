/**
 * custos-plataforma.ts — o que o FireHub paga por mês, e como isso vira custo por loja.
 *
 * Esta é a lista única de custos da plataforma. O P&L do admin
 * (/api/admin/usage-costs) lê daqui — não existe número de custo escrito em
 * outro lugar. Mudou o preço de um serviço, mude AQUI e o painel inteiro segue.
 *
 * Antes disto o painel cobrava R$ 29,90 fixos de cada linha da tabela User,
 * incluindo lojas deletadas, contas de teste e funcionários. Com 35 linhas isso
 * inventava R$ 1.046 de custo por mês que ninguém pagava, e escondia o custo
 * real de quem de fato usa a plataforma.
 *
 * ── COMO LER O CAMPO `rateio` ────────────────────────────────────────────────
 *   'pedidos'  custo de infraestrutura: dividido entre as lojas na proporção
 *              dos pedidos que cada uma processou no mês. É o rateio honesto —
 *              quem processou 3.997 pedidos gastou banco e servidor; quem
 *              processou 1 não gastou quase nada.
 *   'direto'   custo já medido por loja (Gemini). Não entra em rateio nenhum:
 *              vem do UsageLog, loja por loja.
 *   'receita'  custo que só existe quando há venda (taxa de gateway). Sai do
 *              faturamento, não da infraestrutura.
 */

/** Câmbio usado para converter os serviços cobrados em dólar. Ajuste quando variar muito. */
export const USD_BRL = 5.4;

export type Rateio = "pedidos" | "direto" | "receita";

export type ServicoPago = {
  chave: string;
  nome: string;
  /** O que ele faz no sistema, em uma linha. */
  papel: string;
  /** Custo mensal em REAIS. Zero = plano gratuito hoje. */
  mensalBRL: number;
  rateio: Rateio;
  /** true quando o valor ainda precisa ser confirmado na fatura do fornecedor. */
  aConfirmar?: boolean;
  observacao?: string;
};

/**
 * ⚠️ OS VALORES MARCADOS `aConfirmar` SÃO ESTIMATIVAS.
 * Confira na fatura de cada fornecedor e corrija — o P&L é tão bom quanto eles.
 */
export const SERVICOS_PAGOS: ServicoPago[] = [
  {
    chave: "neon",
    nome: "Neon (Postgres)",
    papel: "Banco de dados de tudo: pedidos, cardápio, lojas, sessões.",
    mensalBRL: 25 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "Ago/2026 fechou em US$ 157 — US$ 112 disso era transferência de rede do painel de pedidos, corrigida em set/2026. " +
      "A base é US$ 19 do plano Launch + compute. Vigiar: se passar de 500 GB de egress no mês, tem polling novo sem filtro.",
  },
  {
    chave: "hospedagem",
    nome: "DigitalOcean (VPS do Coolify)",
    papel: "Roda a aplicação Next.js, o cron-runner e o Coolify. É quem serve firehubfood.com.br.",
    mensalBRL: 12.97 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "Confirmado no painel em 01/09/2026: US$ 12,97 de droplets em agosto/2026 (média de US$ 0,26/dia). " +
      "Droplet 107.170.79.194, região NYC (AS14061). É o serviço mais barato da lista e o que sustenta a produção inteira.",
  },
  {
    chave: "vercel",
    nome: "Vercel (Plano Pro)",
    papel: "Hospedava o site antes do Coolify. Hoje só guarda o Blob e continua buildando cada commit.",
    mensalBRL: 30 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "⚠️ MAIOR OPORTUNIDADE ABERTA — e é do FireHub mesmo, não de outro projeto: dos US$ 90,11 do ciclo " +
      "14/08–14/09/2026, US$ 86,06 são do projeto `firehub-site` (firecheck US$ 2,74, landing-page US$ 0,89, " +
      "hakim-portal US$ 0,40). O gasto foi Vercel Functions + 853 GB de Fast Data Transfer: o mesmo polling de 3s " +
      "que inflou o Neon, cobrado nas duas contas. " +
      "HOJE O DEPLOY DE LÁ ESTÁ QUEBRADO: firehub-site.vercel.app responde 500 e /api/health acusa " +
      "'Can't reach database server' (aponta para o host do Neon SEM o -pooler). Ou seja, não serve ninguém — " +
      "mas segue custando US$ 20/mês de plano Pro + build a cada push, porque o auto-deploy no repo nunca foi desligado. " +
      "O código já não tem @vercel/blob e as 278 imagens de produto migraram para /uploads no VPS. " +
      "Falta só migrar 11 arquivos (6 logos + 5 banners de loja, Hakim Centro entre elas) para cancelar o Pro.",
  },
  {
    chave: "railway",
    nome: "Railway (gateway WhatsApp)",
    papel: "Processo do Baileys que mantém a sessão do WhatsApp de cada loja.",
    mensalBRL: 3.20 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "Confirmado em 01/09/2026: plano Hobby, ciclo 31/08–30/09 com uso de US$ 0,34 dentro dos US$ 5 inclusos; " +
      "fatura estimada US$ 3,20. ⚠️ A assinatura estava marcada como PAST DUE — se não for paga, a Railway " +
      "suspende o serviço e o robô de WhatsApp das lojas cai junto.",
  },
  {
    chave: "blob",
    nome: "Vercel Blob",
    papel: "Imagens do cardápio e fotos enviadas pelas lojas.",
    mensalBRL: 0.07 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "Medido em 01/09/2026: 1 GB armazenado (US$ 0,03) + 800 MB de transferência (US$ 0,04). " +
      "É o que prende o sistema à Vercel — e custa 7 centavos de dólar. Não é o Blob que pesa: é o plano Pro em volta dele.",
  },
  {
    chave: "gemini",
    nome: "Google Gemini",
    papel: "Robô de atendimento no WhatsApp e conferência de fotos por IA.",
    mensalBRL: 0,
    rateio: "direto",
    observacao:
      "NÃO é rateado: o UsageLog grava token a token por loja. O valor no P&L de cada loja é o gasto real dela.",
  },
  {
    chave: "resend",
    nome: "Resend",
    papel: "E-mails transacionais (recuperação de senha, avisos).",
    mensalBRL: 0,
    rateio: "pedidos",
    observacao: "Plano gratuito: 3.000 e-mails/mês, 100/dia. Passar disso são US$ 20/mês.",
  },
  {
    chave: "asaas",
    nome: "Asaas",
    papel: "Cobra a mensalidade/comissão dos lojistas.",
    mensalBRL: 0,
    rateio: "receita",
    observacao: "Sem mensalidade: cobra por boleto/Pix emitido. Sai da receita, não da infraestrutura.",
  },
  {
    chave: "whatsapp",
    nome: "WhatsApp (Baileys)",
    papel: "Conexão com o WhatsApp das lojas.",
    mensalBRL: 0,
    rateio: "pedidos",
    observacao:
      "Custo ZERO por ser self-hosted. A API oficial da Meta cobraria por conversa — a tabela de preços " +
      "segue em usage-tracker.ts caso um dia se migre para ela.",
  },
];

/** Serviços cujo custo é de infraestrutura e se divide entre as lojas pelo volume de pedidos. */
export const CUSTO_INFRA_MENSAL_BRL = SERVICOS_PAGOS
  .filter((s) => s.rateio === "pedidos")
  .reduce((soma, s) => soma + s.mensalBRL, 0);

/**
 * Quanto de infraestrutura cabe a uma loja no mês.
 *
 * Proporcional aos pedidos processados. Loja sem pedido no mês não recebe
 * rateio — ela realmente não consumiu banco nem servidor, e cobrar dela um
 * valor fixo era o que fazia o painel mostrar prejuízo em conta desativada.
 */
export function rateioInfra(pedidosDaLoja: number, pedidosNoMes: number): number {
  if (pedidosNoMes <= 0 || pedidosDaLoja <= 0) return 0;
  return CUSTO_INFRA_MENSAL_BRL * (pedidosDaLoja / pedidosNoMes);
}
