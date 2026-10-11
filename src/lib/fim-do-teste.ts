/**
 * O FIM DO PERÍODO DE TESTE DA LOJA — uma leitura só, para a cobrança e para a
 * faixa do topo do painel.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Eram duas regras para a mesma pergunta. A cobrança (lib/billing.ts,
 * `inicioDaCobranca`) lia só `User.trialEndsAt`: sem ele, a venda conta desde
 * o dia 1 do mês. A faixa do topo (app/store/layout.tsx) inventava um teste de
 * 15 dias a partir do cadastro quando o campo estava vazio. Auditoria de
 * 11/10/2026: a Yakisoba do san, criada em 01/10 sem `trialEndsAt`, lia
 * "Teste grátis — 6 dias restantes" no topo enquanto o mês inteiro já entrava
 * na mensalidade dela.
 *
 * Vale a regra da COBRANÇA, porque é ela que vira boleto: sem `trialEndsAt`
 * gravado, não há teste. Gravar o fim do teste no cadastro de toda loja nova
 * (o /api/register já grava; as lojas criadas por outros caminhos, não) é
 * decisão de negócio — não se resolve aqui inventando uma data.
 */

/** O instante em que o teste termina, ou null quando a loja não tem teste. */
export function fimDoTeste(trialEndsAt: Date | string | null | undefined): Date | null {
  if (!trialEndsAt) return null;
  const fim = new Date(trialEndsAt);
  return Number.isNaN(fim.getTime()) ? null : fim;
}

/**
 * Dias de teste que faltam, arredondando para cima (faltando 2 horas, falta
 * "1 dia"). Zero quando não há teste ou ele já acabou.
 */
export function diasDeTesteRestantes(trialEndsAt: Date | string | null | undefined, agora: Date = new Date()): number {
  const fim = fimDoTeste(trialEndsAt);
  if (!fim) return 0;
  return Math.max(0, Math.ceil((fim.getTime() - agora.getTime()) / 86_400_000));
}
