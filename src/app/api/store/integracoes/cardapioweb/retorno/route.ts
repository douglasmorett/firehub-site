import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { cardapiowebConfigurada, contextoDaInstalacao, revogarToken, trocarCodigoPorTokens } from "@/lib/cardapioweb/api";
import { consumirEstado, urlDoFireHub } from "@/lib/cardapioweb/oauth";
import { gravarInstalacao } from "@/lib/cardapioweb/instalacoes";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/integracoes/cardapioweb/retorno?code&state — a Redirect URI
 * cadastrada no app do CardápioWeb (tem de ser idêntica à do cadastro).
 *
 * O portal devolve o Proprietário aqui depois do consentimento. Nesta ordem:
 *   1. o `state` é um que o FireHub emitiu, no prazo, nunca usado, e da MESMA
 *      loja da sessão (lib/cardapioweb/oauth.ts);
 *   2. troca o `code` pelo token no servidor, com o `code_verifier` guardado;
 *   3. pergunta ao CardápioWeb QUAL loja foi autorizada (`identity/context`) —
 *      o vínculo nasce só desse `company.id`;
 *   4. grava a instalação (tokens cifrados) e volta para Integrações.
 *
 * Qualquer falha volta para Integrações com o motivo escrito
 * (`cardapioweb=erro&motivo=…`), nunca uma tela de erro do servidor.
 */
function voltar(base: string, resultado: "ok" | "erro", motivo?: string) {
  const url = new URL(`${base}/store/integracoes`);
  url.searchParams.set("integracao", "cardapioweb");
  url.searchParams.set("cardapioweb", resultado);
  if (motivo) url.searchParams.set("motivo", motivo.slice(0, 220));
  return NextResponse.redirect(url.toString(), 303);
}

export async function GET(req: NextRequest) {
  const base = urlDoFireHub(req.headers.get("host"));
  if (!cardapiowebConfigurada()) return voltar(base, "erro", "A integração com o CardápioWeb ainda não foi liberada no servidor.");

  const params = req.nextUrl.searchParams;
  const erroDoPortal = params.get("error");
  if (erroDoPortal) {
    const motivo =
      erroDoPortal === "access_denied"
        ? "O CardápioWeb não autorizou: só o Proprietário da loja pode instalar. Entre lá com a conta de Proprietário e clique em Conectar de novo."
        : `O CardápioWeb recusou a autorização (${erroDoPortal}).`;
    return voltar(base, "erro", motivo);
  }

  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) {
    // Sessão caiu no meio: loga e volta para ESTE endereço, com o code e o state.
    const aqui = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    return NextResponse.redirect(`${base}/login?callbackUrl=${encodeURIComponent(aqui)}`, 303);
  }
  const usuario = await prisma.user.findUnique({ where: { email }, select: { role: true, permissions: true } }).catch(() => null);
  if (usuario?.role === "STAFF" && !funcionarioAbre("/store/integracoes", usuario.permissions)) {
    return voltar(base, "erro", "Seu usuário não tem acesso às integrações da loja.");
  }
  const lojaId = await lojaDaSessao(email, req.cookies.get("firehub_active_store")?.value || null);
  if (!lojaId) return voltar(base, "erro", "Loja não encontrada na sessão.");

  try {
    const estado = await consumirEstado(params.get("state"), lojaId);
    if (!estado.ok) return voltar(base, "erro", estado.motivo);

    const code = params.get("code") || "";
    if (!code) return voltar(base, "erro", "O CardápioWeb não devolveu a autorização. Clique em Conectar de novo.");

    const t = await trocarCodigoPorTokens(estado.ambiente, { code, redirectUri: estado.redirectUri, codeVerifier: estado.codeVerifier });
    if (!t.ok || !t.dados) return voltar(base, "erro", `O CardápioWeb recusou a troca da autorização: ${t.erro}`);
    const tokens = t.dados;

    const ctx = await contextoDaInstalacao(estado.ambiente, tokens.accessToken);
    if (!ctx.ok || !ctx.dados) {
      await revogarToken(estado.ambiente, tokens.refreshToken || tokens.accessToken);
      const motivo = ctx.status === 403 ? "O app do FireHub está sem a permissão de identidade (auth) no CardápioWeb." : `O CardápioWeb não disse qual loja foi autorizada: ${ctx.erro}`;
      return voltar(base, "erro", motivo);
    }
    const escopos = ctx.dados.escopos.length > 0 ? ctx.dados.escopos : String(tokens.escopos || "").split(/\s+/).filter(Boolean);
    if (escopos.length > 0 && !escopos.includes("orders")) {
      await revogarToken(estado.ambiente, tokens.refreshToken || tokens.accessToken);
      return voltar(base, "erro", "A autorização veio sem a permissão de pedidos (orders). Fale com o suporte do FireHub.");
    }

    const v = await gravarInstalacao({
      ambiente: estado.ambiente,
      companyId: ctx.dados.companyId,
      franchiseeId: lojaId,
      nome: ctx.dados.companyNome || null,
      tokens: { ...tokens, escopos: escopos.join(" ") || tokens.escopos },
      quem: email,
      cwUserId: ctx.dados.userId,
      cwUserEmail: ctx.dados.userEmail,
    });
    if (!v.ok) return voltar(base, "erro", v.motivo);
    console.log(
      `[CardápioWeb] 🔗 loja ${lojaId} ligou "${ctx.dados.companyNome}" (company ${ctx.dados.companyId}, ${estado.ambiente})${v.nova ? "" : " — religada"} — ${email}`,
    );
    return voltar(base, "ok");
  } catch (e: any) {
    console.error("[CardápioWeb] ❌ retorno da autorização:", e?.message);
    return voltar(base, "erro", "Não consegui concluir a conexão agora. Clique em Conectar de novo.");
  }
}
