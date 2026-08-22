import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// ─── CORS: allowed origins (inlined for Edge Runtime compatibility) ───
const ALLOWED_ORIGINS = [
  "https://firehubfood.com.br",
  "https://www.firehubfood.com.br",
  "http://localhost:3000",
  "http://localhost:3001",
];

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  // Antes havia `|| origin.endsWith(".vercel.app")`, o que liberava QUALQUER
  // site hospedado na Vercel a chamar esta API de outro domínio. Removido junto
  // com a saída da Vercel.
  const isAllowed = ALLOWED_ORIGINS.includes(origin);

  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// ─── Security headers applied to every response ───
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

function safeUrl(path: string, base: string): URL {
  try {
    if (base && !base.includes("[SENSITIVE]") && (base.startsWith("http://") || base.startsWith("https://"))) {
      return new URL(path, base);
    }
  } catch (e) {}
  return new URL(path, "https://firehubfood.com.br");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Force HTTPS in production ───
  if (
    process.env.NODE_ENV === "production" &&
    request.headers.get("x-forwarded-proto") === "http"
  ) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    return NextResponse.redirect(url, 301);
  }

  // ─── CORS preflight for API routes ───
  if (pathname.startsWith("/api")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: {
          ...getCorsHeaders(request),
          ...SECURITY_HEADERS,
        },
      });
    }
  }

  // ─── /api/debug/* : bloqueado em produção ───
  // Eram alcançáveis por qualquer um. /api/debug/env vazava e-mails e nomes de
  // todas as lojas JotaJá, host do banco e merchant IDs.
  if (pathname.startsWith("/api/debug")) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse(null, { status: 404, headers: SECURITY_HEADERS });
    }
  }

  // ─── /api/admin/* : exige sessão autenticada ───
  // Não exige role ADMIN de propósito: /api/admin/menu-products e
  // /api/admin/categories são usados pelo PDV por lojistas comuns. O controle
  // fino de role continua dentro de cada rota. Aqui só se corta o acesso
  // ANÔNIMO, que hoje permitia a qualquer um na internet chamar
  // seed-hakim-menu, clean-stale-orders, fix-daily-numbers etc.
  if (pathname.startsWith("/api/admin")) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
      return NextResponse.json(
        { error: "Não autorizado" },
        { status: 401, headers: { ...SECURITY_HEADERS, ...getCorsHeaders(request) } }
      );
    }
  }

  // Rotas protegidas: /store/* exige autenticação
  if (pathname.startsWith("/store")) {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      const loginUrl = safeUrl("/login", request.url);
      if (request.url && !request.url.includes("[SENSITIVE]")) {
        try {
          loginUrl.searchParams.set("callbackUrl", request.url);
        } catch (e) {}
      }
      return NextResponse.redirect(loginUrl);
    }

    // Controle de role é feito server-side em cada page/layout
  }

  // ─── Build response with security headers ───
  const response = NextResponse.next();

  // Add security headers to every response
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // Add CORS headers for API routes
  if (pathname.startsWith("/api")) {
    const corsHeaders = getCorsHeaders(request);
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
