import { NextRequest, NextResponse, after } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { aiqfomeConfigurada, cadastrarWebhooks, lojasDoToken, trocarCodigoPorTokens, urlDoFireHub, urlDoWebhook } from "@/lib/aiqfome/api";
import { consumirEstado } from "@/lib/aiqfome/oauth";
import { gravarAutorizacao, registrarCadastroDeWebhooks } from "@/lib/aiqfome/instalacoes";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/integracoes/aiqfome/retorno?code&state — a redirect_uri
 * cadastrada no app do aiqfome (idêntica à do cadastro).
 *
 * O ID Magalu devolve o lojista aqui depois do consentimento. Nesta ordem:
 *   1. o `state` é um que o FireHub emitiu, no prazo, nunca usado, e da MESMA
 *      conta da sessão (lib/aiqfome/oauth.ts);
 *   2. troca o `code` pelo token no servidor (client_secret);
 *   3. pergunta ao aiqfome QUAIS lojas o token libera (`GET /store`) — o
 *      vínculo nasce só desses ids;
 *   4. grava as instalações (tokens cifrados) e volta para Integrações;
 *   5. depois da resposta, cadastra os webhooks de cada loja. Falha aqui não
 *      desfaz a conexão: o polling de 30 s segura os pedidos e a tela avisa.
 *
 * Qualquer falha volta para Integrações com o motivo escrito.
 */
function voltar(base: string, resultado: "ok" | "erro", motivo?: string) {
  const url = new URL(`${base}/store/integracoes`);
  url.searchParams.set("integracao", "aiqfome");
  url.searchParams.set("aiqfome", resultado);
  if (motivo) url.searchParams.set("motivo", motivo.slice(0, 220));
  return NextResponse.redirect(url.toString(), 303);
}

/** Fora de uma requisição do Next (teste, script) o `after()` lança: aí roda solto. */
function depoisDaResposta(tarefa: () => Promise<void>) {
  try {
    after(tarefa);
  } catch {
    void tarefa().catch((e) => console.error("[aiqfome] ❌ cadastro dos webhooks:", e?.message));
  }
}

const VINCULE_NO_GERALDO = "No Geraldo, vá em Integrações e vincule a loja ao ID Magalu com o mesmo e-mail de dono; depois clique em Conectar de novo.";

export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const base = urlDoFireHub(host);
  if (!aiqfomeConfigurada()) return voltar(base, "erro", "A integração com o aiqfome ainda não foi liberada no servidor.");

  const params = req.nextUrl.searchParams;
  const erroDoId = params.get("error");
  if (erroDoId) {
    const motivo = erroDoId === "access_denied" ? `O ID Magalu não autorizou o FireHub. ${VINCULE_NO_GERALDO}` : `O ID Magalu recusou a autorização (${erroDoId}).`;
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
    if (!code) return voltar(base, "erro", "O ID Magalu não devolveu a autorização. Clique em Conectar de novo.");

    const t = await trocarCodigoPorTokens({ code, redirectUri: estado.redirectUri });
    if (!t.ok || !t.dados) return voltar(base, "erro", `O ID Magalu recusou a troca da autorização: ${t.erro}`);
    const tokens = t.dados;
    const escopos = String(tokens.escopos || "").split(/\s+/).filter(Boolean);
    if (escopos.length > 0 && !(escopos.includes("aqf:order:read") && escopos.includes("aqf:order:create"))) {
      return voltar(base, "erro", "A autorização veio sem a permissão de pedidos do aiqfome. Fale com o suporte do FireHub.");
    }

    const lojas = await lojasDoToken(tokens.accessToken);
    if (!lojas.ok) return voltar(base, "erro", `O aiqfome não disse qual loja foi autorizada: ${lojas.erro}`);
    if (!lojas.dados || lojas.dados.length === 0) return voltar(base, "erro", `O ID Magalu não liberou nenhuma loja do aiqfome. ${VINCULE_NO_GERALDO}`);

    const v = await gravarAutorizacao({ lojas: lojas.dados, franchiseeId: lojaId, tokens, quem: email });
    if (v.ligadas.length === 0) return voltar(base, "erro", v.recusadas[0]?.motivo || "Nenhuma loja do aiqfome foi ligada.");
    console.log(`[aiqfome] 🔗 loja ${lojaId} ligou ${v.ligadas.map((i) => `"${i.nome}" (${i.storeId})`).join(", ")}${v.recusadas.length ? ` — recusadas: ${v.recusadas.map((r) => r.storeId).join(", ")}` : ""} — ${email}`);

    const url = urlDoWebhook(host);
    depoisDaResposta(async () => {
      for (const inst of v.ligadas) {
        const erro = await cadastrarWebhooks(inst, url);
        await registrarCadastroDeWebhooks(inst.id, erro);
        if (erro) console.warn(`[aiqfome] ⚠️ webhooks da loja ${inst.storeId} não cadastrados: ${erro} (o polling segue trazendo os pedidos)`);
      }
    });
    return voltar(base, "ok", v.recusadas.length > 0 ? v.recusadas.map((r) => r.motivo).join(" ") : undefined);
  } catch (e: any) {
    console.error("[aiqfome] ❌ retorno da autorização:", e?.message);
    return voltar(base, "erro", "Não consegui concluir a conexão agora. Clique em Conectar de novo.");
  }
}
