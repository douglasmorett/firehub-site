/**
 * INDIQUE E GANHE ENTRE LOJISTAS — a regra, sem banco.
 *
 * Regra do dono (Douglas, 15/10/2026): um lojista do FireHub indica outro
 * restaurante pelo link da loja dele. Quando a loja indicada PAGA a primeira
 * mensalidade, quem indicou ganha R$ 100,00 de desconto na PRÓXIMA mensalidade.
 * O indicado não ganha nada. E quem passa de 10 indicados ativos e pagantes
 * (11 ou mais) fica isento da mensalidade de UMA loja enquanto continuar assim.
 *
 * ── O QUE ISTO NÃO É ────────────────────────────────────────────────────────
 *
 * Não é o programa de EMBAIXADOR (`?ref=`, `User.ambassadorId`, comissão pelo
 * split do Asaas em lib/billing.ts). E não é o "Indique e Ganhe" antigo entre
 * lojistas, que pagava 20% em DINHEIRO pelo split e foi encerrado (ver
 * api/store/[storeId]/affiliate, que responde 410, e o comentário do split em
 * lib/billing.ts). Este programa NUNCA gera dinheiro nem split: só desconto na
 * mensalidade. Por isso o link usa outro parâmetro (`?indicacao=`) e outra
 * tabela (IndicacaoLojista, lib/indique-e-ganhe-no-banco.ts) — nada aqui toca
 * em `ambassadorId`, `referredById` ou `asaasWalletId`.
 *
 * ── A CONTA É A UNIDADE ─────────────────────────────────────────────────────
 *
 * Quem indica é a CONTA, representada pela loja principal
 * (`accountGroupId || id`). O link de qualquer loja da conta grava a indicação
 * na principal, e é na mensalidade da principal que o crédito abate e que a
 * isenção vale. É o que faz "isento de 1 loja" ter uma resposta só: a conta
 * com três lojas e 11 indicados fica sem a mensalidade da principal; as
 * filiais continuam pagando as delas.
 *
 * Este arquivo não importa banco de propósito: o teste
 * (scripts/teste-indique-e-ganhe.ts) roda tudo aqui sem Neon.
 */
import { mensalidadeDoCiclo, type CicloNasRegras } from "./parceiro/regras";

/** O desconto por loja indicada que pagou a primeira mensalidade. */
export const VALOR_DO_CREDITO = 100;

/** "Mais de 10": a partir de 11 indicados ativos e pagantes a mensalidade da loja principal sai zerada. */
export const INDICADOS_PARA_ISENCAO = 11;

/** O parâmetro do link. Diferente do `ref` do embaixador para nunca colidir com ele. */
export const PARAMETRO_DO_LINK = "indicacao";

export const ENDERECO_DO_CADASTRO = "https://firehubfood.com.br/cadastro";

const c2 = (n: number) => Math.round(n * 100) / 100;

// ── O link ──────────────────────────────────────────────────────────────────

/**
 * O link da loja. Vai pelo SLUG (é o que o lojista reconhece num link de
 * WhatsApp); o cadastro também aceita o id e os slugs antigos, então trocar o
 * nome da loja não mata link já compartilhado.
 */
export function linkDeIndicacao(loja: { id: string; slug: string | null }): string {
  return `${ENDERECO_DO_CADASTRO}?${PARAMETRO_DO_LINK}=${encodeURIComponent(loja.slug || loja.id)}`;
}

/** O código como veio no link, limpo. Vazio ou absurdo = sem indicação. */
export function codigoDaIndicacao(bruto: unknown): string | null {
  const codigo = String(bruto ?? "").trim().toLowerCase();
  if (!codigo || codigo.length > 120 || !/^[a-z0-9_-]+$/.test(codigo)) return null;
  return codigo;
}

export function mensagemDeWhatsApp(link: string): string {
  return `Uso o FireHub no meu restaurante e recomendo: cardápio digital, pedidos, iFood e caixa num lugar só. Teste grátis pelo meu link: ${link}`;
}

