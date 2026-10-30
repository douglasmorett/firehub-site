/**
 * Retirada/balcão que vira ENTREGA pelo lápis do pedido (aba Editar), com a
 * ROTA de verdade (PATCH /api/store/orders/[id]/tipo) e banco em memória.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-retirada-vira-entrega.ts
 *
 * Hakim Centro, 18/10/2026, pedido #74: feito como retirada (PICKUP), o
 * cliente quis entrega e foi preciso trocar no banco. Confere: taxa e total,
 * endereço, histórico (acao TIPO), cotação assinada gravando ponto/distância,
 * a retirada já "esperando no balcão" (SAIU_ENTREGA) voltando a PRONTO, e a
 * recusa em pedido do iFood e com NFC-e autorizada. E a volta (entrega →
 * retirada) zerando a taxa.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "x";

let falhas = 0;
const confere = (oQue: string, cond: boolean, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond || detalhe === undefined ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

const LOJA = "hakim";
const db: { order: any; gravacoes: any[] } = { order: null, gravacoes: [] };

// O `where` do updateMany da rota: confere só os campos simples e o `in`.
const casa = (o: any, where: any) =>
  Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === "object" && !(v instanceof Date) && Array.isArray(v.in)) return v.in.includes(o[k]);
    const a = o[k] instanceof Date ? o[k].getTime() : o[k] ?? null;
    const b = v instanceof Date ? v.getTime() : v ?? null;
    return a === b;
  });

(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where }: any) =>
      where?.email === "douglas@teste"
        ? { id: LOJA, name: "Douglas", email: "douglas@teste", role: "FRANCHISEE", permissions: "", ownerId: null }
        : where?.id === LOJA
          ? { deliveryZones: [], deliveryZoneType: "KM", deliveryConfig: null, storeLatLng: null, storeAddress: "Rua da Loja, 1", city: "Macaé" }
          : null,
  },
  customerOrder: {
    // A rota busca o pedido nas lojas da visão (`franchiseeId: { in: lojaIds }`,
    // lib/loja-ativa.ts, 30/10/2026); fora do "todas" a lista é só a LOJA.
    findFirst: async ({ where }: any) =>
      db.order && where.id === db.order.id && (where.franchiseeId?.in ?? [where.franchiseeId]).includes(LOJA) ? { ...db.order } : null,
    updateMany: async ({ where, data }: any) => {
      if (!db.order || !casa(db.order, where)) return { count: 0 };
      db.gravacoes.push(data);
      Object.assign(db.order, data);
      return { count: 1 };
    },
  },
  $transaction: async (fn: any) => fn((globalThis as any).prisma),
};

const stub = (caminho: string, exports: Record<string, unknown>) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...exports } } as any;
};
stub("next-auth/next", { getServerSession: async () => ({ user: { email: "douglas@teste" } }) });
stub("../src/lib/auth", { authOptions: {} });

const retirada = (extra: Record<string, unknown> = {}) => ({
  id: "o74", franchiseeId: LOJA, status: "ACEITO", source: "SITE", deliveryType: "PICKUP", tableSessionId: null,
  totalAmount: 54.9, deliveryFee: 0, notes: null, editHistory: null, dailyOrderNumber: 74,
  customerName: "Cliente", customerAddress: "", motoboyId: null, dispatchedAt: null, readyAt: null,
  paymentMethod: "Dinheiro", gatewayPaymentId: null, paymentMethods: null, paymentPaidAt: null,
  ifoodOrderId: null, openDeliveryOrderId: null, openDeliveryChannel: null, fiscalStatus: null, fiscalInfo: null,
  ...extra,
});

async function main() {
  const { PATCH } = await import("../src/app/api/store/orders/[id]/tipo/route");
  const { NextRequest } = await import("next/server");
  const { assinarCotacao, chaveDoEndereco } = await import("../src/lib/cotacao-de-entrega");
  const { partesDoEnderecoDigitado } = await import("../src/lib/entrega-no-checkout");
  const patch = async (corpo: unknown) => {
    const res = await PATCH(
      new NextRequest("https://firehubfood.com.br/api/store/orders/o74/tipo", { method: "PATCH", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "o74" }) },
    );
    return { status: res!.status, corpo: (await res!.json()) as any };
  };

  console.log("\n[1] Retirada → entrega, taxa digitada");
  db.order = retirada();
  let r = await patch({ destino: "DELIVERY", endereco: "Rua das Flores, 120 - Centro", taxa: 7 });
  confere("200 e virou DELIVERY", r.status === 200 && db.order.deliveryType === "DELIVERY", r);
  confere("endereço gravado", db.order.customerAddress === "Rua das Flores, 120 - Centro");
  confere("taxa 7,00 e total 54,90 → 61,90", db.order.deliveryFee === 7 && db.order.totalAmount === 61.9, { fee: db.order.deliveryFee, total: db.order.totalAmount });
  const h = Array.isArray(db.order.editHistory) ? db.order.editHistory.at(-1) : null;
  confere("histórico: acao TIPO, quem, antes/depois", h?.acao === "TIPO" && /Douglas/.test(h?.quem) && h?.tipoAntes === "PICKUP" && h?.tipoDepois === "DELIVERY"
    && h?.totalAntes === 54.9 && h?.totalDepois === 61.9 && h?.taxaDepois === 7 && h?.enderecoDepois === "Rua das Flores, 120 - Centro", h);
  confere("sem cotação: ponto e distância ficam para o cron", db.gravacoes.at(-1)?.deliveryDistance === null && db.gravacoes.at(-1)?.motoboyFee === null);

  console.log("\n[2] Com a cotação assinada do /api/delivery-fee");
  db.order = retirada();
  const endereco = "Rua das Flores, 120 - Centro";
  const partes = partesDoEnderecoDigitado(endereco, "Macaé");
  const token = assinarCotacao({
    loja: LOJA, chave: chaveDoEndereco({ ...(partes || {}), address: endereco }), lat: -22.37, lng: -41.78, origemDoPonto: "mapa",
    distanciaKm: 2.4, medida: "rota", faixaKm: 3, taxa: 6, taxaDoEntregador: 5, tempoMin: 30,
  } as any);
  r = await patch({
    destino: "DELIVERY", endereco, taxa: 6, cotacao: token, taxaDigitadaNoBalcao: false,
    ...(partes ? { customerStreet: partes.street, customerNumber: partes.number, customerNeighborhood: partes.neighborhood } : {}),
  });
  confere("200, taxa 6 e total 60,90", r.status === 200 && db.order.deliveryFee === 6 && db.order.totalAmount === 60.9, r);
  confere("distância e ponto da cotação gravados", db.order.deliveryDistance === 2.4 && !!db.order.customerLatLng && typeof db.order.customerLatLng === "object",
    { d: db.order.deliveryDistance, p: db.order.customerLatLng });

  console.log("\n[3] Retirada já na coluna de transporte (esperando no balcão)");
  db.order = retirada({ status: "SAIU_ENTREGA", dispatchedAt: new Date(), readyAt: new Date("2026-10-18T23:00:00Z") });
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: 5 });
  confere("200 e volta para PRONTO, sem carimbo de saída", r.status === 200 && db.order.status === "PRONTO" && db.order.dispatchedAt === null, { r, s: db.order.status });
  confere("a hora do pronto não muda", db.order.readyAt?.toISOString?.() === "2026-10-18T23:00:00.000Z");
  db.order = retirada({ status: "SAIU_ENTREGA", dispatchedAt: new Date() });
  r = await patch({ destino: "MESA", tableId: "m1" });
  confere("esperando no balcão: mesa não", r.status === 400, r);
  db.order = retirada({ status: "ENTREGUE" });
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: 5 });
  confere("retirada ENTREGUE (finalizada): recusa", r.status === 403 && db.order.deliveryType === "PICKUP", r);

  console.log("\n[4] Recusas");
  db.order = retirada({ source: "IFOOD", ifoodOrderId: "if-1", deliveryType: "TAKEOUT" });
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: 5 });
  confere("iFood: 403 e o motivo fala do app", r.status === 403 && /iFood/.test(r.corpo.error) && db.order.deliveryType === "TAKEOUT", r);
  db.order = retirada({ fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "3326...", nfceNumber: 321, ambiente: 1 } });
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: 5 });
  confere("NFC-e autorizada: 403 e fala da nota", r.status === 403 && /NFC-e/.test(r.corpo.error) && db.order.deliveryType === "PICKUP", r);
  db.order = retirada({ status: "CANCELADO" });
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: 5 });
  confere("cancelado: recusa", r.status === 403, r);
  db.order = retirada();
  r = await patch({ destino: "DELIVERY", endereco: "", taxa: 5 });
  confere("sem endereço: 400", r.status === 400, r);
  r = await patch({ destino: "DELIVERY", endereco: "Rua B, 5 - Centro", taxa: -1 });
  confere("taxa negativa: 400", r.status === 400, r);

  console.log("\n[5] A volta: entrega → balcão zera taxa e endereço");
  db.order = retirada({ deliveryType: "DELIVERY", deliveryFee: 7, totalAmount: 61.9, customerAddress: "Rua das Flores, 120 - Centro" });
  r = await patch({ destino: "BALCAO" });
  confere("200, RETIRADA, taxa 0, total 54,90, endereço vazio",
    r.status === 200 && db.order.deliveryType === "RETIRADA" && db.order.deliveryFee === 0 && db.order.totalAmount === 54.9 && db.order.customerAddress === "", db.order);

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
