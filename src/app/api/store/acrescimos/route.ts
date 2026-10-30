/**
 * GET  /api/store/acrescimos            → acréscimos que clientes pediram pelo robô e esperam a loja
 * POST /api/store/acrescimos { id, acao: "aceitar" | "recusar", texto? } → a resposta da loja
 *
 * Consultado em loop pelo AvisoDeAcrescimo (components/customer), montado SÓ
 * na tela de pedidos — no KDS não (dono, 05/10/2026).
 * A regra mora em lib/acrescimo-do-pedido.ts e lib/acrescimo-no-banco.ts.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { acrescimosPendentes, responderAcrescimo } from "@/lib/acrescimo-no-banco";
import { lembrarPor } from "@/lib/cache-curto";
import { lerEnquantoNadaMuda } from "@/lib/novidade-da-loja";
import { lojasDaVisao, cookieDaVisao } from "@/lib/loja-ativa";

export const dynamic = "force-dynamic";

/** As lojas desta conta — o mesmo recorte de /api/store/avisos. */
async function lojasDaSessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return null;
  // 15 s em memória: esta rota roda a cada 8 s por aba (lib/cache-curto.ts).
  const user = await lembrarPor(`acrescimos:usuario:${email}`, 15_000, () =>
    prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, name: true, role: true } }));
  if (!user) return null;
  const lojaId = user.ownerId || user.id;
  // "Todas as Lojas" (cookie "all", lib/loja-ativa.ts): o acréscimo pedido no
  // robô da Rush ou da PasteLê também aparece — e se responde — na tela aberta
  // em "Todas" (Douglas, 30/10/2026: "agora todos é pra mexer em tudo").
  // Fora dela, e para funcionário, `lojaIds` é só a loja da sessão.
  const { lojaIds } = await lojasDaVisao(user, await cookieDaVisao()).catch(() => ({
    lojaIds: [lojaId],
  }));
  const ids = [...new Set([lojaId, user.id, user.ownerId, ...lojaIds].filter(Boolean))] as string[];
  return { lojaId, ids, quem: session?.user?.name || user.name || email };
}

export async function GET() {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    // A lista só muda com gravação de pedido ou acréscimo (lib/novidade-da-loja.ts).
    const acrescimos = await lerEnquantoNadaMuda(`acrescimos:${s.ids.join(",")}`, s.ids, () => acrescimosPendentes(s.ids));
    return NextResponse.json({ acrescimos });
  } catch (e: any) {
    // Sem a tabela ou com o banco fora: lista vazia, sem 500 em loop no console.
    console.error("[Acréscimo] Não consegui listar os acréscimos:", e?.message);
    return NextResponse.json({ acrescimos: [], erro: true });
  }
}

export async function POST(req: Request) {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const id = String(body?.id || "").trim();
  const acao = String(body?.acao || "").trim();
  if (!id || (acao !== "aceitar" && acao !== "recusar")) {
    return NextResponse.json({ error: "Informe o acréscimo e se aceita ou recusa." }, { status: 400 });
  }
  const r = await responderAcrescimo({
    id,
    lojaIds: s.ids,
    aceitar: acao === "aceitar",
    texto: typeof body?.texto === "string" ? body.texto : null,
    quem: s.quem,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status || 500 });
  return NextResponse.json(r);
}
