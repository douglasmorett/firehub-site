import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { PRECOS_DO_APP, estadoDoApp } from "@/lib/app-da-loja/plano";
import { registrarInteresse, WHATSAPP_DE_VENDAS } from "@/lib/app-da-loja/solicitacao";
import { pratosDeVitrine } from "@/lib/app-da-loja/vitrine";

/**
 * GET  — a loja (nome, logo), fotos do cardápio para o celular de demonstração,
 *        os preços, o plano ativo (se o admin já ativou) e o WhatsApp de vendas.
 * POST { plataformas } — anota o clique em "Quero o meu aplicativo"; a tela abre
 *        o WhatsApp de vendas com a mensagem pronta (lib/app-da-loja/solicitacao.ts).
 *
 * Só o dono da loja (a mesma regra do Bill: lib/assessor/loja-da-sessao.ts).
 */

/** As fotos de exemplo quando a loja ainda não tem foto no cardápio (Douglas: "pode usar as fotos da Hakim"). */
const LOJA_DE_EXEMPLO = "hakim-contato";

async function fotosDoCardapio(franchiseeId: string) {
  const buscar = (id: string) => prisma.menuProduct.findMany({
    where: { franchiseeId: id, active: true, imageUrl: { not: null } },
    select: { name: true, price: true, imageUrl: true, category: true },
    take: 300,
  });
  let fotos = pratosDeVitrine(await buscar(franchiseeId));
  let exemplo = false;
  if (fotos.length < 4) {
    const hakim = await prisma.user.findUnique({ where: { slug: LOJA_DE_EXEMPLO }, select: { id: true } });
    if (hakim && hakim.id !== franchiseeId) { fotos = pratosDeVitrine(await buscar(hakim.id)); exemplo = true; }
  }
  return { exemplo, fotos };
}

export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja pede o aplicativo." }, { status: 403 });
  const loja = await prisma.user.findUnique({ where: { id: s.franchiseeId }, select: { storeName: true, slug: true, storeLogo: true } });
  const [{ exemplo, fotos }, plano] = await Promise.all([fotosDoCardapio(s.franchiseeId), estadoDoApp(s.franchiseeId)]);
  return NextResponse.json({
    loja: { nome: loja?.storeName || "Sua loja", slug: loja?.slug || null, logo: loja?.storeLogo || null },
    fotos, fotosDeExemplo: exemplo,
    precos: PRECOS_DO_APP,
    plano: { ativo: plano.ativo, plataformas: plano.plataformas, valor: plano.valor, ativoDesde: plano.ativoDesde },
    whatsapp: WHATSAPP_DE_VENDAS,
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja pede o aplicativo." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  await registrarInteresse(s.franchiseeId, String(body.plataformas || ""));
  return NextResponse.json({ ok: true });
}
