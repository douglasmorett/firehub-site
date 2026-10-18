/**
 * O PLANO DO APLICATIVO PRÓPRIO DA LOJA — quem tem, qual, e quanto entra no
 * boleto do mês.
 *
 * Douglas, 17/10/2026: "ele vai clicar e chamar a gente no WhatsApp; a gente
 * ativa o plano para ele. Vai cobrar, mas essa ativação vai ter que ser manual.
 * A gente vai cobrar no boleto do Asaas, junto com a mensalidade."
 *
 * - A loja NÃO ativa sozinha: só o admin (aba Lojistas › botão "App") liga,
 *   troca de plano ou desliga (POST /api/admin/app-da-loja).
 * - Preço: R$ 149 só Android, R$ 149 só Apple, R$ 197 os dois. O valor é gravado
 *   em cada trecho ligado, para um reajuste futuro não mudar o que já foi
 *   combinado com quem ativou antes (mesma ideia do termo do Bill).
 * - Cobrança: ativo em qualquer momento do mês = o mês inteiro, uma vez só
 *   (a mesma regra do Bill, lib/assessor/assinatura.ts). Trocou de plano no
 *   meio do mês: vale o maior. Desligou: o mês seguinte não entra.
 * - Loja isenta (conta da casa, parceiro) não paga: o fechamento já pula a loja
 *   inteira (`isSpecialStore` em billing.ts).
 *
 * Tabela própria criada no primeiro uso (mesma categoria de
 * lib/assessor/estrutura-no-banco.ts): se faltar, só o app para de cobrar.
 */
import { prisma } from "@/lib/prisma";

export const PRECOS_DO_APP = { android: 149, apple: 149, ambos: 197 } as const;
export type Plataformas = keyof typeof PRECOS_DO_APP;
export const PLATAFORMAS: Plataformas[] = ["android", "apple", "ambos"];
export const ROTULO_DO_PLANO: Record<Plataformas, string> = { android: "Só Android", apple: "Só Apple (iPhone)", ambos: "Android + Apple" };

/** Um trecho ligado. `ate` nulo = ligado agora. */
export type TrechoDoApp = { de: string; ate: string | null; plataformas: Plataformas; valor: number; quem?: string | null };

export type EstadoDoApp = {
  ativo: boolean;
  plataformas: Plataformas | null;
  valor: number;
  ativoDesde: string | null;
  trechos: TrechoDoApp[];
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaPlano" (
     "franchiseeId" TEXT NOT NULL,
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AppDaLojaPlano_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDoPlano(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) { pronto = true; return true; }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura do plano falhou:", err?.message);
  }
  return pronto;
}

function lerTrechos(bruto: unknown): TrechoDoApp[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((t: any) => t && typeof t.de === "string" && PLATAFORMAS.includes(t.plataformas))
    .map((t: any) => ({
      de: t.de,
      ate: typeof t.ate === "string" ? t.ate : null,
      plataformas: t.plataformas as Plataformas,
      valor: Number(t.valor) > 0 ? Number(t.valor) : PRECOS_DO_APP[t.plataformas as Plataformas],
      quem: t.quem ?? null,
    }));
}

/**
 * Quanto o app custa no mês [inicio, fim). Puro, para o teste.
 * Ligado em qualquer instante do mês = o mês inteiro; dois trechos no mesmo
 * mês (trocou de plano) = o maior, uma vez só.
 */
export function valorDoAppNoMes(trechos: TrechoDoApp[], inicio: Date, fim: Date, agora: Date = new Date()): number {
  const ini = inicio.getTime(), fimMs = fim.getTime();
  let valor = 0;
  for (const t of trechos) {
    const de = Math.max(new Date(t.de).getTime(), ini);
    const ate = Math.min(t.ate ? new Date(t.ate).getTime() : Math.max(agora.getTime(), de + 1), fimMs);
    if (ate > de) valor = Math.max(valor, t.valor);
  }
  return valor;
}

