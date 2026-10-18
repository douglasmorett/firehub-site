/**
 * POST /api/app-da-loja/abertura
 *   { instalacaoId, pagina, pushToken?, plataforma, versaoDoApp, app, promocoes?, batida? }
 *
 * O app próprio da loja (apps/loja/src/lib/presenca.ts) avisa ao abrir, ao
 * voltar para a frente e de 4 em 4 minutos enquanto está na tela (`batida`).
 * É daqui que saem "instalações", "ativos agora" e o público das notificações
 * da tela Meu aplicativo (lib/app-da-loja/instalacoes.ts).
 *
 * Pública (o cliente do app não tem login). O que protege:
 * - limite por IP (folgado: operadora de celular põe muita gente atrás do
 *   mesmo IP) e por instalação;
 * - o token de aviso tem de ter a cara de um token do Expo;
 * - a loja sai da PÁGINA que o app abre (/lojas/<slug>), resolvida aqui —
 *   o app não escolhe o id de loja nenhuma;
 * - não devolve nada além de "ok".
 */
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { tokenDeNotificacaoValido } from "@/lib/app-da-loja/aparelhos";
import { instalacaoValida, lojaDoAppPelaPagina, registrarAbertura } from "@/lib/app-da-loja/instalacoes";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`app-loja-abertura-ip:${ip}`, { windowMs: 60_000, maxRequests: 120 }).allowed) {
      return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });
    }
    const corpo = await req.json().catch(() => ({} as any));
    const { instalacaoId, pagina, pushToken, plataforma, versaoDoApp, app, promocoes, batida } = corpo || {};
    if (!instalacaoValida(instalacaoId)) return NextResponse.json({ error: "Instalação inválida." }, { status: 400 });
    if (!checkRateLimit(`app-loja-abertura:${instalacaoId}`, { windowMs: 60_000, maxRequests: 6 }).allowed) {
      return NextResponse.json({ error: "Aguarde um instante." }, { status: 429 });
    }
    if (pushToken != null && pushToken !== "" && !tokenDeNotificacaoValido(pushToken)) {
      return NextResponse.json({ error: "Token de notificação inválido." }, { status: 400 });
    }
    const loja = await lojaDoAppPelaPagina(pagina);
    if (!loja) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

    const gravou = await registrarAbertura({
      chave: loja.chave,
      tz: loja.tz,
      instalacaoId,
      pushToken: tokenDeNotificacaoValido(pushToken) ? pushToken : null,
      plataforma: typeof plataforma === "string" ? plataforma : null,
      versaoDoApp: typeof versaoDoApp === "string" ? versaoDoApp : null,
      app: typeof app === "string" ? app : null,
      promocoes: typeof promocoes === "boolean" ? promocoes : null,
      batida: batida === true,
    });
    if (!gravou) return NextResponse.json({ error: "Agora não deu." }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[App da Loja Abertura POST]", err?.message);
    return NextResponse.json({ error: "Erro ao registrar a abertura" }, { status: 500 });
  }
}
