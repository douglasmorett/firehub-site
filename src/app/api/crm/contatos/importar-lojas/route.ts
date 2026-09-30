import { NextResponse } from "next/server";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { importarLojasParaOCrm } from "@/lib/crm/contatos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST: traz as lojas cadastradas para o CRM (admin). Repetir não duplica (lib/crm/contatos.ts). */
export async function POST() {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  try {
    const r = await importarLojasParaOCrm({ tipo: "ADMIN", id: quem.id, nome: quem.nome });
    return NextResponse.json({ ok: true, ...r });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não consegui trazer as lojas." }, { status: 500 });
  }
}
