import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { ambienteConfigurado, ambientePadrao, cardapiowebConfigurada, ehAmbiente, revogarToken } from "@/lib/cardapioweb/api";
import { iniciarConexao } from "@/lib/cardapioweb/oauth";
import { definirRecebeMarketplaces, desligarInstalacao, instalacoesDasLojas, recebeMarketplaces, webhookMudo } from "@/lib/cardapioweb/instalacoes";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/cardapioweb — o lojista liga as lojas dele do CardápioWeb.
 *
 *   GET                                            → como está: lojas ligadas, estado, webhook mudo
 *   POST { acao: "conectar", ambiente? }           → { url } do portal do CardápioWeb (OAuth + PKCE)
 *   POST { acao: "desconectar", companyId }        → desliga aqui e revoga o token lá
 *   POST { acao: "marketplaces", ligado }          → "receber marketplaces pelo CardápioWeb"
 *
 * Multimarca: cada marca é uma loja no CardápioWeb, e cada uma passa pelo
 * "Conectar" (o Proprietário escolhe a loja na tela de consentimento de lá).
 * Todas caem nesta conta. A volta é /api/store/integracoes/cardapioweb/retorno.
 *
 * A loja é SEMPRE a da sessão (funcionário → loja do dono; admin → a loja que
 * ele está operando) — o mesmo controle da rota da Keeta —, e funcionário só
 * mexe aqui com a caixinha que abre a tela de Integrações (lib/permissao-da-tela.ts).
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
      configurada: cardapiowebConfigurada(),
      ambiente: ambientePadrao(),
      lojas: instalacoes.map((i) => ({
        companyId: i.companyId,
        nome: i.nome || `Loja ${i.companyId}`,
        ambiente: i.ambiente,
        estado: i.estado,
        conectadaEm: i.conectadaEm.toISOString(),
        ultimoPedidoEm: i.ultimoPedidoEm ? i.ultimoPedidoEm.toISOString() : null,
        webhookMudo: webhookMudo(i),
      })),
      receberMarketplaces: await recebeMarketplaces(s.lojaId),
    });
  } catch (e: any) {
    console.error("[CardápioWeb] GET integrações:", e?.message);
    return NextResponse.json({ error: "Não consegui ler as lojas do CardápioWeb agora. Tente de novo." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const s = await lojaDaRequisicao(req);
  if ("erro" in s) return s.erro;
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");

  try {
    if (acao === "conectar") {
      if (!cardapiowebConfigurada()) {
        return NextResponse.json({ error: "A integração com o CardápioWeb ainda está sendo liberada para o FireHub. Avisaremos assim que estiver pronta." }, { status: 503 });
      }
      let ambiente = ambientePadrao();
      if (corpo?.ambiente !== undefined && corpo?.ambiente !== null && corpo?.ambiente !== "") {
        if (!ehAmbiente(corpo.ambiente) || !ambienteConfigurado(corpo.ambiente)) {
          return NextResponse.json({ error: `O ambiente "${String(corpo.ambiente)}" do CardápioWeb não está liberado no servidor.` }, { status: 400 });
        }
        ambiente = corpo.ambiente;
      }
      if (!ambiente) return NextResponse.json({ error: "A integração com o CardápioWeb ainda está sendo liberada para o FireHub." }, { status: 503 });
      const { url } = await iniciarConexao({ franchiseeId: s.lojaId, ambiente, quem: s.email, host: req.headers.get("host") });
      console.log(`[CardápioWeb] 🔗 loja ${s.lojaId} abriu a conexão (${ambiente}) — ${s.email}`);
      return NextResponse.json({ url });
    }

    if (acao === "desconectar") {
      const companyId = String(corpo?.companyId ?? "").trim();
      if (!companyId) return NextResponse.json({ error: "Diga qual loja do CardápioWeb desligar (companyId)." }, { status: 400 });
      const ambiente = ehAmbiente(corpo?.ambiente) ? corpo.ambiente : null;
      const desligadas = await desligarInstalacao(s.lojaId, companyId, ambiente);
      if (desligadas.length === 0) return NextResponse.json({ error: "Esta loja do CardápioWeb não está ligada nesta conta." }, { status: 404 });
      // Revoga lá também (melhor esforço): quem desliga não deixa credencial viva.
      await Promise.all(
        desligadas.flatMap((d) => [revogarToken(d.instalacao.ambiente, d.tokens?.refreshToken), revogarToken(d.instalacao.ambiente, d.tokens?.accessToken)]),
      ).catch(() => {});
      console.log(`[CardápioWeb] 🔌 loja ${s.lojaId} desligou a loja ${companyId} do CardápioWeb — ${s.email}`);
      return NextResponse.json({ ok: true });
    }

    if (acao === "marketplaces") {
      if (typeof corpo?.ligado !== "boolean") return NextResponse.json({ error: "Mande ligado: true ou false." }, { status: 400 });
      await definirRecebeMarketplaces(s.lojaId, corpo.ligado, s.email);
      console.log(`[CardápioWeb] 🛒 loja ${s.lojaId} ${corpo.ligado ? "LIGOU" : "desligou"} "receber marketplaces pelo CardápioWeb" — ${s.email}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e: any) {
    console.error(`[CardápioWeb] POST ${acao}:`, e?.message);
    return NextResponse.json({ error: "Não consegui concluir agora. Tente de novo em instantes." }, { status: 500 });
  }
}
