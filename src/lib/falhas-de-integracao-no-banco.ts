/**
 * Grava o pedido de app que NÃO entrou (iFood, 99Food) — o que o relatório
 * "Pedidos com falha na integração" lista (lib/relatorios/falhas-de-integracao.ts
 * explica o desenho).
 *
 * Quem chama é o ponto de falha da integração, e esta função NUNCA pode mudar
 * o que a integração faz: não lança, não devolve nada que alguém precise
 * esperar, e quem chama a usa sem await (import dinâmico + `.catch`). Sem a
 * tabela (o CREATE falhou), não grava e pronto.
 *
 * Uma linha por pedido do parceiro: a nova tentativa do mesmo pedido (o iFood
 * devolve o evento no próximo polling; o 99Food reenvia) soma em `tentativas`
 * e troca o erro pelo último. O pedido que JÁ está no banco não é "pedido que
 * não entrou" — o erro foi numa atualização dele — e não é gravado.
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDeFalhasDeIntegracao } from "@/lib/garantir-colunas";
import type { PlataformaDaFalha } from "@/lib/relatorios/falhas-de-integracao";

export async function registrarFalhaDeIntegracao(f: {
  plataforma: PlataformaDaFalha;
  franchiseeId: string | null | undefined;
  pedidoExterno: string | null | undefined;
  codigo?: string | null;
  erro: string;
}): Promise<void> {
  try {
    const pedidoExterno = String(f.pedidoExterno ?? "").trim();
    if (!pedidoExterno || !f.franchiseeId) return;
    if (!(await garantirEstruturaDeFalhasDeIntegracao())) return;
    const jaEntrou = await prisma.customerOrder.findFirst({
      where: f.plataforma === "IFOOD" ? { ifoodOrderId: pedidoExterno } : { openDeliveryOrderId: pedidoExterno },
      select: { id: true },
    });
    if (jaEntrou) return;
    const codigo = String(f.codigo ?? "").trim().slice(0, 40) || null;
    const erro = String(f.erro || "erro sem mensagem").slice(0, 500);
    await prisma.$executeRaw`
      INSERT INTO "FalhaDeIntegracao" ("id", "franchiseeId", "plataforma", "pedidoExterno", "codigo", "erro")
      VALUES (${randomUUID()}, ${f.franchiseeId}, ${f.plataforma}, ${pedidoExterno}, ${codigo}, ${erro})
      ON CONFLICT ("plataforma", "pedidoExterno") DO UPDATE SET
        "tentativas" = "FalhaDeIntegracao"."tentativas" + 1,
        "ultimaEm" = CURRENT_TIMESTAMP,
        "erro" = EXCLUDED."erro",
        "codigo" = COALESCE(EXCLUDED."codigo", "FalhaDeIntegracao"."codigo")`;
  } catch (err: any) {
    console.warn(`[Falha de integração] não consegui registrar ${f.plataforma} ${f.pedidoExterno}: ${err?.message}`);
  }
}
