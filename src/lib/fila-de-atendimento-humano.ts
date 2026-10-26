import { prisma } from "./prisma";
import { faxinaDeTempoEmTempo, garantirTabelasDoRobo } from "./robo-no-banco";

/**
 * A FILA DO BALÃOZINHO — "clientes chamando uma pessoa" — no banco.
 *
 * Morava em `global.__humanSupportChats`, um Map do processo: o webhook do
 * robô enchia, o painel (api/chatbot/human-support e api/chatbot/conversas)
 * lia e mudava. Com dois servidores, o webhook fica fixo em A e o painel cai
 * em qualquer um: aberto em B, o balãozinho mostrava a fila de B — vazia —
 * enquanto o cliente esperava na de A; "encerrar" em B não fechava nada em A.
 * E, com um servidor só, cada deploy esvaziava a fila de quem estava esperando.
 *
 * Tabela "AtendimentoHumano" (lib/robo-no-banco.ts), uma linha por conversa.
 * Cada mudança é UM comando atômico (acrescentar ao JSONB, somar não lidas) —
 * duas mensagens do mesmo cliente chegando juntas não podem apagar uma à
 * outra, como fazia o "lê, muda, grava" sobre a memória.
 *
 * O formato devolvido é o mesmo que o widget sempre recebeu (HumanSupportChat).
 * Linha CLOSED fica (o webhook a usa para expirar a conversa em 30 min, como
 * fazia com a entrada da memória); a faxina tira o que passou de um dia sem
 * mexer — depois de 12 h nem a pausa nem a trava do banco valem mais.
 *
 * Banco fora: quem lê recebe "nada na fila" e o robô segue atendendo — falar
 * demais é recuperável, cliente calado por engano não. Nunca lança.
 */

export type MensagemDoChamado = { sender: "user" | "attendant" | "bot"; text: string; timestamp: number };

export interface HumanSupportChat {
  id: string;
  userId: string;
  jid: string;
  phone: string;
  clientName: string;
  status: "PENDING" | "ACTIVE" | "CLOSED";
  /** Por que caiu na fila ("Reclamação", "Pediu atendente"). Vazio = entrada antiga. */
  motivo?: string;
  /** Está na fila SÓ porque a IA caiu (a resposta seguinte da IA a tira de lá). */
  soPorIaForaDoAr: boolean;
  unreadCount: number;
  lastMessage: string;
  updatedAt: number;
  messages: MensagemDoChamado[];
}

type Linha = {
  userId: string;
  jid: string;
  telefone: string;
  nomeDoCliente: string;
  status: string;
  motivo: string | null;
  soPorIaForaDoAr: boolean;
  naoLidas: number;
  ultimaMensagem: string;
  mensagens: unknown;
  atualizadoEm: Date;
};

function paraOChamado(l: Linha): HumanSupportChat {
  return {
    id: `${l.userId}_${l.jid}`,
    userId: l.userId,
    jid: l.jid,
    phone: l.telefone,
    clientName: l.nomeDoCliente,
    status: (["PENDING", "ACTIVE", "CLOSED"].includes(l.status) ? l.status : "PENDING") as HumanSupportChat["status"],
    motivo: l.motivo || undefined,
    soPorIaForaDoAr: l.soPorIaForaDoAr === true,
    unreadCount: Number(l.naoLidas) || 0,
    lastMessage: l.ultimaMensagem || "",
    updatedAt: new Date(l.atualizadoEm).getTime(),
    messages: Array.isArray(l.mensagens) ? (l.mensagens as MensagemDoChamado[]) : [],
  };
}

async function tentar<T>(oQue: string, seFalhar: T, fn: () => Promise<T>): Promise<T> {
  try {
    if (!(await garantirTabelasDoRobo())) return seFalhar;
    return await fn();
  } catch (err: any) {
    console.error(`[Fila humana] ${oQue} falhou: ${String(err?.message || err).slice(0, 160)}`);
    return seFalhar;
  }
}

const json = (v: unknown) => JSON.stringify(v);

/**
 * Põe (ou mantém) a conversa na fila com as mensagens novas. Quem a equipe JÁ
 * assumiu continua ACTIVE; o resto volta a PENDING. Um motivo antigo não é
 * apagado por entrada sem motivo. `soPorIaForaDoAr`: nasce verdadeiro só pelo
 * motivo da queda da IA; qualquer outro motivo o derruba; entrada sem motivo
 * mantém o que estava (a regra que o webhook montava sobre a memória).
 */
