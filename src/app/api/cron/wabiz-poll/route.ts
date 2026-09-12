import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { garantirColunasWabiz } from "@/lib/garantir-colunas";

/**
 * GET /api/cron/wabiz-poll — a cada 30s puxa os pedidos pendentes da Wabiz.
 *
 * A Wabiz não tem webhook nem ACK: o pedido fica em `orders/pending` até a loja
 * mandar `status` com `isProcessed=true`. A regra é a mesma do ACK da Brendi —
 * **só confirma o que está gravado no banco**. Pedido que não gravou continua
 * pendente e o próximo ciclo tenta de novo.
 *
 * Se falhar três ciclos seguidos, o pedido é devolvido com `isProcessed=false`:
 * o painel da Wabiz pinta de vermelho e toca alerta para o atendente lançar à
 * mão — melhor do que o cliente esperando um pedido que ninguém vê.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

interface LojaConectada {
  id: string;
  email: string;
  storeName: string | null;
  ownerId: string | null;
}

/** Ciclos seguidos em que cada pedido falhou ao gravar (em memória: um deploy zera, e tudo bem). */
const falhasPorPedido = new Map<string, number>();
const DEVOLVER_APOS_FALHAS = 3;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await garantirColunasWabiz();

  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < 45_000;
  const log: string[] = [];

  let lojas: LojaConectada[] = [];
  try {
    lojas = await prisma.$queryRaw<LojaConectada[]>`
      SELECT "id", "email", "storeName", "ownerId"
      FROM "User"
      WHERE "wabizConnected" = true
        AND "wabizUsername" IS NOT NULL
        AND "wabizPassword" IS NOT NULL
        AND LEFT("email", 8) <> 'deleted_'
    `;
  } catch {
    return NextResponse.json({ ok: true, lojas: 0, log: ["ℹ️ Colunas Wabiz ainda não existem"] });
  }

  if (lojas.length === 0) {
    return NextResponse.json({ ok: true, lojas: 0 });
  }

  const { pedidosPendentesWabiz, mudarStatusWabiz, WABIZ_STATUS } = await import("@/lib/wabiz-api");
  const { processWabizOrder } = await import("@/lib/processWabizOrder");
  const { statusWabizDoFireHub } = await import("@/lib/wabiz-status");

  let criados = 0, confirmados = 0, falhas = 0, pendentes = 0;

  for (const loja of lojas) {
    if (!temTempo()) {
      log.push("⏱️ Prazo da rodada — as lojas restantes ficam para o próximo ciclo");
      break;
    }
    const storeId = loja.ownerId || loja.id;
    const nome = loja.storeName || loja.email;

    let lista;
    try {
      lista = await pedidosPendentesWabiz(storeId);
    } catch (e: any) {
      log.push(`❌ [${nome}] orders/pending: ${e?.message}`);
      falhas++;
      continue;
    }
    if (lista.length === 0) continue;

    pendentes += lista.length;
    log.push(`📥 [${nome}] ${lista.length} pedido(s) pendente(s)`);

    for (const p of lista) {
      if (!temTempo()) break;
      const chave = `${storeId}:${p?.internalKey}`;
      const r = await processWabizOrder(p, storeId).catch((e: any) => ({ action: "error" as const, message: e?.message }));

      if (r.action === "error") {
        falhas++;
        const n = (falhasPorPedido.get(chave) ?? 0) + 1;
        falhasPorPedido.set(chave, n);
        log.push(`  ❌ #${p?.orderNumber}: ${r.message} (falha ${n}/${DEVOLVER_APOS_FALHAS})`);
        import("@/lib/server-monitor")
          .then((m) => m.alertarFalhaDeIntegracao("Wabiz", nome, `#${p?.orderNumber}: ${r.message || "pedido não gravado"}`))
          .catch(() => {});

        if (n >= DEVOLVER_APOS_FALHAS && p?.internalKey && p?.orderNumber != null) {
          const dev = await mudarStatusWabiz(
            storeId,
            { orderNumber: p.orderNumber, internalKey: p.internalKey },
            WABIZ_STATUS.NAO_CONFIRMADO,
            { notificar: false, processado: false }
          );
          log.push(`  ⛔ #${p.orderNumber}: devolvido à Wabiz como NÃO processado (${dev.ok ? "ok" : dev.erro})`);
          if (dev.ok) falhasPorPedido.delete(chave);
        }
        continue;
      }

      falhasPorPedido.delete(chave);
      if (r.action === "created") criados++;

      // Confirma com o status que o pedido TEM agora: se a loja já adiantou (ou
      // cancelou) antes de a confirmação passar, mandar "2" seria voltar atrás.
      const alvo = statusWabizDoFireHub(r.status || "", null) ?? WABIZ_STATUS.CONFIRMADO;
      const c = await mudarStatusWabiz(
        storeId,
        { orderNumber: p.orderNumber, internalKey: p.internalKey },
        alvo === WABIZ_STATUS.NAO_CONFIRMADO ? WABIZ_STATUS.CONFIRMADO : alvo,
        { notificar: alvo !== WABIZ_STATUS.FINALIZADO, processado: true }
      );
      if (c.ok) {
        confirmados++;
        log.push(`  ✅ #${p.orderNumber} ${r.action === "created" ? "gravado" : "já existia"} e confirmado (status ${alvo})`);
      } else {
        falhas++;
        log.push(`  ⚠️ #${p.orderNumber} gravado, mas a confirmação falhou — tenta de novo no próximo ciclo: ${c.erro}`);
      }
    }
  }

  const houveFalha = falhas > 0;
  if (pendentes > 0 || houveFalha) {
    for (const linha of log) {
      if (linha.includes("❌") || linha.includes("⛔") || linha.includes("⚠️")) console.error(`[Wabiz Cron] ${linha}`);
      else console.log(`[Wabiz Cron] ${linha}`);
    }
  }

  // 207 faz o cron-runner imprimir o corpo — ele silencia 2xx puro.
  return NextResponse.json(
    { ok: !houveFalha, lojas: lojas.length, pendentes, criados, confirmados, falhas, durationMs: Date.now() - inicio, log },
    { status: houveFalha ? 207 : 200 }
  );
}
