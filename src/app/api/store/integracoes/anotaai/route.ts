import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { anotaAiConfigurado, idPageDoToken, listarPedidosAnotaAi, payloadDoJwt, vincularPaginaAnotaAi } from "@/lib/anotaai/api";
import { desligarLojaAnotaAi, ligarLojaAnotaAi, lojasAnotaAiDaConta } from "@/lib/anotaai/lojas";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/anotaai — o lojista liga as lojas dele do Anota AI.
 *
 *   GET                                        → lojas ligadas, último pedido, último erro
 *   POST { acao: "conectar", chave, nome? }    → vincula pela "Chave de integração" do admin do Anota AI
 *   POST { acao: "desconectar", pageId }       → desliga aqui
 *
 * Conectar: o lojista copia a chave em Anota AI › Configuração Geral ›
 * Integrações › "Chave de integração (Token)" e cola no FireHub. O FireHub
 * vincula a página ao parceiro (`linkpage-by-token`), tira o `idpage` do token
 * que o Anota AI devolve e PROVA o vínculo lendo a lista de pedidos com ele —
 * só então liga. A chave em si não é guardada.
 *
 * O "Token da unidade" do Portal de Integração (o JWT com `idpartner` e
 * `idpage`, vínculo feito à mão pelo FireHub no portal) só vale para ADMIN:
 * a assinatura dele não é conferida aqui, e um JWT montado à mão ligaria a
 * página de outro restaurante. Lojista sempre passa pelo `linkpage-by-token`.
 *
 * A loja é SEMPRE a da sessão (molde da rota do CardápioWeb).
 */

async function lojaDaRequisicao(req: NextRequest): Promise<{ lojaId: string; email: string; admin: boolean } | { erro: NextResponse }> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { erro: NextResponse.json({ error: "Faça login no painel." }, { status: 401 }) };
  const usuario = await prisma.user.findUnique({ where: { email }, select: { role: true, permissions: true } }).catch(() => null);
  if (usuario?.role === "STAFF" && !funcionarioAbre("/store/integracoes", usuario.permissions)) {
    return { erro: NextResponse.json({ error: "Seu usuário não tem acesso às integrações da loja." }, { status: 403 }) };
  }
  const lojaId = await lojaDaSessao(email, req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null);
  if (!lojaId) return { erro: NextResponse.json({ error: "Loja não encontrada." }, { status: 404 }) };
  // Papel lido do banco agora (não o do cookie do login).
  return { lojaId, email, admin: usuario?.role === "ADMIN" };
}

export async function GET(req: NextRequest) {
  const s = await lojaDaRequisicao(req);
  if ("erro" in s) return s.erro;
  try {
    const lojas = await lojasAnotaAiDaConta([s.lojaId]);
    return NextResponse.json({
      configurada: anotaAiConfigurado(),
      lojas: lojas.map((l) => ({
        pageId: l.pageId,
        nome: l.nome || "Loja do Anota AI",
        conectadaEm: l.conectadaEm.toISOString(),
        ultimoPedidoEm: l.ultimoPedidoEm ? l.ultimoPedidoEm.toISOString() : null,
        ultimoPollingEm: l.ultimoPollingEm ? l.ultimoPollingEm.toISOString() : null,
        ultimoErro: l.ultimoErro,
      })),
    });
  } catch (e: any) {
    console.error("[Anota AI] GET integrações:", e?.message);
    return NextResponse.json({ error: "Não consegui ler as lojas do Anota AI agora. Tente de novo." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const s = await lojaDaRequisicao(req);
  if ("erro" in s) return s.erro;
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");

  try {
    if (acao === "conectar") {
      if (!anotaAiConfigurado()) {
        return NextResponse.json({ error: "A integração com o Anota AI ainda está sendo liberada para o FireHub. Avisaremos assim que estiver pronta." }, { status: 503 });
      }
      const chave = String(corpo?.chave || "").replace(/\s+/g, "");
      const nome = String(corpo?.nome || "").trim().slice(0, 80) || null;
      if (chave.length < 20 || chave.length > 4000) {
        return NextResponse.json({ error: "Cole a Chave de integração inteira (Anota AI › Configuração Geral › Integrações)." }, { status: 400 });
      }

      // Token da unidade do Portal de Integração (já vinculado): o idpage sai
      // de um JWT sem assinatura conferida — só o ADMIN usa este atalho.
      const dadosDoToken = payloadDoJwt(chave);
      let pageId = s.admin && dadosDoToken?.idpartner ? idPageDoToken(chave) : null;
      if (!pageId) {
        const v = await vincularPaginaAnotaAi(chave, s.lojaId);
        if (!v.ok) {
          console.warn(`[Anota AI] vínculo recusado para a loja ${s.lojaId}: ${v.erro}`);
          const dica = dadosDoToken?.idpartner ? " Isto parece o Token da unidade do Portal de Integração: cole a Chave de integração do admin do Anota AI." : " Confira se copiou a Chave de integração inteira.";
          return NextResponse.json({ error: `O Anota AI não aceitou esta chave (${v.erro}).${dica}` }, { status: 400 });
        }
        // Só o idpage que o Anota AI DEVOLVEU: o da chave colada não prova nada.
        pageId = idPageDoToken(v.dados?.info?.token);
        if (!pageId) {
          // Doc de parceiro é promessa: o formato do `info.token` não está
          // descrito. Só as CHAVES vão para o log, nunca o valor.
          console.error(`[Anota AI] vínculo ok, mas sem idpage — chaves da resposta: ${JSON.stringify(Object.keys(v.dados?.info || {}))}`);
          return NextResponse.json({ error: "O Anota AI aceitou a chave, mas não devolveu o código da loja. Fale com o suporte do FireHub para concluirmos a ligação." }, { status: 502 });
        }
      }

      // Prova: a lista de pedidos abre com este idpage.
      const prova = await listarPedidosAnotaAi(pageId);
      if (!prova.ok) {
        return NextResponse.json({ error: `A loja foi encontrada, mas o Anota AI não liberou os pedidos dela para o FireHub (${prova.erro}).` }, { status: 502 });
      }

      const r = await ligarLojaAnotaAi({ pageId, franchiseeId: s.lojaId, nome, quem: s.email, podeTrocarDono: s.admin });
      if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 409 });
      console.log(`[Anota AI] 🔗 loja ${s.lojaId} ligou a página ${pageId} — ${s.email}`);
      return NextResponse.json({ ok: true, pageId });
    }

    if (acao === "desconectar") {
      const pageId = String(corpo?.pageId ?? "").trim();
      if (!pageId) return NextResponse.json({ error: "Diga qual loja do Anota AI desligar (pageId)." }, { status: 400 });
      const ok = await desligarLojaAnotaAi(s.lojaId, pageId);
      if (!ok) return NextResponse.json({ error: "Esta loja do Anota AI não está ligada nesta conta." }, { status: 404 });
      console.log(`[Anota AI] 🔌 loja ${s.lojaId} desligou a página ${pageId} — ${s.email}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e: any) {
    console.error(`[Anota AI] POST ${acao}:`, e?.message);
    return NextResponse.json({ error: "Não consegui concluir agora. Tente de novo em instantes." }, { status: 500 });
  }
}
