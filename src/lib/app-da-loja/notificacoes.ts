/**
 * A NOTIFICAÇÃO DE PROMOÇÃO que a loja manda para quem tem o app dela
 * (tela "Meu aplicativo" › Notificações). Regras puras em regras-do-push.ts.
 *
 * - Só pela API do Expo, em lotes de 100 (como lib/app-da-loja/aparelhos.ts).
 *   NUNCA pelo WhatsApp (memória numero-do-firehub-so-responde).
 * - Só para os aparelhos que ACEITARAM promoção no app (Apple 4.5.4).
 * - Até 3 envios por dia operacional (vira às 5h, fuso da loja), por conta
 *   (o app é da marca: as unidades do grupo dividem o limite). Agendado conta
 *   no dia em que vai sair; cancelado devolve a vaga.
 * - Agendado sai pelo cron /api/cron/app-da-loja-notificacoes (a cada
 *   minuto, scripts/cron-runner.js), que também pergunta ao Expo, 15 min
 *   depois, se o Google/Apple entregou (os "recibos") e tira da base o
 *   aparelho de onde o app saiu (DeviceNotRegistered).
 *
 * Tabelas em SQL cru, criadas no primeiro uso:
 *   AppDaLojaNotificacao        um envio (texto, público, contas)
 *   AppDaLojaNotificacaoTicket  os tickets do Expo à espera do recibo
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { naLoja, somarDias } from "@/lib/relatorios/base";
import { inicioOperacional } from "@/lib/relatorios/servidor";
import {
  anotarErroDeEntrega,
  apagarAberturasVelhas,
  appDaConta,
  lerBase,
  removerTokensMortos,
  type AppDaConta,
} from "@/lib/app-da-loja/instalacoes";
import {
  ESPERA_DO_RECIBO_MS,
  LIMITE_DE_ENVIOS_POR_DIA,
  LOTE_DE_RECIBOS,
  PUBLICOS,
  VALIDADE_DO_AVISO_S,
  caminhoDoAviso,
  conferirAgendamento,
  conferirComposicao,
  emLotesDe,
  enviosRestantesNoDia,
  juntarBase,
  lerRecibos,
  lerTickets,
  tokensDoPublico,
  type Publico,
} from "@/lib/app-da-loja/regras-do-push";

const URL_DO_ENVIO = "https://exp.host/--/api/v2/push/send";
const URL_DOS_RECIBOS = "https://exp.host/--/api/v2/push/getReceipts";
export const CANAL_DE_PROMOCOES = "promocoes";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaNotificacao" (
     "id" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "enviadoPelaLojaId" TEXT NOT NULL,
     "quem" TEXT,
     "titulo" TEXT NOT NULL,
     "mensagem" TEXT NOT NULL,
     "caminho" TEXT,
     "produtoNome" TEXT,
     "publico" TEXT NOT NULL,
     "status" TEXT NOT NULL,
     "dia" TEXT NOT NULL,
     "agendadoPara" TIMESTAMP(3),
     "criadoEm" TIMESTAMP(3) NOT NULL,
     "iniciadoEm" TIMESTAMP(3),
     "enviadoEm" TIMESTAMP(3),
     "alvo" INTEGER NOT NULL DEFAULT 0,
     "aceitos" INTEGER NOT NULL DEFAULT 0,
     "errosNoEnvio" INTEGER NOT NULL DEFAULT 0,
     "entregues" INTEGER NOT NULL DEFAULT 0,
     "errosNaEntrega" INTEGER NOT NULL DEFAULT 0,
     "removidos" INTEGER NOT NULL DEFAULT 0,
     "motivo" TEXT,
     CONSTRAINT "AppDaLojaNotificacao_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaNotificacao_lojaId_criadoEm_idx" ON "AppDaLojaNotificacao"("lojaId", "criadoEm")`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaNotificacao_status_idx" ON "AppDaLojaNotificacao"("status", "agendadoPara")`,
  `CREATE TABLE IF NOT EXISTS "AppDaLojaNotificacaoTicket" (
     "ticketId" TEXT NOT NULL,
     "envioId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "pushToken" TEXT NOT NULL,
     "criadoEm" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "AppDaLojaNotificacaoTicket_pkey" PRIMARY KEY ("ticketId")
   )`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaNotificacaoTicket_criadoEm_idx" ON "AppDaLojaNotificacaoTicket"("criadoEm")`,
];

let pronto = false;
export async function garantirEstruturaDasNotificacoes(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura das notificações falhou:", err?.message);
  }
  return pronto;
}

export type Envio = {
  id: string;
  titulo: string;
  mensagem: string;
  caminho: string | null;
  produtoNome: string | null;
  publico: Publico;
  status: "AGENDADO" | "ENVIANDO" | "ENVIADO" | "CANCELADO" | "FALHOU";
  dia: string;
  agendadoPara: Date | null;
  criadoEm: Date;
  enviadoEm: Date | null;
  alvo: number;
  aceitos: number;
  errosNoEnvio: number;
  entregues: number;
  errosNaEntrega: number;
  removidos: number;
  motivo: string | null;
  quem: string | null;
};

const COLUNAS = `"id","titulo","mensagem","caminho","produtoNome","publico","status","dia","agendadoPara","criadoEm","enviadoEm",
  "alvo","aceitos","errosNoEnvio","entregues","errosNaEntrega","removidos","motivo","quem"`;

export async function historicoDeEnvios(chave: string, quantos = 30): Promise<Envio[]> {
  if (!(await garantirEstruturaDasNotificacoes())) return [];
  return prisma.$queryRawUnsafe<Envio[]>(
    `SELECT ${COLUNAS} FROM "AppDaLojaNotificacao" WHERE "lojaId" = $1 ORDER BY COALESCE("agendadoPara","criadoEm") DESC LIMIT $2`,
    chave,
    quantos,
  );
}

/** Quantos envios ainda cabem no dia operacional `dia` desta conta. */
export async function restantesNoDia(chave: string, dia: string): Promise<number> {
  if (!(await garantirEstruturaDasNotificacoes())) return 0;
  const envios = await prisma.$queryRaw<{ dia: string; status: string }[]>`
    SELECT "dia", "status" FROM "AppDaLojaNotificacao" WHERE "lojaId" = ${chave} AND "dia" = ${dia}`;
  return enviosRestantesNoDia(envios, dia);
}