// ── Quem pode indicar quem ──────────────────────────────────────────────────

export type LojaNaIndicacao = {
  id: string;
  role: string;
  accountGroupId: string | null;
  ownerId: string | null;
  cpfCnpj: string | null;
  /** onboardingData.cpfDoResponsavel — o CPF de quem abriu a conta pelo CNPJ. */
  cpfDoResponsavel?: string | null;
};

/** A loja principal da conta: é ela que indica, ganha o crédito e fica isenta. */
export function contaDaLoja(loja: { id: string; accountGroupId: string | null }): string {
  return loja.accountGroupId || loja.id;
}

const documentosDe = (l: LojaNaIndicacao) =>
  [l.cpfCnpj, l.cpfDoResponsavel].map((d) => String(d || "").replace(/\D/g, "")).filter((d) => d.length >= 11);

export type MotivoDaRecusa = "MESMA_LOJA" | "MESMA_CONTA" | "MESMO_DONO" | "INDICADORA_INVALIDA";

/**
 * A indicação vale? `indicadora` já deve vir resolvida para a loja principal.
 *
 * "Mesmo dono" é qualquer um destes: uma loja é funcionário/sub-conta da outra
 * (`ownerId`), as duas têm o mesmo `ownerId`, ou o mesmo CPF/CNPJ aparece nas
 * duas (documento da conta ou CPF do responsável). Abrir uma segunda conta com
 * o próprio CPF para ganhar R$ 100 é exatamente o que isto barra.
 */
export function motivoDaRecusa(indicadora: LojaNaIndicacao, indicada: LojaNaIndicacao): MotivoDaRecusa | null {
  if (indicadora.role !== "FRANCHISEE") return "INDICADORA_INVALIDA";
  if (indicadora.id === indicada.id) return "MESMA_LOJA";
  if (contaDaLoja(indicadora) === contaDaLoja(indicada)) return "MESMA_CONTA";
  if (
    indicada.ownerId === indicadora.id ||
    indicadora.ownerId === indicada.id ||
    (!!indicada.ownerId && indicada.ownerId === indicadora.ownerId)
  ) return "MESMO_DONO";
  const docs = new Set(documentosDe(indicadora));
  if (documentosDe(indicada).some((d) => docs.has(d))) return "MESMO_DONO";
  return null;
}

export const TEXTO_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  MESMA_LOJA: "a loja não pode indicar a si mesma",
  MESMA_CONTA: "é loja da mesma conta (filial)",
  MESMO_DONO: "é loja do mesmo dono",
  INDICADORA_INVALIDA: "o link não é de uma loja ativa",
};

// ── O gatilho: a primeira mensalidade paga ──────────────────────────────────

/**
 * O ciclo pago gera o crédito? Só mensalidade de verdade: ciclo pago no Asaas
 * (`paidAt`) com mensalidade cobrada (`amountDue` > 0). O "PAID" do mês em
 * teste ou sem uso não tem boleto nem `paidAt`; e o boleto de quem estava em
 * teste e só pagou tráfego pago tem `amountDue` 0 — nenhum dos dois é a
 * primeira mensalidade.
 *
 * "A PRIMEIRA" não precisa ser contada aqui: o crédito é um por loja indicada
 * (a linha da indicação é única por `indicadaId` e o UPDATE só grava quando
 * ainda não há crédito), então o primeiro pagamento que passar por aqui gera
 * e todos os seguintes — inclusive o mesmo webhook repetido — não fazem nada.
 */
export function cicloGeraCredito(ciclo: { status: string; paidAt: Date | string | null; amountDue: number }): boolean {
  return ciclo.status === "PAID" && !!ciclo.paidAt && (ciclo.amountDue || 0) > 0;
}

