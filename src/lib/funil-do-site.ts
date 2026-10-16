/**
 * O FUNIL DO SITE — o banco (as regras moram em lib/funil-do-site-regras.ts).
 *
 * O cardápio público (components/customer/useVisitaDoCardapio.ts) avisa
 * POST /api/loja/visita a cada etapa e, com a aba aberta, a cada 45 s. Cada
 * pessoa (um navegador) num dia de operação é UMA linha de "VisitaDoCardapio":
 * a primeira e a última vez que deu sinal, de onde veio, celular ou computador
 * e até onde chegou. Mesa, garçom, totem e o lanche da equipe não entram — o
 * funil é do cliente que pede pelo site.
 *
 * Tabela fora do schema.prisma, criada no primeiro uso (como LancheDaEquipe e
 * CashbackAjuste). Hora gravada com horaEmUtc (o NOW() do PGlite grava a hora
 * de Brasília).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { horaEmUtc } from "@/lib/cashback-no-banco";
import { dataDaLoja, viradaDoExpedienteDaLoja, FUSO_PADRAO } from "@/lib/fuso";
import {
  etapasAte, ONLINE_POR_MS, FUNIL_VAZIO, ORIGENS,
  type ContagemDoFunil, type EtapaDoFunil, type OrigemDaVisita, type DispositivoDaVisita,
} from "@/lib/funil-do-site-regras";

let tabelaOk = false;

export async function garantirTabelaDoFunil(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "VisitaDoCardapio" (
      "id" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "sessao" TEXT NOT NULL,
      "dia" TEXT NOT NULL,
      "origem" TEXT NOT NULL DEFAULT 'direto',
      "dispositivo" TEXT NOT NULL DEFAULT 'celular',
      "primeiraEm" TIMESTAMP(3) NOT NULL,
      "ultimaEm" TIMESTAMP(3) NOT NULL,
      "produto" BOOLEAN NOT NULL DEFAULT false,
      "carrinho" BOOLEAN NOT NULL DEFAULT false,
      "checkout" BOOLEAN NOT NULL DEFAULT false,
      "pedido" BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT "VisitaDoCardapio_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "VisitaDoCardapio_loja_sessao_dia_key" ON "VisitaDoCardapio"("lojaId", "sessao", "dia")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VisitaDoCardapio_lojaId_primeiraEm_idx" ON "VisitaDoCardapio"("lojaId", "primeiraEm")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VisitaDoCardapio_lojaId_ultimaEm_idx" ON "VisitaDoCardapio"("lojaId", "ultimaEm")`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Funil] 🛑 Tabela VisitaDoCardapio falhou: ${err?.message}`);
    return false;
  }
}

// ── A loja pelo slug (o cardápio só sabe o slug) ─────────────────────────────

const lojaPorSlug = new Map<string, { lojaId: string; fuso: string; em: number } | null>();

async function lojaDoSlug(slug: string): Promise<{ lojaId: string; fuso: string } | null> {
  const guardado = lojaPorSlug.get(slug);
  if (guardado !== undefined && (guardado === null || Date.now() - guardado.em < 10 * 60_000)) return guardado;
  const u = await prisma.user.findUnique({ where: { slug }, select: { id: true } }).catch(() => null);
  if (!u) {
    lojaPorSlug.set(slug, null);
    return null;
  }
  const { fusoDaLoja } = await import("@/lib/fuso-da-loja");
  const valor = { lojaId: u.id, fuso: (await fusoDaLoja(u.id).catch(() => FUSO_PADRAO)) || FUSO_PADRAO, em: Date.now() };
  if (lojaPorSlug.size > 5000) lojaPorSlug.clear();
  lojaPorSlug.set(slug, valor);
  return valor;
}

/** O dia de operação (vira às 5h) — o mesmo "dia" dos números da Início. */
function diaDaVisita(fuso: string, agora: Date): string {
  return dataDaLoja(fuso, viradaDoExpedienteDaLoja(fuso, agora));
}

/**
 * Registra a etapa (e marca as anteriores). "batida" só renova o "online".
 * Devolve false quando a loja não existe ou o banco não está pronto.
 */
