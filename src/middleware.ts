import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = (request.headers.get("host") || "").toLowerCase();

  // Icebox domain: não exige login para nenhuma rota de compra
  const isIcebox = host.includes("iceboxdistribuidora");
  if (isIcebox) {
    // Permite tudo no domínio Icebox — a autenticação é tratada na página
    return NextResponse.next();
  }

  // Rotas protegidas: /store/* exige autenticação (exceto /store/compras)
  if (pathname.startsWith("/store")) {
    // /store/compras é público (catálogo Icebox acessível pelo FireHub também)
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
