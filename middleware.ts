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
  // Lista VAZIA em `camera=()` nao restringe terceiros: desliga o recurso ate
  // para a propria origem. Estavam desligados os dois que o app usa:
  //   - camera  -> o leitor de codigo de barras do financeiro (BarcodeScanner)
  //                nunca abriu em celular nenhum, e ninguem reportou porque
  //                quase nao se usa. Tambem impediria o scanner de QR das
  //                etiquetas antes mesmo de ele existir.
  //   - geolocation -> o app do motoboy e a pagina do cliente pedem posicao.
  // O next.config ja pedia `geolocation=(self)` e este arquivo dizia `()`. Qual
  // dos dois vale DEPENDE DA ROTA — medido em producao em 28/08/2026:
  //     /store/*                    -> geolocation=(self)   (vence o next.config)
  //     /, /api/*, /loja/*, /downloads/* -> geolocation=()  (vence este arquivo)
  // E o azar estava exatamente aí: os dois unicos consumidores de GPS do sistema
  // — o app do motoboy e a pagina do cliente — moram em /loja/*, a faixa em que
  // o `()` valia. `camera=()` estava nas duas metades, sem escapatoria.
  // Por isso os dois arquivos agora dizem a MESMA coisa: assim nao importa qual
  // vence em qual rota. Divergir foi o que escondeu o problema.
  // `microphone` segue vazio de proposito — nada no app grava audio.
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(self)",
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
  //
  // ⚠️ Chamada de dentro do próprio container fica de fora.
  //
  // O server standalone do Next injeta `x-forwarded-proto: http` sozinho em
  // requisição HTTP direta. Como o cron-runner chama http://localhost:3000, TODO
  // cron levava 301 para https://0.0.0.0:3000 e nunca executava — visto no log de
  // produção: ifood-poll, jotaja-poll, billing-close, meta-ads-sync,
  // health-check e gateway-keepalive, todos parados em "retornou 301".
  //
  // Isso não afrouxa nada para fora: requisição externa chega com o Host do
  // domínio, nunca com localhost, e continua sendo redirecionada para HTTPS.
  const hostDaRequisicao = (request.headers.get("host") || "").toLowerCase();
  const ehChamadaLocal =
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(hostDaRequisicao);

  if (
    process.env.NODE_ENV === "production" &&
    request.headers.get("x-forwarded-proto") === "http" &&
    !ehChamadaLocal
  ) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    return NextResponse.redirect(url, 301);
  }

  // ─── DOMÍNIO DA ICEBOX ────────────────────────────────────────────────────
  // iceboxdistribuidora.com.br era servido por um projeto Vercel PRÓPRIO, que
  // foi apagado. O domínio continuou na conta apontando para lugar nenhum, e
  // quem tentava comprar recebia DEPLOYMENT_NOT_FOUND — a loja fechada sem
  // ninguém perceber, porque nada no FireHub monitora esse domínio.
  //
  // As páginas sempre estiveram AQUI: /icebox/compras, /icebox/login e
  // /icebox/cart. Então o domínio passa a ser servido por este projeto, e a
  // raiz dele abre o catálogo em vez da página do FireHub.
  //
  // É rewrite e não redirect: o cliente continua vendo iceboxdistribuidora.com.br
  // na barra de endereço, que é o domínio que ele conhece.
  const hostSemPorta = hostDaRequisicao.split(":")[0];
  const ehDominioIcebox = /^(www.)?iceboxdistribuidora.com.br$/i.test(hostSemPorta);
  if (ehDominioIcebox && (pathname === "/" || pathname === "")) {
    const url = request.nextUrl.clone();
    url.pathname = "/icebox/compras";
    return NextResponse.rewrite(url);
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
