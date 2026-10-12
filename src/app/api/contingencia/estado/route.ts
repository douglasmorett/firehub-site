/**
 * GET /api/contingencia/estado — o que a tela "Modo Contingência" mostra:
 * ativada ou não, o computador (último contato e relato dele), as últimas
 * quedas e os conflitos recentes.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemPede } from "@/lib/contingencia/sessao";

export const dynamic = "force-dynamic";

export async function GET() {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const linha = await prisma.$queryRawUnsafe<
      { ativadaEm: Date; ativadaPor: string | null; ultimoContato: Date | null; relato: any }[]
    >(`SELECT "ativadaEm", "ativadaPor", "ultimoContato", "relato" FROM "Contingencia" WHERE "lojaId" = $1`, quem.lojaId);
    if (!linha[0]) return NextResponse.json({ ativada: false, dono: quem.dono || quem.suporte });
    const episodios = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "inicio", "fim", "subiuEm", "linhas", "pedidos", "conflitos" FROM "ContingenciaEpisodio"
        WHERE "lojaId" = $1 ORDER BY "subiuEm" DESC LIMIT 5`,
      quem.lojaId,
    );
    const conflitos = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "tabela", "registro", "coluna", "valorDaLoja", "valorDaNuvem", "decisao", "em" FROM "ContingenciaConflito"
        WHERE "lojaId" = $1 AND "em" >= now() - interval '7 days' ORDER BY "em" DESC LIMIT 30`,
      quem.lojaId,
    );
    return NextResponse.json({
      ativada: true,
      dono: quem.dono || quem.suporte,
      ativadaEm: linha[0].ativadaEm,
      ativadaPor: linha[0].ativadaPor,
      ultimoContato: linha[0].ultimoContato,
      relato: linha[0].relato,
      episodios,
      conflitos,
    });
  } catch {
    // Estrutura ainda não criada (boot antigo): é o mesmo que não ativada.
    return NextResponse.json({ ativada: false, dono: quem.dono || quem.suporte });
  }
}