export async function registrarVisita(v: {
  slug: string;
  sessao: string;
  etapa: EtapaDoFunil | "batida";
  origem: OrigemDaVisita;
  dispositivo: DispositivoDaVisita;
}): Promise<boolean> {
  if (!(await garantirTabelaDoFunil())) return false;
  const loja = await lojaDoSlug(v.slug);
  if (!loja) return false;
  const agora = new Date();
  const dia = diaDaVisita(loja.fuso, agora);
  const marca = new Set<EtapaDoFunil>(v.etapa === "batida" ? ["visita"] : etapasAte(v.etapa));
  const id = `vis_${agora.getTime().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await prisma.$executeRaw`
    INSERT INTO "VisitaDoCardapio" ("id", "lojaId", "sessao", "dia", "origem", "dispositivo", "primeiraEm", "ultimaEm", "produto", "carrinho", "checkout", "pedido")
    VALUES (${id}, ${loja.lojaId}, ${v.sessao}, ${dia}, ${v.origem}, ${v.dispositivo}, ${horaEmUtc(agora)}, ${horaEmUtc(agora)},
            ${marca.has("produto")}, ${marca.has("carrinho")}, ${marca.has("checkout")}, ${marca.has("pedido")})
    ON CONFLICT ("lojaId", "sessao", "dia") DO UPDATE SET
      "ultimaEm" = EXCLUDED."ultimaEm",
      "produto" = "VisitaDoCardapio"."produto" OR EXCLUDED."produto",
      "carrinho" = "VisitaDoCardapio"."carrinho" OR EXCLUDED."carrinho",
      "checkout" = "VisitaDoCardapio"."checkout" OR EXCLUDED."checkout",
      "pedido" = "VisitaDoCardapio"."pedido" OR EXCLUDED."pedido"`;
  return true;
}

// ── A leitura da Início ──────────────────────────────────────────────────────

/** null = todas as lojas (o ADMIN em "Todas"). */
type Lojas = string | string[] | null;

const filtroDaLoja = (lojas: Lojas) =>
  lojas === null
    ? Prisma.sql`TRUE`
    : Array.isArray(lojas)
      ? (lojas.length ? Prisma.sql`v."lojaId" IN (${Prisma.join(lojas)})` : Prisma.sql`FALSE`)
      : Prisma.sql`v."lojaId" = ${lojas}`;

export type OnlineAgora = { agora: number; comCarrinho: number; finalizando: number };

/** Quem deu sinal nos últimos 2 minutos — e quantos deles estão com carrinho. */
export async function onlineAgora(lojas: Lojas, agora: Date = new Date()): Promise<OnlineAgora> {
  if (!(await garantirTabelaDoFunil())) return { agora: 0, comCarrinho: 0, finalizando: 0 };
  const desde = new Date(agora.getTime() - ONLINE_POR_MS);
  const [l] = await prisma.$queryRaw<{ agora: number; carrinho: number; checkout: number }[]>(Prisma.sql`
    SELECT count(*)::int AS agora,
           count(*) FILTER (WHERE v."carrinho" AND NOT v."pedido")::int AS carrinho,
           count(*) FILTER (WHERE v."checkout" AND NOT v."pedido")::int AS checkout
    FROM "VisitaDoCardapio" v
    WHERE ${filtroDaLoja(lojas)} AND v."ultimaEm" >= ${horaEmUtc(desde)}`);
  return { agora: Number(l?.agora) || 0, comCarrinho: Number(l?.carrinho) || 0, finalizando: Number(l?.checkout) || 0 };
}

export type FunilDoPeriodo = {
  funil: ContagemDoFunil;
  origens: { origem: OrigemDaVisita; visitas: number; pedidos: number }[];
  dispositivos: { celular: number; computador: number };
};

/** O funil das visitas que COMEÇARAM no período. */
export async function funilDoPeriodo(lojas: Lojas, de: Date, ate: Date): Promise<FunilDoPeriodo> {
  const vazio: FunilDoPeriodo = { funil: { ...FUNIL_VAZIO }, origens: [], dispositivos: { celular: 0, computador: 0 } };
  if (!(await garantirTabelaDoFunil())) return vazio;
  const janela = Prisma.sql`${filtroDaLoja(lojas)} AND v."primeiraEm" >= ${horaEmUtc(de)} AND v."primeiraEm" <= ${horaEmUtc(ate)}`;
  const linhas = await prisma.$queryRaw<{
    origem: string; dispositivo: string; visitas: number; produto: number; carrinho: number; checkout: number; pedido: number;
  }[]>(Prisma.sql`
    SELECT v."origem", v."dispositivo",
           count(*)::int AS visitas,
           count(*) FILTER (WHERE v."produto")::int AS produto,
           count(*) FILTER (WHERE v."carrinho")::int AS carrinho,
           count(*) FILTER (WHERE v."checkout")::int AS checkout,
           count(*) FILTER (WHERE v."pedido")::int AS pedido
    FROM "VisitaDoCardapio" v
    WHERE ${janela}
    GROUP BY v."origem", v."dispositivo"`);

  const funil: ContagemDoFunil = { ...FUNIL_VAZIO };
  const porOrigem = new Map<OrigemDaVisita, { visitas: number; pedidos: number }>();
  const dispositivos = { celular: 0, computador: 0 };
  for (const l of linhas) {
    funil.visita += Number(l.visitas) || 0;
    funil.produto += Number(l.produto) || 0;
    funil.carrinho += Number(l.carrinho) || 0;
    funil.checkout += Number(l.checkout) || 0;
    funil.pedido += Number(l.pedido) || 0;
    const origem = (ORIGENS as readonly string[]).includes(l.origem) ? (l.origem as OrigemDaVisita) : "outro";
    const o = porOrigem.get(origem) || { visitas: 0, pedidos: 0 };
    o.visitas += Number(l.visitas) || 0;
    o.pedidos += Number(l.pedido) || 0;
    porOrigem.set(origem, o);
    if (l.dispositivo === "computador") dispositivos.computador += Number(l.visitas) || 0;
    else dispositivos.celular += Number(l.visitas) || 0;
  }
  const origens = [...porOrigem.entries()].map(([origem, o]) => ({ origem, ...o })).sort((a, b) => b.visitas - a.visitas);
  return { funil, origens, dispositivos };
}

/** Desde quando a loja tem visitas contadas (a tela avisa que antes não havia contagem). */
export async function primeiraVisita(lojas: Lojas): Promise<string | null> {
  if (!(await garantirTabelaDoFunil())) return null;
  const [l] = await prisma.$queryRaw<{ em: Date | null }[]>(Prisma.sql`
    SELECT min(v."primeiraEm") AS em FROM "VisitaDoCardapio" v WHERE ${filtroDaLoja(lojas)}`);
  return l?.em ? new Date(l.em).toISOString() : null;
}
