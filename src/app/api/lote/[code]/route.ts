import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { temEstruturaDeLotes } from "@/lib/garantir-colunas";
import { normalizarCodigo, codigoPlausivel, estadoDePrazo, textoDePrazo } from "@/lib/lote";

/**
 * O que o QR da etiqueta resolve, e por onde o insumo entra e sai do estoque.
 *
 * ── O FLUXO, QUE É DE FRANQUIA ──────────────────────────────────────────────
 *
 * Quem IMPRIME a etiqueta (`franchiseeId`) e quem RECEBE a mercadoria
 * (`recebidoPorId`) são partes diferentes: a fábrica produz e etiqueta, a loja
 * recebe e lê o QR. **Imprimir não põe nada em estoque nenhum** — o insumo entra
 * no estoque da LOJA no momento em que ela lê o código.
 *
 * Por isso a busca NÃO filtra por loja: filtrar bloquearia exatamente o caso
 * principal, que é a loja lendo a etiqueta que a fábrica imprimiu.
 *
 * Quem chega aqui veio da câmera do celular, está de pé e tem uma mão livre.
 * Todo caminho de saída é um estado nomeado que a tela sabe desenhar — nunca um
 * 500, nunca uma tela branca.
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

  const lote = await prisma.stockLot.findUnique({
    where: { code: codigo },
    include: { stockItem: { select: { id: true, name: true, unit: true, quantity: true } } },
  });

  if (!lote || !lote.active) {
    return NextResponse.json({ estado: "NAO_ENCONTRADA", codigo, nomeDaLoja: loja.nomeDaLoja });
  }

  const dados = comEstado(lote);

  // ── AINDA NÃO RECEBIDA: é a primeira leitura ─────────────────────────────
  // Qualquer loja da rede pode receber. O código tem 8 caracteres num alfabeto
  // de 30 (656 bilhões de combinações), então não há enumeração viável — e
  // receber é reversível pelo estorno, com autor gravado.
  if (!lote.recebidoPorId) {
    return NextResponse.json({
      estado: "A_RECEBER",
      codigo,
      nomeDaLoja: loja.nomeDaLoja,
      lote: dados,
    });
  }

  // ── RECEBIDA POR OUTRA LOJA ──────────────────────────────────────────────
  // Erro honesto, e não "não encontrada": a mercadoria existe, só entrou no
  // estoque de outro lugar. Dizer isso evita a mesma caixa ser lançada duas
  // vezes em duas lojas — que é o erro caro deste fluxo.
  if (lote.recebidoPorId !== loja.franchiseeId) {
    const outra = await prisma.user.findUnique({
      where: { id: lote.recebidoPorId },
      select: { storeName: true, name: true },
    });
    return NextResponse.json({
      estado: "RECEBIDA_POR_OUTRA",
      codigo,
      nomeDaLoja: loja.nomeDaLoja,
      recebidaPor: outra?.storeName || outra?.name || "outra loja",
      recebidaEm: lote.recebidoEm,
      lote: dados,
    });
  }

  // ── É MINHA: saída, ou os estados de borda ───────────────────────────────
  const recente = await prisma.stockTransaction.findFirst({
    where: {
      stockLotId: lote.id,
      userId: loja.userId,
      createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    estado: recente ? "JA_MOVIMENTADO" : lote.quantidadeRestante <= 0 ? "LOTE_ZERADO" : "OK",
    codigo,
    nomeDaLoja: loja.nomeDaLoja,
    lote: dados,
    ultimaMovimentacao: recente
      ? { id: recente.id, quantidade: Math.abs(recente.quantity), tipo: recente.type, quando: recente.createdAt }
      : null,
  });
}

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
  if (!["ENTRADA", "SAIDA", "ESTORNO", "DESCARTE"].includes(acao)) {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }

  const lote = await prisma.stockLot.findUnique({ where: { code: codigo } });
  if (!lote || !lote.active) {
    return NextResponse.json({ error: "Etiqueta não encontrada." }, { status: 404 });
  }

  const bruto = typeof corpo?.quantidade === "string"
    ? corpo.quantidade.replace(/\./g, "").replace(",", ".")
    : corpo?.quantidade;
  const quantidade = Number(bruto);
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return NextResponse.json({ error: "Informe uma quantidade maior que zero." }, { status: 400 });
  }

  // Chave de idempotência PREFIXADA no servidor com a loja e o lote. O índice é
  // único no sistema inteiro: chave escolhida pelo cliente podia colidir com a
  // de outra loja, e a resposta "já foi feita" devolveria a movimentação alheia
  // — a baixa desta loja simplesmente não aconteceria, com a tela dizendo que
  // aconteceu. O sufixo do cliente é o que torna o reenvio idempotente.
  const sufixo = String(corpo?.sourceRef || "").replace(/[^\w:.-]/g, "").slice(0, 80);
  const sourceRef = sufixo ? `l:${loja.franchiseeId}:${lote.id}:${sufixo}` : null;
  if (sourceRef) {
    const jaFeita = await prisma.stockTransaction.findUnique({ where: { sourceRef } });
    if (jaFeita) return NextResponse.json({ ok: true, duplicado: true, movimentacao: jaFeita });
  }

  /* ─── ENTRADA: a loja recebendo a mercadoria ──────────────────────────────
   *
   * É AQUI que o insumo entra no estoque. Imprimir não põe nada em lugar
   * nenhum: a fábrica etiqueta, a loja lê e recebe.
   *
   * O insumo é encontrado ou CRIADO pelo nome do produto, no estoque desta
   * loja. Criar sozinho é o que faz a promessa "só clica e usa" ser verdade —
   * exigir cadastro prévio faria a primeira leitura de toda loja nova terminar
   * num beco sem saída.
   */
  if (acao === "ENTRADA") {
    if (lote.recebidoPorId && lote.recebidoPorId !== loja.franchiseeId) {
      return NextResponse.json(
        { error: "Esta etiqueta já foi recebida por outra loja." },
        { status: 409 }
      );
    }
    if (lote.recebidoPorId === loja.franchiseeId) {
      return NextResponse.json({ error: "Esta etiqueta já foi recebida." }, { status: 409 });
    }

    const nome = String(lote.productName || "").trim();
    if (!nome) return NextResponse.json({ error: "A etiqueta não tem nome de produto." }, { status: 400 });

    try {
      const resultado = await prisma.$transaction(async (tx) => {
        let insumo = await tx.stockItem.findFirst({
          where: { franchiseeId: loja.franchiseeId, name: { equals: nome, mode: "insensitive" } },
        });
        if (!insumo) {
          insumo = await tx.stockItem.create({
            data: {
              franchiseeId: loja.franchiseeId,
              name: nome,
              quantity: 0,
              unit: lote.unit || "un",
            },
          });
        } else if (!insumo.active) {
          // Insumo arquivado que volta a chegar: desarquiva em vez de criar um
          // paralelo com o mesmo nome, que quebraria a ficha técnica.
          await tx.stockItem.update({ where: { id: insumo.id }, data: { active: true } });
        }

        await tx.stockTransaction.create({
          data: {
            stockItemId: insumo.id,
            stockLotId: lote.id,
            franchiseeId: loja.franchiseeId,
            userId: loja.userId,
            sourceRef,
            quantity: Math.abs(quantidade),
            type: "INPUT",
            notes: `Entrada por etiqueta ${codigo}${corpo?.observacao ? " — " + String(corpo.observacao).slice(0, 160) : ""}`,
          },
        });

        await tx.stockItem.updateMany({
          where: { id: insumo.id, franchiseeId: loja.franchiseeId },
          data: { quantity: { increment: Math.abs(quantidade) } },
        });

        const atualizado = await tx.stockLot.update({
          where: { id: lote.id },
          data: {
            recebidoPorId: loja.franchiseeId,
            recebidoEm: new Date(),
            stockItemId: insumo.id,
            quantidadeRestante: Math.abs(quantidade),
            quantidadeInicial: Math.abs(quantidade),
            unit: insumo.unit,
            status: "ATIVO",
          },
        });

        const saldo = await tx.stockItem.findUnique({
          where: { id: insumo.id },
          select: { id: true, name: true, quantity: true, unit: true },
        });

        return { lote: atualizado, insumo: saldo };
      });

      return NextResponse.json({
        ok: true,
        recebido: true,
        lote: comEstado(resultado.lote),
        insumo: resultado.insumo,
      });
    } catch (e: any) {
      if (sourceRef && String(e?.code) === "P2002") {
        const original = await prisma.stockTransaction.findUnique({ where: { sourceRef } });
        if (original) return NextResponse.json({ ok: true, duplicado: true, movimentacao: original });
      }
      console.error("[Lote] Falha na entrada:", e?.message);
      return NextResponse.json({ error: "Não consegui dar entrada. Tente de novo." }, { status: 500 });
    }
  }

  /* ─── SAÍDA / DESCARTE / ESTORNO: só quem recebeu movimenta ──────────────── */
  if (lote.recebidoPorId !== loja.franchiseeId) {
    return NextResponse.json(
      { error: "Esta etiqueta ainda não foi recebida por esta loja." },
      { status: 409 }
    );
  }
  if (!lote.stockItemId) {
    return NextResponse.json({ error: "Este lote não está ligado a nenhum insumo." }, { status: 400 });
  }

  const ehSaida = acao !== "ESTORNO";
  const delta = ehSaida ? -Math.abs(quantidade) : Math.abs(quantidade);
  const tipo = acao === "DESCARTE" ? "WASTE" : acao === "ESTORNO" ? "INPUT" : "OUTPUT";

  try {
    const resultado = await prisma.$transaction(async (tx) => {
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

      // franchiseeId DENTRO do WHERE da escrita: o `update` exige chave única,
      // então a conferência de dono ficaria só na leitura anterior.
      const alterados = await tx.stockItem.updateMany({
        where: { id: lote.stockItemId!, franchiseeId: loja.franchiseeId },
        data: { quantity: { increment: delta } },
      });
      if (alterados.count === 0) throw new Error("INSUMO_FORA_DA_LOJA");

      const item = await tx.stockItem.findUnique({
        where: { id: lote.stockItemId! },
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
    if (String(e?.message) === "INSUMO_FORA_DA_LOJA") {
      return NextResponse.json({ error: "Este insumo não pertence mais a esta loja." }, { status: 409 });
    }
    if (sourceRef && String(e?.code) === "P2002") {
      const original = await prisma.stockTransaction.findUnique({ where: { sourceRef } });
      if (original) return NextResponse.json({ ok: true, duplicado: true, movimentacao: original });
    }
    console.error("[Lote] Falha ao movimentar:", e?.message);
    return NextResponse.json({ error: "Não consegui registrar. Tente de novo." }, { status: 500 });
  }
}
