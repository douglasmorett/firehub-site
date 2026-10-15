/**
 * O COMPUTADOR DA CONTINGÊNCIA ESTÁ NA REDE DA LOJA? (Modo Contingência)
 *
 * 14/10/2026, noite: a contingência da Hakim Centro estava ativada no PC de
 * CASA do Douglas. Num soluço da nuvem, as telas da loja pulavam para
 * http://192.168.15.106:7890 — um endereço que só existe na casa dele — e
 * ficavam presas no erro do Chrome. Nada avisava.
 *
 * A nuvem vê de que internet (IP público) cada um fala com ela:
 *   - o computador da contingência, no relato a cada 30 s (`ipPublico`);
 *   - as telas do painel da loja, quando pedem o bilhete (`abas`: IP → última
 *     vez e quantas vezes), regravado no máximo a cada 5 min por IP.
 * Se há tela do painel abrindo o FireHub por outra internet, a tela do módulo
 * mostra um ALERTA. Só alerta, nunca trava: a mesma loja pode sair por IPv4 e
 * IPv6, ter dois links ou o dono abrir o painel de casa — por isso compara só
 * a mesma família (IPv4 com IPv4; IPv6 pelo prefixo /64) e diz qual é o IP
 * do aparelho de quem está olhando.
 */
import { v4ParaNumero, v6ParaGrupos } from "../ip-do-cloudflare";

/** IP → quando a última tela do painel pediu o bilhete por ele, e quantas vezes (de 5 em 5 min). */
export type TelasVistas = Record<string, { em: string; n: number }>;

/** Quantos IPs guardar (os mais recentes). */
export const IPS_GUARDADOS = 8;
/** IP sem tela há mais que isto sai da lista. */
export const VALIDADE_DO_IP_MS = 24 * 60 * 60_000;
/** O mesmo IP só é regravado depois disto (cada tela pede o bilhete ao abrir e a cada 30 min). */
export const REGRAVAR_O_IP_MS = 5 * 60_000;
/** Para o alerta, só contam as telas vistas neste tempo. */
export const TELAS_RECENTES_MS = 2 * 60 * 60_000;

/** A "rede" de um IP: o próprio IPv4, ou o prefixo /64 do IPv6. */
export function redeDoIp(bruto: unknown): { familia: 4 | 6; rede: string } | null {
  if (typeof bruto !== "string") return null;
  let ip = bruto.trim().toLowerCase();
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7);
  if (v4ParaNumero(ip) !== null) return { familia: 4, rede: ip };
  const g = v6ParaGrupos(ip);
  if (!g) return null;
  return { familia: 6, rede: g.slice(0, 4).map((x) => x.toString(16)).join(":") };
}

function lerTelas(bruto: unknown, agora: number): TelasVistas {
  const certo: TelasVistas = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return certo;
  for (const [ip, v] of Object.entries(bruto as Record<string, any>)) {
    const em = new Date(v?.em).getTime();
    if (!redeDoIp(ip) || !Number.isFinite(em) || agora - em > VALIDADE_DO_IP_MS) continue;
    certo[ip] = { em: new Date(em).toISOString(), n: Math.max(1, Math.trunc(Number(v?.n)) || 1) };
  }
  return certo;
}

/**
 * Anota que uma tela do painel pediu o bilhete por este IP. Devolve a lista
 * nova para gravar, ou null quando não há nada a gravar (IP inválido ou visto
 * há menos de REGRAVAR_O_IP_MS).
 */
export function anotarTela(bruto: unknown, ip: string, agora = Date.now()): TelasVistas | null {
  if (!redeDoIp(ip)) return null;
  const telas = lerTelas(bruto, agora);
  const antes = telas[ip];
  if (antes && agora - new Date(antes.em).getTime() < REGRAVAR_O_IP_MS) return null;
  telas[ip] = { em: new Date(agora).toISOString(), n: (antes?.n || 0) + 1 };
  const ficam = Object.entries(telas).sort((a, b) => new Date(b[1].em).getTime() - new Date(a[1].em).getTime()).slice(0, IPS_GUARDADOS);
  return Object.fromEntries(ficam);
}

export type AlertaDeRede = {
  /** IP público do computador da contingência. */
  ipDoComputador: string;
  /** IPs (mesma família) das telas do painel que abriram o FireHub por outra internet. */
  outras: { ip: string; em: string; n: number; esteAparelho: boolean }[];
};

/**
 * Há tela do painel abrindo o FireHub por outra internet que não a do
 * computador da contingência? Sem IP do computador ou sem tela da mesma
 * família para comparar: null (não dá para dizer — nada de alerta à toa).
 */
export function alertaDeRede(ipDoComputador: unknown, telas: unknown, ipDesteAparelho: string | null = null, agora = Date.now()): AlertaDeRede | null {
  const pc = redeDoIp(ipDoComputador);
  if (!pc) return null;
  const meu = redeDoIp(ipDesteAparelho);
  const outras: AlertaDeRede["outras"] = [];
  for (const [ip, v] of Object.entries(lerTelas(telas, agora))) {
    if (agora - new Date(v.em).getTime() > TELAS_RECENTES_MS) continue;
    const r = redeDoIp(ip)!;
    if (r.familia !== pc.familia || r.rede === pc.rede) continue;
    outras.push({ ip, em: v.em, n: v.n, esteAparelho: !!meu && meu.familia === r.familia && meu.rede === r.rede });
  }
  if (!outras.length) return null;
  outras.sort((a, b) => b.n - a.n);
  return { ipDoComputador: String(ipDoComputador), outras };
}
