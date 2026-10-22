/**
 * Rota 100% automatizada — as regras que a loja escolhe.
 *
 * Moram em `User.deliveryConfig.roteirizacaoAutomatica` (o deliveryConfig é
 * mesclado, nunca substituído — ver api/store-settings). Plano: vault
 * "FireHub - Plano despacho automático", §4.1. Padrões decididos com o Douglas
 * em 21/10/2026: 3 entregas por rota, 2 km entre as entregas, 15 min de janela
 * de prazo, 8 min de espera do pedido pronto, 150 m = "na loja", e quem puxa a
 * rota é só o motoboy chamado.
 *
 * SEM IMPORTS de propósito: o navegador (components/customer/RotaAutomatica)
 * e o servidor usam o mesmo tipo e o mesmo padrão, e o teste carrega sozinho.
 */

export type QuemPuxa = "chamado" | "qualquer";

export type RoteirizacaoAutomaticaConfig = {
  /** Padrão false. Ligado = cria rota automática e prioriza no KDS (D1). */
  ativo: boolean;
  /** 1..6 — quantas entregas um motoboy leva por vez. */
  maxEntregasPorRota: number;
  /** 0,5..10 km — distância máxima entre as entregas da mesma rota. */
  raioDoGrupoKm: number;
  /** 5..60 min — só junta pedidos com prazo até X min depois do mais urgente. */
  janelaDePrazoMin: number;
  /** 0..30 min — pedido pronto espera no máximo isto por companhia. */
  esperaMaxMin: number;
  /** 50..500 m — motoboy a até X m do pino da loja conta como "na loja". */
  raioDaLojaM: number;
  /** "chamado" (padrão): só o motoboy chamado puxa. "qualquer": quem escanear primeiro (D11). */
  quemPuxa: QuemPuxa;
};

export const ROTEIRIZACAO_AUTOMATICA_PADRAO: RoteirizacaoAutomaticaConfig = {
  ativo: false,
  maxEntregasPorRota: 3,
  raioDoGrupoKm: 2,
  janelaDePrazoMin: 15,
  esperaMaxMin: 8,
  raioDaLojaM: 150,
  quemPuxa: "chamado",
};

/** Os limites de cada número (a janela de explicação usa os mesmos). */
export const LIMITES_DA_ROTEIRIZACAO_AUTOMATICA = {
  maxEntregasPorRota: { min: 1, max: 6, inteiro: true },
  raioDoGrupoKm: { min: 0.5, max: 10, inteiro: false },
  janelaDePrazoMin: { min: 5, max: 60, inteiro: true },
  esperaMaxMin: { min: 0, max: 30, inteiro: true },
  raioDaLojaM: { min: 50, max: 500, inteiro: true },
} as const;

type ChaveNumerica = keyof typeof LIMITES_DA_ROTEIRIZACAO_AUTOMATICA;

/**
 * Número fora da faixa vai para a borda (e não para o padrão): quem digitou
 * 12 entregas quis "o máximo", não "3". Lixo (texto, vazio) cai no padrão.
 */
function numeroNaFaixa(v: unknown, chave: ChaveNumerica): number {
  const { min, max, inteiro } = LIMITES_DA_ROTEIRIZACAO_AUTOMATICA[chave];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return ROTEIRIZACAO_AUTOMATICA_PADRAO[chave];
  const preso = Math.min(max, Math.max(min, n));
  return inteiro ? Math.round(preso) : Math.round(preso * 10) / 10;
}

const objeto = (v: unknown): any => {
  let o: any = v;
  if (typeof o === "string") {
    try { o = JSON.parse(o); } catch { o = null; }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? o : null;
};

/**
 * A configuração gravada, sempre completa e dentro dos limites, a partir do
 * `deliveryConfig` inteiro da loja (lê a chave `roteirizacaoAutomatica`).
 */
export function lerRoteirizacaoAutomatica(deliveryConfig: unknown): RoteirizacaoAutomaticaConfig {
  return limparRoteirizacaoAutomatica(objeto(deliveryConfig)?.roteirizacaoAutomatica);
}

/**
 * O objeto da regra (o que o PUT da tela manda) limpo: copia só as chaves
 * conhecidas e aplica os limites — o que mais vier no JSON não passa daqui.
 */
export function limparRoteirizacaoAutomatica(regra: unknown): RoteirizacaoAutomaticaConfig {
  const r = objeto(regra);
  if (!r) return { ...ROTEIRIZACAO_AUTOMATICA_PADRAO };
  return {
    ativo: r.ativo === true,
    maxEntregasPorRota: numeroNaFaixa(r.maxEntregasPorRota, "maxEntregasPorRota"),
    raioDoGrupoKm: numeroNaFaixa(r.raioDoGrupoKm, "raioDoGrupoKm"),
    janelaDePrazoMin: numeroNaFaixa(r.janelaDePrazoMin, "janelaDePrazoMin"),
    esperaMaxMin: numeroNaFaixa(r.esperaMaxMin, "esperaMaxMin"),
    raioDaLojaM: numeroNaFaixa(r.raioDaLojaM, "raioDaLojaM"),
    quemPuxa: r.quemPuxa === "qualquer" ? "qualquer" : "chamado",
  };
}
