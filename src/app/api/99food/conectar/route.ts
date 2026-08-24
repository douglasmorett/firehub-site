import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAuthorizationUrl, getAuthToken, food99Configurado } from "@/lib/food99-api";

export const dynamic = "force-dynamic";

/**
 * Conexão do lojista com o 99Food — autoatendimento, sem ninguém do FireHub no meio.
 *
 * GET  → diz se a loja já está conectada (consulta o 99Food, não o nosso banco)
 * POST → gera a URL onde o lojista autoriza com a conta DELE
 *
 * Por que isto substitui o formulário antigo:
 *
 * A tela de Integrações pedia Merchant ID, App ID e Secret Key ao lojista e,
 * ao salvar, marcava `food99Connected = true` e escrevia "conectado com
 * sucesso" — sem falar com o 99Food uma única vez. O lojista via "conectado" e
 * nunca recebia pedido. Pior: App ID e Secret são credenciais do FIREHUB, não
 * dele; nenhum lojista teria de onde tirá-las.
 *
 * Aqui `conectado` é o que o 99Food responde, não o que alguém digitou. O
 * app_shop_id é o id da loja no nosso banco, então a amarração é automática e
 * o pedido chega sabendo de quem é.
 */

async function lojaDaSessao(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  // Funcionário conecta a loja do dono, não uma loja própria.
  const lojaId = user.ownerId || user.id;
  return { lojaId, nome: user.storeName || "" };
}

export async function GET(req: NextRequest) {
  const r = await lojaDaSessao(req);
  if ("erro" in r) return r.erro;

  if (!food99Configurado()) {
    return NextResponse.json({
      conectado: false,
      disponivel: false,
      mensagem:
        "A integração 99Food ainda não foi habilitada no servidor " +
        "(faltam FOOD99_APP_ID e FOOD99_APP_SECRET).",
    });
  }

  const resultado = await getAuthToken(r.lojaId);

  if (resultado.autorizada) {
    return NextResponse.json({
      conectado: true,
      disponivel: true,
      expiraEm: new Date(resultado.token.token_expiration_time * 1000).toISOString(),
      mensagem: "Loja conectada ao 99Food. Os pedidos chegam automaticamente.",
    });
  }

  return NextResponse.json({
    conectado: false,
    disponivel: true,
    erro: resultado.erro,
    mensagem: resultado.erro
      ? `Não consegui confirmar com o 99Food: ${resultado.erro}`
      : "Loja ainda não autorizada. Clique em conectar para autorizar no 99Food.",
  });
}

export async function POST(req: NextRequest) {
  const r = await lojaDaSessao(req);
  if ("erro" in r) return r.erro;

  if (!food99Configurado()) {
    return NextResponse.json(
      { error: "Integração 99Food não habilitada no servidor (FOOD99_APP_ID / FOOD99_APP_SECRET)." },
      { status: 503 }
    );
  }

  // Gerada na hora do clique de propósito: a URL carrega timestamp e
  // assinatura, e perde a validade. Guardar uma URL dessas em banco daria um
  // botão que funciona hoje e falha calado na semana que vem.
  const resultado = await getAuthorizationUrl(r.lojaId);
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 502 });
  }

  console.log(`[99Food] URL de autorização gerada para a loja ${r.lojaId} (${r.nome})`);
  return NextResponse.json({
    url: resultado.url,
    instrucao:
      "Abra este link e entre com a conta que a sua loja usa no 99Food " +
      "(a mesma onde você vê os pedidos). Depois de autorizar, volte e atualize esta tela.",
  });
}