/** Os marcos de tempo da conta: começo de hoje, 7 e 30 dias, e do mês (dia operacional). */
export function marcosDaConta(tz: string | null, agora: Date = new Date()) {
  const hoje = naLoja(agora, tz).dia;
  return {
    agora,
    hoje,
    inicio7: inicioOperacional(somarDias(hoje, -6), tz),
    inicio30: inicioOperacional(somarDias(hoje, -29), tz),
    inicioDoMes: inicioOperacional(`${hoje.slice(0, 7)}-01`, tz),
  };
}

/** Os tokens que o público escolhido alcança agora. */
export async function tokensParaEnviar(app: Pick<AppDaConta, "chave" | "lojaIds" | "tz">, publico: Publico, agora = new Date()): Promise<string[]> {
  const { aberturas, pedidos } = await lerBase(app);
  return tokensDoPublico(juntarBase(aberturas, pedidos), publico, marcosDaConta(app.tz, agora).inicio30);
}

export type PedidoDeEnvio = {
  franchiseeId: string;
  quem: string | null;
  titulo: unknown;
  mensagem: unknown;
  /** "" ou ausente = abre o cardápio; id de produto da loja = abre o produto. */
  produtoId?: unknown;
  /** false = sem link: o toque só abre o app. */
  comLink?: unknown;
  publico: unknown;
  /** ISO; ausente = agora. */
  agendarPara?: unknown;
};

/**
 * Cria o envio (agora ou agendado). Agora: manda na hora e devolve as contas.
 * A vaga do dia é reservada dentro de uma trava por conta — dois cliques
 * rápidos não passam do limite.
 */
