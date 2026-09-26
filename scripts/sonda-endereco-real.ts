/**
 * Sonda MANUAL (usa a internet): um endereço de verdade pelo motor da taxa,
 * com o OSM e o roteador reais e os caches do banco em memória.
 *   npx tsx scripts/sonda-endereco-real.ts "Rua do forno, travessa pantanal, nº 130, Jardim Esperança"
 */
export {};
process.env.DATABASE_URL ||= "teste-sem-banco";
(async () => {
  const rota = await import("../src/lib/distancia-por-rota");
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const { avaliarEntrega } = await import("../src/lib/area-de-entrega");
  const m1 = new Map<string, any>(); const m2 = new Map<string, string>();
  Object.assign(rota.cacheDeRotas, { ler: async (c: string) => m1.get(c) ?? null, gravar: async (c: string, r: any) => { m1.set(c, { ...r, criadoEm: Date.now() }); }, daOrigem: async () => [] });
  Object.assign(servidor.armazemDaTaxa, { ler: async (c: string) => m2.get(c) ?? null, gravar: async (g: any) => { m2.set(g.chave, g.resposta); } });
  const zonas = [[1, 5, 4, 30], [1.5, 8, 7, 30], [2, 10, 9, 35], [2.5, 12, 11, 35], [3, 15, 14, 40], [3.5, 17, 16, 40], [4, 18, 17, 45], [4.5, 19, 18, 45], [5, 20, 19, 50]].map(([km, fee, motoboyFee, time]) => ({ km, fee, motoboyFee, time }));
  const divinos = { storeAddress: "Tv Liberdade 11, Vila Monte Alegre", storeLatLng: { lat: -22.854033, lng: -42.0296526 }, city: "Cabo Frio", deliveryZoneType: "ROTA", deliveryZones: zonas, deliveryConfig: { repasseDoEntregador: { separado: true } } };
  const endereco = process.argv[2] || "Rua do forno, travessa pantanal, nº 130, Jardim Esperança";
  const t0 = Date.now();
  const v: any = await avaliarEntrega(divinos as any, { endereco }, { prazoMs: 20_000 } as any);
  console.log(JSON.stringify({ endereco, ms: Date.now() - t0, resultado: v.resultado, taxa: v.taxa, repasse: v.taxaDoEntregador, km: v.distanciaKm, medida: v.medida, ponto: v.ponto, pedeConfirmacao: v.pedeConfirmacao, motivos: v.motivosDaConfirmacao, motivo: v.motivo }, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
