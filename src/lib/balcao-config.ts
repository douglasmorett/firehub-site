/**
 * As regras do lançamento presencial que cada loja decide por conta própria.
 *
 * Hoje é só uma: o número do pager é obrigatório ou não. Mora numa coluna
 * JSON (`User.balcaoConfig`) e não em duas colunas booleanas porque esta tela
 * nasceu para crescer — a próxima regra do balcão entra aqui sem DDL novo, e
 * DDL no FireHub é instrução escrita à mão em lib/garantir-colunas.ts, não
 * migration.
 *
 * ── Por que "obrigatório" é uma escolha da loja ─────────────────────────────
 *
 * O pager (lib/pager.ts) é o aparelhinho numerado que a loja entrega a quem
 * espera o pedido. Loja que usa, usa em TODA venda — e aí esquecer de digitar
 * o número é o atendente não ter como chamar a pessoa quando o pedido fica
 * pronto. Loja que não usa nunca digitaria nada.
 *
 * Por isso nasce DESLIGADO em todo mundo: ligado por padrão travaria a venda
 * de quem nem tem pager, que é a maioria. Quem usa liga, e a partir dali o
 * campo deixa de ser opcional.
 *
 * ── Onde a regra pega ───────────────────────────────────────────────────────
 *
 * Só no lançamento do PDV (/store/venda-presencial), abas Balcão e Mesa — que
 * é onde o campo de pager existe. O app de Mesas do garçom abre mesa e lança
 * item sem nunca perguntar pager, então ligar a trava da mesa NÃO alcança o
 * pedido que o garçom abre no salão. Decisão do dono em 22/09/2026, para não
 * mexer na tela que roda no salão em horário de operação.
 *
 * ── O pager no lugar do número da mesa ──────────────────────────────────────
 *
 * Com o pager obrigatório na mesa, o número da mesa deixa de ser: quem pede
 * na aba Mesa e fica com o aparelhinho é chamado por ele, e exigir os dois
 * números fazia o atendente inventar uma mesa. Pedido da NIK (Danilo) em
 * 26/09/2026. Digitado, o número da mesa continua indo para o pedido.
 */

/** Onde o pedido está sendo lançado. Delivery não tem pager. */
export type TipoDeLancamento = "BALCAO" | "MESA" | "DELIVERY";

export type BalcaoConfig = {
  /** Venda de balcão só é registrada com o número do pager preenchido. */
  pagerObrigatorioBalcao: boolean;
  /** Idem para o pedido lançado na aba Mesa do PDV. */
  pagerObrigatorioMesa: boolean;
};

/** O que vale para quem nunca abriu a tela: nada obrigatório. */
export const BALCAO_CONFIG_PADRAO: BalcaoConfig = {
  pagerObrigatorioBalcao: false,
  pagerObrigatorioMesa: false,
};

/**
 * Lê o que está gravado, venha como vier.
 *
 * Coluna ausente (loja antiga, ou o boot ainda não rodou o ADD COLUMN), JSON
 * inválido, string, número — tudo cai no padrão. Uma configuração ilegível
 * NÃO pode virar "obrigatório": isso travaria a venda de uma loja que nunca
 * pediu nada.
 */
export function lerBalcaoConfig(bruto: unknown): BalcaoConfig {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return { ...BALCAO_CONFIG_PADRAO };
  const o = bruto as Record<string, unknown>;
  return {
    pagerObrigatorioBalcao: o.pagerObrigatorioBalcao === true,
    pagerObrigatorioMesa: o.pagerObrigatorioMesa === true,
  };
}

/** O pager é obrigatório NESTE lançamento? */
export function pagerEhObrigatorio(config: unknown, tipo: TipoDeLancamento | string | null | undefined): boolean {
  const c = lerBalcaoConfig(config);
  if (tipo === "BALCAO") return c.pagerObrigatorioBalcao;
  if (tipo === "MESA") return c.pagerObrigatorioMesa;
  // Delivery não tem pager, e qualquer outro tipo que apareça amanhã entra
  // livre em vez de travar sozinho.
  return false;
}

/** O número da mesa é obrigatório na aba Mesa? Só quando o pager não está no lugar dele. */
export function numeroDaMesaEhObrigatorio(config: unknown): boolean {
  return !lerBalcaoConfig(config).pagerObrigatorioMesa;
}

/**
 * O que dizer quando falta o número, ou null quando está tudo certo.
 *
 * A mensagem é a MESMA na tela e na API de propósito: o atendente que vê o
 * aviso vermelho no campo e o que recebe o erro do servidor leem a mesma
 * frase, e ninguém precisa traduzir uma na outra para saber que é o mesmo
 * problema.
 */
export function problemaDoPagerObrigatorio(
  config: unknown,
  tipo: TipoDeLancamento | string | null | undefined,
  pager: unknown,
): string | null {
  if (!pagerEhObrigatorio(config, tipo)) return null;
  const preenchido = String(pager ?? "").trim() !== "";
  if (preenchido) return null;
  return tipo === "MESA"
    ? "Informe o número do pager. A loja marcou o pager como obrigatório na mesa (Minha Loja › Balcão & Pager)."
    : "Informe o número do pager. A loja marcou o pager como obrigatório no balcão (Minha Loja › Balcão & Pager).";
}