function estadoDe(trechos: TrechoDoApp[]): EstadoDoApp {
  const aberto = trechos.find((t) => !t.ate) || null;
  return {
    ativo: Boolean(aberto),
    plataformas: aberto?.plataformas ?? null,
    valor: aberto?.valor ?? 0,
    ativoDesde: aberto?.de ?? null,
    trechos,
  };
}

async function lerDoBanco(franchiseeId: string): Promise<TrechoDoApp[]> {
  const r = await prisma.$queryRaw<{ trechos: unknown }[]>`
    SELECT "trechos" FROM "AppDaLojaPlano" WHERE "franchiseeId" = ${franchiseeId}`;
  return lerTrechos(r[0]?.trechos);
}

export async function estadoDoApp(franchiseeId: string): Promise<EstadoDoApp> {
  try {
    if (!(await garantirEstruturaDoPlano())) return estadoDe([]);
    return estadoDe(await lerDoBanco(franchiseeId));
  } catch (err: any) {
    console.error("[App da loja] Erro ao ler o plano:", err?.message);
    return estadoDe([]);
  }
}

/**
 * Liga, troca ou desliga (plataformas = null) o plano — só o admin chama.
 * Trocar fecha o trecho aberto e abre outro com o preço da tabela de hoje.
 */
export async function definirPlanoDoApp(
  franchiseeId: string,
  plataformas: Plataformas | null,
  quem: string | null,
  agora: Date = new Date(),
): Promise<EstadoDoApp> {
  if (!(await garantirEstruturaDoPlano())) throw new Error("O plano do aplicativo não está disponível agora.");
  if (plataformas !== null && !PLATAFORMAS.includes(plataformas)) throw new Error("Plano inválido.");
  const trechos = await lerDoBanco(franchiseeId);
  const aberto = trechos.find((t) => !t.ate);
  if (aberto && aberto.plataformas === plataformas) return estadoDe(trechos);
  const iso = agora.toISOString();
  if (aberto) aberto.ate = iso;
  if (plataformas) trechos.push({ de: iso, ate: null, plataformas, valor: PRECOS_DO_APP[plataformas], quem });
  const json = JSON.stringify(trechos);
  await prisma.$executeRaw`
    INSERT INTO "AppDaLojaPlano" ("franchiseeId", "trechos", "atualizadoEm")
    VALUES (${franchiseeId}, ${json}::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT ("franchiseeId") DO UPDATE SET "trechos" = EXCLUDED."trechos", "atualizadoEm" = CURRENT_TIMESTAMP`;
  return estadoDe(trechos);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoAppNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoPlano())) return 0;
    return valorDoAppNoMes(await lerDoBanco(franchiseeId), inicio, fim);
  } catch (err: any) {
    console.error("[App da loja] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}

/**
 * Teve o plano COMPLETO (Android + Apple) ligado em algum momento do mês
 * [inicio, fim)? Puro, para o teste. É a cortesia do Multimarcas: quem paga os
 * dois aplicativos não paga a página das marcas (Douglas, 17/10/2026 —
 * lib/multimarcas/assinatura.ts).
 */
export function teveAppCompletoNoMes(trechos: TrechoDoApp[], inicio: Date, fim: Date, agora: Date = new Date()): boolean {
  const ini = inicio.getTime(), fimMs = fim.getTime();
  return trechos.some((t) => {
    if (t.plataformas !== "ambos") return false;
    const de = Math.max(new Date(t.de).getTime(), ini);
    const ate = Math.min(t.ate ? new Date(t.ate).getTime() : Math.max(agora.getTime(), de + 1), fimMs);
    return ate > de;
  });
}

/** O mesmo, lendo do banco. Nunca lança: na dúvida, sem cortesia. */
export async function appCompletoNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<boolean> {
  try {
    if (!(await garantirEstruturaDoPlano())) return false;
    return teveAppCompletoNoMes(await lerDoBanco(franchiseeId), inicio, fim);
  } catch {
    return false;
  }
}
