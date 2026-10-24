/**
 * "Qtd Pedidos" da comanda: quantos pedidos este cliente já fez NESTA loja,
 * contando o da comanda.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * A comanda imprimia "Qtd Pedidos: 1" cravado no código — no Assistente
 * (firehub-print-assistant/server.js) e na prévia (comanda-modelo.ts). A
 * Showrrascão dá a taxa grátis do primeiro pedido olhando esse número, e
 * dava para todo mundo: o Thiago (22 99929-9355) saiu "1" no 4º pedido, em
 * 16/10/2026, com a Trilha Premiada já dando o prêmio de quem volta.
 *
 * ── A régua ─────────────────────────────────────────────────────────────────
 *
 * Mesmo telefone pelos últimos 8 dígitos (o número aparece gravado com e sem
 * DDD/55 — a mesma comparação de lib/cupons-no-banco.ts), pedidos até a hora
 * deste (a reimpressão de um pedido antigo mostra o número daquele dia), sem
 * cancelado, sem rascunho do robô e sem Pix que não foi pago.
 *
 * Fica de fora, nas duas pontas:
 *   - marketplace (iFood, 99, Brendi, Wabiz, JotaJá, Keeta): o telefone vem
 *     mascarado (0800 + localizador) e os 8 últimos dígitos juntariam clientes
 *     diferentes. O pedido de marketplace volta `null` e a linha não sai;
 *   - mesa: cada rodada é um pedido, e "Qtd Pedidos" na rodada não diz nada;
 *   - acréscimo (`parentOrderId`): é a mesma venda do pedido-pai.
 *
 * `null` = não dá para contar (sem telefone, telefone de zeros, marketplace,
 * mesa). Quem imprime não escreve a linha — melhor nada do que um "1" falso.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { digitosDoTelefone } from "@/lib/campanha-converter";

const ORIGENS_DE_MARKETPLACE = ["IFOOD", "99FOOD", "BRENDI", "WABIZ", "JOTAJA", "KEETA", "CARDAPIOWEB", "AIQFOME", "ANOTAAI", "OPEN_DELIVERY"];
const STATUS_QUE_NAO_CONTAM = ["CANCELADO", "CANCELLED", "CANCELED", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"];

export type PedidoParaContar = {
  id: string;
  franchiseeId: string;
  customerPhone?: string | null;
  createdAt: Date | string;
  source?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  tableSessionId?: string | null;
  parentOrderId?: string | null;
};

/** Os 8 últimos dígitos que identificam o cliente, ou null quando não dá para contar este pedido. */
export function chaveDoClienteParaContar(p: PedidoParaContar): string | null {
  if (canalDoPedido(p as any).ehMarketplace) return null;
  if (p.tableSessionId) return null;
  const d = digitosDoTelefone(p.customerPhone);
  // Celular/fixo com DDD tem 10 ou 11 dígitos; o PDV grava "00000000000".
  if (d.length < 10 || /^0+$/.test(d) || /^(\d)\1+$/.test(d)) return null;
  return d.slice(-8);
}

/** Quantos pedidos o cliente de cada pedido já fez na loja, contando o próprio. */
export async function qtdPedidosDosClientes(pedidos: PedidoParaContar[]): Promise<Map<string, number | null>> {
  const resultado = new Map<string, number | null>();
  await Promise.all(
    pedidos.map(async (p) => {
      const ultimos8 = chaveDoClienteParaContar(p);
      if (!ultimos8) return resultado.set(p.id, null);
      try {
        const linhas = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*)::bigint AS n FROM "CustomerOrder"
          WHERE "franchiseeId" = ${p.franchiseeId}
            AND "status" NOT IN (${Prisma.join(STATUS_QUE_NAO_CONTAM)})
            AND COALESCE(UPPER("source"), 'ONLINE') NOT IN (${Prisma.join(ORIGENS_DE_MARKETPLACE)})
            AND "ifoodOrderId" IS NULL
            AND "openDeliveryOrderId" IS NULL
            AND "tableSessionId" IS NULL
            AND "parentOrderId" IS NULL
            AND "createdAt" <= ${new Date(p.createdAt)}
            AND regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + ultimos8}`;
        // O próprio pedido está na conta; se por algum motivo não estiver
        // (status que não conta, ex.: reimpressão de cancelado), vale ao menos 1.
        resultado.set(p.id, Math.max(1, Number(linhas[0]?.n ?? 0)));
      } catch (err) {
        // A comanda não pode parar por causa da contagem: sem número, sem linha.
        console.error("[qtdPedidosDosClientes]", (err as any)?.message || err);
        resultado.set(p.id, null);
      }
    })
  );
  return resultado;
}
