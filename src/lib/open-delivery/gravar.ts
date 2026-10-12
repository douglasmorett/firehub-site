/**
 * lib/open-delivery/gravar.ts — a tradução vira CustomerOrder.
 *
 * O esqueleto que funcionou na Wabiz (processWabizOrder.ts), sem nada de canal:
 *
 *   1. Idempotência pelo `openDeliveryOrderId` (único no banco, com o prefixo
 *      do canal). O mesmo pedido chega pelo webhook E pelo polling; o segundo
 *      encontro é "já existe", nunca pedido duplicado na cozinha.
 *   2. Nome do espelho corrigido antes de gravar (lib/espelho-do-parceiro.ts).
 *   3. Ponto do cliente passa pelo corte da loja e vira km da entrega.
 *   4. Número do dia DENTRO da transação do create — gerado fora, ele era
 *      queimado quando o create falhava ("#24 sumiu"; JotaJá, Brendi e 99 ainda
 *      geram fora).
 *   5. Estoque e impressão DEPOIS de gravar, sem derrubar o resultado.
 *
 * Quem confirma ao parceiro (ack, 204, confirm) é quem chamou, e só depois de
 * receber "created" ou "exists": evento confirmado sem pedido gravado é pedido
 * perdido para sempre quando o parceiro não tem listagem (JotaJá, 23/08/2026).
 */
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumberTx } from "@/lib/order-number";
import { pontoEDistanciaDoParceiro } from "@/lib/distancia-da-entrega";
import { corrigirNomeDoEspelho } from "@/lib/espelho-do-parceiro";
import type { TraducaoOD } from "./traducao";

export type ResultadoGravacao = {
  action: "created" | "exists" | "error";
  pedidoId?: string;
  status?: string;
  message?: string;
};

export async function gravarPedidoOpenDelivery(traducao: TraducaoOD, rotulo: string): Promise<ResultadoGravacao> {
  const dados = { ...traducao.dados };
  const idNoBanco = String(dados.openDeliveryOrderId || "");
  const lojaId = String(dados.franchiseeId || "");
  const numero = String(dados.openDeliveryReference || idNoBanco);
  if (!idNoBanco || !lojaId) return { action: "error", message: "pedido sem id ou sem loja" };
  if (traducao.items.length === 0) return { action: "error", message: `pedido ${numero} veio sem itens` };

  const existente = await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: idNoBanco } as any,
    select: { id: true, status: true, franchiseeId: true },
  });
  if (existente) {
    // Mesmo id em OUTRA loja não pode acontecer (o id tem o prefixo do canal e
    // o canal resolve a loja pelo merchant). Se acontecer, é vínculo errado —
    // gritar em vez de devolver o pedido de uma loja como se fosse da outra.
    if (existente.franchiseeId !== lojaId) {
      return { action: "error", message: `pedido ${numero} já existe em OUTRA loja (${existente.franchiseeId}) — vínculo do merchant errado?` };
    }
    return { action: "exists", pedidoId: existente.id, status: existente.status };
  }

  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, storeName: true } });
  if (!loja) return { action: "error", message: `loja ${lojaId} não encontrada` };

  await Promise.all(traducao.espelhos.map((e) => corrigirNomeDoEspelho(e.id, e.nome, lojaId, rotulo)));

  const doParceiro = await pontoEDistanciaDoParceiro(lojaId, dados.customerLatLng).catch(() => ({ ponto: undefined, km: null }));
  if (doParceiro.ponto) dados.customerLatLng = doParceiro.ponto;
  else delete dados.customerLatLng;
  if (doParceiro.km != null) dados.deliveryDistance = doParceiro.km;

  let criado: { id: string } | null = null;
  let ultimoErro: any = null;
  for (let tentativa = 1; tentativa <= 3 && !criado; tentativa++) {
    try {
      criado = await prisma.$transaction(
        async (tx) => {
          dados.dailyOrderNumber = await generateDailyOrderNumberTx(tx, lojaId);
          return (tx.customerOrder as any).create({ data: dados, select: { id: true } });
        },
        { timeout: 20000 },
      );
    } catch (e: any) {
      ultimoErro = e;
      if (e?.code === "P2002") {
        const ja = await prisma.customerOrder.findFirst({
          where: { openDeliveryOrderId: idNoBanco } as any,
          select: { id: true, status: true },
        });
        if (ja) return { action: "exists", pedidoId: ja.id, status: ja.status };
      }
      console.error(`[${rotulo}] ❌ Tentativa ${tentativa}/3 de gravar o pedido ${numero}: ${e?.message}`);
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!criado) return { action: "error", message: `não gravou o pedido ${numero}: ${ultimoErro?.message || "erro desconhecido"}` };

  import("@/lib/stock")
    .then((m) => m.deductStockForOrder(criado!.id))
    .catch((e) => console.error(`[${rotulo}] Baixa de estoque falhou para ${numero}:`, e?.message));

  try {
    const completo = await prisma.customerOrder.findUnique({
      where: { id: criado.id },
      include: { items: { include: { menuProduct: { select: { id: true, name: true, isBeverage: true } } } } },
    });
    if (completo) {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(lojaId, completo, loja.storeName || undefined);
    }
  } catch (e: any) {
    console.error(`[${rotulo}] Erro ao enfileirar a impressão:`, e?.message);
  }

  const statusGravado = String(dados.status ?? "");
  console.log(`[${rotulo}] ✅ Pedido #${numero} gravado para ${loja.storeName || lojaId} (${statusGravado})`);
  return { action: "created", pedidoId: criado.id, status: statusGravado };
}
