/**
 * Os celulares com o app próprio da loja — a BASE da tela "Meu aplicativo"
 * (app/store/meu-aplicativo). Regras puras em lib/app-da-loja/regras-do-push.ts.
 *
 * ── O app é da MARCA ────────────────────────────────────────────────────────
 *
 * Um app por marca (apps/loja/marcas/<id>), e o app de quem tem filial abre
 * /lojas/<slug>, a página do GRUPO. Por isso o aparelho fica guardado na loja
 * PRINCIPAL do grupo (`chave` = principalDoGrupo): qualquer loja da conta vê a
 * mesma base, e o pedido feito em qualquer unidade conta como pedido do app.
 * Loja sem filial: a chave é ela mesma.
 *
 * ── As tabelas não estão no schema.prisma de propósito ──────────────────────
 *
 * Como PedidoAparelho: SQL cru, criadas na primeira chamada. Faltando, o app
 * segue funcionando — só a tela fica sem números.
 *
 *   AppDaLojaAparelho  uma linha por instalação (id sorteado no celular), com o
 *                      token de aviso quando o cliente deixou, a resposta da
 *                      pergunta da promoção e o último acesso.
 *   AppDaLojaAbertura  um carimbo por aparelho por DIA operacional — o gráfico
 *                      "aparelhos que abriram o app".
 *   AppDaLojaPedido    o pedido feito DENTRO do app, mesmo sem token de aviso
 *                      (PedidoAparelho só tem quem deixou avisar).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { estadoDoApp, type EstadoDoApp } from "@/lib/app-da-loja/plano";
import { garantirTabelaDoAppDaLoja } from "@/lib/app-da-loja/aparelhos";
import { naLoja } from "@/lib/relatorios/base";
import { principalDoGrupo } from "@/lib/vitrine-do-grupo";
import type { AparelhoDaAbertura, AparelhoDePedido } from "@/lib/app-da-loja/regras-do-push";

/** Grava e compara hora em UTC (a coluna é timestamp sem fuso; ver lib/cashback-no-banco.ts). */
const emUtc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaAparelho" (
     "lojaId" TEXT NOT NULL,
     "instalacaoId" TEXT NOT NULL,
     "pushToken" TEXT,
     "plataforma" TEXT,
     "versaoDoApp" TEXT,
     "app" TEXT,
     "promocoes" BOOLEAN NOT NULL DEFAULT false,
     "promocoesRespondidoEm" TIMESTAMP(3),
     "promocoesDesligadasEm" TIMESTAMP(3),
     "primeiroAcesso" TIMESTAMP(3) NOT NULL,
     "ultimoAcesso" TIMESTAMP(3) NOT NULL,
     "aberturas" INTEGER NOT NULL DEFAULT 0,
     "errosDeEntrega" INTEGER NOT NULL DEFAULT 0,
     "removidoEm" TIMESTAMP(3),
     CONSTRAINT "AppDaLojaAparelho_pkey" PRIMARY KEY ("lojaId", "instalacaoId")
   )`,
  // 18/10/2026: o termo de uso da 1ª abertura (apps/loja/src/lib/termo.ts).
  // A tabela já existe em produção — coluna nova entra por ALTER.
  `ALTER TABLE "AppDaLojaAparelho" ADD COLUMN IF NOT EXISTS "termoVersao" TEXT`,
  `ALTER TABLE "AppDaLojaAparelho" ADD COLUMN IF NOT EXISTS "termoAceitoEm" TIMESTAMP(3)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppDaLojaAparelho_lojaId_pushToken_key"
     ON "AppDaLojaAparelho"("lojaId", "pushToken") WHERE "pushToken" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaAparelho_pushToken_idx" ON "AppDaLojaAparelho"("pushToken")`,
  `CREATE TABLE IF NOT EXISTS "AppDaLojaAbertura" (
     "lojaId" TEXT NOT NULL,
     "dia" TEXT NOT NULL,
     "instalacaoId" TEXT NOT NULL,
     CONSTRAINT "AppDaLojaAbertura_pkey" PRIMARY KEY ("lojaId", "dia", "instalacaoId")
   )`,
  `CREATE TABLE IF NOT EXISTS "AppDaLojaPedido" (
     "pedidoId" TEXT NOT NULL,
     "lojaId" TEXT NOT NULL,
     "instalacaoId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "AppDaLojaPedido_pkey" PRIMARY KEY ("pedidoId")
   )`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaPedido_lojaId_createdAt_idx" ON "AppDaLojaPedido"("lojaId", "createdAt")`,
];