export async function criarEnvio(p: PedidoDeEnvio, agora: Date = new Date()): Promise<{ ok: true; envio: Envio } | { ok: false; erro: string; status?: number }> {
  if (!(await garantirEstruturaDasNotificacoes())) return { ok: false, erro: "As notificações não estão disponíveis agora.", status: 503 };
  const app = await appDaConta(p.franchiseeId);
  if (!app?.ativo) return { ok: false, erro: "O aplicativo desta loja não está ativo.", status: 403 };

  const texto = conferirComposicao({ titulo: p.titulo, mensagem: p.mensagem });
  if (!texto.ok) return { ok: false, erro: texto.erro };
  const publico = PUBLICOS.includes(p.publico as Publico) ? (p.publico as Publico) : null;
  if (!publico) return { ok: false, erro: "Escolha para quem vai a notificação." };

  // O link: cardápio da loja que está enviando, ou um produto dela (ativo).
  let caminho: string | null = null;
  let produtoNome: string | null = null;
  if (p.comLink !== false) {
    const produtoId = typeof p.produtoId === "string" ? p.produtoId.trim() : "";
    if (produtoId) {
      const produto = await prisma.menuProduct.findFirst({
        where: { id: produtoId, franchiseeId: p.franchiseeId, active: true },
        select: { id: true, name: true },
      });
      if (!produto) return { ok: false, erro: "Esse produto não está mais no cardápio." };
      produtoNome = produto.name;
      caminho = caminhoDoAviso(app.slug, produto.id);
    } else {
      caminho = caminhoDoAviso(app.slug);
    }
  }

  let agendadoPara: Date | null = null;
  if (p.agendarPara) {
    agendadoPara = new Date(String(p.agendarPara));
    const erro = conferirAgendamento(agendadoPara, agora);
    if (erro) return { ok: false, erro };
  }
  const dia = naLoja(agendadoPara ?? agora, app.tz).dia;

  if (!agendadoPara) {
    const alcance = await tokensParaEnviar(app, publico, agora);
    if (alcance.length === 0) {
      return { ok: false, erro: "Ninguém desse público aceitou receber promoções ainda. Divulgue o app e peça para os clientes tocarem em “Quero receber”." };
    }
  }

  const id = randomUUID();
  const reservou = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`app-da-loja-push:${app.chave}`}))`;
    const doDia = await tx.$queryRaw<{ dia: string; status: string }[]>`
      SELECT "dia", "status" FROM "AppDaLojaNotificacao" WHERE "lojaId" = ${app.chave} AND "dia" = ${dia}`;
    if (enviosRestantesNoDia(doDia, dia) <= 0) return false;
    await tx.$executeRaw`
      INSERT INTO "AppDaLojaNotificacao" ("id","lojaId","enviadoPelaLojaId","quem","titulo","mensagem","caminho","produtoNome",
        "publico","status","dia","agendadoPara","criadoEm","iniciadoEm")
      VALUES (${id}, ${app.chave}, ${p.franchiseeId}, ${p.quem?.slice(0, 80) ?? null}, ${texto.texto.titulo}, ${texto.texto.mensagem},
        ${caminho}, ${produtoNome}, ${publico}, ${agendadoPara ? "AGENDADO" : "ENVIANDO"}, ${dia},
        (${agendadoPara ? agendadoPara.toISOString() : null}::timestamptz AT TIME ZONE 'UTC'),
        (now() AT TIME ZONE 'UTC'), (${agendadoPara ? null : agora.toISOString()}::timestamptz AT TIME ZONE 'UTC'))`;
    return true;
  });
  if (!reservou) {
    return { ok: false, erro: `Limite de ${LIMITE_DE_ENVIOS_POR_DIA} notificações por dia atingido${agendadoPara ? " nesse dia" : " hoje"}. Muita notificação faz o cliente desinstalar o app.` };
  }

  if (!agendadoPara) await executarEnvio(id);
  const [envio] = await prisma.$queryRawUnsafe<Envio[]>(`SELECT ${COLUNAS} FROM "AppDaLojaNotificacao" WHERE "id" = $1`, id);
  return { ok: true, envio };
}

/** Cancela um agendado que ainda não saiu (a vaga do dia volta). */
export async function cancelarAgendado(chave: string, id: string): Promise<boolean> {
  if (!(await garantirEstruturaDasNotificacoes())) return false;
  const n = await prisma.$executeRaw`
    UPDATE "AppDaLojaNotificacao" SET "status" = 'CANCELADO', "motivo" = 'Cancelado pela loja'
    WHERE "id" = ${id} AND "lojaId" = ${chave} AND "status" = 'AGENDADO'`;
  return n > 0;
}

function cabecalhosDoExpo(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (process.env.EXPO_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return h;
}

/**
 * Manda um envio que está ENVIANDO. Lote a lote: um lote recusado conta como
 * erro e o envio segue com os outros. Nunca lança — o status final diz o que houve.
 */
export async function executarEnvio(id: string): Promise<void> {
  const [linha] = await prisma.$queryRaw<{ lojaId: string; enviadoPelaLojaId: string; titulo: string; mensagem: string; caminho: string | null; publico: Publico }[]>`
    SELECT "lojaId","enviadoPelaLojaId","titulo","mensagem","caminho","publico" FROM "AppDaLojaNotificacao" WHERE "id" = ${id} AND "status" = 'ENVIANDO'`;
  if (!linha) return;
  try {
    const app = await appDaConta(linha.enviadoPelaLojaId);
    if (!app?.ativo) {
      await prisma.$executeRaw`UPDATE "AppDaLojaNotificacao" SET "status" = 'CANCELADO', "motivo" = 'O plano do aplicativo foi desligado antes do envio' WHERE "id" = ${id}`;
      return;
    }
    const tokens = await tokensParaEnviar(app, linha.publico);
    let aceitos = 0, erros = 0;
    const mortos: string[] = [];
    const comErro: string[] = [];
    const okTokens: string[] = [];
    for (const lote of emLotesDe(tokens)) {
      const mensagens = lote.map((to) => ({
        to,
        title: linha.titulo,
        body: linha.mensagem,
        data: { tipo: "PROMOCAO", envioId: id, caminho: linha.caminho },
        sound: "default",
        channelId: CANAL_DE_PROMOCOES,
        priority: "default",
        ttl: VALIDADE_DO_AVISO_S,
      }));
      let corpo: unknown = null;
      let httpOk = false;
      try {
        const res = await fetch(URL_DO_ENVIO, { method: "POST", headers: cabecalhosDoExpo(), body: JSON.stringify(mensagens), signal: AbortSignal.timeout(15000) });
        httpOk = res.ok;
        corpo = await res.json().catch(() => null);
        if (!res.ok) console.warn(`[App da loja] Lote do envio ${id} recusado pelo Expo: ${res.status} ${JSON.stringify(corpo).slice(0, 200)}`);
      } catch (err: any) {
        console.warn(`[App da loja] Lote do envio ${id} falhou: ${err?.message}`);
      }
      const r = lerTickets(lote, corpo, httpOk);
      aceitos += r.aceitos.length;
      erros += r.erros;
      mortos.push(...r.mortos);
      okTokens.push(...r.aceitos.map((a) => a.token));
      if (httpOk) {
        const foi = new Set([...r.aceitos.map((a) => a.token), ...r.mortos]);
        comErro.push(...lote.filter((t) => !foi.has(t)));
      }
      if (r.aceitos.length) {
        const valores = r.aceitos.map((a) => Prisma.sql`(${a.ticketId}, ${id}, ${linha.lojaId}, ${a.token}, (now() AT TIME ZONE 'UTC'))`);
        await prisma.$executeRaw`
          INSERT INTO "AppDaLojaNotificacaoTicket" ("ticketId","envioId","lojaId","pushToken","criadoEm")
          VALUES ${Prisma.join(valores)} ON CONFLICT DO NOTHING`;
      }
    }
    await removerTokensMortos(mortos);
    await anotarErroDeEntrega(linha.lojaId, comErro, okTokens);
    await prisma.$executeRaw`
      UPDATE "AppDaLojaNotificacao" SET "status" = ${tokens.length > 0 && aceitos === 0 ? "FALHOU" : "ENVIADO"},
        "enviadoEm" = (now() AT TIME ZONE 'UTC'), "alvo" = ${tokens.length}, "aceitos" = ${aceitos},
        "errosNoEnvio" = ${erros}, "removidos" = "removidos" + ${mortos.length},
        "motivo" = ${tokens.length === 0 ? "Ninguém desse público aceitou promoções" : aceitos === 0 ? "O serviço de notificações recusou o envio" : null}
      WHERE "id" = ${id}`;
  } catch (err: any) {
    console.error(`[App da loja] Envio ${id} falhou: ${err?.message}`);
    await prisma.$executeRaw`UPDATE "AppDaLojaNotificacao" SET "status" = 'FALHOU', "motivo" = 'Erro no servidor durante o envio' WHERE "id" = ${id}`.catch(() => {});
  }
}

/** Cron: solta os agendados que chegaram na hora (poucos por rodada). */
export async function soltarAgendados(): Promise<number> {
  if (!(await garantirEstruturaDasNotificacoes())) return 0;
  // Envio que ficou ENVIANDO por 30 min (servidor reiniciou no meio) não fica pendurado.
  await prisma.$executeRaw`
    UPDATE "AppDaLojaNotificacao" SET "status" = 'FALHOU', "motivo" = 'O envio foi interrompido (servidor reiniciou)'
    WHERE "status" = 'ENVIANDO' AND "iniciadoEm" < (now() AT TIME ZONE 'UTC') - interval '30 minutes'`;
  const prontos = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "AppDaLojaNotificacao" SET "status" = 'ENVIANDO', "iniciadoEm" = (now() AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "AppDaLojaNotificacao"
      WHERE "status" = 'AGENDADO' AND "agendadoPara" <= (now() AT TIME ZONE 'UTC')
      ORDER BY "agendadoPara" LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  for (const p of prontos) await executarEnvio(p.id);
  return prontos.length;
}

/**
 * Cron: pergunta ao Expo o recibo dos tickets de 15 min atrás — entregue ao
 * Google/Apple, ou erro. DeviceNotRegistered = o app saiu do celular: o token
 * sai da base. Ticket sem recibo em 24 h é esquecido (o Expo guarda 24 h).
 */
export async function conferirRecibos(): Promise<{ conferidos: number; removidos: number }> {
  if (!(await garantirEstruturaDasNotificacoes())) return { conferidos: 0, removidos: 0 };
  const limite = new Date(Date.now() - ESPERA_DO_RECIBO_MS).toISOString();
  const tickets = await prisma.$queryRaw<{ ticketId: string; envioId: string; lojaId: string; pushToken: string }[]>`
    SELECT "ticketId","envioId","lojaId","pushToken" FROM "AppDaLojaNotificacaoTicket"
    WHERE "criadoEm" <= (${limite}::timestamptz AT TIME ZONE 'UTC') ORDER BY "criadoEm" LIMIT ${LOTE_DE_RECIBOS}`;
  if (tickets.length === 0) return { conferidos: 0, removidos: 0 };

  let corpo: unknown = null;
  try {
    const res = await fetch(URL_DOS_RECIBOS, {
      method: "POST",
      headers: cabecalhosDoExpo(),
      body: JSON.stringify({ ids: tickets.map((t) => t.ticketId) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { conferidos: 0, removidos: 0 };
    corpo = await res.json().catch(() => null);
  } catch {
    return { conferidos: 0, removidos: 0 };
  }

  let removidos = 0;
  const porEnvio = new Map<string, typeof tickets>();
  for (const t of tickets) porEnvio.set(t.envioId, [...(porEnvio.get(t.envioId) || []), t]);
  const respondidos: string[] = [];
  for (const [envioId, lista] of porEnvio) {
    const r = lerRecibos(lista.map((t) => ({ ticketId: t.ticketId, token: t.pushToken })), corpo);
    respondidos.push(...r.respondidos);
    if (r.respondidos.length === 0) continue;
    await removerTokensMortos(r.mortos);
    removidos += r.mortos.length;
    await prisma.$executeRaw`
      UPDATE "AppDaLojaNotificacao" SET "entregues" = "entregues" + ${r.entregues},
        "errosNaEntrega" = "errosNaEntrega" + ${r.erros}, "removidos" = "removidos" + ${r.mortos.length}
      WHERE "id" = ${envioId}`;
  }
  if (respondidos.length) {
    await prisma.$executeRaw`DELETE FROM "AppDaLojaNotificacaoTicket" WHERE "ticketId" = ANY(${respondidos}::text[])`;
  }
  await prisma.$executeRaw`
    DELETE FROM "AppDaLojaNotificacaoTicket" WHERE "criadoEm" < (now() AT TIME ZONE 'UTC') - interval '24 hours'`;
  return { conferidos: respondidos.length, removidos };
}

/** Cron, uma vez por hora basta: o carimbo diário de abertura só serve ao gráfico de 30 dias. */
let ultimaFaxina = 0;
export async function faxinaDasAberturas(agora = new Date()): Promise<void> {
  if (agora.getTime() - ultimaFaxina < 60 * 60 * 1000) return;
  ultimaFaxina = agora.getTime();
  await apagarAberturasVelhas(somarDias(naLoja(agora, null).dia, -60));
}