export function entrarNaFila(e: {
  userId: string;
  jid: string;
  telefone: string;
  nomeDoCliente: string;
  textoDoCliente: string;
  mensagens: MensagemDoChamado[];
  motivo?: string;
  motivoDaIaForaDoAr: string;
  agora?: number;
}): Promise<boolean> {
  const motivo = e.motivo || null;
  const quando = new Date(e.agora ?? Date.now());
  return tentar("entrar na fila", false, async () => {
    await prisma.$executeRaw`
      INSERT INTO "AtendimentoHumano"
        ("userId", "jid", "telefone", "nomeDoCliente", "status", "motivo", "soPorIaForaDoAr", "naoLidas", "ultimaMensagem", "mensagens", "atualizadoEm")
      VALUES (${e.userId}, ${e.jid}, ${e.telefone}, ${e.nomeDoCliente}, 'PENDING', ${motivo},
              ${motivo === e.motivoDaIaForaDoAr}, 1, ${e.textoDoCliente}, ${json(e.mensagens)}::jsonb, ${quando})
      ON CONFLICT ("userId", "jid") DO UPDATE SET
        "telefone" = EXCLUDED."telefone",
        "nomeDoCliente" = EXCLUDED."nomeDoCliente",
        "status" = CASE WHEN "AtendimentoHumano"."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'PENDING' END,
        "naoLidas" = "AtendimentoHumano"."naoLidas" + 1,
        "ultimaMensagem" = EXCLUDED."ultimaMensagem",
        "mensagens" = "AtendimentoHumano"."mensagens" || EXCLUDED."mensagens",
        "atualizadoEm" = EXCLUDED."atualizadoEm",
        "motivo" = COALESCE(EXCLUDED."motivo", "AtendimentoHumano"."motivo"),
        "soPorIaForaDoAr" = CASE
          WHEN EXCLUDED."motivo" IS NULL OR EXCLUDED."motivo" = ${e.motivoDaIaForaDoAr} THEN "AtendimentoHumano"."soPorIaForaDoAr"
          ELSE false END`;
    faxinaDeTempoEmTempo("fila-humana", 60 * 60_000, () =>
      prisma.$executeRaw`DELETE FROM "AtendimentoHumano" WHERE "atualizadoEm" < now() - interval '1 day'`,
    );
    return true;
  });
}

/** A entrada desta conversa (qualquer status), ou null. */
export function chamadoDaConversa(userId: string, jid: string): Promise<HumanSupportChat | null> {
  return tentar("ler a conversa", null, async () => {
    const linhas = await prisma.$queryRaw<Linha[]>`
      SELECT * FROM "AtendimentoHumano" WHERE "userId" = ${userId} AND "jid" = ${jid}`;
    return linhas.length ? paraOChamado(linhas[0]) : null;
  });
}

/** O cliente escreveu de novo numa conversa que está com a equipe (não fechada). */
export function acrescentarDoCliente(userId: string, jid: string, texto: string, agora: number = Date.now()): Promise<boolean> {
  return tentar("acrescentar mensagem", false, async () => {
    const n = await prisma.$executeRaw`
      UPDATE "AtendimentoHumano" SET
        "mensagens" = "mensagens" || ${json([{ sender: "user", text: texto, timestamp: agora }])}::jsonb,
        "ultimaMensagem" = ${texto},
        "atualizadoEm" = ${new Date(agora)},
        "naoLidas" = "naoLidas" + 1
      WHERE "userId" = ${userId} AND "jid" = ${jid} AND "status" <> 'CLOSED'`;
    return n > 0;
  });
}

/** Tira a conversa da fila (atendimento expirou). */
export function tirarDaFila(userId: string, jid: string): Promise<boolean> {
  return tentar("tirar da fila", false, async () => {
    const n = await prisma.$executeRaw`DELETE FROM "AtendimentoHumano" WHERE "userId" = ${userId} AND "jid" = ${jid}`;
    return n > 0;
  });
}

