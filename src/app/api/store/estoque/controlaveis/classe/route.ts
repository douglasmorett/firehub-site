/**
 * /api/store/estoque/controlaveis/classe — a loja corrige a classe do insumo
 * no Relatório dos controláveis.
 *
 *   POST { stockItemId, classe: "ALIMENTO" | "EMBALAGEM" | "CONDIMENTO" | "INDIRETO" | null }
 *        null volta ao palpite pelo nome.
 *
 * Só quem vê dados sensíveis (a mesma porta do relatório).
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { salvarClasse } from "@/lib/cmv/controlaveis-no-banco";
import { ehClasse } from "@/lib/cmv/controlaveis";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const corpo = await req.json().catch(() => null);
  const stockItemId = typeof corpo?.stockItemId === "string" ? corpo.stockItemId : "";
  const classe = corpo?.classe == null || corpo.classe === "" ? null : corpo.classe;
  if (!stockItemId || (classe != null && !ehClasse(classe))) {
    return NextResponse.json({ error: "Escolha o insumo e uma classe válida." }, { status: 400 });
  }
  try {
    const ok = await salvarClasse(r.acesso.lojaId, stockItemId, classe, r.acesso.usuarioId);
    if (!ok) return NextResponse.json({ error: "Insumo não encontrado nesta loja." }, { status: 404 });
    return NextResponse.json({ ok: true, classe });
  } catch (err: any) {
    console.error("[Controláveis] Falha ao gravar a classe:", err?.message || err);
    return NextResponse.json({ error: "Não deu para gravar a classe agora." }, { status: 500 });
  }
}