/** O que a linha da indicação guarda do crédito. */
export type CreditoDaIndicacao = {
  id: string;
  creditoValor: number;
  creditoGeradoEm: Date | string | null;
  creditoUsado: number;
  usos: UsoDoCredito[];
};

export type UsoDoCredito = { cicloId: string; yearMonth: string; valor: number; em: string };

/** Quanto do crédito ainda não foi usado. */
export const saldoDoCredito = (c: CreditoDaIndicacao) => c2(Math.max(0, (c.creditoValor || 0) - (c.creditoUsado || 0)));

export const saldoTotal = (creditos: CreditoDaIndicacao[]) => c2(creditos.reduce((s, c) => s + saldoDoCredito(c), 0));

// ── A aplicação: abate na próxima mensalidade ───────────────────────────────

export type Abatimento = {
  /** Quanto sai da mensalidade deste ciclo. */
  abatido: number;
  /** As linhas que mudam: `creditoUsado` e `usos` novos. Vazio = nada a gravar. */
  alteracoes: { id: string; creditoUsado: number; usos: UsoDoCredito[] }[];
};

/**
 * Abate os créditos na mensalidade de um ciclo. Os mais antigos primeiro.
 *
 * MENSALIDADE MENOR QUE O CRÉDITO: abate até zerar e o resto fica para o mês
 * seguinte (decisão de 15/10/2026, a que o dono pediu como primeira opção) —
 * a loja que paga o mínimo de R$ 100 e tem dois créditos usa um por mês.
 * Só abate MENSALIDADE: taxa de tráfego pago, totem, Bill e loja extra de
 * marketplace são serviço prestado e continuam no boleto.
 *
 * IDEMPOTENTE POR CICLO: o fechamento pode rodar de novo para o mesmo mês (o
 * ciclo "nada a cobrar" pode ser refeito). O que já foi usado NESTE ciclo
 * conta como abatido, e só se consome mais se faltar — nunca duas vezes.
 * Se o recálculo der uma mensalidade MENOR que o já abatido, o crédito não
 * volta (fica o primeiro abatimento): é o caso raro e a favor do lojista.
 */
export function abaterCreditos(
  creditos: CreditoDaIndicacao[],
  ciclo: { id: string; yearMonth: string },
  mensalidade: number,
  agora: Date,
): Abatimento {
  const alvo = c2(Math.max(0, mensalidade || 0));
  const jaNesteCiclo = c2(
    creditos.reduce((s, c) => s + (c.usos || []).filter((u) => u.cicloId === ciclo.id).reduce((a, u) => a + u.valor, 0), 0),
  );
  let falta = c2(alvo - jaNesteCiclo);
  if (falta <= 0) return { abatido: jaNesteCiclo, alteracoes: [] };

  const ordem = [...creditos]
    .filter((c) => saldoDoCredito(c) > 0)
    .sort((a, b) => new Date(a.creditoGeradoEm || 0).getTime() - new Date(b.creditoGeradoEm || 0).getTime() || a.id.localeCompare(b.id));

  const alteracoes: Abatimento["alteracoes"] = [];
  let abatido = jaNesteCiclo;
  for (const c of ordem) {
    if (falta <= 0) break;
    const usar = c2(Math.min(saldoDoCredito(c), falta));
    if (usar <= 0) continue;
    alteracoes.push({
      id: c.id,
      creditoUsado: c2((c.creditoUsado || 0) + usar),
      usos: [...(c.usos || []), { cicloId: ciclo.id, yearMonth: ciclo.yearMonth, valor: usar, em: agora.toISOString() }],
    });
    falta = c2(falta - usar);
    abatido = c2(abatido + usar);
  }
  return { abatido, alteracoes };
}

/** A previsão do painel: quanto do saldo abateria numa mensalidade, sem gravar nada. */
export function previsaoDoAbatimento(creditos: CreditoDaIndicacao[], mensalidade: number): number {
  return c2(Math.min(saldoTotal(creditos), Math.max(0, mensalidade || 0)));
}

