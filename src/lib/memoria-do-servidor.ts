/**
 * A MEMÓRIA DO SERVIDOR, medida pelo que importa — e o alarme que avisa
 * ANTES de o processo cair, sem gritar à toa.
 *
 * ── O alarme antigo chorava à toa ───────────────────────────────────────────
 *
 * O /api/health comparava o `heapUsed` do instante com 512 MB, e o cron de
 * saúde (lib/server-monitor.ts) com 450 MB — e este mandava WhatsApp para o
 * Douglas e o Victor a cada 5 minutos. Só que o Node usa memória em SERROTE:
 * aloca, sobe até ~650 MB, a coleta de lixo limpa e volta a ~280 MB (medido
 * em 16/10/2026, sexta às 19h48, no pico). O topo do serrote é lixo esperando
 * a coleta, não uso — e um terço das leituras dava "degraded" com o servidor
 * folgado.
 *
 * ── O que derruba de verdade ────────────────────────────────────────────────
 *
 * O teto é o `heap_size_limit` do V8: sem NODE_OPTIONS e sem limite no
 * container (Coolify), o Node 20 fica com ~1/4 da RAM — ~2 GB no droplet de
 * 8 GB. Encostar nele é "JavaScript heap out of memory": o processo morre e o
 * Coolify sobe outro (site fora por um minuto, filas em memória perdidas).
 *
 * ── Como mede agora ─────────────────────────────────────────────────────────
 *
 * PISO = o menor `heapUsed` dos últimos 5 minutos (amostra a cada 15 s): o
 * que sobra depois das coletas, a memória que o servidor de fato segura. O
 * pico do serrote não mexe no piso; um vazamento, sim — ele sobe o piso aos
 * poucos, e é isso que precisa de aviso.
 *
 * ── Os níveis (decisão do Douglas, 16/10/2026: "tem que avisar antes") ──────
 *
 *   ok       piso abaixo de 60% do teto.
 *   atenção  piso a partir de 60% (~1,2 GB de ~2 GB): ainda sobram ~800 MB —
 *            dá tempo de ver o que cresceu e reiniciar FORA do pico, em vez de
 *            o servidor cair no meio do jantar.
 *   crítico  piso a partir de 80%, OU o instante a partir de 90%: perto de
 *            cair.
 *
 * Logo depois de ligar ainda não há 3 minutos de amostras e o piso não existe
 * (o aquecimento sobe a memória sem ser vazamento): só o instante ≥ 90% conta.
 */
import v8 from "node:v8";

export type NivelDaMemoria = "ok" | "atencao" | "critico";

/** Piso a partir do qual avisa cedo. */
export const LIMIAR_DE_ATENCAO = 0.6;
/** Piso a partir do qual é perigo. */
export const LIMIAR_CRITICO = 0.8;
/** O instante sozinho só pesa colado no teto. */
export const LIMIAR_DO_INSTANTE = 0.9;

export const JANELA_DO_PISO_MS = 5 * 60_000;
export const INTERVALO_DA_AMOSTRA_MS = 15_000;
/** Menos que isto de amostras e o piso ainda não diz nada (aquecimento). */
export const MINIMO_PARA_O_PISO_MS = 3 * 60_000;

export type AmostraDeMemoria = { em: number; usado: number };

export type LeituraDaMemoria = {
  nivel: NivelDaMemoria;
  usadoMB: number;
  /** O que sobra depois das coletas (menor dos últimos 5 min); null no aquecimento. */
  pisoMB: number | null;
  tetoMB: number;
  /** Piso em % do teto (null no aquecimento). */
  pctDoPiso: number | null;
  /** Instante em % do teto. */
  pctDoInstante: number;
  aquecendo: boolean;
};

const MB = 1024 * 1024;
const mb = (bytes: number) => Math.round(bytes / MB);
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);

/**
 * A régua, sem relógio nem processo: recebe as amostras, a hora e o teto.
 * As amostras fora da janela de 5 minutos não contam.
 */
