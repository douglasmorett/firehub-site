/**
 * POST /api/store/employees/[id]/assinatura  { alvo, alvoId, nome, imagem }
 *
 * Guarda a assinatura feita na tela (dedo ou mouse) para um lançamento do
 * fiado — no balcão logo depois da venda, na mesa ao lançar a conta, ou
 * depois, pelo Extrato. Uma por lançamento: a segunda é recusada (409), porque
 * assinatura que se troca calada não prova nada (lib/fiado-para-assinar.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { problemaDaAssinatura } from "@/lib/comprovante-do-fiado";
import { acessoAoFiado, assinaturasDosLancamentos, gravarAssinaturaDoFiado, lancamentoDoFiado, lerAlvo } from "@/lib/fiado-para-assinar";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;

  const acesso = await acessoAoFiado(session.user.email, id);
  if (!acesso.ok) return NextResponse.json({ error: acesso.erro }, { status: acesso.status });

  const body = await req.json().catch(() => ({} as any));
  const alvo = lerAlvo(body?.alvo);
  const alvoId = String(body?.alvoId || "").trim();
  if (!alvo || !alvoId) return NextResponse.json({ error: "Informe qual lançamento do fiado assinar." }, { status: 400 });
  const problema = problemaDaAssinatura(body || {});
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  // O lançamento tem de ser DESTE cliente (já conferido como da loja/grupo).
  if (!(await lancamentoDoFiado(acesso.cliente.id, alvo, alvoId))) {
    return NextResponse.json({ error: "Lançamento do fiado não encontrado." }, { status: 404 });
  }

  try {
    const gravou = await gravarAssinaturaDoFiado({
      lojaId: acesso.lojaId, employeeId: acesso.cliente.id, alvo, alvoId,
      nome: String(body.nome), imagem: String(body.imagem), quem: acesso.quem,
    });
    if (!gravou) {
      const ja = (await assinaturasDosLancamentos([alvoId], false)).get(alvoId);
      return NextResponse.json({ error: `Este fiado já foi assinado${ja ? ` por ${ja.nome}` : ""}.`, jaAssinado: true }, { status: 409 });
    }
  } catch (err: any) {
    console.error("[Assinatura do fiado] gravar falhou:", err?.message);
    return NextResponse.json({ error: "Não consegui guardar a assinatura. Tente de novo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
