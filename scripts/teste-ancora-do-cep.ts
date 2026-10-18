/**
 * A âncora do CEP (lib/ancora-do-cep.ts + `ancorasDaLoja` em
 * lib/ponto-aprendido.ts + o degrau 0b de `resolverPontosNoServidor`), com os
 * endereços reais da NIK Esfihas (Sobradinho/DF, 18/10/2026). Banco FALSO em
 * memória (o `globalThis.prisma` que lib/prisma reaproveita) e ViaCEP/mapa
 * falsos: nada sai para a rede, nada toca banco de verdade.
 *
 *   DATABASE_URL=postgresql://banco-falso/teste NEXTAUTH_SECRET=x npx tsx scripts/teste-ancora-do-cep.ts
 */
export {};

let ok = 0;
let falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe === undefined ? "" : ` — ${JSON.stringify(detalhe)}`}`);
  }
}

// ── O banco falso: as entregas da loja e o cache do mapa ─────────────────────
type Entrega = { customerAddress: string; customerLatLng: unknown; source: string; openDeliveryChannel: string | null; ifoodOrderId: string | null };
const entregas: Entrega[] = [];
const geocodeCache = new Map<string, { chave: string; lat: number; lng: number; origem: string | null }>();
let leiturasDasEntregas = 0;
/** As correções da loja (PontoAprendido, linhas "t:"). */
const correcoes: { franchiseeId: string; chave: string; lat: number; lng: number; endereco: string }[] = [];
(globalThis as any).prisma = new Proxy(
  {
    $executeRawUnsafe: async () => 0,
    $queryRawUnsafe: async (sql: string, ...args: any[]) => {
      if (/FROM "CustomerOrder"/.test(sql)) {
        leiturasDasEntregas++;
        return args[0] === "nik" ? entregas : [];
      }
      if (/FROM "GeocodeCache"/.test(sql)) return (args[0] as string[]).map((c) => geocodeCache.get(c)).filter(Boolean);
      if (/FROM "PontoAprendido"/.test(sql) && /"endereco" ~/.test(sql)) return correcoes.filter((c) => c.franchiseeId === args[0]);
      return [];
    },
  },
  { get: (t, k) => (k in t ? (t as any)[k] : async () => []) },
);

// ── ViaCEP e mapa falsos ─────────────────────────────────────────────────────
const CORREIOS: Record<string, { logradouro: string; bairro: string }> = {
  "73030037": { logradouro: "Quadra 3 Conjunto G", bairro: "Sobradinho" },
  "73015106": { logradouro: "Quadra 2 Conjunto A-6", bairro: "Sobradinho" },
  "73062404": { logradouro: "Conjunto AR 14 Conjunto 4", bairro: "Setor Oeste (Sobradinho II)" },
  "73252124": { logradouro: "Quadra 1 Conjunto G", bairro: "Condomínio Império dos Nobres (Sobradinho)" },
  "73092900": { logradouro: "Rodovia DF-425", bairro: "Setor Habitacional Contagem (Sobradinho)" },
};
let buscasNoMapa = 0;
let buscasNoViaCep = 0;
globalThis.fetch = (async (url: string) => {
  const u = new URL(String(url));
  if (u.hostname.includes("viacep")) {
    buscasNoViaCep++;
    const cep = u.pathname.split("/")[2];
    const c = CORREIOS[cep];
    return { ok: true, status: 200, json: async () => (c ? { ...c, localidade: "Brasília", uf: "DF" } : { erro: true }) } as any;
  }
  buscasNoMapa++;
  return { ok: true, status: 200, json: async () => (u.hostname.includes("photon") ? { features: [] } : []) } as any;
}) as unknown as typeof fetch;

const NIK = { lat: -15.6467899133085, lng: -47.80763973611775 };
const ifood = (endereco: string, lat: number, lng: number): Entrega => ({
  customerAddress: endereco, customerLatLng: { lat, lng }, source: "IFOOD", openDeliveryChannel: null, ifoodOrderId: "x",
});

async function main() {
  const { lugarComparavel, lugaresDoBairroDoCep, chavesDaAncoraPeloCep, chaveDaAncoraPeloTexto, ancorasDasEntregas, ancoraDoPedido } =
    await import("../src/lib/ancora-do-cep");
  const { chaveDaVizinhanca, distanciaKm, areaDaLoja } = await import("../src/lib/ponto-do-pedido");

  console.log("\n1) O lugar: o nome do bairro, com o algarismo da região");
  confere('"Sobradinho I" e "Sobradinho 1" são Sobradinho', lugarComparavel("Sobradinho I") === "sobradinho" && lugarComparavel("Sobradinho 1") === "sobradinho");
  confere('"Sobradinho II" é "sobradinho 2"', lugarComparavel("Sobradinho II") === "sobradinho 2");
  confere("setor da região: o setor e a região",
    JSON.stringify(lugaresDoBairroDoCep("Setor Oeste (Sobradinho II)")) === JSON.stringify(["setor oeste", "sobradinho 2"]));
  confere("condomínio entre parênteses NÃO vira a região (tem quadra e conjunto próprios)",
    JSON.stringify(lugaresDoBairroDoCep("Condomínio Império dos Nobres (Sobradinho)")) === JSON.stringify(["condominio imperio dos nobres"]));

  console.log("\n2) As chaves do pedido pelo CEP (rua e bairro dos Correios)");
  const pelo = (cep: string) => chavesDaAncoraPeloCep({ rua: CORREIOS[cep].logradouro, bairro: CORREIOS[cep].bairro });
  confere("73030-037 = Quadra 3 Conjunto G de Sobradinho", JSON.stringify(pelo("73030037")) === JSON.stringify(["v:sobradinho|q3|cjg"]), pelo("73030037"));
  confere("73015-106 = Quadra 2 Conjunto A-6", pelo("73015106")[0] === "v:sobradinho|q2|cja6", pelo("73015106"));
  confere('"Conjunto AR 14 Conjunto 4" (Sobradinho II): o 1º "Conjunto" é do setor', pelo("73062404").includes("v:sobradinho 2|ar14|cj4"), pelo("73062404"));
  confere("Quadra 1 Conjunto G do Império não vira a de Sobradinho", !pelo("73252124").some((k) => k.startsWith("v:sobradinho|")), pelo("73252124"));
  confere("Rodovia DF-425 (condomínio): sem âncora", pelo("73092900").length === 0);
  confere('"Quadra 8" sem conjunto: sem âncora', chavesDaAncoraPeloCep({ rua: "Quadra 8", bairro: "Sobradinho" }).length === 0);
  confere('"Quadra 7 Conjunto E": o conjunto E existe', chavesDaAncoraPeloCep({ rua: "Quadra 7 Conjunto E", bairro: "Sobradinho" })[0] === "v:sobradinho|q7|cje");

  console.log("\n3) As chaves das entregas com ponto, pelo texto do app");
  const textos: [string, string | null][] = [
    ["Q. 5 Conjunto C, 35 - Comp: pela área verde - Ref: pé - Sobradinho - Brasília", "v:sobradinho|q5|cjc"],
    ["Q 7 Conjunto E, 19 - Sobradinho - Brasília", "v:sobradinho|q7|cje"],
    ["Q 4 Conjunto E, 204 - Comp: Conjunto E, Bloco E - Ref: Na banca - Sobradinho - Brasília", "v:sobradinho|q4|cje"],
    ["Q. 4 conjunto E bloco B Ed. Morada da Serra, 202 - Comp: Apto 202 - Ref: Próximo ao senac - Sobradinho I - Brasília", "v:sobradinho|q4|cje"],
    ["ar 7, cj 5 LT 18 - Sobradinho II, Sobradinho - DF, Casa cinza na esquina", "v:sobradinho 2|ar7|cj5"],
    ["Q 2 Conjunto B9, 13 - Comp: Portão azul - Sobradinho - Brasília", "v:sobradinho|q2|cjb9"],
    // Texto com CEP: o lugar é o CEP, não o nome — fica de fora.
    ["Qd 03 Cj G lote 07, 07 - Casa - QUADRA 3 - Brasília/DF - CEP 73030037", null],
    ["Quadra 5 conjunto E lote 3 - Sobradinho", "v:sobradinho|q5|cje"],
    ["Quadra 5 próximo ao conjunto e da praça - Sobradinho", null],
  ];
  for (const [t, esperada] of textos) confere(`"${t.slice(0, 50)}" → ${esperada}`, chaveDaAncoraPeloTexto(t) === esperada, chaveDaAncoraPeloTexto(t));
  confere("vizinhança das correções também lê o conjunto E", chaveDaVizinhanca("Quadra 7 conjunto E casa 3, 3 - QUADRA 7 - Brasília/DF - CEP 73035051") === "v:73035|q7|cje");
  confere('"Q. 9 Conjunto E, AR 17": duas quadras, continua sem vizinhança', chaveDaVizinhanca("Q. 9 Conjunto E, AR 17 - Sobradinho") === null);

  console.log("\n4) A âncora: a mediana das entregas, e só se couberem num quarteirão");
  const a = ancorasDasEntregas([
    { endereco: "Q 3 Conjunto G, 10 - Sobradinho - Brasília", ponto: { lat: -15.6527, lng: -47.8121 } },
    { endereco: "Q. 3 Conj. G, 22 - Sobradinho - Brasília", ponto: { lat: -15.6530, lng: -47.8118 } },
    { endereco: "Quadra 3 Conjunto G, 31 - Sobradinho I - Brasília", ponto: { lat: -15.6525, lng: -47.8125 } },
    { endereco: "Q 9 Conjunto B, 1 - Sobradinho - Brasília", ponto: { lat: -15.6400, lng: -47.7950 } },
    { endereco: "Q 9 Conjunto B, 2 - Sobradinho - Brasília", ponto: { lat: -15.6000, lng: -47.7950 } },
  ]);
  const g = a.get("v:sobradinho|q3|cjg");
  confere("três entregas do Q3 Cj G: a mediana, com a contagem", !!g && g.entregas === 3 && Math.abs(g.lat + 15.6527) < 1e-9 && Math.abs(g.lng + 47.8121) < 1e-9, g);
  confere("Q9 Cj B espalhado por 4 km: sem âncora", !a.has("v:sobradinho|q9|cjb"));
  confere("a primeira chave do CEP com entregas", ancoraDoPedido(["v:setor oeste|q3|cjg", "v:sobradinho|q3|cjg"], a) === g);

  console.log("\n5) No servidor: o #60 da NIK cai na Quadra 3 Conjunto G, não na Quadra 15");
  entregas.push(
    ifood("Q 3 Conjunto G, 10 - Sobradinho - Brasília", -15.6527, -47.8121),
    ifood("Q. 3 Conj. G, 22 - Comp: casa - Sobradinho - Brasília", -15.6530, -47.8118),
    ifood("AR 14 Conjunto 4, 8 - Sobradinho II - Brasília", -15.6488, -47.8196),
    // Ponto achado pelo texto (o nosso mapa) não ensina: seria o mapa ensinando o mapa.
    { customerAddress: "Q 2 Cj A6, 7 - Sobradinho - Brasília", customerLatLng: { lat: -15.70, lng: -47.90, origem: "mapa" }, source: "WABIZ", openDeliveryChannel: "WABIZ", ifoodOrderId: null },
    // A posição dada pela loja ensina.
    { customerAddress: "Quadra 1 conjunto G, 37 - Império - Sobradinho - Brasília", customerLatLng: { lat: -15.6867, lng: -47.8359, origem: "manual" }, source: "WABIZ", openDeliveryChannel: "WABIZ", ifoodOrderId: null },
  );
  const { resolverPontosNoServidor, chaveDaBusca, reiniciarGeocodificacaoParaTeste } = await import("../src/lib/geocodificacao-servidor");
  reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
  const area = areaDaLoja({ deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [] }, NIK);
  const loja = { cidade: "BRASILIA DF", endereco: "QUADRA 5 RUA 5 CL 17 - SOBRADINHO I", centro: NIK, area, franchiseeId: "nik" };
  const W60 = "Qd 03 Cj G lote 07, 07 - Casa - QUADRA 3 - Brasília/DF - CEP 73030037";
  const QUADRA_15_CJ_C = { lat: -15.6389, lng: -47.7869 };
  const chave60 = chaveDaBusca(W60, "BRASILIA DF");
  geocodeCache.set(chave60, { chave: chave60, ...QUADRA_15_CJ_C, origem: "rua (Photon, grafia aproximada) (pelo CEP)" });
  const antesMapa = buscasNoMapa;
  const r = await resolverPontosNoServidor(
    [
      { id: "p60", endereco: W60, ehMarketplace: true },
      { id: "par", endereco: "AR 14 conjunto 04, 03 - Casa - SOBRADINHO 2 - Brasília/DF - CEP 73062404", ehMarketplace: true },
      { id: "imp", endereco: "Quadra 1 Conjunto G, 37 - IMPERIO - Brasília/DF - CEP 73252124", ehMarketplace: true },
      { id: "a6", endereco: "Quadra 2 cj A6, 00 - Bloco 1, apto 104 - QUADRA 2 - Brasília/DF - CEP 73015106", ehMarketplace: true },
    ],
    loja,
  );
  const p60 = r.achados.find((x) => x.id === "p60");
  confere("#60: pela âncora, aproximado, na Quadra 3 Conjunto G (o cache da Quadra 15 não volta)",
    !!p60 && p60.fonte === "vizinhanca" && p60.aproximado === true && distanciaKm(p60, { lat: -15.65285, lng: -47.81195 }) < 0.05 && /2 entregas/.test(p60.origem), p60);
  const par = r.achados.find((x) => x.id === "par");
  confere("AR 14 Conjunto 4 (Sobradinho II) pela âncora", !!par && par.fonte === "vizinhanca" && distanciaKm(par, { lat: -15.6488, lng: -47.8196 }) < 0.05, par);
  const imp = r.achados.find((x) => x.id === "imp");
  confere("Império: sem âncora de Sobradinho (segue o mapa, que aqui não acha nada)", !imp || imp.fonte !== "vizinhanca", imp);
  confere("Quadra 2 Cj A6: a entrega achada pelo nosso mapa não virou âncora", r.achados.find((x) => x.id === "a6")?.fonte !== "vizinhanca");
  confere("o mapa só foi perguntado pelos dois sem âncora", buscasNoMapa > antesMapa);
  const viaAntes = buscasNoViaCep;
  const leiturasAntes = leiturasDasEntregas;
  const r2 = await resolverPontosNoServidor([{ id: "p60", endereco: W60, ehMarketplace: true }], loja);
  confere("de novo: o mesmo ponto, sem ViaCEP nem banco (memória)", r2.achados[0]?.fonte === "vizinhanca" && buscasNoViaCep === viaAntes && leiturasDasEntregas === leiturasAntes);
  const r3 = await resolverPontosNoServidor([{ id: "p60", endereco: W60, ehMarketplace: true }], { ...loja, franchiseeId: "outra" });
  confere("a âncora é da loja: outra loja não herda as entregas da NIK", r3.achados[0]?.fonte !== "vizinhanca");

  console.log("\n6) A correção da loja vale para o MESMO CEP (condomínio, quadra comercial)");
  const VIVENDAS = { lat: -15.6611, lng: -47.8402 };
  correcoes.push(
    { franchiseeId: "nik", chave: "t:cond novo horizonte", ...VIVENDAS, endereco: "Cond. Novo Horizonte, Mod A, Lote 8A, s/n - Apt 302 - DF - 425 - Brasília/DF - CEP 73092906" },
    { franchiseeId: "nik", chave: "t:geral", lat: -15.6, lng: -47.7, endereco: "Quadra 2 conjunto e12 casa 1 - QUADRA 2 - Brasília/DF - CEP 73000000" },
  );
  const VH = "Condomínio Novo Horizonte módulo C casa 4, 4 - DF 425 - Brasília/DF - CEP 73092906";
  const r6 = await resolverPontosNoServidor(
    [
      { id: "vh", endereco: VH, ehMarketplace: true },
      { id: "geral", endereco: "Quadra 9 casa 3, 3 - QUADRA 9 - Brasília/DF - CEP 73000000", ehMarketplace: true },
    ],
    loja,
  );
  const vh = r6.achados.find((x) => x.id === "vh");
  confere("outra casa do mesmo CEP: a posição corrigida, aproximada",
    !!vh && vh.fonte === "vizinhanca" && vh.aproximado === true && distanciaKm(vh, VIVENDAS) < 0.01 && /mesmo CEP/.test(vh.origem), vh);
  confere("CEP da cidade inteira (73000-000) não ensina", r6.achados.find((x) => x.id === "geral")?.fonte !== "vizinhanca");
  correcoes.push({ franchiseeId: "nik", chave: "t:outro lado", lat: -15.6611, lng: -47.8202, endereco: "Cond. Novo Horizonte casa 90 - CEP 73092906" });
  const r7 = await resolverPontosNoServidor([{ id: "vh", endereco: VH, ehMarketplace: true }], loja);
  confere("correções do mesmo CEP a 2 km uma da outra: não vale (não é um lugar só)", r7.achados[0]?.fonte !== "vizinhanca", r7);

  console.log(`\n${ok} ok, ${falhas} falharam`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