export function avaliarMemoria(amostras: AmostraDeMemoria[], agora: number, teto: number, usadoAgora: number): LeituraDaMemoria {
  const naJanela = amostras.filter((a) => a.em >= agora - JANELA_DO_PISO_MS && a.em <= agora);
  const maisAntiga = naJanela.reduce((m, a) => Math.min(m, a.em), agora);
  const aquecendo = agora - maisAntiga < MINIMO_PARA_O_PISO_MS;
  const piso = aquecendo ? null : Math.min(usadoAgora, ...naJanela.map((a) => a.usado));

  const fracaoDoInstante = teto > 0 ? usadoAgora / teto : 0;
  const fracaoDoPiso = piso != null && teto > 0 ? piso / teto : null;

  let nivel: NivelDaMemoria = "ok";
  if (fracaoDoInstante >= LIMIAR_DO_INSTANTE || (fracaoDoPiso != null && fracaoDoPiso >= LIMIAR_CRITICO)) nivel = "critico";
  else if (fracaoDoPiso != null && fracaoDoPiso >= LIMIAR_DE_ATENCAO) nivel = "atencao";

  return {
    nivel,
    usadoMB: mb(usadoAgora),
    pisoMB: piso != null ? mb(piso) : null,
    tetoMB: mb(teto),
    pctDoPiso: piso != null ? pct(piso, teto) : null,
    pctDoInstante: pct(usadoAgora, teto),
    aquecendo,
  };
}

/** O texto do WhatsApp para o nível (ok não tem texto). */
export function textoDoAvisoDeMemoria(l: LeituraDaMemoria): string | null {
  if (l.nivel === "ok") return null;
  const base = l.pisoMB != null
    ? `${l.pisoMB} MB de ${l.tetoMB} MB (${l.pctDoPiso}%) mesmo depois da limpeza`
    : `${l.usadoMB} MB de ${l.tetoMB} MB (${l.pctDoInstante}%) agora`;
  return l.nivel === "critico"
    ? `🔴 Memória perto do limite: ${base}. Risco de o servidor cair sozinho (o Coolify sobe outro em ~1 min). Reiniciar o app no Coolify assim que der.`
    : `🟡 Memória subindo: ${base}. Ainda há folga — vale olhar o que cresceu e reiniciar o app fora do pico.`;
}

// ── A amostragem, uma só por processo ────────────────────────────────────────
//
// Fica no globalThis: no Next cada rota pode carregar a sua cópia deste
// módulo, e o /api/health e o cron de saúde têm que ler o MESMO histórico.
type Estado = { amostras: AmostraDeMemoria[]; timer: ReturnType<typeof setInterval> | null };
const g = globalThis as unknown as { __memoriaDoServidor?: Estado };
const estado: Estado = (g.__memoriaDoServidor ??= { amostras: [], timer: null });

function registrar(agora = Date.now()): number {
  const usado = process.memoryUsage().heapUsed;
  estado.amostras.push({ em: agora, usado });
  // Guarda só a janela (mais uma folga): 5 min a cada 15 s são ~20 números.
  const corte = agora - JANELA_DO_PISO_MS - INTERVALO_DA_AMOSTRA_MS;
  while (estado.amostras.length && estado.amostras[0].em < corte) estado.amostras.shift();
  return usado;
}

function iniciarAmostragem() {
  if (estado.timer) return;
  registrar();
  estado.timer = setInterval(() => registrar(), INTERVALO_DA_AMOSTRA_MS);
  // Não segura o processo vivo só por causa da medição.
  (estado.timer as any).unref?.();
}

/** A leitura de agora (e liga a amostragem na primeira vez). */
export function lerMemoria(): LeituraDaMemoria {
  iniciarAmostragem();
  const agora = Date.now();
  const usado = registrar(agora);
  return avaliarMemoria(estado.amostras, agora, v8.getHeapStatistics().heap_size_limit, usado);
}
