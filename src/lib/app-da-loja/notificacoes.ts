/**
 * A NOTIFICAÇÃO DE PROMOÇÃO que a loja manda para quem tem o app dela
 * (tela "Meu aplicativo" › Notificações). Regras puras em regras-do-push.ts,
 * segmentos.ts, mensagem.ts e resultado-dos-envios.ts.
 *
 * - Só pela API do Expo, em lotes de 100 (como lib/app-da-loja/aparelhos.ts).
 *   NUNCA pelo WhatsApp (memória numero-do-firehub-so-responde).
 * - Só para os aparelhos que ACEITARAM promoção no app (Apple 4.5.4), e
 *   dentro deles o SEGMENTO escolhido (sumidos, fiéis, quem pediu X…).
 * - Sem limite por dia (Douglas, 17/10/2026): a tela avisa a partir do 3º e
 *   o histórico mostra quantos desligaram as promoções depois de cada envio.
 *   Proteções técnicas: confirmação na tela, o mesmo texto duas vezes em
 *   menos de 2 min é barrado (clique duplo), lotes de 100.
 * - Agendado sai pelo cron /api/cron/app-da-loja-notificacoes (a cada
 *   minuto), que também: pergunta ao Expo os recibos (entregue/erro, 15 min
 *   depois), tira da base o aparelho de onde o app saiu (DeviceNotRegistered)
 *   e APURA cada envio das últimas 72 h — abertos (toques), pedidos e
 *   faturamento atribuídos (24 h) e quantos desligaram (48 h).
 *
 * Tabelas em SQL cru, criadas no primeiro uso:
 *   AppDaLojaNotificacao         um envio (texto, segmento, contas, resultado)
 *   AppDaLojaNotificacaoTicket   os tickets do Expo à espera do recibo
 *   AppDaLojaNotificacaoDestino  quem recebeu (token e "i:<instalação>"), 7 dias
 *   AppDaLojaNotificacaoToque    quem tocou (o app avisa)
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { naLoja, somarDias } from "@/lib/relatorios/base";
import { inicioOperacional } from "@/lib/relatorios/servidor";
import { entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import {
  anotarErroDeEntrega,
  apagarAberturasVelhas,
  appDaConta,
  garantirEstruturaDasInstalacoes,
  removerTokensMortos,
  type AppDaConta,
} from "@/lib/app-da-loja/instalacoes";
import { carregarPerfis, pedidosDoAppComChaves } from "@/lib/app-da-loja/perfis";
import { SEGMENTOS, segmentoValido, tokensDoSegmento, type Segmento } from "@/lib/app-da-loja/segmentos";
import { envioDuplicado } from "@/lib/app-da-loja/mensagem";
import { atribuirPedidos, desligaramDepois, JANELA_DE_ATRIBUICAO_MS } from "@/lib/app-da-loja/resultado-dos-envios";
import {
  ESPERA_DO_RECIBO_MS,
  LOTE_DE_RECIBOS,
  VALIDADE_DO_AVISO_S,
  caminhoDoAviso,
  conferirAgendamento,
  conferirComposicao,
  emLotesDe,
  enviosNoDia,
  lerRecibos,
  lerTickets,
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
     "segmento" TEXT NOT NULL,
     "segmentoValor" TEXT,
     "segmentoRotulo" TEXT,
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
     "abertos" INTEGER NOT NULL DEFAULT 0,
     "pedidos" INTEGER NOT NULL DEFAULT 0,
     "faturamento" DOUBLE PRECISION NOT NULL DEFAULT 0,
     "desligaram" INTEGER NOT NULL DEFAULT 0,
     "apuradoEm" TIMESTAMP(3),
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
  `CREATE TABLE IF NOT EXISTS "AppDaLojaNotificacaoDestino" (
     "envioId" TEXT NOT NULL,
     "chave" TEXT NOT NULL,
     "criadoEm" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "AppDaLojaNotificacaoDestino_pkey" PRIMARY KEY ("envioId", "chave")
   )`,
  `CREATE TABLE IF NOT EXISTS "AppDaLojaNotificacaoToque" (
     "envioId" TEXT NOT NULL,
     "instalacaoId" TEXT NOT NULL,
     "em" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "AppDaLojaNotificacaoToque_pkey" PRIMARY KEY ("envioId", "instalacaoId")
   )`,
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
  segmento: string;
  segmentoValor: string | null;
  segmentoRotulo: string | null;
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
  abertos: number;
  pedidos: number;
  faturamento: number;
  desligaram: number;
  apuradoEm: Date | null;
  motivo: string | null;
  quem: string | null;
};

const COLUNAS = `"id","titulo","mensagem","caminho","produtoNome","segmento","segmentoValor","segmentoRotulo","status","dia","agendadoPara","criadoEm","enviadoEm",
  "alvo","aceitos","errosNoEnvio","entregues","errosNaEntrega","removidos","abertos","pedidos","faturamento","desligaram","apuradoEm","motivo","quem"`;

export async function historicoDeEnvios(chave: string, quantos = 40): Promise<Envio[]> {
  if (!(await garantirEstruturaDasNotificacoes())) return [];
  return prisma.$queryRawUnsafe<Envio[]>(
    `SELECT ${COLUNAS} FROM "AppDaLojaNotificacao" WHERE "lojaId" = $1 ORDER BY COALESCE("enviadoEm","agendadoPara","criadoEm") DESC LIMIT $2`,
    chave,
    quantos,
  );
}

/** Quantos envios saem (ou saíram) no dia operacional `dia` desta conta. */
export async function quantosNoDia(chave: string, dia: string): Promise<number> {
  if (!(await garantirEstruturaDasNotificacoes())) return 0;
  const envios = await prisma.$queryRaw<{ dia: string; status: string }[]>`
    SELECT "dia", "status" FROM "AppDaLojaNotificacao" WHERE "lojaId" = ${chave} AND "dia" = ${dia}`;
  return enviosNoDia(envios, dia);
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

/** Os tokens (e o mapa token → instalação) que o segmento alcança agora. */
export async function destinosDoSegmento(app: Pick<AppDaConta, "chave" | "lojaIds" | "tz">, seg: Segmento, agora = new Date()) {
  const perfis = await carregarPerfis(app, agora);
  const mes = naLoja(agora, app.tz).dia.slice(5, 7);
  const tokens = tokensDoSegmento(perfis.aparelhos, seg, perfis.clientes, { agora, mesDaLoja: mes });
  return { tokens, instalacaoDoToken: perfis.instalacaoDoToken };
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
  segmento: unknown;
  /** ISO; ausente = agora. */
  agendarPara?: unknown;
};

function rotuloDoSegmento(seg: Segmento, nomeDoValor: string | null): string {
  const def = SEGMENTOS.find((s) => s.tipo === seg.tipo)!;
  if (seg.tipo === "produto") return `Pediram ${nomeDoValor || "o produto"}`;
  if (seg.tipo === "categoria") return `Pediram de ${seg.valor}`;
  return def.rotulo;
}

/**
 * Cria o envio (agora ou agendado). Agora: manda na hora e devolve as contas.
 * Dentro de uma trava por conta: dois cliques no mesmo texto em menos de
 * 2 min viram um envio só.
 */
export async function criarEnvio(p: PedidoDeEnvio, agora: Date = new Date()): Promise<{ ok: true; envio: Envio } | { ok: false; erro: string; status?: number }> {
  if (!(await garantirEstruturaDasNotificacoes())) return { ok: false, erro: "As notificações não estão disponíveis agora.", status: 503 };
  const app = await appDaConta(p.franchiseeId);
  if (!app?.ativo) return { ok: false, erro: "O aplicativo desta loja não está ativo.", status: 403 };

  const texto = conferirComposicao({ titulo: p.titulo, mensagem: p.mensagem });
  if (!texto.ok) return { ok: false, erro: texto.erro };
  const seg = segmentoValido(p.segmento);
  if (!seg) return { ok: false, erro: "Escolha para quem vai a notificação." };

  let nomeDoValor: string | null = null;
  if (seg.tipo === "produto") {
    const prod = await prisma.menuProduct.findFirst({ where: { id: String(seg.valor), franchiseeId: { in: app.lojaIds } }, select: { name: true } });
    if (!prod) return { ok: false, erro: "Esse produto não foi achado no cardápio." };
    nomeDoValor = prod.name;
  }

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
    const { tokens } = await destinosDoSegmento(app, seg, agora);
    if (tokens.length === 0) {
      return { ok: false, erro: "Ninguém desse grupo pode receber agora (é preciso ter aceitado as promoções no app). Escolha outro grupo." };
    }
  }

  const id = randomUUID();
  const criou = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`app-da-loja-push:${app.chave}`}))`;
    const recentes = await tx.$queryRaw<{ titulo: string; mensagem: string; criadoEm: Date }[]>`
      SELECT "titulo", "mensagem", "criadoEm" FROM "AppDaLojaNotificacao"
      WHERE "lojaId" = ${app.chave} AND "status" <> 'CANCELADO' AND "criadoEm" > (now() AT TIME ZONE 'UTC') - interval '5 minutes'`;
    if (envioDuplicado(texto.texto, recentes.map((r) => ({ ...r, criadoEm: new Date(r.criadoEm) })), agora)) return false;
    await tx.$executeRaw`
      INSERT INTO "AppDaLojaNotificacao" ("id","lojaId","enviadoPelaLojaId","quem","titulo","mensagem","caminho","produtoNome",
        "segmento","segmentoValor","segmentoRotulo","status","dia","agendadoPara","criadoEm","iniciadoEm")
      VALUES (${id}, ${app.chave}, ${p.franchiseeId}, ${p.quem?.slice(0, 80) ?? null}, ${texto.texto.titulo}, ${texto.texto.mensagem},
        ${caminho}, ${produtoNome}, ${seg.tipo}, ${seg.valor ?? null}, ${rotuloDoSegmento(seg, nomeDoValor)},
        ${agendadoPara ? "AGENDADO" : "ENVIANDO"}, ${dia},
        (${agendadoPara ? agendadoPara.toISOString() : null}::timestamptz AT TIME ZONE 'UTC'),
        (${agora.toISOString()}::timestamptz AT TIME ZONE 'UTC'), (${agendadoPara ? null : agora.toISOString()}::timestamptz AT TIME ZONE 'UTC'))`;
    return true;
  });
  if (!criou) return { ok: false, erro: "Essa mesma notificação acabou de ser enviada. Se quer mandar de novo, espere 2 minutos.", status: 409 };

  if (!agendadoPara) await executarEnvio(id);
  const [envio] = await prisma.$queryRawUnsafe<Envio[]>(`SELECT ${COLUNAS} FROM "AppDaLojaNotificacao" WHERE "id" = $1`, id);
  return { ok: true, envio };
}

/** Cancela um agendado que ainda não saiu. */
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
  const [linha] = await prisma.$queryRaw<{ lojaId: string; enviadoPelaLojaId: string; titulo: string; mensagem: string; caminho: string | null; segmento: string; segmentoValor: string | null }[]>`
    SELECT "lojaId","enviadoPelaLojaId","titulo","mensagem","caminho","segmento","segmentoValor" FROM "AppDaLojaNotificacao" WHERE "id" = ${id} AND "status" = 'ENVIANDO'`;
  if (!linha) return;
  try {
    const app = await appDaConta(linha.enviadoPelaLojaId);
    if (!app?.ativo) {
      await prisma.$executeRaw`UPDATE "AppDaLojaNotificacao" SET "status" = 'CANCELADO', "motivo" = 'O plano do aplicativo foi desligado antes do envio' WHERE "id" = ${id}`;
      return;
    }
    const seg = segmentoValido({ tipo: linha.segmento, valor: linha.segmentoValor }) || { tipo: "todos" as const };
    const { tokens, instalacaoDoToken } = await destinosDoSegmento(app, seg);
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
        // Quem recebeu, pelas duas chaves do aparelho — para atribuir pedidos e desligamentos.
        const chaves = r.aceitos.flatMap((a) => {
          const inst = instalacaoDoToken.get(a.token);
          return inst ? [a.token, `i:${inst}`] : [a.token];
        });
        const destinos = chaves.map((c) => Prisma.sql`(${id}, ${c}, (now() AT TIME ZONE 'UTC'))`);
        await prisma.$executeRaw`
          INSERT INTO "AppDaLojaNotificacaoDestino" ("envioId","chave","criadoEm") VALUES ${Prisma.join(destinos)} ON CONFLICT DO NOTHING`;
      }
    }
    await removerTokensMortos(mortos);
    await anotarErroDeEntrega(linha.lojaId, comErro, okTokens);
    await prisma.$executeRaw`
      UPDATE "AppDaLojaNotificacao" SET "status" = ${tokens.length > 0 && aceitos === 0 ? "FALHOU" : "ENVIADO"},
        "enviadoEm" = (now() AT TIME ZONE 'UTC'), "alvo" = ${tokens.length}, "aceitos" = ${aceitos},
        "errosNoEnvio" = ${erros}, "removidos" = "removidos" + ${mortos.length},
        "motivo" = ${tokens.length === 0 ? "Ninguém desse grupo podia receber na hora do envio" : aceitos === 0 ? "O serviço de notificações recusou o envio" : null}
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

