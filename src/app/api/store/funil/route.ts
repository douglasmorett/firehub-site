/**
 * GET /api/store/funil?de=<ISO>&ate=<ISO>[&antesDe=<ISO>&antesAte=<ISO>][&loja=<id>]
 * — o topo da Início: quem está no site agora, as visitas do período e o
 * funil (lib/funil-do-site.ts). Sem `de`, só o "online agora" (a tela pergunta
 * de 20 em 20 s).
 *
 * A mesma porta e a mesma visão de loja da /api/store/inicio: `loja` só vale
 * para o ADMIN; o lojista vê a loja ativa ou o grupo em "Todas as Lojas".
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { COOKIE_DA_LOJA_ATIVA, lojasDaVisao } from "@/lib/loja-ativa";
import { funilDoPeriodo, onlineAgora, primeiraVisita } from "@/lib/funil-do-site";

export const dynamic = "force-dynamic";

const data = (v: string | null) => {
  const d = new Date(v || "");
  return isNaN(d.getTime()) ? null : d;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (usuario.role !== "FRANCHISEE" && usuario.role !== "ADMIN" && usuario.role !== "STAFF") {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }
  if (usuario.role === "STAFF" && !funcionarioAbre("/store", String(usuario.permissions ?? ""))) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  let lojas: string | string[] | null;
  if (usuario.role === "ADMIN") {
    const loja = p.get("loja");
    lojas = loja && loja !== "todas" ? loja : null;
  } else {
    lojas = (await lojasDaVisao(usuario, req.cookies.get(COOKIE_DA_LOJA_ATIVA)?.value)).lojaIds;
  }

  try {
    const online = await onlineAgora(lojas);
    const de = data(p.get("de"));
    const ate = data(p.get("ate"));
    if (!de || !ate || de > ate) return NextResponse.json({ online }, { headers: { "Cache-Control": "no-store" } });

    const antesDe = data(p.get("antesDe"));
    const antesAte = data(p.get("antesAte"));
    const [periodo, anterior, desde] = await Promise.all([
      funilDoPeriodo(lojas, de, ate),
      antesDe && antesAte && antesDe <= antesAte ? funilDoPeriodo(lojas, antesDe, antesAte) : Promise.resolve(null),
      primeiraVisita(lojas),
    ]);
    return NextResponse.json({ online, periodo, anterior, desde }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[Funil] leitura falhou:", err?.message || err);
    return NextResponse.json({ error: "Não deu para carregar as visitas agora." }, { status: 500 });
  }
}
