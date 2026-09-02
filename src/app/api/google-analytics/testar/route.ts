import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { enviarCompraParaGa4, enviarEventoDeTesteGa4 } from "@/lib/ga4-mp";

/**
 * Valida a configuração do GA4 do lojista, sem sujar o relatório dele.
 *
 * ── POR QUE VALIDAR EM VEZ DE "MANDAR UM EVENTO DE TESTE" ───────────────────
 *
 * O endpoint de produção do Measurement Protocol responde 204 para QUALQUER
 * coisa — inclusive para um segredo errado ou um ID de container no lugar do
 * ID de métrica. Um botão que dissesse "deu certo" com base nesse 204 mentiria
 * exatamente nos casos em que o lojista precisa da verdade.
 *
 * O endpoint de validação (`/debug/mp/collect`) devolve o que está errado no
 * formato e NÃO grava nada.
 *
 * ── MAS ELE SOZINHO NÃO BASTA, E QUASE PASSOU BATIDO ────────────────────────
 *
 * Medido em 01/09/2026: com um `api_secret` INVENTADO, o endpoint de validação
 * responde sem reclamar nada. Ele confere o FORMATO do evento, não a
 * autenticação. Um botão que dissesse "deu certo" só com base nisso mentiria
 * exatamente para quem colou o segredo errado.
 *
 * Por isso o teste tem dois passos:
 *   1. valida o formato (não grava nada);
 *   2. manda um evento DE VERDADE, `firehub_teste_conexao` — nome próprio, sem
 *      valor e sem receita, para não sujar o relatório de vendas.
 *
 * A prova é o passo 2 aparecer no relatório Tempo real da propriedade. Se o
 * segredo estiver errado, o Google responde 204 igual e nada aparece lá — e é
 * isso que a mensagem da tela manda o lojista conferir.
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

  const medicaoInformada = String(corpo?.measurementId || "").trim().toUpperCase();
  const segredoInformado = String(corpo?.apiSecret || "").trim();

  // Aceita o que está na tela (ainda não salvo): obrigar a salvar antes de
  // testar obrigaria a gravar um segredo errado para descobrir que está errado.
  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { gaMeasurementId: true, gaApiSecret: true },
  });

  const measurementId = medicaoInformada || loja?.gaMeasurementId || "";
  const apiSecret = segredoInformado || loja?.gaApiSecret || "";

  if (!measurementId) {
    return NextResponse.json({ ok: false, erro: "Informe o ID de métrica (G-XXXXXXXXXX)." }, { status: 400 });
  }
  if (!apiSecret) {
    return NextResponse.json({ ok: false, erro: "Informe o segredo do Measurement Protocol." }, { status: 400 });
  }

  const r = await enviarCompraParaGa4({
    measurementId,
    apiSecret,
    // Prefixo para nunca colidir com o transaction_id de um pedido real —
    // ainda que a validação não grave nada.
    orderId: `teste-${franchiseeId.slice(-6)}`,
    valor: 1,
    moeda: "BRL",
    // client_id fictício no formato que o GA4 espera (<aleatório>.<epoch>).
    clientId: "1234567890.1234567890",
    itens: [{ id: "teste", nome: "Item de teste FireHub", quantidade: 1, preco: 1 }],
    modoValidacao: true,
  });

  if (!r.ok) {
    return NextResponse.json({ ok: false, erro: r.erro }, { status: 400 });
  }

  // Passo 2: evento real, o único que prova o segredo.
  const nomeDoEvento = "firehub_teste_conexao";
  const envio = await enviarEventoDeTesteGa4({
    measurementId,
    apiSecret,
    // client_id fixo por loja: repetir o teste não infla a contagem de
    // visitantes com um usuário novo a cada clique.
    clientId: `${franchiseeId.replace(/\D/g, "").slice(-10) || "1234567890"}.1234567890`,
    nomeDoEvento,
  });
  if (!envio.ok) {
    return NextResponse.json({ ok: false, erro: envio.erro }, { status: 400 });
  }

  return NextResponse.json({ ok: true, measurementId, nomeDoEvento });
}
