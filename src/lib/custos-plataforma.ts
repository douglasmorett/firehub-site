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
    mensalBRL: 68 * USD_BRL,
    rateio: "pedidos",
    observacao:
      "Plano de US$ 68/mês a partir de 01/10/2026 (antes: 2 vCPU / 4 GB / 120 GB por US$ 32; agosto/2026 fechou em US$ 12,97). " +
      "Droplet 107.170.79.194, região NYC (AS14061). É o serviço que sustenta a produção inteira.",
  },
  {
    chave: "vercel",
    nome: "Vercel",
    papel: "Hospedava o site e as imagens antes do Coolify. O FireHub não usa mais nada de lá.",
    mensalBRL: 0,
    rateio: "pedidos",
    observacao:
      "Saída concluída em 01/09/2026: repositório desconectado (último build da Vercel em 01/09 23h44 UTC — " +
      "os commits seguintes só passam pelo GitHub Actions → Coolify), 41 imagens do Blob migradas para /uploads " +
      "e nenhuma coluna do banco cita mais \"vercel\". Até ago/2026 era o maior custo depois do Neon (US$ 86 do " +
      "projeto firehub-site num ciclo). O plano Pro (US$ 20) continua por causa do FireCheck e do EvoPDV, " +
      "que ainda são servidos pela Vercel — é custo desses projetos, não do FireHub.",
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
