import { NextRequest, NextResponse } from "next/server";
import { vendedorDaSessao } from "@/lib/perfil-da-loja/acesso";
import { lojaEstaNaCarteira, perfilDaLoja } from "@/lib/perfil-da-loja/no-banco";

/** GET: o perfil completo de uma loja da carteira do vendedor logado. Loja de fora = 404. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await vendedorDaSessao();
  if (!v.ok) return v.resposta;
  const { id } = await params;
  if (!(await lojaEstaNaCarteira(v.id, id))) return NextResponse.json({ error: "Esta loja não está na sua carteira." }, { status: 404 });
  const perfil = await perfilDaLoja(id);
  if (!perfil) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  return NextResponse.json(perfil);
}