/** O app avisa que o cliente tocou na notificação. Uma vez por instalação e envio. */
export async function registrarToque(envioId: string, instalacaoId: string): Promise<boolean> {
  if (!(await garantirEstruturaDasNotificacoes())) return false;
  const existe = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "AppDaLojaNotificacao" WHERE "id" = ${envioId} AND "enviadoEm" > (now() AT TIME ZONE 'UTC') - interval '7 days'`;
  if (!existe.length) return false;
  await prisma.$executeRaw`
    INSERT INTO "AppDaLojaNotificacaoToque" ("envioId","instalacaoId","em") VALUES (${envioId}, ${instalacaoId}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT DO NOTHING`;
  return true;
}

/**
 * Cron: apura os envios das últimas 72 h de cada conta — toques, pedidos e
 * faturamento atribuídos (24 h, regra em resultado-dos-envios.ts) e quantos
 * desligaram as promoções ou desinstalaram (48 h). Grava no envio; a tela só
 * lê. Depois de 72 h o envio fica com o último resultado e os destinos saem.
 */
export async function apurarEnvios(): Promise<number> {
  if (!(await garantirEstruturaDasNotificacoes()) || !(await garantirEstruturaDasInstalacoes())) return 0;
  const recentes = await prisma.$queryRaw<{ id: string; lojaId: string; enviadoPelaLojaId: string; enviadoEm: Date }[]>`
    SELECT "id","lojaId","enviadoPelaLojaId","enviadoEm" FROM "AppDaLojaNotificacao"
    WHERE "status" = 'ENVIADO' AND "enviadoEm" > (now() AT TIME ZONE 'UTC') - interval '72 hours'
      AND ("apuradoEm" IS NULL OR "apuradoEm" < (now() AT TIME ZONE 'UTC') - interval '5 minutes')
    ORDER BY "enviadoEm"`;
  const porConta = new Map<string, typeof recentes>();
  for (const e of recentes) porConta.set(e.lojaId, [...(porConta.get(e.lojaId) || []), e]);
  let apurados = 0;
  for (const [chave, envios] of porConta) {
    try {
      const app = await appDaConta(envios[0].enviadoPelaLojaId);
      if (!app) continue;
      const ids = envios.map((e) => e.id);
      const destinosLinhas = await prisma.$queryRaw<{ envioId: string; chave: string }[]>`
        SELECT "envioId","chave" FROM "AppDaLojaNotificacaoDestino" WHERE "envioId" = ANY(${ids}::text[])`;
      const destinos = new Map<string, Set<string>>(ids.map((i) => [i, new Set<string>()]));
      for (const d of destinosLinhas) destinos.get(d.envioId)!.add(d.chave);
      const maisAntigo = new Date(Math.min(...envios.map((e) => new Date(e.enviadoEm).getTime())));
      const pedidosApp = await pedidosDoAppComChaves(app, maisAntigo);
      const vendas = new Map(
        (pedidosApp.length
          ? await prisma.customerOrder.findMany({ where: { id: { in: pedidosApp.map((p) => p.id) } }, select: { id: true, status: true, totalAmount: true, reposicao: true } })
          : []
        ).map((o) => [o.id, o]),
      );
      const paraAtribuir = pedidosApp
        .filter((p) => vendas.has(p.id) && entraNaVenda(vendas.get(p.id) as any))
        .map((p) => ({ id: p.id, em: p.em, valor: Number(vendas.get(p.id)!.totalAmount) || 0, chaves: p.chaves }));
      const atribuidos = atribuirPedidos(envios.map((e) => ({ id: e.id, enviadoEm: new Date(e.enviadoEm), destinos: destinos.get(e.id)! })), paraAtribuir, JANELA_DE_ATRIBUICAO_MS);
      const eventos = await prisma.$queryRaw<{ instalacaoId: string; em: Date }[]>`
        SELECT "instalacaoId", GREATEST("promocoesDesligadasEm", "removidoEm") AS em FROM "AppDaLojaAparelho"
        WHERE "lojaId" = ${chave} AND GREATEST("promocoesDesligadasEm", "removidoEm") >= (${maisAntigo.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      const evs = eventos.map((e) => ({ chave: `i:${e.instalacaoId}`, em: new Date(e.em) }));
      const toques = await prisma.$queryRaw<{ envioId: string; n: number }[]>`
        SELECT "envioId", COUNT(*)::int AS n FROM "AppDaLojaNotificacaoToque" WHERE "envioId" = ANY(${ids}::text[]) GROUP BY "envioId"`;
      const nToques = new Map(toques.map((t) => [t.envioId, Number(t.n)]));
      for (const e of envios) {
        const a = atribuidos.get(e.id)!;
        const desligaram = desligaramDepois(new Date(e.enviadoEm), destinos.get(e.id)!, evs);
        await prisma.$executeRaw`
          UPDATE "AppDaLojaNotificacao" SET "abertos" = ${nToques.get(e.id) || 0}, "pedidos" = ${a.pedidos},
            "faturamento" = ${a.faturamento}, "desligaram" = ${desligaram}, "apuradoEm" = (now() AT TIME ZONE 'UTC')
          WHERE "id" = ${e.id}`;
        apurados++;
      }
    } catch (err: any) {
      console.warn(`[App da loja] Apuração dos envios de ${chave} falhou: ${err?.message}`);
    }
  }
  // Destino só serve à apuração (72 h) — sai depois de 7 dias.
  await prisma.$executeRaw`DELETE FROM "AppDaLojaNotificacaoDestino" WHERE "criadoEm" < (now() AT TIME ZONE 'UTC') - interval '7 days'`;
  return apurados;
}

/** Cron, uma vez por hora basta: o carimbo diário de abertura só serve ao gráfico. */
let ultimaFaxina = 0;
export async function faxinaDasAberturas(agora = new Date()): Promise<void> {
  if (agora.getTime() - ultimaFaxina < 60 * 60 * 1000) return;
  ultimaFaxina = agora.getTime();
  await apagarAberturasVelhas(somarDias(naLoja(agora, null).dia, -100));
}
