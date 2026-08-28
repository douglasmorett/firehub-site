import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { temEstruturaDeLotes } from "@/lib/garantir-colunas";
import { normalizarCodigo, codigoPlausivel, estadoDePrazo, textoDePrazo } from "@/lib/lote";

/**
 * O que o QR da etiqueta resolve, e por onde a baixa acontece.
 *
 * Quem chega aqui veio da câmera do celular, está de pé na cozinha e tem uma
 * mão livre. Então TODO caminho de saída desta rota é um estado nomeado que a
 * tela sabe desenhar — nunca um 500, nunca uma tela branca.
 */

async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, email: true, storeName: true, name: true },
  });
  if (!u) return null;
  const franchiseeId = u.ownerId || u.id;
  const loja = u.ownerId
    ? await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, name: true } })
    : { storeName: u.storeName, name: u.name };
  return {
    franchiseeId,
    userId: u.id,
    email: u.email,
    nomeDaLoja: loja?.storeName || loja?.name || "sua loja",
  };
}

function comEstado(lote: any) {
  return {
    ...lote,
    estadoDePrazo: estadoDePrazo(lote.validoAte),
    textoDePrazo: textoDePrazo(lote.validoAte),
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const codigo = normalizarCodigo(code);

  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ estado: "NAO_AUTENTICADO", codigo }, { status: 401 });

  if (!(await temEstruturaDeLotes())) {
    return NextResponse.json({ estado: "RECURSO_INDISPONIVEL", codigo, nomeDaLoja: loja.nomeDaLoja });
  }

  if (!codigoPlausivel(codigo)) {
    return NextResponse.json({ estado: "CODIGO_INVALIDO", codigo, nomeDaLoja: loja.nomeDaLoja });
  }

  // Busca pelo código SEM filtrar por loja, e só depois compara: assim um
  // código de outra loja responde "não encontrada" (o mesmo que um código
  // inexistente) em vez de confirmar, pela diferença de resposta, que aquele
  // código existe em algum lugar do sistema.
  const lote = await prisma.stockLot.findUnique({
    where: { code: codigo },
    include: {
      stockItem: { select: { id: true, name: true, unit: true, quantity: true } },
    },
  });

  if (!lote || lote.franchiseeId !== loja.franchiseeId || !lote.active) {
    return NextResponse.json({ estado: "NAO_ENCONTRADA", codigo, nomeDaLoja: loja.nomeDaLoja });
  }

  if (!lote.stockItemId || !lote.stockItem) {
    return NextResponse.json({
      estado: "SEM_INSUMO_VINCULADO",
      codigo,
      nomeDaLoja: loja.nomeDaLoja,
      lote: comEstado(lote),
    });
  }

  // "Já dei baixa nessa agora há pouco": a última movimentação deste lote feita
  // por esta mesma pessoa, nos últimos 2 minutos. É o caso real de escanear
  // duas vezes sem perceber — o scanner dispara fácil em duplicidade.
  const agora = Date.now();
  const recente = await prisma.stockTransaction.findFirst({
    where: {
      stockLotId: lote.id,
      userId: loja.userId,
      createdAt: { gte: new Date(agora - 2 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    estado: recente ? "JA_MOVIMENTADO" : lote.quantidadeRestante <= 0 ? "LOTE_ZERADO" : "OK",
    codigo,
    nomeDaLoja: loja.nomeDaLoja,
    lote: comEstado(lote),
    ultimaMovimentacao: recente
      ? { id: recente.id, quantidade: Math.abs(recente.quantity), tipo: recente.type, quando: recente.createdAt, porQuem: loja.email }
      : null,
  });
}

/**
 * POST — dá saída (ou estorna) a partir da etiqueta.
 *
 * Idempotência por `sourceRef` único: o cliente manda a mesma chave se repetir
 * o envio, e a segunda gravação bate no índice em vez de dobrar a baixa. É a
 * correção estrutural do rastreio por substring em `notes` que o resto do
 * módulo usava.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const codigo = normalizarCodigo(code);

  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await temEstruturaDeLotes())) {
    return NextResponse.json({ error: "Recurso ainda indisponível nesta loja." }, { status: 503 });
  }

  let corpo: any = {};
  try { corpo = await req.json(); } catch { }

  const acao = String(corpo?.acao || "SAIDA").toUpperCase();
  if (acao !== "SAIDA" && acao !== "ESTORNO" && acao !== "DESCARTE") {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }

  const bruto = typeof corpo?.quantidade === "string"
    ? corpo.quantidade.replace(/\./g, "").replace(",", ".")
    : corpo?.quantidade;
  const quantidade = Number(bruto);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return NextResponse.json({ error: "Informe uma quantidade maior que zero." }, { status: 400 });
  }

  const lote = await prisma.stockLot.findUnique({ where: { code: codigo } });
  if (!lote || lote.franchiseeId !== loja.franchiseeId || !lote.active) {
    return NextResponse.json({ error: "Etiqueta não encontrada nesta loja." }, { status: 404 });
  }
  if (!lote.stockItemId) {
    return NextResponse.json({ error: "Este lote ainda não está ligado a um insumo do estoque." }, { status: 400 });
  }

  // A chave vem do cliente para sobreviver a um reenvio da MESMA intenção
  // (rede ruim, botão apertado duas vezes). Sem ela, cada envio seria uma
  // baixa nova — que é exatamente o que se quer evitar num celular de cozinha.
  const sourceRef = String(corpo?.sourceRef || "").slice(0, 120) || null;
  if (sourceRef) {
    const jaFeita = await prisma.stockTransaction.findUnique({ where: { sourceRef } });
    if (jaFeita) {
      return NextResponse.json({ ok: true, duplicado: true, movimentacao: jaFeita });
    }
  }

  const ehSaida = acao !== "ESTORNO";
  const delta = ehSaida ? -Math.abs(quantidade) : Math.abs(quantidade);
  const tipo = acao === "DESCARTE" ? "WASTE" : acao === "ESTORNO" ? "INPUT" : "OUTPUT";

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Saldo e histórico na MESMA transação, como o resto do módulo já faz.
      const mov = await tx.stockTransaction.create({
        data: {
          stockItemId: lote.stockItemId!,
          stockLotId: lote.id,
          franchiseeId: loja.franchiseeId,
          userId: loja.userId,
          sourceRef,
          quantity: delta,
          type: tipo,
          notes: `Etiqueta ${codigo}${corpo?.observacao ? " — " + String(corpo.observacao).slice(0, 160) : ""}`,
        },
      });

      const item = await tx.stockItem.update({
        // franchiseeId no WHERE da escrita: entre conferir e gravar, o insumo
        // pode ter sido apagado ou movido.
        where: { id: lote.stockItemId! },
        data: { quantity: { increment: delta } },
        select: { id: true, name: true, quantity: true, unit: true },
      });

      const restante = Math.max(0, Number((lote.quantidadeRestante + delta).toFixed(4)));
      const loteAtualizado = await tx.stockLot.update({
        where: { id: lote.id },
        data: {
          quantidadeRestante: restante,
          status: restante <= 0 ? (acao === "DESCARTE" ? "DESCARTADO" : "CONSUMIDO") : "ATIVO",
        },
      });

      return { mov, item, lote: loteAtualizado };
    });

    return NextResponse.json({
      ok: true,
      duplicado: false,
      movimentacao: resultado.mov,
      insumo: resultado.item,
      lote: comEstado(resultado.lote),
    });
  } catch (e: any) {
    // Corrida no índice único: outra requisição gravou a mesma intenção entre
    // a conferência e o insert. Devolver a original é o comportamento certo.
    if (sourceRef && String(e?.code) === "P2002") {
      const original = await prisma.stockTransaction.findUnique({ where: { sourceRef } });
      if (original) return NextResponse.json({ ok: true, duplicado: true, movimentacao: original });
    }
    console.error("[Lote] Falha ao movimentar:", e?.message);
    return NextResponse.json({ error: "Não consegui registrar a baixa. Tente de novo." }, { status: 500 });
  }
}