let pronto = false;
export async function garantirEstruturaDasInstalacoes(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura das instalações falhou:", err?.message);
  }
  return pronto;
}

/** O id que o app sorteia na instalação (apps/loja/src/lib/presenca.ts). */
export function instalacaoValida(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

// ── DE QUEM É O APP ─────────────────────────────────────────────────────────

/** O slug da página que o app abre: "/lojas/hakim-contato" ou "/loja/x". */
export function slugDaPagina(pagina: unknown): string | null {
  const m = /^\/lojas?\/([a-z0-9][a-z0-9-]{0,80})(?:[/?#]|$)/i.exec(String(pagina || "").trim());
  return m ? m[1].toLowerCase() : null;
}

type LojaDoApp = { chave: string; tz: string | null };
const cacheDoSlug = new Map<string, { valor: LojaDoApp | null; ate: number }>();

/** A loja (principal do grupo) dona do app que abre esta página. 10 min de cache: o app avisa muito. */
export async function lojaDoAppPelaPagina(pagina: unknown): Promise<LojaDoApp | null> {
  const slug = slugDaPagina(pagina);
  if (!slug) return null;
  const c = cacheDoSlug.get(slug);
  if (c && c.ate > Date.now()) return c.valor;
  const loja = await prisma.user.findUnique({
    where: { slug },
    select: { id: true, accountGroupId: true, role: true, storeTimezone: true },
  });
  let valor: LojaDoApp | null = null;
  if (loja && (!loja.role || loja.role === "FRANCHISEE")) {
    const chave = principalDoGrupo(loja);
    let tz = loja.storeTimezone ?? null;
    if (chave !== loja.id) {
      const principal = await prisma.user.findUnique({ where: { id: chave }, select: { storeTimezone: true } });
      tz = principal?.storeTimezone ?? tz;
    }
    valor = { chave, tz };
  }
  if (cacheDoSlug.size > 500) cacheDoSlug.clear();
  cacheDoSlug.set(slug, { valor, ate: Date.now() + 10 * 60 * 1000 });
  return valor;
}

export type AppDaConta = {
  /** Plano ligado nesta loja ou na principal do grupo. */
  ativo: boolean;
  plano: EstadoDoApp;
  /** Onde a base do app mora (a principal do grupo). */
  chave: string;
  /** Todas as lojas do grupo (pedidos de qualquer unidade contam). */
  lojaIds: string[];
  slug: string | null;
  tz: string | null;
  nome: string;
};

/**
 * O app da conta desta loja. O plano pode ter sido ligado na unidade ou na
 * principal (o admin liga em quem a loja pediu): vale o que estiver ligado.
 */
export async function appDaConta(franchiseeId: string): Promise<AppDaConta | null> {
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { id: true, accountGroupId: true, slug: true, storeTimezone: true, storeName: true, name: true },
  });
  if (!loja) return null;
  const chave = principalDoGrupo(loja);
  const [daLoja, doGrupo, irmas] = await Promise.all([
    estadoDoApp(loja.id),
    chave !== loja.id ? estadoDoApp(chave) : Promise.resolve(null),
    prisma.user.findMany({ where: { OR: [{ id: chave }, { accountGroupId: chave }] }, select: { id: true } }),
  ]);
  const plano = daLoja.ativo || !doGrupo ? daLoja : doGrupo;
  return {
    ativo: plano.ativo,
    plano,
    chave,
    lojaIds: [...new Set([loja.id, chave, ...irmas.map((i) => i.id)])],
    slug: loja.slug,
    tz: loja.storeTimezone ?? null,
    nome: (loja.storeName || loja.name || "Sua loja").trim(),
  };
}

/** Só a pergunta "o plano está ligado?" — para o menu, que roda em toda tela. Nunca lança. */
export async function appLigadoNaConta(franchiseeId: string | null | undefined): Promise<boolean> {
  if (!franchiseeId) return false;
  try {
    if ((await estadoDoApp(franchiseeId)).ativo) return true;
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { id: true, accountGroupId: true } });
    if (!loja?.accountGroupId) return false;
    return (await estadoDoApp(loja.accountGroupId)).ativo;
  } catch {
    return false;
  }
}

