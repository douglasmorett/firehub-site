import { NextRequest, NextResponse } from "next/server";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { dataDaAgenda, instanteDaAgenda, somarDias } from "@/lib/crm/agenda";
import { desempenhoDaEquipe } from "@/lib/crm/desempenho";

export const dynamic = "force-dynamic";

/**
 * GET ?dias=7|30|90 ou ?mes=YYYY-MM — o desempenho da equipe (admin). O
 * período fecha em "amanhã 00h" de Brasília, então hoje entra inteiro.
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });

  const hoje = dataDaAgenda(new Date());
  const mes = req.nextUrl.searchParams.get("mes");
  let de: string;
  let ate: string;
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    de = `${mes}-01`;
    const [y, m] = mes.split("-").map(Number);
    ate = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  } else {
    const dias = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("dias")) || 30, 365));
    ate = somarDias(hoje, 1);
    de = somarDias(ate, -dias);
  }
  const equipe = await desempenhoDaEquipe(instanteDaAgenda(de, "00:00"), instanteDaAgenda(ate, "00:00"));
  return NextResponse.json({ de, ate: somarDias(ate, -1), equipe });
}
