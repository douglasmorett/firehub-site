/**
 * Quem cai em cada marco da recuperação pelo QR (api/cron/recuperacao-clientes).
 * Puro: recebe o último pedido de cada telefone e devolve os alvos. Teste:
 * scripts/teste-recuperacao-pelo-qr.ts.
 *
 * ── OS MARCOS NOVOS (Lucas/Frangoso, 11/11/2026, aprovados em 15/11) ────────
 *
 *   "segundo"  quem fez UM pedido só e está há N dias (20 ou 30) sem fazer o
 *              segundo. O "7 dias sem pedir" pega o cliente fiel toda semana;
 *              este pega só quem ainda não voltou nenhuma vez.
 *   "janela"   quem está entre `de` e `ate` dias sem pedir (padrão 15 a 25).
 *              Como a janela tem vários dias, o cliente recebe o PRIMEIRO dia
 *              em que o cron o encontrar nela (o teto de 60 por dia pode
 *              empurrar alguém para o dia seguinte) e depois espera
 *              GUARDA_DA_JANELA_DIAS: no máximo uma vez por mês. O cupom deste
 *              marco a loja limita a "1 uso por cliente por mês" no cadastro do
 *              cupom (lib/cupons.ts, `usosPorMes`).
 *
 * "sumido" (7/15/30) é o de sempre: o último pedido caiu há exatamente N dias.
 */

export type TipoDoMarco = "sumido" | "segundo" | "janela";

/** Um telefone da loja: o pedido mais recente e quantos pedidos tem. */
export type PedidosDoTelefone = { telefone: string; ultimo: Date; pedidos: number };

/** A janela entra assim se a loja não escolheu (exemplo do Lucas). */
export const JANELA_PADRAO = { de: 15, ate: 25 } as const;
/** Teto da janela: depois disso não é recuperação, é cliente perdido. */
const JANELA_MAXIMA = 120;
/** Quem recebeu o marco da janela espera isto para receber de novo. */
export const GUARDA_DA_JANELA_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/** A janela gravada pela loja, sempre válida (1 ≤ de ≤ ate ≤ 120). */
export function lerJanela(cfg: unknown): { de: number; ate: number } {
  const c = (cfg && typeof cfg === "object" ? cfg : {}) as Record<string, unknown>;
  const num = (v: unknown, padrao: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, JANELA_MAXIMA) : padrao;
  };
  const de = num(c.janelaDe, JANELA_PADRAO.de);
  const ate = num(c.janelaAte, JANELA_PADRAO.ate);
  return ate >= de ? { de, ate } : { de: ate, ate: de };
}

/**
 * Junta o mesmo cliente gravado de jeitos diferentes ("21 9…", "5521 9…"):
 * fica o pedido mais recente e a soma dos pedidos. Sem isto, um cliente com
 * dois formatos parecia ter um pedido só em cada — e recebia o "faz 20 dias
 * do seu primeiro pedido" sendo freguês.
 */
export function juntarPorCliente(
  lista: PedidosDoTelefone[],
  chave: (telefone: string) => string
): PedidosDoTelefone[] {
  const porChave = new Map<string, PedidosDoTelefone>();
  for (const p of lista) {
    const k = chave(p.telefone);
    if (!k) continue;
    const ja = porChave.get(k);
    if (!ja) porChave.set(k, { ...p });
    else porChave.set(k, {
      telefone: p.ultimo > ja.ultimo ? p.telefone : ja.telefone,
      ultimo: p.ultimo > ja.ultimo ? p.ultimo : ja.ultimo,
      pedidos: ja.pedidos + p.pedidos,
    });
  }
  return [...porChave.values()];
}

/** Dias inteiros desde o último pedido (7 dias e 23 horas = 7). */
export function diasSemPedir(ultimo: Date, agora: Date): number {
  return Math.floor((agora.getTime() - ultimo.getTime()) / DIA_MS);
}

/**
 * Os telefones que fazem este marco hoje.
 * `recebeuJanela` é o mapa chave → ISO de quem recebeu o marco da janela.
 */
export function alvosDoMarco(
  lista: PedidosDoTelefone[],
  marco: { tipo: TipoDoMarco; dias: number; ate?: number },
  agora: Date,
  opcoes: { chave?: (telefone: string) => string; recebeuJanela?: Record<string, unknown> } = {}
): string[] {
  const corteDaJanela = agora.getTime() - GUARDA_DA_JANELA_DIAS * DIA_MS;
  return lista
    .filter((p) => {
      const dias = diasSemPedir(p.ultimo, agora);
      if (marco.tipo === "sumido") return dias === marco.dias;
      if (marco.tipo === "segundo") return p.pedidos === 1 && dias === marco.dias;
      // janela
      if (dias < marco.dias || dias > (marco.ate ?? marco.dias)) return false;
      const em = opcoes.recebeuJanela?.[opcoes.chave ? opcoes.chave(p.telefone) : p.telefone];
      return !(typeof em === "string" && new Date(em).getTime() >= corteDaJanela);
    })
    .map((p) => p.telefone);
}

/** Tira do mapa de envios o que passou de `guardaDias` (o mapa mora no chatbotConfig). */
export function podarEnvios(envios: Record<string, string>, guardaDias: number, agora: Date): Record<string, string> {
  const corte = agora.getTime() - guardaDias * DIA_MS;
  const r: Record<string, string> = {};
  for (const [t, em] of Object.entries(envios)) if (new Date(em).getTime() >= corte) r[t] = em;
  return r;
}
