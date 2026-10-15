/**
 * OS "ALERTAS DE PRODUÇÃO" DO PAINEL — a borda amarela/vermelha do cartão na
 * coluna Em Produção (User.timeAlertConfig, modal do sino no painel).
 *
 * Dois jeitos de contar, à escolha do lojista (Douglas, 15/10/2026: "pode
 * escolher se é por tempo de preparo ou se é quanto tempo falta para chegar
 * no cliente"):
 *
 *   • "entrega" (o de sempre) — quanto FALTA para o horário prometido ao
 *     cliente. Amarelo com 10 min restantes, vermelho com 5: o número do
 *     vermelho é o MENOR.
 *   • "preparo" — há quanto tempo o pedido está EM PRODUÇÃO (o mesmo relógio
 *     do "Em produção (12 min)" do cartão, lib/tempo-na-etapa.ts). Amarelo com
 *     20 min de preparo, vermelho com 30: o número do vermelho é o MAIOR.
 *
 * Os números de cada modo ficam guardados separados. Os de entrega continuam
 * nos campos de sempre (yellowMinutes/redMinutes), porque o app do motoboy e o
 * relatório de tempos leem só eles (`limitesDoAlerta` em
 * lib/relatorios/tempos.ts) — na rua o que conta é quanto falta para o
 * cliente, e trocar o modo do painel não pode mudar a cor do motoboy. Os de
 * preparo vão em `preparo`.
 */

export type ModoDoAlerta = "entrega" | "preparo";

export type FaixasDoAlerta = {
  yellowEnabled: boolean;
  yellowMinutes: number;
  redEnabled: boolean;
  redMinutes: number;
};

export type ConfigDoAlerta = FaixasDoAlerta & {
  modo: ModoDoAlerta;
  preparo: FaixasDoAlerta;
};

export const PADRAO_ENTREGA: FaixasDoAlerta = { yellowEnabled: true, yellowMinutes: 10, redEnabled: true, redMinutes: 5 };
export const PADRAO_PREPARO: FaixasDoAlerta = { yellowEnabled: true, yellowMinutes: 20, redEnabled: true, redMinutes: 30 };

function faixas(v: unknown, padrao: FaixasDoAlerta): FaixasDoAlerta {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...padrao };
  const c = v as Record<string, unknown>;
  const minutos = (x: unknown, p: number) => {
    const n = Math.floor(Number(x));
    return Number.isFinite(n) ? Math.min(240, Math.max(0, n)) : p;
  };
  return {
    yellowEnabled: c.yellowEnabled === undefined ? padrao.yellowEnabled : Boolean(c.yellowEnabled),
    yellowMinutes: minutos(c.yellowMinutes, padrao.yellowMinutes),
    redEnabled: c.redEnabled === undefined ? padrao.redEnabled : Boolean(c.redEnabled),
    redMinutes: minutos(c.redMinutes, padrao.redMinutes),
  };
}

/** Lê o que está gravado. Configuração antiga (sem `modo`) segue "entrega", como sempre foi. */
export function lerConfigDoAlerta(cfg: unknown): ConfigDoAlerta {
  const c = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
  return {
    ...faixas(c, PADRAO_ENTREGA),
    modo: c.modo === "preparo" ? "preparo" : "entrega",
    preparo: faixas(c.preparo, PADRAO_PREPARO),
  };
}

/** As faixas que o modo escolhido usa. */
export function faixasDoModo(cfg: ConfigDoAlerta): FaixasDoAlerta {
  return cfg.modo === "preparo" ? cfg.preparo : cfg;
}

/**
 * Amarelo e vermelho trocados (no preparo o vermelho vem DEPOIS do amarelo;
 * na entrega, com MENOS minutos): o amarelo nunca apareceria. Texto do aviso,
 * ou null quando está certo.
 */
export function avisoDasFaixas(cfg: ConfigDoAlerta): string | null {
  const f = faixasDoModo(cfg);
  if (!f.yellowEnabled || !f.redEnabled || f.yellowMinutes <= 0 || f.redMinutes <= 0) return null;
  if (cfg.modo === "preparo" && f.redMinutes <= f.yellowMinutes) {
    return "O vermelho precisa de mais minutos que o amarelo — senão o pedido pula direto para o vermelho.";
  }
  if (cfg.modo === "entrega" && f.redMinutes >= f.yellowMinutes) {
    return "O vermelho precisa de menos minutos que o amarelo — ele é o aviso de que está quase na hora.";
  }
  return null;
}

/**
 * A cor do cartão em produção.
 * `minutosRestantes`: até o horário prometido (null = sem prazo, como a mesa).
 * `minutosEmPreparo`: desde a entrada em produção (null = sem carimbo, mesa ou agendado).
 */
export function corDoAlerta(
  cfg: ConfigDoAlerta,
  t: { minutosRestantes: number | null; minutosEmPreparo: number | null },
): "vermelho" | "amarelo" | null {
  const f = faixasDoModo(cfg);
  const vermelho = f.redEnabled && f.redMinutes > 0 ? f.redMinutes : null;
  const amarelo = f.yellowEnabled && f.yellowMinutes > 0 ? f.yellowMinutes : null;
  if (cfg.modo === "preparo") {
    const m = t.minutosEmPreparo;
    if (m === null) return null;
    if (vermelho !== null && m >= vermelho) return "vermelho";
    if (amarelo !== null && m >= amarelo) return "amarelo";
    return null;
  }
  const m = t.minutosRestantes;
  if (m === null) return null;
  if (vermelho !== null && m <= vermelho) return "vermelho";
  if (amarelo !== null && m <= amarelo) return "amarelo";
  return null;
}