// ── ABERTURA ────────────────────────────────────────────────────────────────

export type Abertura = {
  chave: string;
  tz: string | null;
  instalacaoId: string;
  pushToken: string | null;
  plataforma?: string | null;
  versaoDoApp?: string | null;
  app?: string | null;
  /**
   * true = recebe promoção (aceitou o termo);
   * false = tocou "Agora não" na tela antiga de promoções;
   * null = ainda não aceitou o termo (não muda nada).
   */
  promocoes: boolean | null;
  /** A versão do termo de uso aceita neste celular (null = nenhuma). */
  termoVersao?: string | null;
  /** A batida de 4 em 4 min não conta como abertura nova. */
  batida: boolean;
};

/**
 * Grava a abertura (ou a batida de quem segue com o app aberto). O token que
 * já era de OUTRA instalação da mesma loja (reinstalou o app) passa para esta:
 * um token, um aparelho.
 */
export async function registrarAbertura(a: Abertura, agora: Date = new Date()): Promise<boolean> {
  if (!(await garantirEstruturaDasInstalacoes())) return false;
  const plataforma = String(a.plataforma || "").slice(0, 20) || null;
  const versao = String(a.versaoDoApp || "").slice(0, 40) || null;
  const app = String(a.app || "").slice(0, 120) || null;
  const token = a.pushToken ? a.pushToken.trim() : null;
  const respondeu = a.promocoes !== null;
  const promocoes = a.promocoes === true;
  const mais = a.batida ? 0 : 1;
  const termo = a.termoVersao && /^[0-9A-Za-z._-]{1,20}$/.test(a.termoVersao) ? a.termoVersao : null;
  const dia = naLoja(agora, a.tz).dia;

  await prisma.$transaction(async (tx) => {
    let primeiroDoOutro: Date | null = null;
    if (token) {
      const outros = await tx.$queryRaw<{ primeiroAcesso: Date }[]>`
        DELETE FROM "AppDaLojaAparelho"
        WHERE "lojaId" = ${a.chave} AND "pushToken" = ${token} AND "instalacaoId" <> ${a.instalacaoId}
        RETURNING "primeiroAcesso"`;
      for (const o of outros) if (!primeiroDoOutro || o.primeiroAcesso < primeiroDoOutro) primeiroDoOutro = o.primeiroAcesso;
    }
    const primeiro = primeiroDoOutro && primeiroDoOutro < agora ? primeiroDoOutro : agora;
    await tx.$executeRaw`
      INSERT INTO "AppDaLojaAparelho" ("lojaId", "instalacaoId", "pushToken", "plataforma", "versaoDoApp", "app",
        "promocoes", "promocoesRespondidoEm", "primeiroAcesso", "ultimoAcesso", "aberturas", "termoVersao", "termoAceitoEm")
      VALUES (${a.chave}, ${a.instalacaoId}, ${token}, ${plataforma}, ${versao}, ${app},
        ${promocoes}, ${respondeu ? emUtc(agora) : null}, ${emUtc(primeiro)}, ${emUtc(agora)}, 1,
        ${termo}, ${termo ? emUtc(agora) : null})
      ON CONFLICT ("lojaId", "instalacaoId") DO UPDATE SET
        "pushToken" = COALESCE(EXCLUDED."pushToken", "AppDaLojaAparelho"."pushToken"),
        "plataforma" = COALESCE(EXCLUDED."plataforma", "AppDaLojaAparelho"."plataforma"),
        "versaoDoApp" = COALESCE(EXCLUDED."versaoDoApp", "AppDaLojaAparelho"."versaoDoApp"),
        "app" = COALESCE(EXCLUDED."app", "AppDaLojaAparelho"."app"),
        "promocoes" = CASE WHEN ${respondeu}::boolean THEN EXCLUDED."promocoes" ELSE "AppDaLojaAparelho"."promocoes" END,
        "promocoesRespondidoEm" = CASE WHEN ${respondeu}::boolean AND EXCLUDED."promocoes" <> "AppDaLojaAparelho"."promocoes"
          THEN EXCLUDED."promocoesRespondidoEm" ELSE COALESCE("AppDaLojaAparelho"."promocoesRespondidoEm", EXCLUDED."promocoesRespondidoEm") END,
        -- Desligou as promoções agora (estava ligado): o histórico mostra o efeito de cada envio.
        "promocoesDesligadasEm" = CASE WHEN ${respondeu}::boolean AND EXCLUDED."promocoes" = false AND "AppDaLojaAparelho"."promocoes" = true
          THEN EXCLUDED."ultimoAcesso" ELSE "AppDaLojaAparelho"."promocoesDesligadasEm" END,
        "primeiroAcesso" = LEAST("AppDaLojaAparelho"."primeiroAcesso", EXCLUDED."primeiroAcesso"),
        "ultimoAcesso" = EXCLUDED."ultimoAcesso",
        "aberturas" = "AppDaLojaAparelho"."aberturas" + ${mais},
        "termoAceitoEm" = CASE WHEN ${termo}::text IS NOT NULL AND ${termo}::text IS DISTINCT FROM "AppDaLojaAparelho"."termoVersao"
          THEN EXCLUDED."ultimoAcesso" ELSE "AppDaLojaAparelho"."termoAceitoEm" END,
        "termoVersao" = COALESCE(${termo}::text, "AppDaLojaAparelho"."termoVersao"),
        "removidoEm" = NULL`;
    await tx.$executeRaw`
      INSERT INTO "AppDaLojaAbertura" ("lojaId", "dia", "instalacaoId") VALUES (${a.chave}, ${dia}, ${a.instalacaoId})
      ON CONFLICT DO NOTHING`;
  });
  return true;
}

