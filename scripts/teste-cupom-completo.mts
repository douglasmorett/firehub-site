// Map Grill (04/10/2026): impressora única, modelo "pronto-cozinha", via do entregador marcada.
// npx tsx scripts/teste-cupom-completo.mts
const papeis: any[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  if (String(url).endsWith("/status")) return { json: async () => ({ ok: true }) };
  if (String(url).endsWith("/print")) {
    papeis.push(JSON.parse(init.body));
    return { json: async () => ({ ok: true }) };
  }
  return { json: async () => ({}) };
};
const { printOrder } = await import("../src/lib/print");
const config: any = {
  autoprint: true,
  storeSlug: "map-grill",
  printers: [{ id: "1", name: "MP-4200 TH", label: "Impressora 2", copies: 1, columns: 42, modulos: ["salao", "delivery"], modeloId: "pronto-cozinha", categories: [], paperWidth: "80mm", somenteBebidas: false, viaDoEntregador: true }],
};
const pedido: any = {
  id: "ped1", dailyOrderNumber: 44, source: "ONLINE", deliveryType: "DELIVERY", createdAt: new Date().toISOString(),
  customerName: "Cliente", paymentMethod: "Pix", isPrepaid: false, totalAmount: 49.3, deliveryFee: 5,
  items: [{ name: "Picanha", qty: 1, price: 44.3, notes: "", category: "Pratos" }],
};
const resumo = () => papeis.splice(0).map((p) => `${p.printer} id=${p.order.id} semValores=${!!p.order.semValores} qr=${!!p.order.qrPuxarUrl}`);
let falhou = false;
const conferir = (nome: string, obtido: string[], esperado: number, teste: (l: string[]) => boolean) => {
  const ok = obtido.length === esperado && teste(obtido);
  if (!ok) falhou = true;
  console.log(ok ? "OK " : "ERRO", nome, obtido);
};

await printOrder(pedido, "Map Grill", config, {}, false, false, false);
conferir("automático: cozinha sem valores + via com QR", resumo(), 2, (l) => l[0].includes("semValores=true") && l[1].includes("via-entregador") && l[1].includes("qr=true"));
await printOrder(pedido, "Map Grill", config, {}, true, true, false);
conferir("botão cozinha: só sem valores", resumo(), 1, (l) => l[0].includes("semValores=true"));
await printOrder(pedido, "Map Grill", config, {}, true, false, true);
conferir("botão completo: só a via, com valores e QR", resumo(), 1, (l) => l[0].includes("semValores=false") && l[0].includes("qr=true"));
const semVia = { ...config, printers: [{ ...config.printers[0], viaDoEntregador: false }] };
await printOrder(pedido, "Map Grill", semVia, {}, true, false, true);
conferir("botão completo sem via: com valores", resumo(), 1, (l) => l[0].includes("semValores=false"));
process.exit(falhou ? 1 : 0);
