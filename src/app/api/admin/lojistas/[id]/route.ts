import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { excluirLoja, retratoDaLoja } from "@/lib/excluir-loja";

/**
 * A lixeira do admin (pedido do dono, 27/09/2026).
 *
 *   GET    → o retrato do que a exclusão leva (pedidos, mensalidades pagas...)
 *   DELETE { confirmacao1, confirmacao2 } → apaga a loja inteira. As DUAS
 *            palavras têm que ser "EXCLUIR": o admin digita duas vezes para
 *            não apagar a loja errada. Nunca a própria conta nem outro admin.
 */
async function adminLogado() {
  const session = await getServerSession(authOptions);
  const u = session?.user as any;
  return u && u.role === "ADMIN" ? { id: String(u.id || ""), email: String(u.email || "") } : null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adminLogado())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const retrato = await retratoDaLoja(id);
  if (!retrato) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  return NextResponse.json(retrato);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await adminLogado();
  if (!admin) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const palavra = (v: unknown) => String(v ?? "").trim().toUpperCase();
  if (palavra(body.confirmacao1) !== "EXCLUIR" || palavra(body.confirmacao2) !== "EXCLUIR") {
    return NextResponse.json({ error: 'Digite EXCLUIR nos dois campos para confirmar.' }, { status: 400 });
  }

  const retrato = await retratoDaLoja(id);
  if (!retrato) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  if (retrato.role === "ADMIN" || id === admin.id || retrato.email.toLowerCase() === admin.email.toLowerCase()) {
    return NextResponse.json({ error: "Conta de administrador não se exclui por aqui." }, { status: 400 });
  }

  try {
    const { apagado } = await excluirLoja(id);
    console.log(`[Admin Excluir] ${retrato.nome} (${retrato.email}, ${id}) por ${admin.email}: ${apagado.join(", ") || "nada além da conta"}`);
    return NextResponse.json({ ok: true, apagado });
  } catch (e: any) {
    console.error("[Admin Excluir]", e);
    return NextResponse.json({ error: `Não foi possível excluir: ${e?.message || "erro no banco"}` }, { status: 500 });
  }
}
