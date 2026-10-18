import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { idsDaCarteira, idsDeTodasAsLojas, idsSemDono, resumosDasLojas } from "@/lib/perfil-da-loja/no-banco";
import { relatorioDaCarteira } from "@/lib/perfil-da-loja/regras";

/**
 * GET: o resumo do perfil de TODAS as lojas (status da atividade, faturamento,
 * oportunidades) e o relatório da carteira. `?vendedor=<id>` recorta pelas
 * lojas que aquele vendedor vê no portal; `?vendedor=sem`, as sem vendedor e
 * sem embaixador (a carteira "Sem vendedor" da performance das carteiras).
 * A lista inteira fica 5 minutos em memória (lib/perfil-da-loja/no-banco.ts).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const todas = await resumosDasLojas(await idsDeTodasAsLojas());
  const vendedor = req.nextUrl.searchParams.get("vendedor");
  let lojas = todas;
  if (vendedor === "sem") {
    const semDono = new Set(await idsSemDono());
    lojas = todas.filter((l) => semDono.has(l.id));
  } else if (vendedor && vendedor !== "todos") {
    const daCarteira = new Set(await idsDaCarteira(vendedor));
    lojas = todas.filter((l) => daCarteira.has(l.id));
  }
  return NextResponse.json({ lojas, relatorio: relatorioDaCarteira(lojas), geradoEm: new Date().toISOString() });
}
