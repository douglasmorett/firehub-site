import { executarDDL } from "./ddl-do-boot";

/**
 * ── O ESTADO DO ROBÔ QUE O PAINEL LÊ, NO BANCO ──────────────────────────────
 *
 * Com dois servidores atrás do balanceador, o webhook do robô fica fixo num
 * deles (A, pelo domínio próprio), mas o painel da loja cai em qualquer um.
 * Tudo o que os dois lados leem e mudam — a pausa do robô numa conversa, a
 * fila de "clientes chamando", a faixa de IA fora do ar, o eco do número do
 * FireHub — morava na memória do processo: o lojista clicava "devolver ao
 * robô" em B e o robô seguia mudo em A por 12 horas; a fila que o webhook
 * enchia em A aparecia vazia para quem abria o painel em B.
 *
 * As tabelas, pequenas e fora do schema.prisma (acesso só por SQL cru, como a
 * AcrescimoDoPedido). Nascem no boot (src/instrumentation.ts) e, por
 * precaução, no primeiro uso de cada processo. Sem elas (banco que não é
 * Postgres, DDL que falhou), cada módulo segue pela memória do processo —
 * exatamente o comportamento de antes, que com UM servidor é correto.
 *
 *  - PausaDoRobo: o robô quieto numa conversa até `ate` (lib/pausa-do-robo.ts).
 *  - AtendimentoHumano: a fila do balãozinho (lib/fila-de-atendimento-humano.ts).
 *  - SaudeDaIa: o incidente de IA fora do ar, por loja ou do sistema (lib/saude-da-ia.ts).
 *  - EcoDoAtendimento: o que o número do FireHub mandou, para reconhecer o
 *    eco `fromMe` (lib/atendimento/whatsapp.ts).
 *
 * Avisos "uma vez só" não têm tabela própria: usam a "Vez" (lib/vez.ts) com um
 * dono novo a cada tentativa.
 */
export const TABELAS_DO_ROBO = [
  `CREATE TABLE IF NOT EXISTS "PausaDoRobo" (
    "userId" TEXT NOT NULL,
    "remoteJid" TEXT NOT NULL,
    "ate" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("userId", "remoteJid")
  )`,
  `CREATE TABLE IF NOT EXISTS "AtendimentoHumano" (
    "userId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nomeDoCliente" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "motivo" TEXT,
    "soPorIaForaDoAr" BOOLEAN NOT NULL DEFAULT false,
    "naoLidas" INTEGER NOT NULL DEFAULT 0,
    "ultimaMensagem" TEXT NOT NULL DEFAULT '',
    "mensagens" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "atualizadoEm" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "jid")
  )`,
  `CREATE TABLE IF NOT EXISTS "SaudeDaIa" (
    "chave" TEXT PRIMARY KEY,
    "desde" TIMESTAMPTZ NOT NULL,
    "ultimaFalhaEm" TIMESTAMPTZ NOT NULL,
    "resumo" TEXT NOT NULL,
    "exigeAcao" BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS "EcoDoAtendimento" (
    "hash" TEXT NOT NULL,
    "conversa" TEXT NOT NULL,
    "em" TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY ("hash", "conversa")
  )`,
];

const g = globalThis as typeof globalThis & { __firehubTabelasDoRobo?: Promise<boolean> | null };

/**
 * As tabelas existem? Uma vez por processo (o hash do executarDDL faz o boot
 * seguinte pular sem trava). false = siga pela memória. Nunca lança.
 */
export function garantirTabelasDoRobo(): Promise<boolean> {
  if (!g.__firehubTabelasDoRobo) {
    g.__firehubTabelasDoRobo = (async () => {
      if (!/^postgres/i.test(String(process.env.DATABASE_URL || ""))) return false;
      try {
        await executarDDL("robo-no-banco", TABELAS_DO_ROBO);
        return true;
      } catch (err: any) {
        console.error(`[Robô no banco] não consegui criar as tabelas: ${err?.message} — sigo pela memória do processo.`);
        g.__firehubTabelasDoRobo = null; // a próxima chamada tenta de novo
        return false;
      }
    })();
  }
  return g.__firehubTabelasDoRobo;
}

/**
 * Faxina de linha velha, no máximo uma vez por `intervaloMs` por assunto e por
 * processo — junto de uma gravação, nunca numa leitura do painel.
 */
const ultimaFaxina = new Map<string, number>();
export function faxinaDeTempoEmTempo(assunto: string, intervaloMs: number, faxina: () => Promise<unknown>): void {
  const agora = Date.now();
  if (agora - (ultimaFaxina.get(assunto) ?? 0) < intervaloMs) return;
  ultimaFaxina.set(assunto, agora);
  faxina().catch((err: any) => console.warn(`[Robô no banco] faxina de ${assunto} falhou: ${String(err?.message || err).slice(0, 120)}`));
}
