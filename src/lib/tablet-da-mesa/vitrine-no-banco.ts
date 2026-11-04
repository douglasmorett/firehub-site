/** A vitrine do tablet no banco (TabletDaMesaVitrine, lib/tablet-da-mesa/estrutura.ts). */
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoTablet } from "./estrutura";
import { VITRINE_AUTOMATICA, limparVitrine, type VitrineDoTablet } from "./vitrine";

export async function lerVitrine(lojaId: string): Promise<VitrineDoTablet> {
  if (!(await garantirEstruturaDoTablet())) return VITRINE_AUTOMATICA;
  try {
    const linhas = await prisma.$queryRawUnsafe<any[]>(`SELECT "banners", "recomendados" FROM "TabletDaMesaVitrine" WHERE "lojaId" = $1`, lojaId);
    return linhas[0] ? limparVitrine(linhas[0]) : VITRINE_AUTOMATICA;
  } catch {
    return VITRINE_AUTOMATICA;
  }
}

/** Grava o que o painel mandou, só com produtos da loja. Devolve o que ficou. */
export async function salvarVitrine(lojaId: string, bruto: unknown): Promise<VitrineDoTablet> {
  if (!(await garantirEstruturaDoTablet())) throw new Error("O Tablet na mesa está indisponível agora. Tente de novo em instantes.");
  const produtos = await prisma.menuProduct.findMany({ where: { franchiseeId: lojaId }, select: { id: true } });
  const v = limparVitrine(bruto, new Set(produtos.map((p) => p.id)));
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TabletDaMesaVitrine" ("lojaId", "banners", "recomendados", "atualizadoEm")
     VALUES ($1, $2::jsonb, $3::jsonb, (NOW() AT TIME ZONE 'UTC'))
     ON CONFLICT ("lojaId") DO UPDATE SET "banners" = EXCLUDED."banners", "recomendados" = EXCLUDED."recomendados", "atualizadoEm" = EXCLUDED."atualizadoEm"`,
    lojaId, JSON.stringify(v.banners), JSON.stringify(v.recomendados),
  );
  return v;
}
