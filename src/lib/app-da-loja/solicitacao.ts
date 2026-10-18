/**
 * O INTERESSE NO APLICATIVO PRÓPRIO DA LOJA — o clique em "Quero o meu
 * aplicativo" na tela /store/aplicativo.
 *
 * Douglas, 17/10/2026: "ele vai clicar e vai vir chamar a gente no WhatsApp:
 * 'oi, quero meu aplicativo'". O botão abre o WhatsApp de vendas do FireHub com
 * a mensagem pronta; aqui só fica anotado QUAL plano a loja clicou e quando,
 * para o admin ver ao ativar (botão "📱 App" em Lojistas). Não avisa ninguém:
 * a conversa no WhatsApp já é o aviso. A ativação e a cobrança moram em
 * lib/app-da-loja/plano.ts.
 */
import { prisma } from "@/lib/prisma";
import { PLATAFORMAS, type Plataformas } from "./plano";

/** WhatsApp de vendas/atendimento do FireHub (o mesmo do site e do login). */
export const WHATSAPP_DE_VENDAS = "5522981118514";

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaInteresse" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "plataformas" TEXT NOT NULL,
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AppDaLojaInteresse_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaInteresse_franchiseeId_idx" ON "AppDaLojaInteresse"("franchiseeId")`,
];

let pronto = false;
async function garantir(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) { pronto = true; return true; }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura do interesse falhou:", err?.message);
  }
  return pronto;
}

/** Anota o clique. Nunca lança: o WhatsApp abre de qualquer jeito. */
export async function registrarInteresse(franchiseeId: string, plataformas: string): Promise<void> {
  try {
    if (!PLATAFORMAS.includes(plataformas as Plataformas) || !(await garantir())) return;
    const id = `int_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    await prisma.$executeRaw`
      INSERT INTO "AppDaLojaInteresse" ("id", "franchiseeId", "plataformas") VALUES (${id}, ${franchiseeId}, ${plataformas})`;
  } catch (err: any) {
    console.error("[App da loja] Erro ao anotar o interesse:", err?.message);
  }
}

export async function interessesDaLoja(franchiseeId: string): Promise<{ plataformas: Plataformas; criadoEm: string }[]> {
  try {
    if (!(await garantir())) return [];
    const r = await prisma.$queryRaw<{ plataformas: string; criadoEm: Date }[]>`
      SELECT "plataformas", "criadoEm" FROM "AppDaLojaInteresse" WHERE "franchiseeId" = ${franchiseeId}
       ORDER BY "criadoEm" DESC LIMIT 10`;
    return r.map((x) => ({ plataformas: x.plataformas as Plataformas, criadoEm: x.criadoEm.toISOString() }));
  } catch {
    return [];
  }
}

/** O link do WhatsApp de vendas com a mensagem pronta. */
export function linkDoWhatsApp(loja: string, plano: string): string {
  const texto = `Oi! Quero o meu aplicativo próprio 📱\nLoja: ${loja}\nPlano: ${plano}`;
  return `https://wa.me/${WHATSAPP_DE_VENDAS}?text=${encodeURIComponent(texto)}`;
}
