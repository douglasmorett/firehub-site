import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const ICEBOX_DOMAINS = ["iceboxdistribuidora.com.br", "www.iceboxdistribuidora.com.br"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host")?.replace(/:.*$/, "") || "";

  // ─── ICEBOX DOMAIN: redireciona para catálogo ────────────────
  if (ICEBOX_DOMAINS.includes(hostname)) {
    // Se acessou a raiz, manda pro catálogo
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/store/compras";
      return NextResponse.rewrite(url);
    }
    // Se acessou /login, mantém (precisa logar)
    if (pathname === "/login" || pathname === "/cadastro" || pathname === "/esqueci-senha" || pathname === "/redefinir-senha") {
      return NextResponse.next();
    }
    // Se acessou /store/compras ou /store/cart, permite (catálogo público)
    if (pathname.startsWith("/store/compras") || pathname.startsWith("/store/cart")) {
      // Não exige login — a própria page vai tratar se precisa ou não
      return NextResponse.next();
    }
    // API routes são liberadas
    if (pathname.startsWith("/api")) {
      return NextResponse.next();
    }
    // Qualquer outra rota no domínio Icebox → redireciona pro catálogo
    const url = request.nextUrl.clone();
    url.pathname = "/store/compras";
    return NextResponse.rewrite(url);
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
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
