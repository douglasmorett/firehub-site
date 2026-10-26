import { prisma } from "./prisma";
import { garantirTabelasDoRobo } from "./robo-no-banco";

/**
 * A IA do robô está de pé? — o estado que o PAINEL mostra.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O alerta de "IA fora do ar" vai pelo WhatsApp para o `notificationPhone` da
 * loja e da conta matriz. Conferido no banco em 18/09/2026: a matriz NÃO tem
 * número cadastrado, e 3 das 5 lojas com robô também não (Hakim Centro e Brazza
 * Burguer entre elas). Foi assim que o crédito do Gemini ficou esgotado cinco
 * dias sem ninguém saber: os alertas existiam e não tinham para onde ir.
 *
 * A faixa do painel não depende de telefone: toda loja com o painel aberto vê.
 * Este módulo é só o estado que ela lê — o webhook escreve, a rota
 * /api/chatbot/status-conexao entrega.
 *
 * ── No banco, gravando só quando muda ───────────────────────────────────────
 *
 * Era só memória do processo. Com dois servidores o webhook fica fixo em A e o
 * painel cai em qualquer um: a loja com o painel em B nunca via a faixa. O
 * estado agora vai para a tabela "SaudeDaIa" (lib/robo-no-banco.ts), uma linha
 * por loja e uma do sistema — mas o webhook roda a CADA mensagem, então só
 * grava quando o estado MUDA: incidente novo, outro resumo, ou a hora da última
 * falha andou mais de um minuto (é ela que faz o soluço sumir em 15 min). O
 * sucesso só apaga quando havia incidente — e, uma vez por processo e por
 * loja, por garantia (o processo novo não sabe o que o anterior deixou).
 *
 * Quem lê (a faixa, a cada 90 s por painel) lê a tabela INTEIRA — quase
 * sempre vazia — com cache de 15 s por servidor: uma consulta a cada 15 s,
 * não importa quantas lojas perguntem. A gravação deste processo apaga o cache.
 *
 * A memória continua: banco fora, a faixa sai dela, como antes.
 *
 * Guardado em `globalThis` porque o Next carrega cada rota num bundle próprio;
 * uma variável de módulo seria uma por rota.
 */

export type SaudeDaIa = {
  foraDoAr: boolean;
  /** ISO de quando o incidente começou. */
  desde: string | null;
  resumo: string | null;
  /** Não volta sozinha: alguém tem que agir (crédito, chave). */
  exigeAcao: boolean;
};

type Registro = { desde: number; ultimaFalhaEm: number; resumo: string; exigeAcao: boolean };
type Estado = {
  sistema: Registro | null;
  porLoja: Map<string, Registro>;
  /** Quando cada chave foi gravada no banco por este processo (ms) — o freio da gravação. */
  gravadoEm: Map<string, number>;
  /** Chaves já apagadas no banco por este processo depois de subir. */
  limpas: Set<string>;
  /** A tabela inteira, como o banco a mostrou por último. */
  lida: { em: number; linhas: Map<string, Registro> } | null;
  gravacoes: Promise<void>;
};

/** Falha passageira sem repetição some sozinha da faixa depois disto. */
const SOLUCO_EXPIRA_MS = 15 * 60 * 1000;
/** A última falha do mesmo incidente só é regravada depois disto. */
const REGRAVAR_FALHA_MS = 60_000;
/** Quanto a leitura da tabela vale em cada servidor. */
const CACHE_MS = 15_000;
const SISTEMA = "sistema";

function estado(): Estado {
  const g = globalThis as any;
  if (!g.__firehubSaudeDaIa || !(g.__firehubSaudeDaIa.gravadoEm instanceof Map)) {
    g.__firehubSaudeDaIa = { sistema: null, porLoja: new Map(), gravadoEm: new Map(), limpas: new Set(), lida: null, gravacoes: Promise.resolve() };
  }
  return g.__firehubSaudeDaIa as Estado;
}

/** As gravações saem uma de cada vez, na ordem: o fim do incidente não pode chegar antes do começo. */
function noBanco(oQue: string, fn: () => Promise<unknown>): void {
  const e = estado();
  e.gravacoes = e.gravacoes.then(async () => {
    try {
      if (!(await garantirTabelasDoRobo())) return;
      await fn();
    } catch (err: any) {
      console.warn(`[Saúde da IA] não gravei ${oQue} no banco: ${String(err?.message || err).slice(0, 120)}`);
    } finally {
      e.lida = null;
    }
  });
}

