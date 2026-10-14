import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerConfigDoPainel, normalizarCodigo, separarSenhas } from "@/lib/painel-de-senhas";
import { linkDoCardapioDaLoja } from "@/lib/saudacao-do-dia";

/**
 * O que a TV do Painel de senhas desenha (lib/painel-de-senhas.ts).
 *
 * Pública: a TV não faz login. Quem abre é quem tem o CÓDIGO que a loja vê no
 * painel; trocar o código lá desconecta a TV na próxima pergunta. Só sai
 * número, primeiro nome (se a loja ligou) e a marca da loja.
 *
 * A TV pergunta a cada 4 s, e a loja pode ter mais de uma TV: a resposta fica
 * 2 s na memória por loja, para três TVs não virarem três consultas.
 */
const guardado = new Map<string, { em: number; corpo: unknown }>();
const VALIDADE_MS = 2000;

const STATUS_NA_TELA = ["NOVO", "ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA"];

export async function GET(req: NextRequest) {
  const lojaId = String(req.nextUrl.searchParams.get("loja") || "").slice(0, 40);
  const codigo = normalizarCodigo(req.nextUrl.searchParams.get("codigo"));
  if (!lojaId || !codigo) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }

  const chave = `${lojaId}:${codigo}`;
  const pronto = guardado.get(chave);
  if (pronto && Date.now() - pronto.em < VALIDADE_MS) {
    return NextResponse.json(pronto.corpo, { headers: { "Cache-Control": "no-store" } });
  }

  const loja = await prisma.user
    .findUnique({
      where: { id: lojaId },
      select: { storeName: true, name: true, storeLogo: true, slug: true, chatbotConfig: true, painelDeSenhas: true },
    })
    .catch(() => null);
  const config = lerConfigDoPainel(loja?.painelDeSenhas);
  if (!loja || !config.codigo || config.codigo !== codigo) {
    // 410: a TV para de perguntar e volta para a tela do código.
    return NextResponse.json({ error: "Este código não vale mais. Peça o código novo no painel da loja." }, { status: 410 });
  }

  const agora = Date.now();
  // Só os tipos que a loja escolheu — 200 deliveries não podem empurrar o
  // balcão para fora da consulta.
  const tipos: object[] = [];
  if (config.balcao) tipos.push({ deliveryType: { notIn: ["DELIVERY", "MESA"] } });
  if (config.mesa) tipos.push({ deliveryType: "MESA" });
  if (config.delivery) tipos.push({ deliveryType: "DELIVERY" });

  const pedidos = tipos.length
    ? await prisma.customerOrder.findMany({
        where: {
          franchiseeId: lojaId,
          createdAt: { gte: new Date(agora - 12 * 3600_000) },
          status: { in: STATUS_NA_TELA },
          dailyOrderNumber: { not: null },
          // O acréscimo colado é parte do pedido pai, não senha nova.
          parentOrderId: null,
          OR: tipos,
        },
        select: {
          id: true, dailyOrderNumber: true, customerName: true, status: true, deliveryType: true,
          kdsStage: true, readyAt: true, updatedAt: true, createdAt: true, scheduledDatetime: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  const { preparando, prontos } = separarSenhas(pedidos, config, agora);
  const corpo = {
    loja: {
      nome: loja.storeName || loja.name || "",
      logo: loja.storeLogo || null,
      cardapio: config.qrDoCardapio ? linkDoCardapioDaLoja(loja) || null : null,
    },
    config: {
      mostrarNome: config.mostrarNome,
      som: config.som,
      voz: config.voz,
      mensagem: config.mensagem,
      cor: config.cor,
    },
    preparando: preparando.slice(0, 40),
    prontos: prontos.slice(0, 24),
    agora: new Date(agora).toISOString(),
  };

  if (guardado.size > 500) guardado.clear();
  guardado.set(chave, { em: agora, corpo });
  return NextResponse.json(corpo, { headers: { "Cache-Control": "no-store" } });
}