/** A IA voltou a responder: sai da fila quem estava lá SÓ pela queda e ninguém assumiu. */
export function tirarSeSoPelaQuedaDaIa(userId: string, jid: string): Promise<boolean> {
  return tentar("tirar da fila (IA voltou)", false, async () => {
    const n = await prisma.$executeRaw`
      DELETE FROM "AtendimentoHumano"
      WHERE "userId" = ${userId} AND "jid" = ${jid} AND "soPorIaForaDoAr" AND "status" = 'PENDING'`;
    return n > 0;
  });
}

/** O que o balãozinho mostra: as conversas não fechadas da loja, a mais recente primeiro. */
export function chamadosAbertos(userId: string): Promise<HumanSupportChat[]> {
  return tentar("listar a fila", [], async () => {
    const linhas = await prisma.$queryRaw<Linha[]>`
      SELECT * FROM "AtendimentoHumano"
      WHERE "userId" = ${userId} AND "status" <> 'CLOSED'
      ORDER BY "atualizadoEm" DESC`;
    return linhas.map(paraOChamado);
  });
}

/** Todas as conversas da loja que passaram pela fila (inclusive fechadas): contatos do marketing. */
export function contatosDaFila(userId: string): Promise<{ jid: string; telefone: string; nome: string; atualizadoEm: Date }[]> {
  return tentar("listar contatos da fila", [], async () => {
    const linhas = await prisma.$queryRaw<{ jid: string; telefone: string; nomeDoCliente: string; atualizadoEm: Date }[]>`
      SELECT "jid", "telefone", "nomeDoCliente", "atualizadoEm" FROM "AtendimentoHumano" WHERE "userId" = ${userId}`;
    return linhas.map((l) => ({ jid: l.jid, telefone: l.telefone, nome: l.nomeDoCliente, atualizadoEm: l.atualizadoEm }));
  });
}

/** A atendente abriu a conversa: lida e assumida. */
export function marcarLido(userId: string, jid: string): Promise<boolean> {
  return tentar("marcar como lida", false, async () => {
    const n = await prisma.$executeRaw`
      UPDATE "AtendimentoHumano" SET "naoLidas" = 0, "status" = 'ACTIVE'
      WHERE "userId" = ${userId} AND "jid" = ${jid}`;
    return n > 0;
  });
}

/**
 * A loja respondeu o cliente: a resposta entra no histórico do chamado e ele
 * fica ACTIVE. Pela aba do robô (`peloRobo`), só mexe em chamado ainda aberto,
 * e zera as não lidas — quem respondeu já leu.
 */
export function respostaDaLoja(userId: string, jid: string, texto: string, opcoes: { peloRobo?: boolean; agora?: number } = {}): Promise<boolean> {
  const agora = opcoes.agora ?? Date.now();
  const peloRobo = opcoes.peloRobo === true;
  return tentar("registrar a resposta da loja", false, async () => {
    const n = await prisma.$executeRaw`
      UPDATE "AtendimentoHumano" SET
        "mensagens" = "mensagens" || ${json([{ sender: "attendant", text: texto, timestamp: agora }])}::jsonb,
        "ultimaMensagem" = ${texto},
        "atualizadoEm" = ${new Date(agora)},
        "status" = 'ACTIVE',
        "naoLidas" = CASE WHEN ${peloRobo} THEN 0 ELSE "naoLidas" END
      WHERE "userId" = ${userId} AND "jid" = ${jid} AND (NOT ${peloRobo} OR "status" <> 'CLOSED')`;
    return n > 0;
  });
}

/**
 * Fecha o chamado (fica na tabela como CLOSED). Devolve se existia e o motivo
 * dele — "Loop suspeito" fecha sem mandar mensagem ao cliente.
 */
export function encerrarChamado(userId: string, jid: string): Promise<{ existia: boolean; motivo?: string }> {
  return tentar("encerrar o chamado", { existia: false }, async () => {
    const linhas = await prisma.$queryRaw<{ motivo: string | null }[]>`
      UPDATE "AtendimentoHumano" SET "status" = 'CLOSED', "naoLidas" = 0
      WHERE "userId" = ${userId} AND "jid" = ${jid}
      RETURNING "motivo"`;
    return linhas.length ? { existia: true, motivo: linhas[0].motivo || undefined } : { existia: false };
  });
}
