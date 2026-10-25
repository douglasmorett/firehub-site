/**
 * O entregador do iFood Sob Demanda NÃO é um pedido novo.
 *
 * Quando a loja pede o entregador do iFood para um pedido do canal próprio
 * (site, robô, balcão) — pelo Portal do iFood ou pela aba Shipping —, o iFood
 * cria do lado dele um pedido com `salesChannel=POS` (ver lib/ifood-shipping.ts)
 * e o confirma sozinho. O polling do FireHub importava esse pedido como mais
 * um pedido do iFood: o mesmo pedido aparecia duas vezes no painel e a comanda
 * saía de novo (Pizzaria do Costa, 24/10/2026).
 *
 * Agora, antes de importar, procura-se o pedido ORIGINAL da loja nas últimas
 * horas (mesmo telefone ou, sem telefone, mesma rua e número). Achou um só:
 * o pedido do iFood fica ligado a ele em "IfoodShippingPedido" e o original
 * ganha uma nota com o número do iFood e o código de coleta — nada é criado,
 * nada é impresso. Não achou, ou achou mais de um: importa como sempre, para
 * não sumir com o pedido de quem lança o Sob Demanda só pelo portal.
 *
 * O vínculo NÃO grava `ifoodOrderId` no original de propósito: os eventos do
 * entregador (cancelamento da corrida, por exemplo) mudariam o status do
 * pedido da loja.
 */
import { garantirTabelaDoShipping } from "./ifood-shipping";

/** Quanto tempo para trás um pedido ainda pode ser o original. */
const JANELA_MS = 6 * 3600_000;

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const simples = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pedido criado pela própria loja para chamar o entregador do iFood. */
export function ehPedidoSobDemanda(orderData: any): boolean {
  return String(orderData?.salesChannel ?? "").toUpperCase() === "POS";
}

export type CandidatoAoOriginal = {
  id: string;
  customerPhone: string | null;
  customerAddress: string | null;
};

/**
 * O pedido da loja que este Sob Demanda atende — ou null quando não dá para
 * ter certeza. Telefone (8 últimos dígitos) primeiro; sem telefone que case,
 * rua e número. Dois candidatos iguais = null: ligar ao pedido errado é pior
 * do que o pedido repetido.
 */
export function escolherOriginal(orderData: any, candidatos: CandidatoAoOriginal[]): string | null {
  const telefone = digitos(orderData?.customer?.phone?.number ?? orderData?.customer?.phone).slice(-8);
  if (telefone.length === 8) {
    const porTelefone = candidatos.filter((c) => digitos(c.customerPhone).slice(-8) === telefone);
    if (porTelefone.length === 1) return porTelefone[0].id;
    if (porTelefone.length > 1) return null;
  }
  const endereco = orderData?.delivery?.deliveryAddress ?? {};
  const rua = simples(endereco.streetName).trim();
  const numero = digitos(endereco.streetNumber);
  if (!rua || !numero) return null;
  const porEndereco = candidatos.filter((c) => {
    const texto = simples(c.customerAddress);
    return texto.includes(rua) && new RegExp(`(^|\\D)${numero}(\\D|$)`).test(texto);
  });
  return porEndereco.length === 1 ? porEndereco[0].id : null;
}

/** Este pedido do iFood já foi ligado a um pedido da loja? */
export async function sobDemandaJaVinculado(prisma: any, ifoodOrderId: string): Promise<boolean> {
  try {
    if (!ifoodOrderId || !(await garantirTabelaDoShipping(prisma))) return false;
    const linhas: any[] = await prisma.$queryRaw`
      SELECT 1 FROM "IfoodShippingPedido"
       WHERE "ifoodOrderId" = ${ifoodOrderId} AND "pedidoDoFireHub" IS NOT NULL
       LIMIT 1`;
    return linhas.length > 0;
  } catch {
    return false;
  }
}

/**
 * Liga o pedido Sob Demanda ao original e devolve o id do original — ou null,
 * e quem chamou importa o pedido como sempre. Nunca lança.
 */
export async function vincularSobDemanda(
  prisma: any,
  p: { ifoodOrderId: string; orderData: any; franchiseeId: string; merchantId?: string | null },
): Promise<string | null> {
  if (!ehPedidoSobDemanda(p.orderData)) return null;
  try {
    const candidatos: (CandidatoAoOriginal & { notes: string | null })[] = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: p.franchiseeId,
        createdAt: { gte: new Date(Date.now() - JANELA_MS) },
        deliveryType: "DELIVERY",
        NOT: [{ source: "IFOOD" }, { status: "CANCELADO" }],
      },
      select: { id: true, customerPhone: true, customerAddress: true, notes: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const id = escolherOriginal(p.orderData, candidatos);
    if (!id || !(await garantirTabelaDoShipping(prisma))) return null;

    const o = p.orderData;
    const displayId = String(o?.displayId ?? p.ifoodOrderId.slice(-6)).toUpperCase();
    const total = Number(o?.total?.orderAmount ?? o?.total?.subTotal ?? 0) || 0;
    await prisma.$executeRaw`
      INSERT INTO "IfoodShippingPedido"
        ("ifoodOrderId", "franchiseeId", "merchantId", "displayId", "clienteNome", "total", "pedidoDoFireHub")
      VALUES (${p.ifoodOrderId}, ${p.franchiseeId}, ${String(p.merchantId ?? o?.merchant?.id ?? "")}, ${displayId},
              ${o?.customer?.name ?? null}, ${total}, ${id})
      ON CONFLICT ("ifoodOrderId") DO UPDATE SET "pedidoDoFireHub" = EXCLUDED."pedidoDoFireHub"`;

    const codigo = o?.delivery?.pickupCode || o?.pickupCode || o?.driver?.pickupCode || o?.logistics?.pickupCode || "";
    const nota = `🛵 Entregador iFood Sob Demanda: pedido iFood #${displayId}${codigo ? ` · código de coleta ${codigo}` : ""}`;
    const original = candidatos.find((c) => c.id === id);
    if (!String(original?.notes ?? "").includes(`pedido iFood #${displayId}`)) {
      await prisma.customerOrder.update({
        where: { id },
        data: { notes: [original?.notes, nota].filter(Boolean).join(" · ") },
      });
    }
    return id;
  } catch (e: any) {
    console.warn(`[iFood Sob Demanda] não liguei ${p.ifoodOrderId} ao pedido da loja:`, e?.message);
    return null;
  }
}
