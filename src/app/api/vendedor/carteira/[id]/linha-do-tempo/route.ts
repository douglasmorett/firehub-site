import { NextRequest, NextResponse } from "next/server";
import { vendedorDaSessao } from "@/lib/perfil-da-loja/acesso";
import { lojaEstaNaCarteira } from "@/lib/perfil-da-loja/no-banco";
import { linhaDoTempoDaLoja } from "@/lib/perfil-da-loja/linha-do-tempo-no-banco";

/**
 * GET: a linha do tempo de uma loja da carteira do vendedor — em RESUMO: o
 * texto das conversas não sai do banco (o atendimento é só do admin).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await vendedorDaSessao();
  if (!v.ok) return v.resposta;
  const { id } = await params;
  if (!(await lojaEstaNaCarteira(v.id, id))) return NextResponse.json({ error: "Esta loja não está na sua carteira." }, { status: 404 });
  return NextResponse.json(await linhaDoTempoDaLoja(id, "VENDEDOR"));
}
