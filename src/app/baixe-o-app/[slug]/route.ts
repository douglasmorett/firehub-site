/**
 * GET /baixe-o-app/<slug> — o link único do aplicativo da loja: o iPhone vai
 * para a App Store, o Android para o Google Play, o resto para o cardápio.
 * É o QR do convite no computador (components/customer/clube/ConviteDoApp.tsx)
 * e o link que a loja pode pôr na bio do Instagram.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { conviteDoApp } from "@/lib/app-da-loja/links";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Dentro do container o Next vê o host interno (0.0.0.0:3000): o endereço
  // público vem do cabeçalho do proxy (mesma pegadinha de src/proxy.ts).
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  const base = host && !/^(0\.0\.0\.0|127\.|localhost|\[::1\])/.test(host) ? `https://${host}` : "https://firehubfood.com.br";
  const cardapio = new URL(`/loja/${encodeURIComponent(slug)}`, base);
  const loja = await prisma.user.findUnique({ where: { slug }, select: { id: true } }).catch(() => null);
  if (!loja) return NextResponse.redirect(cardapio);
  const links = await conviteDoApp(loja.id);
  const ua = req.headers.get("user-agent") || "";
  const destino = /iphone|ipad|ipod/i.test(ua) ? links?.ios : /android/i.test(ua) ? links?.android : null;
  return NextResponse.redirect(destino || cardapio.toString());
}