export function registrarIncidenteDaIa(
  lojaId: string,
  falha: { resumo: string; exigeAcao: boolean; doSistema: boolean },
  agora: number = Date.now(),
) {
  const e = estado();
  const anterior = falha.doSistema ? e.sistema : e.porLoja.get(lojaId);
  const registro: Registro = {
    desde: anterior?.desde ?? agora,
    ultimaFalhaEm: agora,
    resumo: falha.resumo,
    exigeAcao: falha.exigeAcao,
  };
  if (falha.doSistema) e.sistema = registro;
  else e.porLoja.set(lojaId, registro);

  const chave = falha.doSistema ? SISTEMA : lojaId;
  const mudou =
    !anterior ||
    anterior.resumo !== registro.resumo ||
    anterior.exigeAcao !== registro.exigeAcao ||
    agora - (e.gravadoEm.get(chave) ?? 0) >= REGRAVAR_FALHA_MS;
  if (!mudou) return;
  e.gravadoEm.set(chave, agora);
  e.limpas.delete(chave);
  e.lida = null;
  // `desde` do banco vence: o incidente pode ter começado antes deste processo subir.
  noBanco("o incidente", () => prisma.$executeRaw`
    INSERT INTO "SaudeDaIa" ("chave", "desde", "ultimaFalhaEm", "resumo", "exigeAcao")
    VALUES (${chave}, ${new Date(registro.desde)}, ${new Date(agora)}, ${registro.resumo}, ${registro.exigeAcao})
    ON CONFLICT ("chave") DO UPDATE SET
      "ultimaFalhaEm" = EXCLUDED."ultimaFalhaEm", "resumo" = EXCLUDED."resumo", "exigeAcao" = EXCLUDED."exigeAcao"`);
}

/** A IA respondeu para esta loja: o incidente dela — e o do sistema, que usa a mesma chave — acabou. */
export function registrarSucessoDaIa(lojaId: string) {
  const e = estado();
  const apagar: string[] = [];
  if (e.sistema || !e.limpas.has(SISTEMA)) apagar.push(SISTEMA);
  if (e.porLoja.has(lojaId) || !e.limpas.has(lojaId)) apagar.push(lojaId);
  e.sistema = null;
  e.porLoja.delete(lojaId);
  if (apagar.length === 0) return;
  for (const chave of apagar) {
    e.limpas.add(chave);
    e.gravadoEm.delete(chave);
  }
  e.lida = null;
  noBanco("o fim do incidente", () => prisma.$executeRaw`DELETE FROM "SaudeDaIa" WHERE "chave" = ANY(${apagar})`);
}

async function lerDoBanco(): Promise<Map<string, Registro> | null> {
  const e = estado();
  if (e.lida && Date.now() - e.lida.em < CACHE_MS) return e.lida.linhas;
  try {
    if (!(await garantirTabelasDoRobo())) return null;
    const em = Date.now();
    const linhas = await prisma.$queryRaw<{ chave: string; desde: Date; ultimaFalhaEm: Date; resumo: string; exigeAcao: boolean }[]>`
      SELECT "chave", "desde", "ultimaFalhaEm", "resumo", "exigeAcao" FROM "SaudeDaIa"`;
    const mapa = new Map<string, Registro>();
    for (const l of linhas) {
      mapa.set(l.chave, {
        desde: new Date(l.desde).getTime(),
        ultimaFalhaEm: new Date(l.ultimaFalhaEm).getTime(),
        resumo: l.resumo,
        exigeAcao: l.exigeAcao === true,
      });
    }
    e.lida = { em, linhas: mapa };
    return mapa;
  } catch {
    return null;
  }
}

/** O que a faixa mostra para esta loja. Nunca lança: banco fora, vale a memória deste servidor. */
export async function saudeDaIa(lojaId: string, agora: number = Date.now()): Promise<SaudeDaIa> {
  const e = estado();
  const doBanco = await lerDoBanco();
  const sistema = doBanco ? doBanco.get(SISTEMA) : e.sistema;
  const daLoja = doBanco ? doBanco.get(lojaId) : e.porLoja.get(lojaId);
  const vivo = (r: Registro | null | undefined) =>
    r && (r.exigeAcao || agora - r.ultimaFalhaEm < SOLUCO_EXPIRA_MS) ? r : null;
  const r = vivo(sistema) || vivo(daLoja);
  if (!r) return { foraDoAr: false, desde: null, resumo: null, exigeAcao: false };
  return { foraDoAr: true, desde: new Date(r.desde).toISOString(), resumo: r.resumo, exigeAcao: r.exigeAcao };
}
