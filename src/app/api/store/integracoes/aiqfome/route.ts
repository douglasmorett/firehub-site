import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { aiqfomeConfigurada, cadastrarWebhooks, urlDoWebhook } from "@/lib/aiqfome/api";
import { iniciarConexao } from "@/lib/aiqfome/oauth";
import { desligarInstalacao, instalacoesDasLojas, registrarCadastroDeWebhooks, webhookMudo } from "@/lib/aiqfome/instalacoes";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/aiqfome — o lojista liga as lojas dele do aiqfome.
 *
 *   GET                                   → como está: lojas ligadas, estado, webhooks
 *   POST { acao: "conectar" }             → { url } do ID Magalu (OAuth)
 *   POST { acao: "desconectar", storeId } → desliga aqui (apaga os tokens)
 *   POST { acao: "webhooks", storeId }    → tenta cadastrar os webhooks da loja de novo
 *
 * A volta do ID Magalu é /api/store/integracoes/aiqfome/retorno. A loja é
 * SEMPRE a da sessão (o mesmo controle da rota do CardápioWeb), e funcionário
 * só mexe aqui com a caixinha que abre a tela de Integrações.
 */

async function lojaDaRequisicao(req: NextRequest): Promise<{ lojaId: string; email: string } | { erro: NextResponse }> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { erro: NextResponse.json({ error: "Faça login no painel." }, { status: 401 }) };
  const usuario = await prisma.user.findUnique({ where: { email }, select: { role: true, permissions: true } }).catch(() => null);
  if (usuario?.role === "STAFF" && !funcionarioAbre("/store/integracoes", usuario.permissions)) {
    return { erro: NextResponse.json({ error: "Seu usuário não tem acesso às integrações da loja." }, { status: 403 }) };
  }
  const lojaId = await lojaDaSessao(email, req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null);
  if (!lojaId) return { erro: NextResponse.json({ error: "Loja não encontrada." }, { status: 404 }) };
  return { lojaId, email };
}

export async function GET(req: NextRequest) {
  const s = await lojaDaRequisicao(req);
  if ("erro" in s) return s.erro;
  try {
    const instalacoes = await instalacoesDasLojas([s.lojaId]);
    return NextResponse.json({
      configurada: aiqfomeConfigurada(),
      lojas: instalacoes.map((i) => ({
        storeId: i.storeId,
        nome: i.nome || `Loja ${i.storeId}`,
        estado: i.estado,
        conectadaEm: i.conectadaEm.toISOString(),
        ultimoPedidoEm: i.ultimoPedidoEm ? i.ultimoPedidoEm.toISOString() : null,
        webhooksOk: !!i.webhooksEm,
        webhooksErro: i.webhooksErro,
        webhookMudo: webhookMudo(i),
      })),
    });
  } catch (e: any) {
    console.error("[aiqfome] GET integrações:", e?.message);
    return NextResponse.json({ error: "Não consegui ler as lojas do aiqfome agora. Tente de novo." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const s = await lojaDaRequisicao(req);
  if ("erro" in s) return s.erro;
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");

  try {
    if (acao === "conectar") {
      if (!aiqfomeConfigurada()) {
        return NextResponse.json({ error: "A integração com o aiqfome ainda está em homologação. Avisaremos assim que estiver pronta." }, { status: 503 });
      }
      const { url } = await iniciarConexao({ franchiseeId: s.lojaId, quem: s.email, host: req.headers.get("host") });
      console.log(`[aiqfome] 🔗 loja ${s.lojaId} abriu a conexão — ${s.email}`);
      return NextResponse.json({ url });
    }

    if (acao === "desconectar") {
      const storeId = String(corpo?.storeId ?? "").trim();
      if (!storeId) return NextResponse.json({ error: "Diga qual loja do aiqfome desligar (storeId)." }, { status: 400 });
      const desligada = await desligarInstalacao(s.lojaId, storeId);
      if (!desligada) return NextResponse.json({ error: "Esta loja do aiqfome não está ligada nesta conta." }, { status: 404 });
      console.log(`[aiqfome] 🔌 loja ${s.lojaId} desligou a loja ${storeId} do aiqfome — ${s.email}`);
      return NextResponse.json({ ok: true });
    }

    if (acao === "webhooks") {
      if (!aiqfomeConfigurada()) return NextResponse.json({ error: "A integração com o aiqfome ainda está em homologação." }, { status: 503 });
      const storeId = String(corpo?.storeId ?? "").trim();
      const inst = (await instalacoesDasLojas([s.lojaId])).find((i) => i.storeId === storeId);
      if (!inst) return NextResponse.json({ error: "Esta loja do aiqfome não está ligada nesta conta." }, { status: 404 });
      const erro = await cadastrarWebhooks(inst, urlDoWebhook(req.headers.get("host")));
      await registrarCadastroDeWebhooks(inst.id, erro);
      return NextResponse.json({ ok: !erro, erro });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e: any) {
    console.error(`[aiqfome] POST ${acao}:`, e?.message);
    return NextResponse.json({ error: "Não consegui concluir agora. Tente de novo em instantes." }, { status: 500 });
  }
}
