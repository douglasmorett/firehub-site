import { NextResponse } from "next/server";
import { vendedorDaSessao } from "@/lib/perfil-da-loja/acesso";
import { idsDaCarteira, resumosDasLojas } from "@/lib/perfil-da-loja/no-banco";
import { relatorioDaCarteira } from "@/lib/perfil-da-loja/regras";

/**
 * GET: o relatório da carteira do vendedor logado — só as lojas que ele já
 * vê no portal (carteira + indicações, lib/perfil-da-loja/no-banco.ts).
 */
export async function GET() {
  const v = await vendedorDaSessao();
  if (!v.ok) return v.resposta;
  const lojas = await resumosDasLojas(await idsDaCarteira(v.id));
  return NextResponse.json({ lojas, relatorio: relatorioDaCarteira(lojas), geradoEm: new Date().toISOString() });
}
