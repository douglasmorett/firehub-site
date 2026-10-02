/**
 * /src/lib/codigo-de-entrega-reconferir.ts
 *
 * Manda de novo ao iFood o código de entrega que o motoboy digitou e o iFood
 * não atendeu na hora (403 "Access Denied", sem rede). O porquê e os limites
 * estão em `deveReconferir` (lib/codigo-de-entrega.ts); aqui é só o laço.
 *
 * Roda dentro do cron do iFood (api/cron/ifood-poll), que já passa a cada
 * minuto. O pedido já está ENTREGUE no FireHub — nada aqui muda status: o que
 * muda é o iFood concluir o pedido lá, e o registro em ifoodDropCodeInfo.
 */
import { prisma } from "@/lib/prisma";
import { deveReconferir } from "@/lib/codigo-de-entrega";
import { conferirCodigoDeEntrega } from "@/lib/ifood-pedido";

/** Poucos por ciclo: o bloqueio do iFood é por rajada. */
const POR_CICLO = 8;

export async function reconferirCodigosPendentes(log: string[] = []): Promise<{ conferidos: number; tentados: number }> {
  const desde = new Date(Date.now() - 4 * 60 * 60_000);
  const candidatos = await prisma.customerOrder.findMany({
    where: {
      ifoodDropCodeRequired: true,
      ifoodOrderId: { not: null },
      updatedAt: { gte: desde },
      ifoodDropCodeInfo: { path: ["resultado"], equals: "indisponivel" },
    },
    select: { id: true, ifoodOrderId: true, franchiseeId: true, ifoodStoreMerchant: true, ifoodDropCodeInfo: true },
    orderBy: { updatedAt: "asc" },
    take: 40,
  });

  let tentados = 0;
  let conferidos = 0;
  for (const pedido of candidatos) {
    if (tentados >= POR_CICLO) break;
    const pendente = deveReconferir(pedido.ifoodDropCodeInfo);
    if (!pendente) continue;
    tentados++;

    const info = (pedido.ifoodDropCodeInfo ?? {}) as Record<string, unknown>;
    const tentativas = (Number(info.tentativas) || 0) + 1;
    let novo: Record<string, unknown>;
    try {
      const r = await conferirCodigoDeEntrega(pedido, pendente.digitado, "Código de entrega → iFood (nova tentativa)");
      novo = {
        ...info,
        tentativas,
        ultimaTentativa: new Date().toISOString(),
        ultimaResposta: { status: r.status, origem: r.origem ?? null, texto: String(r.texto || "").slice(0, 200) },
        // `quando` fica: é dele que a janela de tentativas é contada.
        resultado: r.resultado,
        ...(r.resultado === "conferido" ? { conferidoNaTentativa: tentativas } : {}),
      };
      if (r.resultado === "conferido") conferidos++;
      log.push(`🔐 Código de entrega ${pedido.id}: tentativa ${tentativas} → ${r.resultado} (${r.status})`);
    } catch (e: any) {
      novo = {
        ...info,
        tentativas,
        ultimaTentativa: new Date().toISOString(),
        ultimaResposta: { status: 0, texto: String(e?.message || "erro").slice(0, 200) },
      };
      log.push(`🔐 Código de entrega ${pedido.id}: tentativa ${tentativas} falhou (${e?.message})`);
    }

    // Grava sem mexer em updatedAt: o pedido não mudou para quem olha o painel.
    await prisma.$executeRaw`UPDATE "CustomerOrder" SET "ifoodDropCodeInfo" = ${JSON.stringify(novo)}::jsonb WHERE id = ${pedido.id}`
      .catch((e: any) => log.push(`🔐 Código de entrega ${pedido.id}: não gravou (${e?.message})`));
  }

  return { conferidos, tentados };
}
