import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isIceboxDomain(request: NextRequest): boolean {
  // Check multiple header sources for the hostname
  const host = request.headers.get("host") || "";
  const xForwardedHost = request.headers.get("x-forwarded-host") || "";
  const url = request.nextUrl.hostname || "";
  
  const allHosts = [host, xForwardedHost, url].map(h => h.replace(/:.*$/, "").toLowerCase().trim());
  return allHosts.some(h => h.includes("iceboxdistribuidora"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── DEBUG: rota para verificar hostname (remover depois) ───
  if (pathname === "/_debug-host") {
    return NextResponse.json({
      host: request.headers.get("host"),
      xForwardedHost: request.headers.get("x-forwarded-host"),
      urlHostname: request.nextUrl.hostname,
      isIcebox: isIceboxDomain(request),
      pathname,
    });
  }

  // ─── ICEBOX DOMAIN: redireciona para catálogo ────────────────
  if (isIceboxDomain(request)) {
    // Se acessou a raiz, manda pro catálogo
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/store/compras";
      return NextResponse.redirect(url);
    }
    // Se acessou /login, mantém (precisa logar)
    if (pathname === "/login" || pathname === "/cadastro" || pathname === "/esqueci-senha" || pathname === "/redefinir-senha") {
      return NextResponse.next();
    }
    // Se acessou /store/compras ou /store/cart ou /store/orders, permite (catálogo público)
    if (pathname.startsWith("/store/compras") || pathname.startsWith("/store/cart") || pathname.startsWith("/store/orders")) {
      return NextResponse.next();
    }
    // API routes são liberadas
    if (pathname.startsWith("/api")) {
      return NextResponse.next();
    }
    // Qualquer outra rota no domínio Icebox → redireciona pro catálogo
    const url = request.nextUrl.clone();
    url.pathname = "/store/compras";
    return NextResponse.redirect(url);
  }

  // ─── FIREHUB DOMAIN: rotas protegidas /store/* ───────────────
  if (pathname.startsWith("/store")) {
    // EXCEÇÃO: /store/compras é público (catálogo Icebox)
    if (pathname.startsWith("/store/compras")) {
      return NextResponse.next();
    }

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET || "fallback_secret_for_dev",
    });

    if (!token) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", request.url);
      return NextResponse.redirect(loginUrl);
    }

    // Só FRANCHISEE e ADMIN podem acessar /store
    const role = token.role as string;
    if (role !== "FRANCHISEE" && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