// ── A isenção: mais de 10 indicados ativos e pagantes ───────────────────────

export type IndicadaNaContagem = {
  id: string;
  role: string;
  trialEndsAt: Date | string | null;
  /** Os ciclos FECHADOS da loja (OPEN não entra na conta). */
  ciclos: CicloNasRegras[];
};

/**
 * A indicada está ATIVA E PAGANTE? O critério exato:
 *
 *   1. a conta existe e é loja (`role` FRANCHISEE — a excluída vira DELETED);
 *   2. já saiu do teste (`trialEndsAt` no passado);
 *   3. já pagou pelo menos uma mensalidade no Asaas (situação PAGA em algum
 *      ciclo, lib/parceiro/regras.ts) — é o "pagante";
 *   4. não tem NENHUMA mensalidade VENCIDA sem pagamento — é o "em dia".
 *
 * O item 4 é como "pagou a última cobrança" foi lido. Ao pé da letra, a
 * última cobrança é o boleto que o fechamento do dia 1 acabou de emitir e
 * que vence no dia 5: no dia em que a mensalidade da indicadora é gerada,
 * nenhuma indicada pagou ainda o boleto do mês, e ninguém ficaria isento
 * nunca. Boleto A VENCER não tira ninguém da conta; VENCIDO tira. "Bloqueada"
 * cai aqui também: o painel só trava por boleto vencido (app/store/layout.tsx).
 */
export function indicadaAtivaPagante(loja: IndicadaNaContagem, agora: Date): boolean {
  if (loja.role !== "FRANCHISEE") return false;
  if (!loja.trialEndsAt || new Date(loja.trialEndsAt).getTime() > agora.getTime()) return false;
  const mesCorrente = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
  const situacoes = loja.ciclos.map((c) => mensalidadeDoCiclo(c, c.yearMonth, mesCorrente, agora).situacao);
  return situacoes.includes("PAGA") && !situacoes.includes("VENCIDA");
}

export function indicadosAtivosPagantes(lojas: IndicadaNaContagem[], agora: Date): number {
  return lojas.filter((l) => indicadaAtivaPagante(l, agora)).length;
}

/** A mensalidade da loja principal sai zerada? (Créditos de R$ 100 ficam guardados enquanto isso.) */
export const isentaPorIndicacoes = (ativosPagantes: number) => ativosPagantes >= INDICADOS_PARA_ISENCAO;

// ── A tela ──────────────────────────────────────────────────────────────────

export type SituacaoDaIndicacao = "EM_TESTE" | "AGUARDANDO_PAGAMENTO" | "CREDITO_GERADO" | "CREDITO_USADO" | "NAO_VALEU";

export function situacaoDaIndicacao(
  ind: CreditoDaIndicacao & { recusadaMotivo: string | null },
  indicada: { role: string; trialEndsAt: Date | string | null } | null,
  agora: Date,
): SituacaoDaIndicacao {
  if (ind.recusadaMotivo) return "NAO_VALEU";
  if ((ind.creditoValor || 0) > 0) return saldoDoCredito(ind) > 0 ? "CREDITO_GERADO" : "CREDITO_USADO";
  if (!indicada || indicada.role !== "FRANCHISEE") return "NAO_VALEU";
  if (indicada.trialEndsAt && new Date(indicada.trialEndsAt).getTime() > agora.getTime()) return "EM_TESTE";
  return "AGUARDANDO_PAGAMENTO";
}

export const TEXTO_DA_SITUACAO: Record<SituacaoDaIndicacao, string> = {
  EM_TESTE: "Em teste",
  AGUARDANDO_PAGAMENTO: "Aguardando a 1ª mensalidade",
  CREDITO_GERADO: "Pagou · crédito de R$ 100 gerado",
  CREDITO_USADO: "Pagou · crédito usado",
  NAO_VALEU: "Não vale para o programa",
};