/** O pedido feito dentro do app (com ou sem token de aviso). */
export async function registrarPedidoDoApp(p: { pedidoId: string; lojaId: string; instalacaoId: string | null }): Promise<void> {
  if (!(await garantirEstruturaDasInstalacoes())) return;
  await prisma.$executeRaw`
    INSERT INTO "AppDaLojaPedido" ("pedidoId", "lojaId", "instalacaoId", "createdAt")
    VALUES (${p.pedidoId}, ${p.lojaId}, ${p.instalacaoId}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pedidoId") DO NOTHING`;
}

/**
 * O Expo disse que o app saiu destes celulares (DeviceNotRegistered): o token
 * sai de PedidoAparelho e a instalação sai da base (volta sozinha se o app
 * abrir de novo). Nunca lança.
 */
export async function removerTokensMortos(tokens: string[]): Promise<void> {
  const lista = [...new Set(tokens.filter(Boolean))];
  if (lista.length === 0) return;
  try {
    if (await garantirTabelaDoAppDaLoja()) {
      await prisma.$executeRaw`DELETE FROM "PedidoAparelho" WHERE "pushToken" = ANY(${lista}::text[])`;
    }
    if (await garantirEstruturaDasInstalacoes()) {
      await prisma.$executeRaw`
        UPDATE "AppDaLojaAparelho" SET "pushToken" = NULL, "removidoEm" = (now() AT TIME ZONE 'UTC')
        WHERE "pushToken" = ANY(${lista}::text[])`;
    }
  } catch (err: any) {
    console.warn(`[App da loja] Não consegui tirar ${lista.length} token(s) da base: ${err?.message}`);
  }
}

