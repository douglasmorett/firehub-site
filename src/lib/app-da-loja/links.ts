/**
 * OS LINKS DO APLICATIVO NAS LOJAS (Google Play e App Store) — e o convite
 * "Baixe o app" no site da loja.
 *
 * Douglas, 18/10/2026: "no nosso site oficial tem que ter alguma coisa chamando
 * o cliente para baixar o aplicativo: baixe o app, ganhe descontos especiais…
 * a partir do momento que a gente ativar o aplicativo para ele, essa chamada lá
 * no site dele já fica ativa."
 *
 * O admin cola os dois links no mesmo lugar onde liga o plano (Admin ›
 * Lojistas › 📱 App). O convite aparece quando o plano está ligado (na loja ou
 * na principal do grupo) e existe pelo menos um link.
 */
import { prisma } from "@/lib/prisma";
import { appLigadoNaConta } from "@/lib/app-da-loja/instalacoes";
import { linkDaLojaDeApps } from "@/lib/app-da-loja/link-da-loja-de-apps";
import { clubeValendoNaLoja } from "@/lib/clube/no-banco";

export type LinksDoApp = { android: string | null; ios: string | null };
/** O convite do site: os links e, com o Clube ligado, o que ele dá (vira uma das chamadas). */
export type ConviteDoApp = LinksDoApp & { clube: { nome: string; percentual: number } | null };

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaLinks" (
     "franchiseeId" TEXT NOT NULL,
     "android" TEXT,
     "ios" TEXT,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AppDaLojaLinks_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
async function garantir(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) { pronto = true; return true; }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura dos links falhou:", err?.message);
  }
  return pronto;
}

async function lerLinha(franchiseeId: string): Promise<LinksDoApp | null> {
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT "android","ios" FROM "AppDaLojaLinks" WHERE "franchiseeId" = $1`, franchiseeId);
  return r[0] ? { android: r[0].android ?? null, ios: r[0].ios ?? null } : null;
}

export async function lerLinksDoApp(franchiseeId: string): Promise<LinksDoApp> {
  try {
    if (!(await garantir())) return { android: null, ios: null };
    return (await lerLinha(franchiseeId)) || { android: null, ios: null };
  } catch {
    return { android: null, ios: null };
  }
}

export async function gravarLinksDoApp(franchiseeId: string, links: { android?: unknown; ios?: unknown }): Promise<LinksDoApp> {
  if (!(await garantir())) throw new Error("Os links do aplicativo não estão disponíveis agora.");
  const android = linkDaLojaDeApps(links.android, "android");
  const ios = linkDaLojaDeApps(links.ios, "ios");
  if (String(links.android ?? "").trim() && !android) throw new Error("Link do Google Play inválido (play.google.com/store/apps/details?id=…).");
  if (String(links.ios ?? "").trim() && !ios) throw new Error("Link da App Store inválido (apps.apple.com/…/id…).");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AppDaLojaLinks" ("franchiseeId","android","ios","atualizadoEm") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
     ON CONFLICT ("franchiseeId") DO UPDATE SET "android" = EXCLUDED."android", "ios" = EXCLUDED."ios", "atualizadoEm" = CURRENT_TIMESTAMP`,
    franchiseeId, android, ios,
  );
  return { android, ios };
}

/**
 * O convite "Baixe o app" do cardápio desta loja: null quando o plano não está
 * ligado ou não há link. Vale o link da loja; faltando, o da principal do
 * grupo (o app é da marca). Com o Clube ligado, vai junto o nome e o % — o
 * site troca a chamada a cada visita (components/customer/clube/ConviteDoApp.tsx).
 * Nunca lança.
 */
export async function conviteDoApp(lojaId: string): Promise<ConviteDoApp | null> {
  try {
    if (!(await appLigadoNaConta(lojaId))) return null;
    if (!(await garantir())) return null;
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, accountGroupId: true, storeName: true, name: true } });
    if (!loja) return null;
    const daLoja = await lerLinha(loja.id);
    const doGrupo = loja.accountGroupId && loja.accountGroupId !== loja.id ? await lerLinha(loja.accountGroupId) : null;
    const android = daLoja?.android || doGrupo?.android || null;
    const ios = daLoja?.ios || doGrupo?.ios || null;
    if (!android && !ios) return null;
    const clube = await clubeValendoNaLoja(loja.id);
    return {
      android,
      ios,
      clube: clube
        ? { nome: clube.config.nome || `Clube ${(loja.storeName || loja.name || "").trim()}`.trim(), percentual: clube.config.percentual }
        : null,
    };
  } catch {
    return null;
  }
}
