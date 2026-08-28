import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { enviarCompraParaMeta } from "@/lib/meta-capi";

/**
 * Dispara um Purchase de TESTE para a API de Conversões.
 *
 * Serve para o lojista (ou o gestor de tráfego dele) provar, sem fazer um
 * pedido de verdade, que o evento sai daqui e chega no Meta.
 *
 * Vai com `test_event_code`: o evento aparece ao vivo na aba "Testar eventos"
 * do Gerenciador de Eventos e NÃO entra nos dados da campanha. Sem esse código
 * o teste sujaria o relatório com uma venda que não existiu — e, pior,
 * ensinaria o algoritmo com um dado falso.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const eu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!eu) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const franchiseeId = eu.ownerId || eu.id;

  let corpo: any = {};
  try { corpo = await req.json(); } catch { }

  const pixelInformado = String(corpo?.pixelId || "").replace(/\D/g, "");
  const tokenInformado = String(corpo?.token || "").trim();

  // Aceita o que está na tela (ainda não salvo) para o lojista testar ANTES de
  // gravar — testar só depois de salvar obrigaria a salvar um token errado
  // para descobrir que estava errado.
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { metaPixelId: true, facebookPixelId: true, metaCapiToken: true, slug: true, city: true, storeName: true },
  });

  const pixelId = pixelInformado || loja?.metaPixelId || loja?.facebookPixelId || "";
  const token = tokenInformado || loja?.metaCapiToken || "";

  if (!pixelId) return NextResponse.json({ ok: false, erro: "Informe o ID do Pixel." }, { status: 400 });
  if (!token) return NextResponse.json({ ok: false, erro: "Informe o token da API de Conversões." }, { status: 400 });

  // Código fixo por loja: o lojista digita ESTE código na aba "Testar eventos"
  // e vê o evento aparecer. Fixo para ele poder deixar a aba aberta e repetir
  // o teste quantas vezes quiser.
  const testEventCode = `TEST${franchiseeId.slice(-6).toUpperCase()}`;

  const r = await enviarCompraParaMeta({
    pixelId,
    token,
    // Prefixo `teste-` para nunca colidir com o event_id de um pedido real.
    orderId: `teste-${franchiseeId.slice(-6)}`,
    valor: 1,
    moeda: "BRL",
    urlDaLoja: loja?.slug ? `https://firehubfood.com.br/loja/${loja.slug}` : null,
    // Dados fictícios de propósito: é um teste de encanamento, não um cliente.
    telefone: "22999990000",
    nome: "Teste FireHub",
    cidade: loja?.city || null,
    testEventCode,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, erro: r.erro, testEventCode }, { status: 400 });
  }
  return NextResponse.json({ ok: true, recebidos: r.recebidos, eventId: r.eventId, testEventCode });
}