/** Erro de entrega que não é "app desinstalado": conta, para a tela de suporte enxergar. Nunca lança. */
export async function anotarErroDeEntrega(chave: string, tokens: string[], ok: string[]): Promise<void> {
  try {
    if (tokens.length) {
      await prisma.$executeRaw`UPDATE "AppDaLojaAparelho" SET "errosDeEntrega" = "errosDeEntrega" + 1
        WHERE "lojaId" = ${chave} AND "pushToken" = ANY(${tokens}::text[])`;
    }
    if (ok.length) {
      await prisma.$executeRaw`UPDATE "AppDaLojaAparelho" SET "errosDeEntrega" = 0
        WHERE "lojaId" = ${chave} AND "errosDeEntrega" > 0 AND "pushToken" = ANY(${ok}::text[])`;
    }
  } catch { /* só estatística */ }
}

// ── LEITURA DA BASE ─────────────────────────────────────────────────────────

/** As duas fontes da base, cruas — quem junta é `juntarBase` (regras puras). */
export async function lerBase(app: Pick<AppDaConta, "chave" | "lojaIds">): Promise<{ aberturas: AparelhoDaAbertura[]; pedidos: AparelhoDePedido[] }> {
  // (Os perfis para segmentar e atribuir pedidos moram em lib/app-da-loja/perfis.ts.)
  const [okA, okP] = await Promise.all([garantirEstruturaDasInstalacoes(), garantirTabelaDoAppDaLoja()]);
  const aberturas = okA
    ? await prisma.$queryRaw<AparelhoDaAbertura[]>`
        SELECT "instalacaoId", "pushToken", "primeiroAcesso", "ultimoAcesso", "promocoes", "promocoesRespondidoEm", "removidoEm"
        FROM "AppDaLojaAparelho" WHERE "lojaId" = ${app.chave}`
    : [];
  const pedidos = okP
    ? await prisma.$queryRaw<AparelhoDePedido[]>`
        SELECT "pushToken", MIN("createdAt") AS "primeiroPedido", MAX("createdAt") AS "ultimoPedido"
        FROM "PedidoAparelho" WHERE "lojaId" = ANY(${app.lojaIds}::text[])
        GROUP BY "pushToken"`
    : [];
  return { aberturas, pedidos };
}

/** Os ids dos pedidos feitos pelo app nas lojas da conta, a partir de um instante. */
export async function pedidosDoApp(lojaIds: string[], desde: Date): Promise<string[]> {
  const [okA, okP] = await Promise.all([garantirEstruturaDasInstalacoes(), garantirTabelaDoAppDaLoja()]);
  const partes: Prisma.Sql[] = [];
  if (okP) partes.push(Prisma.sql`SELECT "pedidoId" FROM "PedidoAparelho" WHERE "lojaId" = ANY(${lojaIds}::text[]) AND "createdAt" >= ${emUtc(desde)}`);
  if (okA) partes.push(Prisma.sql`SELECT "pedidoId" FROM "AppDaLojaPedido" WHERE "lojaId" = ANY(${lojaIds}::text[]) AND "createdAt" >= ${emUtc(desde)}`);
  if (partes.length === 0) return [];
  const linhas = await prisma.$queryRaw<{ pedidoId: string }[]>`${Prisma.join(partes, " UNION ")}`;
  return linhas.map((l) => l.pedidoId);
}

/** Aparelhos que abriram o app em cada dia operacional (o gráfico). */
export async function aberturasPorDia(chave: string, desdeDia: string): Promise<Record<string, number>> {
  if (!(await garantirEstruturaDasInstalacoes())) return {};
  const linhas = await prisma.$queryRaw<{ dia: string; n: number }[]>`
    SELECT "dia", COUNT(*)::int AS n FROM "AppDaLojaAbertura"
    WHERE "lojaId" = ${chave} AND "dia" >= ${desdeDia} GROUP BY "dia"`;
  return Object.fromEntries(linhas.map((l) => [l.dia, Number(l.n)]));
}

/** Faxina: o carimbo por dia só serve para o gráfico (30 dias). Nunca lança. */
export async function apagarAberturasVelhas(antesDoDia: string): Promise<void> {
  try {
    if (!(await garantirEstruturaDasInstalacoes())) return;
    await prisma.$executeRaw`DELETE FROM "AppDaLojaAbertura" WHERE "dia" < ${antesDoDia}`;
  } catch { /* faxina */ }
}
