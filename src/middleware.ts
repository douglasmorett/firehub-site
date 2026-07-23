import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = (request.headers.get("host") || "").toLowerCase();

  // ─── ICEBOX DOMAIN: libera tudo, autenticação na página ──────
  if (host.includes("iceboxdistribuidora")) {
    return NextResponse.next();
  }

  // ─── FIREHUB DOMAIN: rotas protegidas /store/* ───────────────
  if (pathname.startsWith("/store")) {
    // /store/compras é público (catálogo Icebox acessível pelo FireHub também)
    if (pathname.startsWith("/store/compras")) {
      return NextResponse.next();
    }

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", request.url);
      return NextResponse.redirect(loginUrl);
    }

    // Controle de role é feito em cada página server-side (layout.tsx / page.tsx)
    // O middleware apenas garante que o usuário está autenticado
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
