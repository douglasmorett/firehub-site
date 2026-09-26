/**
 * O MOTOR da entrega por km (cluster A, 25/09/2026): faixa, rota, estimativa,
 * ponto aproximado, "não sei", coordenada de parceiro falsa, cache e prazo.
 *
 *   npx tsx scripts/teste-motor-da-entrega.ts
 *
 * Sem rede e sem banco: o `fetch` do Nominatim e do roteador (OSRM) é
 * simulado aqui, e os caches do banco (RotaCache, GeocodeCache) são trocados
 * por memória. A DATABASE_URL é de mentira — só para o módulo do Prisma subir.
 *
 * Loja de referência: Divinos Burger (Cabo Frio, modo ROTA), com a tabela real
 * dela (km de rua → taxa ao cliente • repasse ao motoboy).
 *
 * MANUAL, OPCIONAL (usa a internet — o integrador decide rodar):
 *   npx tsx scripts/teste-motor-da-entrega.ts --rede
 * Depois dos casos simulados, pergunta ao roteador público e ao Nominatim de
 * verdade pela Divinos → Vila Boca do Mato (medido em 25/09/2026: ~0,84 km de
 * rua). Confere o formato real da resposta (waypoints, código "Ok").
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
process.env.COTACAO_SECRET = "segredo-de-teste";
delete process.env.OSRM_URL;
const fetchDeVerdade = globalThis.fetch;

type Ponto = { lat: number; lng: number };

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

// ── O MUNDO SIMULADO ─────────────────────────────────────────────────────────

const LOJA: Ponto = { lat: -22.854033, lng: -42.0296526 };
const KM_POR_GRAU_LAT = 111.32;
/** Um ponto a `km` da loja para o sul (e um desvio de lng para cada caso ter chave própria). */
function aoSul(km: number, desvio = 0): Ponto {
  return { lat: Number((LOJA.lat - km / KM_POR_GRAU_LAT).toFixed(6)), lng: Number((LOJA.lng + desvio).toFixed(6)) };
}
function retaKm(a: Ponto, b: Ponto) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const chave4 = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

type RespostaSimulada = { status: number; corpo: unknown } | "pendura";
/** Nominatim: pela consulta normalizada (q=) ou "rua|cidade" (estruturada). */
const nominatim = new Map<string, RespostaSimulada>();
let nominatimPadrao: RespostaSimulada = { status: 200, corpo: [] };
/** OSRM: pelo destino (4 casas). Sem entrada: rua = reta × 1,3, arrastado 5 m. */
const osrm = new Map<string, RespostaSimulada | ((tentativa: number) => RespostaSimulada)>();
/** O roteador reserva (OSRM_URL_RESERVA), com respostas próprias pelo destino. */
const RESERVA_DO_TESTE = "http://reserva.local:5000";
const osrmReserva = new Map<string, RespostaSimulada>();
/** Google (GOOGLE_MAPS_API_KEY): pelo "address" normalizado. Sem entrada: ZERO_RESULTS. */
const google = new Map<string, unknown>();
const chamadas: { tipo: "nominatim" | "osrm" | "reserva" | "google"; url: string; em: number }[] = [];

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function lugar(p: Ponto, a: { road?: string; suburb?: string; city?: string; house_number?: string; display?: string; classe?: string; tipo?: string }) {
  return {
    lat: String(p.lat), lon: String(p.lng),
    ...(a.classe ? { class: a.classe, type: a.tipo ?? "", addresstype: a.tipo ?? "" } : {}),
    display_name: a.display ?? [a.road, a.house_number, a.suburb, a.city ?? "Cabo Frio", "Rio de Janeiro", "Brasil"].filter(Boolean).join(", "),
    address: { road: a.road, suburb: a.suburb, city: a.city ?? "Cabo Frio", house_number: a.house_number },
  };
}
const osrmOk = (metros: number, deslocamento = 5) => ({
  status: 200,
  corpo: { code: "Ok", routes: [{ distance: metros, duration: metros / 8 }], waypoints: [{ distance: 3 }, { distance: deslocamento }] },
});

function esperarAbortar(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, rejeita) => {
    const erro = () => rejeita(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    if (!signal) return;
    if (signal.aborted) return erro();
    signal.addEventListener("abort", erro);
  });
}

const tentativasOsrm = new Map<string, number>();
(globalThis as any).fetch = async (entrada: any, init?: RequestInit): Promise<Response> => {
  const url = String(entrada);
  if (url.includes("nominatim.openstreetmap.org")) {
    chamadas.push({ tipo: "nominatim", url, em: Date.now() });
    const u = new URL(url);
    const k = u.searchParams.get("q") != null ? norm(u.searchParams.get("q")!) : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    const r = nominatim.get(k) ?? nominatimPadrao;
    if (r === "pendura") return esperarAbortar(init?.signal);
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/route/v1/driving/")) {
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const destino = { lat: Number(m[4]), lng: Number(m[3]) };
    const k = chave4(destino);
    if (url.startsWith(RESERVA_DO_TESTE)) {
      chamadas.push({ tipo: "reserva", url, em: Date.now() });
      const r = osrmReserva.get(k) ?? osrmOk(retaKm({ lat: Number(m[2]), lng: Number(m[1]) }, destino) * 1300);
      if (r === "pendura") return esperarAbortar(init?.signal);
      return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
    }
    chamadas.push({ tipo: "osrm", url, em: Date.now() });
    const n = (tentativasOsrm.get(k) || 0) + 1;
    tentativasOsrm.set(k, n);
    const cfg = osrm.get(k);
    const r = typeof cfg === "function" ? cfg(n) : cfg ?? osrmOk(retaKm({ lat: Number(m[2]), lng: Number(m[1]) }, destino) * 1300);
    if (r === "pendura") return esperarAbortar(init?.signal);
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }
  if (url.includes("maps.googleapis.com/maps/api/geocode")) {
    chamadas.push({ tipo: "google", url, em: Date.now() });
    const k = norm(new URL(url).searchParams.get("address") || "");
    return new Response(JSON.stringify(google.get(k) ?? { status: "ZERO_RESULTS", results: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`fetch inesperado no teste: ${url}`);
};

const contar = (tipo: "nominatim" | "osrm" | "reserva" | "google", desde: number) => chamadas.slice(desde).filter((c) => c.tipo === tipo).length;

// Os avisos do motor vão para cá (o teste confere o log do 429 e da estimativa).
const avisos: string[] = [];
const warnOriginal = console.warn;
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

// ── A LOJA ───────────────────────────────────────────────────────────────────

const ZONAS_DIVINOS = [
  { km: 1, fee: 5, motoboyFee: 4, time: 30 }, { km: 1.5, fee: 8, motoboyFee: 7, time: 35 },
  { km: 2, fee: 10, motoboyFee: 9, time: 40 }, { km: 2.5, fee: 12, motoboyFee: 11, time: 40 },
  { km: 3, fee: 15, motoboyFee: 14, time: 45 }, { km: 3.5, fee: 17, motoboyFee: 16, time: 45 },
  { km: 4, fee: 18, motoboyFee: 17, time: 50 }, { km: 4.5, fee: 19, motoboyFee: 18, time: 50 },
  { km: 5, fee: 20, motoboyFee: 19, time: 60 },
];
const divinos = {
  storeAddress: "Tv Liberdade 11, Vila Monte Alegre", storeLatLng: LOJA, city: "Cabo Frio",
  deliveryZoneType: "ROTA", deliveryZones: ZONAS_DIVINOS,
  deliveryConfig: { repasseDoEntregador: { separado: true, marketplace: "TABELA" } },
};

async function main() {
  const rota = await import("../src/lib/distancia-por-rota");
  const geocoding = await import("../src/lib/geocoding");
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const area = await import("../src/lib/area-de-entrega");
  const parceiro = await import("../src/lib/coordenadas-do-parceiro");
  const distancia = await import("../src/lib/distancia-da-entrega");
  const { avaliarEntrega } = area;

  // Caches do banco → memória.
  const rotasGuardadas = new Map<string, { km: number; minutos: number | null; deslocamentoM?: number | null; criadoEm: number }>();
  Object.assign(rota.cacheDeRotas, {
    ler: async (c: string) => rotasGuardadas.get(c) ?? null,
    gravar: async (c: string, r: any) => { rotasGuardadas.set(c, { ...r, criadoEm: Date.now() }); },
    daOrigem: async (p: string) => [...rotasGuardadas].filter(([c]) => c.startsWith(p)).map(([chave, r]) => ({ chave, km: r.km })),
  });
  const geoGuardado = new Map<string, string>();
  Object.assign(servidor.armazemDaTaxa, {
    ler: async (c: string) => geoGuardado.get(c) ?? null,
    gravar: async (g: any) => { geoGuardado.set(g.chave, g.resposta); },
  });

  function zerar(opcoes?: { intervaloDoPublicoMs?: number; intervaloDoNominatimMs?: number; manterCaches?: boolean }) {
    rota.reiniciarRoteadorParaTeste({ intervaloDoPublicoMs: opcoes?.intervaloDoPublicoMs ?? 0 });
    servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: opcoes?.intervaloDoNominatimMs ?? 0 });
    geocoding.reiniciarNominatimParaTeste();
    if (!opcoes?.manterCaches) { rotasGuardadas.clear(); geoGuardado.clear(); }
    nominatim.clear();
    nominatimPadrao = { status: 200, corpo: [] };
    osrm.clear();
    osrmReserva.clear();
    tentativasOsrm.clear();
    delete process.env.OSRM_URL;
    // Reserva desligado por padrão: os casos abaixo falam da política do
    // PRINCIPAL (quantas perguntas, prazo, 429). O reserva tem seção própria.
    process.env.OSRM_URL_RESERVA = "";
    // Google desligado por padrão (sem chave): tem seção própria.
    google.clear();
    delete process.env.GOOGLE_MAPS_API_KEY;
  }
  /** Avalia com o PINO do cliente num ponto em que o roteador devolve `metros`. */
  async function comPino(destino: Ponto, metros: number, loja: any = divinos) {
    osrm.set(chave4(destino), osrmOk(metros));
    return avaliarEntrega(loja, { endereco: "casa do cliente", coords: destino, origemDasCoords: "pino" });
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R5: a faixa (limite inclusivo, 0,01 km, folga só na última) ==");
  const { faixaDaDistancia } = geocoding;
  const faixa = (km: number) => {
    const r = faixaDaDistancia(ZONAS_DIVINOS, km);
    return r.dentro ? r.faixa!.km : "FORA";
  };
  conferir("0 km → primeira faixa (sem km mínimo)", faixa(0) === 1);
  conferir("1,00 km → faixa de 1 km (inclusivo)", faixa(1) === 1);
  conferir("1,004 km arredonda para 1,00 → faixa de 1", faixa(1.004) === 1);
  conferir("1,006 km arredonda para 1,01 → faixa de 1,5", faixa(1.006) === 1.5);
  conferir("1,5 km → faixa de 1,5", faixa(1.5) === 1.5);
  conferir("1,2 km cai na faixa de cima (1,5)", faixa(1.2) === 1.5);
  conferir("4,99 km → faixa de 5", faixa(4.99) === 5);
  conferir("5,05 km → ainda a última (folga de 50 m)", faixa(5.05) === 5);
  conferir("5,054 km arredonda para 5,05 → atende", faixa(5.054) === 5);
  conferir("5,06 km → FORA", faixa(5.06) === "FORA");
  conferir("folga não vale nas faixas do meio: 1,04 km é faixa de 1,5", faixa(1.04) === 1.5);
  conferir("faixas fora de ordem no cadastro são ordenadas", faixaDaDistancia([{ km: 3 }, { km: 1 }], 0.5).faixa?.km === 1);
  conferir("sem faixa nenhuma → fora", faixaDaDistancia([], 1).dentro === false);

  zerar();
  console.log("\n== R5 de ponta a ponta: pino do cliente + rota pela rua (tabela da Divinos) ==");
  const casos: [number, number | "FORA", number | null][] = [
    // metros de rua, taxa esperada, repasse esperado
    [1000, 5, 4], [1004, 5, 4], [1006, 8, 7], [1500, 8, 7], [2600, 15, 14], [4990, 20, 19], [5000, 20, 19], [5050, 20, 19], [5060, "FORA", null],
  ];
  for (let i = 0; i < casos.length; i++) {
    const [metros, taxa, repasse] = casos[i];
    const v = await comPino(aoSul(0.9, i * 0.001), metros);
    if (taxa === "FORA") {
      conferir(`${metros} m de rua → FORA`, v.resultado === "FORA", v);
    } else {
      conferir(`${metros} m de rua → R$ ${taxa} • motoboy R$ ${repasse}`,
        v.resultado === "ATENDE" && v.taxa === taxa && v.taxaDoEntregador === repasse && v.medida === "rota" && v.pedeConfirmacao === false,
        { resultado: v.resultado, taxa: v.taxa, repasse: v.taxaDoEntregador, medida: v.medida, d: v.distanciaKm });
    }
  }
  const naPorta = await comPino(LOJA, 0);
  conferir("cliente na porta da loja: 0 km é a primeira faixa, com repasse", naPorta.resultado === "ATENDE" && naPorta.distanciaKm === 0 && naPorta.taxa === 5 && naPorta.taxaDoEntregador === 4 && naPorta.faixaKm === 1, naPorta);
  const comPonto = await comPino(aoSul(0.9, 0.0005), 1400);
  conferir("o veredito leva o ponto, a origem (pino), a medida, a faixa e o prazo",
    comPonto.ponto?.origem === "pino" && comPonto.ponto?.lat === aoSul(0.9, 0.0005).lat && comPonto.medida === "rota" && comPonto.faixaKm === 1.5 && comPonto.tempoMin === 35, comPonto);

  zerar();
  const lojaKm = { ...divinos, deliveryZoneType: "KM" };
  const antesKm = chamadas.length;
  const emKm = await avaliarEntrega(lojaKm, { endereco: "x", coords: aoSul(1.2) });
  conferir("modo KM (raio): linha reta de propósito, sem perguntar ao roteador",
    emKm.resultado === "ATENDE" && emKm.medida === "linha-reta" && emKm.taxa === 8 && contar("osrm", antesKm) === 0, emKm);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R4: roteador fora → 1 nova tentativa, estimativa pelo fator DA LOJA, disjuntor ==");
  zerar();
  const destinoFalha = aoSul(2.0);
  osrm.set(chave4(destinoFalha), { status: 503, corpo: { message: "fora" } });
  let antes = chamadas.length;
  const estimada = await avaliarEntrega(divinos, { endereco: "x", coords: destinoFalha });
  // A reta EXATA: é ela que se multiplica pelo fator (arredondar uma vez só, R5).
  const reta = geocoding.linhaRetaKm(LOJA.lat, LOJA.lng, destinoFalha.lat, destinoFalha.lng);
  conferir("perguntou 2 vezes (a primeira + 1 nova tentativa)", contar("osrm", antes) === 2, contar("osrm", antes));
  conferir("sem histórico, fator 1,4: distância = reta × 1,4, medida 'estimada'",
    estimada.medida === "estimada" && estimada.distanciaKm === Math.round(reta * 1.4 * 100) / 100, { d: estimada.distanciaKm, reta, medida: estimada.medida });
  conferir("a faixa sai da distância estimada (nunca da reta pura)", estimada.resultado === "ATENDE" && estimada.taxa === 15, estimada);
  conferir("o motivo diz que foi estimado", /ESTIMADOS/.test(estimada.motivo), estimada.motivo);
  conferir("a nota do pedido diz 'distância estimada'", /distância estimada/.test(area.descreverVeredicto(estimada)), area.descreverVeredicto(estimada));
  conferir("o disjuntor abriu (duas falhas seguidas)", rota.estadoDoRoteador().disjuntorAberto === true);
  antes = chamadas.length;
  const comDisjuntor = await avaliarEntrega(divinos, { endereco: "x", coords: aoSul(1.7) });
  conferir("com o disjuntor aberto, nem pergunta — e estima na hora", contar("osrm", antes) === 0 && comDisjuntor.medida === "estimada", comDisjuntor);
  conferir("o log avisou que o roteador caiu", avisos.some((a) => /roteador .* fora/.test(a)));

  // R5 com o roteador fora: reta EXATA × fator, arredondada UMA vez. Caso do
  // teste de ponta a ponta de 25/09/2026: 0,7375 km × 1,36 virava 0,74 × 1,36
  // = 1,01 km — a faixa de 1,5 km (R$ 8) para quem está a 1,00 km (R$ 5).
  zerar();
  let noLimite: Ponto | null = null;
  for (let m = 700; m <= 740 && !noLimite; m++) {
    const p = aoSul(m / 1000);
    const r = retaKm(LOJA, p);
    if (Math.round(r * 1.4 * 100) === 100 && Math.round((Math.round(r * 100) / 100) * 1.4 * 100) === 101) noLimite = p;
  }
  conferir("(achado um ponto em que arredondar a reta antes sobe de faixa)", !!noLimite);
  if (noLimite) {
    osrm.set(chave4(noLimite), { status: 503, corpo: { message: "fora" } });
    const umaVez = await avaliarEntrega(divinos, { endereco: "x", coords: noLimite });
    conferir("estimada arredonda UMA vez: reta exata × 1,4 = 1,00 km → faixa de 1 km (R$ 5 • R$ 4), não 1,01 km → R$ 8",
      umaVez.medida === "estimada" && umaVez.distanciaKm === 1 && umaVez.faixaKm === 1 && umaVez.taxa === 5 && umaVez.taxaDoEntregador === 4,
      { umaVez, reta: retaKm(LOJA, noLimite) });
    conferir("o log mostra a reta exata (0,715 km), não a arredondada (0,72)",
      avisos.some((a) => /distância ESTIMADA \(0\.71\d km × 1\.4/.test(a)), avisos.filter((a) => /ESTIMADA/.test(a)));
  }

  zerar();
  // Histórico da loja: 5 rotas com razão ~1,6 (Cabo Frio medido: mediana perto de 1,5–1,6).
  for (const [i, km] of [1.0, 1.5, 2.0, 2.5, 3.0].entries()) {
    const p = aoSul(km, 0.01 + i * 0.002);
    rotasGuardadas.set(rota.chaveDaRota(LOJA, p), { km: Math.round(retaKm(LOJA, p) * 1.6 * 100) / 100, minutos: 5, deslocamentoM: 5, criadoEm: Date.now() });
  }
  conferir("fator da loja = mediana da RotaCache dela (≈1,6)", (await rota.fatorDeDesvio(LOJA)).fator === 1.6, await rota.fatorDeDesvio(LOJA));
  const destinoHist = aoSul(2.0, -0.01);
  osrm.set(chave4(destinoHist), { status: 502, corpo: {} });
  const comHistorico = await avaliarEntrega(divinos, { endereco: "x", coords: destinoHist });
  const retaHist = geocoding.linhaRetaKm(LOJA.lat, LOJA.lng, destinoHist.lat, destinoHist.lng);
  conferir("roteador fora: reta × 1,6 da loja (Gamboa não vira faixa de baixo)",
    comHistorico.medida === "estimada" && comHistorico.distanciaKm === Math.round(retaHist * 1.6 * 100) / 100, { d: comHistorico.distanciaKm, retaHist });

  zerar();
  for (const [i, km] of [1.0, 1.5, 2.0].entries()) {
    const p = aoSul(km, 0.02 + i * 0.002);
    rotasGuardadas.set(rota.chaveDaRota(LOJA, p), { km: Math.round(retaKm(LOJA, p) * 3 * 100) / 100, minutos: 5, deslocamentoM: 5, criadoEm: Date.now() });
  }
  conferir("fator limitado a 2,0 no máximo", (await rota.fatorDeDesvio(LOJA)).fator === 2);
  zerar();
  for (const [i, km] of [1.0, 1.5, 2.0].entries()) {
    const p = aoSul(km, 0.03 + i * 0.002);
    rotasGuardadas.set(rota.chaveDaRota(LOJA, p), { km: Math.round(retaKm(LOJA, p) * 1.05 * 100) / 100, minutos: 5, deslocamentoM: 5, criadoEm: Date.now() });
  }
  conferir("fator limitado a 1,2 no mínimo", (await rota.fatorDeDesvio(LOJA)).fator === 1.2);
  zerar();
  rotasGuardadas.set(rota.chaveDaRota(LOJA, aoSul(1)), { km: 1.6, minutos: 5, deslocamentoM: 5, criadoEm: Date.now() });
  conferir("menos de 3 amostras → 1,4", (await rota.fatorDeDesvio(LOJA)).fator === 1.4);

  zerar();
  const destino429 = aoSul(1.8);
  osrm.set(chave4(destino429), { status: 429, corpo: { message: "Too Many Requests" } });
  antes = chamadas.length;
  const com429 = await avaliarEntrega(divinos, { endereco: "x", coords: destino429 });
  conferir("429: NÃO insiste (uma pergunta só) e abre o disjuntor",
    contar("osrm", antes) === 1 && rota.estadoDoRoteador().disjuntorAberto && com429.medida === "estimada", { n: contar("osrm", antes), medida: com429.medida });

  zerar();
  const destinoIlha = aoSul(1.1);
  osrm.set(chave4(destinoIlha), { status: 400, corpo: { code: "NoRoute", message: "Impossible route" } });
  antes = chamadas.length;
  const semRota = await avaliarEntrega(divinos, { endereco: "x", coords: destinoIlha });
  conferir("NoRoute é definitivo: uma pergunta, estimativa, disjuntor FECHADO",
    contar("osrm", antes) === 1 && semRota.medida === "estimada" && !rota.estadoDoRoteador().disjuntorAberto, { n: contar("osrm", antes), medida: semRota.medida });

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R4b: roteador reserva (FOSSGIS) antes da estimativa ==");
  zerar();
  process.env.OSRM_URL_RESERVA = RESERVA_DO_TESTE;
  const destinoReserva = aoSul(2.2, 0.0021);
  osrm.set(chave4(destinoReserva), { status: 503, corpo: { message: "fora" } });
  osrmReserva.set(chave4(destinoReserva), osrmOk(3100));
  antes = chamadas.length;
  const pelaReserva = await avaliarEntrega(divinos, { endereco: "x", coords: destinoReserva });
  conferir("principal fora: 2 perguntas a ele, 1 ao reserva, e vale a RUA do reserva",
    contar("osrm", antes) === 2 && contar("reserva", antes) === 1 && pelaReserva.medida === "rota" && pelaReserva.distanciaKm === 3.1 && pelaReserva.taxa === 17,
    { osrm: contar("osrm", antes), reserva: contar("reserva", antes), medida: pelaReserva.medida, d: pelaReserva.distanciaKm, taxa: pelaReserva.taxa });
  conferir("o estado conta a resposta do reserva", rota.estadoDoRoteador().contagem.respondidasPelaReserva === 1, rota.estadoDoRoteador().contagem);
  // O disjuntor do principal abriu (duas falhas): a próxima vai direto ao reserva.
  const direto = aoSul(1.9, 0.0023);
  antes = chamadas.length;
  const comPrincipalFora = await avaliarEntrega(divinos, { endereco: "x", coords: direto });
  conferir("disjuntor do principal aberto: nem pergunta a ele, pergunta ao reserva",
    contar("osrm", antes) === 0 && contar("reserva", antes) === 1 && comPrincipalFora.medida === "rota", { osrm: contar("osrm", antes), reserva: contar("reserva", antes), medida: comPrincipalFora.medida });

  zerar();
  process.env.OSRM_URL_RESERVA = RESERVA_DO_TESTE;
  const destinoSemRota = aoSul(1.15, 0.0025);
  osrm.set(chave4(destinoSemRota), { status: 400, corpo: { code: "NoRoute", message: "Impossible route" } });
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "x", coords: destinoSemRota });
  conferir("'não há rota' do principal é definitivo: o reserva não é perguntado", contar("reserva", antes) === 0, contar("reserva", antes));

  zerar();
  process.env.OSRM_URL_RESERVA = RESERVA_DO_TESTE;
  const destinoAmbos = aoSul(2.0, 0.0027);
  osrm.set(chave4(destinoAmbos), { status: 503, corpo: {} });
  osrmReserva.set(chave4(destinoAmbos), { status: 502, corpo: {} });
  const ambosFora = await avaliarEntrega(divinos, { endereco: "x", coords: destinoAmbos });
  conferir("os dois fora: estimativa, e o disjuntor do reserva abre", ambosFora.medida === "estimada" && rota.estadoDoRoteador().reserva.disjuntorAberto === true, { medida: ambosFora.medida, reserva: rota.estadoDoRoteador().reserva });
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "x", coords: aoSul(1.6, 0.0029) });
  conferir("com os dois disjuntores abertos, a cotação seguinte não pergunta a ninguém", contar("osrm", antes) === 0 && contar("reserva", antes) === 0, { osrm: contar("osrm", antes), reserva: contar("reserva", antes) });

  zerar();
  process.env.OSRM_URL_RESERVA = RESERVA_DO_TESTE;
  const destinoReservaMudo = aoSul(1.25, 0.0031);
  osrm.set(chave4(destinoReservaMudo), { status: 503, corpo: {} });
  osrmReserva.set(chave4(destinoReservaMudo), "pendura");
  const inicioDoMudo = Date.now();
  const reservaMudo = await avaliarEntrega(divinos, { endereco: "x", coords: destinoReservaMudo }, { prazoMs: 12_000 });
  const gastoNoMudo = Date.now() - inicioDoMudo;
  conferir("reserva mudo: desiste em 3 s e estima (a cotação não passa do prazo)", reservaMudo.medida === "estimada" && gastoNoMudo < 5000, { gasto: gastoNoMudo, medida: reservaMudo.medida });

  zerar();
  const destinoMenor = aoSul(1.5);
  osrm.set(chave4(destinoMenor), osrmOk(900, 400));
  const menor = await avaliarEntrega(divinos, { endereco: "x", coords: destinoMenor });
  conferir("rota MENOR que a reta (ponto arrastado) não vale: estimada", menor.medida === "estimada" && (menor.distanciaKm ?? 0) >= 1.5, menor);

  zerar();
  const destinoLento = aoSul(1.3);
  osrm.set(chave4(destinoLento), "pendura");
  antes = chamadas.length;
  let t0 = Date.now();
  const lento = await avaliarEntrega(divinos, { endereco: "x", coords: destinoLento }, { prazoMs: 12_000 });
  let gasto = Date.now() - t0;
  conferir("roteador mudo: 3 s + nova tentativa curta de 1,5 s, depois estimativa", lento.medida === "estimada" && contar("osrm", antes) === 2 && gasto >= 4400 && gasto < 6500, { gasto, n: contar("osrm", antes) });

  zerar();
  const destinoCurto = aoSul(1.35);
  osrm.set(chave4(destinoCurto), "pendura");
  t0 = Date.now();
  const curto = await avaliarEntrega(divinos, { endereco: "x", coords: destinoCurto }, { prazoMs: 2500 });
  gasto = Date.now() - t0;
  conferir("o prazo da cotação manda: com 2,5 s, o roteador não passa do prazo", curto.medida === "estimada" && gasto < 3000, { gasto });

  zerar();
  const destinoVolta = aoSul(1.4);
  osrm.set(chave4(destinoVolta), (n) => (n === 1 ? { status: 503, corpo: {} } : osrmOk(1800)));
  const volta = await avaliarEntrega(divinos, { endereco: "x", coords: destinoVolta });
  conferir("falhou uma vez e a nova tentativa respondeu: vale a rota", volta.medida === "rota" && volta.distanciaKm === 1.8 && !rota.estadoDoRoteador().disjuntorAberto, volta);

  zerar({ intervaloDoPublicoMs: 1000 });
  antes = chamadas.length;
  await comPino(aoSul(1.1, 0.004), 1500);
  await comPino(aoSul(1.1, 0.006), 1500);
  const [c1, c2] = chamadas.slice(antes).filter((c) => c.tipo === "osrm");
  conferir("servidor público: no máximo 1 pergunta por segundo", !!c1 && !!c2 && c2.em - c1.em >= 950, c1 && c2 ? c2.em - c1.em : null);
  zerar({ intervaloDoPublicoMs: 1000 });
  process.env.OSRM_URL = "http://osrm.local:5000";
  antes = chamadas.length;
  await comPino(aoSul(1.1, 0.008), 1500);
  await comPino(aoSul(1.1, 0.009), 1500);
  const [p1, p2] = chamadas.slice(antes).filter((c) => c.tipo === "osrm");
  conferir("OSRM_URL troca o servidor (e o limite do público não se aplica)", !!p1 && p1.url.startsWith("http://osrm.local:5000/") && p2.em - p1.em < 500, p1?.url);
  delete process.env.OSRM_URL;

  zerar();
  const destinoCache = aoSul(1.2, 0.0011);
  await comPino(destinoCache, 1300);
  antes = chamadas.length;
  const doCache = await comPino(destinoCache, 9999);
  conferir("a mesma rota não é perguntada de novo (cache)", contar("osrm", antes) === 0 && doCache.distanciaKm === 1.3, doCache);
  conferir("e foi guardada no cache do banco com o deslocamento", rotasGuardadas.get(rota.chaveDaRota(LOJA, destinoCache))?.deslocamentoM === 5);
  // Linha gravada antes de 25/09/2026 não tem o deslocamento: pergunta de novo uma vez.
  const destinoLegado = aoSul(1.2, 0.0013);
  rotasGuardadas.set(rota.chaveDaRota(LOJA, destinoLegado), { km: 1.4, minutos: 3, criadoEm: Date.now() });
  osrm.set(chave4(destinoLegado), osrmOk(1450, 7));
  antes = chamadas.length;
  const legado = await avaliarEntrega(divinos, { endereco: "x", coords: destinoLegado });
  conferir("linha antiga sem deslocamento é perguntada de novo", contar("osrm", antes) === 1 && legado.distanciaKm === 1.45, legado);
  const destinoVelho = aoSul(1.2, 0.0015);
  rotasGuardadas.set(rota.chaveDaRota(LOJA, destinoVelho), { km: 1.33, minutos: 3, deslocamentoM: 4, criadoEm: Date.now() - 61 * 24 * 3600_000 });
  osrm.set(chave4(destinoVelho), { status: 503, corpo: {} });
  const velho = await avaliarEntrega(divinos, { endereco: "x", coords: destinoVelho });
  conferir("rota com mais de 60 dias: pergunta de novo, e com o roteador fora a velha ainda vale (é rua)", velho.medida === "rota" && velho.distanciaKm === 1.33, velho);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R3: ponto aproximado pede confirmação (e a coordenada do cliente nunca) ==");
  zerar();
  const centroDoBairro = aoSul(0.63, 0.002);
  nominatim.set(norm("Boca do Mato, Cabo Frio"), { status: 200, corpo: [lugar(centroDoBairro, { suburb: "Vila Boca do Mato", display: "Vila Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil" })] });
  osrm.set(chave4(centroDoBairro), osrmOk(840));
  const partesCanaa = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato", city: "Cabo Frio" };
  const bairro = await avaliarEntrega(divinos, { endereco: "Travessa Canaã, 6 - Boca do Mato, Cabo Frio", partes: partesCanaa });
  conferir("só o centro do bairro: ATENDE com taxa ESTIMADA e pedeConfirmacao",
    bairro.resultado === "ATENDE" && bairro.taxa === 5 && bairro.pedeConfirmacao === true && bairro.aproximado === true, bairro);
  conferir("o ponto vai junto (é onde o pino abre), com origem 'bairro'", bairro.ponto?.origem === "bairro" && bairro.ponto?.lat === centroDoBairro.lat, bairro.ponto);
  conferir("a nota diz 'ponto aproximado'", /ponto aproximado/.test(area.descreverVeredicto(bairro)));
  conferir("a busca pela rua veio ANTES do centro do bairro",
    (() => { const n = chamadas.filter((c) => c.tipo === "nominatim").map((c) => c.url); const iRua = n.findIndex((u) => u.includes("street=")); const iBairro = n.findIndex((u) => /q=Boca/.test(u)); return iRua >= 0 && iBairro > iRua; })());

  zerar();
  // Pedido #5 da Divinos: "Diamante, 19 - Monte Alegre". O OSM chama o bairro de
  // "Vila Monte Alegre"; o outro trecho da Rua Diamante fica a ~4,9 km.
  const diamantePerto = aoSul(0.13, 0.0005);
  const diamanteLonge = aoSul(4.2, 0.02);
  nominatim.set(`${norm("Rua Diamante")}|${norm("Cabo Frio")}`, { status: 200, corpo: [
    lugar(diamanteLonge, { road: "Rua Diamante", suburb: "Jardim Excelsior" }),
    lugar(diamantePerto, { road: "Rua Diamante", suburb: "Vila Monte Alegre" }),
  ] });
  osrm.set(chave4(diamantePerto), osrmOk(180));
  const diamante = await avaliarEntrega(divinos, { endereco: "Rua Diamante, 19 - Monte Alegre", partes: { street: "Rua Diamante", number: "19", neighborhood: "Monte Alegre", city: "Cabo Frio" } });
  conferir("'Monte Alegre' confere com 'Vila Monte Alegre': o trecho CERTO (0,18 km, R$ 5), sem confirmação",
    diamante.resultado === "ATENDE" && diamante.taxa === 5 && diamante.pedeConfirmacao === false && diamante.ponto?.lat === diamantePerto.lat, diamante);

  zerar();
  nominatim.set(`${norm("Rua Diamante")}|${norm("Cabo Frio")}`, { status: 200, corpo: [
    lugar(diamanteLonge, { road: "Rua Diamante", suburb: "Jardim Excelsior" }),
    lugar(diamantePerto, { road: "Rua Diamante", suburb: "Vila Monte Alegre" }),
  ] });
  osrm.set(chave4(diamanteLonge), osrmOk(6100));
  const homonima = await avaliarEntrega(divinos, { endereco: "Rua Diamante, 19 - Peró", partes: { street: "Rua Diamante", number: "19", neighborhood: "Peró", city: "Cabo Frio" } });
  conferir("rua homônima com bairro que não confere: NÃO assume o mais longe como verdade (nunca FORA calado)",
    homonima.resultado !== "FORA" && homonima.pedeConfirmacao === true && !!homonima.ponto, homonima);
  conferir("… e o ponto aproximado fora do raio é DESCONHECIDO (confirme no mapa)", homonima.resultado === "DESCONHECIDO" && homonima.taxa === null);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Duas ruas no texto e rua homônima pelo bairro (Divinos, 25/09/2026, 20h34) ==");
  // Medido no OSM: a Travessa Pantanal existe em DOIS lugares de Cabo Frio — a
  // certa a ~0,3 km da Rua do Forno, a outra no Centro —, e nenhuma diz bairro.
  // O bairro do cliente ("Jardim Esperança") no mapa é "Vila Jardim Esperança".
  const travessaCerta = aoSul(1.9, -0.0035);
  const travessaDoCentro = aoSul(-2.9, 0.004);
  const ruaDoForno = aoSul(1.65, -0.0012);
  const centroDoJardim = aoSul(2.1, 0.003);
  const duasTravessas = () =>
    nominatim.set(`${norm("Travessa Pantanal")}|${norm("Cabo Frio")}`, { status: 200, corpo: [
      lugar(travessaDoCentro, { road: "Travessa Pantanal", suburb: "Centro" }),
      lugar(travessaCerta, { road: "Travessa Pantanal" }),
    ] });

  zerar();
  duasTravessas();
  nominatim.set(`${norm("Rua do Forno")}|${norm("Cabo Frio")}`, { status: 200, corpo: [lugar(ruaDoForno, { road: "Rua do Forno" })] });
  osrm.set(chave4(travessaCerta), osrmOk(2600));
  const duasRuas = await avaliarEntrega(divinos, { endereco: "Rua do forno, travessa pantanal, nº 130, Jardim Esperança" });
  conferir("duas ruas: a travessa JUNTO da Rua do Forno (não a do Centro), 2,6 km de rua, R$ 15, sem confirmação",
    duasRuas.resultado === "ATENDE" && duasRuas.ponto?.lat === travessaCerta.lat && duasRuas.pedeConfirmacao === false && duasRuas.taxa === 15, duasRuas);

  zerar();
  duasTravessas();
  nominatim.set(norm("Jardim Esperança, Cabo Frio"), { status: 200, corpo: [
    lugar(centroDoJardim, { suburb: "Vila Jardim Esperança", classe: "landuse", tipo: "residential", display: "Vila Jardim Esperança, Cabo Frio, Rio de Janeiro, Brasil" }),
  ] });
  osrm.set(chave4(travessaCerta), osrmOk(2600));
  const soATravessa = await avaliarEntrega(divinos, { endereco: "Travessa Pantanal, 130 - Jardim Esperança" });
  conferir("rua homônima: fica o trecho junto do bairro do cliente (não o mais longe, nem o centro do bairro), com confirmação",
    soATravessa.ponto?.lat === travessaCerta.lat && soATravessa.pedeConfirmacao === true, soATravessa);

  const ordem = geocoding.logradourosDoTexto("Rua do forno, travessa pantanal, nº 130, Jardim Esperança");
  conferir("as ruas do texto, a pequena primeiro", JSON.stringify(ordem) === JSON.stringify(["Travessa pantanal", "Rua do forno"]), ordem);
  conferir("rua de referência não entra", JSON.stringify(geocoding.logradourosCandidatos("Rua Beira Alta, 20, perto da Rua do Sol")) === JSON.stringify(["Rua Beira Alta"]), geocoding.logradourosCandidatos("Rua Beira Alta, 20, perto da Rua do Sol"));
  conferir("duas ruas longe uma da outra não se encontram",
    geocoding.encontroDeRuas([{ logradouro: "A", trechos: [travessaDoCentro] }, { logradouro: "B", trechos: [ruaDoForno] }]) === null);
  conferir("o trecho mais perto do bairro", geocoding.trechoMaisPerto([travessaDoCentro, travessaCerta], centroDoJardim)?.trecho === travessaCerta);

  // O bairro como o cliente digita (as 27 entregas não achadas em 7 dias, 25/09/2026).
  const confere = geocoding.bairroConfere;
  conferir("bairro colado: 'JardimBelaVista' é 'Jardim Bela Vista'", confere("JardimBelaVista", "Jardim Bela Vista"));
  conferir("bairro colado: 'Extensãodobosque' é 'Extensão do Bosque'", confere("Extensãodobosque", "Extensão do Bosque"));
  conferir("uma letra a menos: 'Atlântic' é 'Atlântica'", confere("Atlântic", "Atlântica"));
  conferir("uma letra trocada: 'Alecrin' é 'Alecrim'", confere("Alecrin", "Alecrim"));
  conferir("'Chácar Marilea' é 'Chácara Mariléa'", confere("Chácar Marilea", "Chácara Mariléa"));
  conferir("prefixo: 'Jardim Esperança' é 'Vila Jardim Esperança'", confere("Jardim Esperança", "Vila Jardim Esperança"));
  conferir("nome curto parecido é OUTRO bairro: 'Vila Nova' não é 'Vila Nobre'", !confere("Vila Nova", "Vila Nobre"));
  conferir("'Boa Vista' não é 'Bela Vista'", !confere("Boa Vista", "Bela Vista"));
  conferir("'Jardim América' não é 'Jardim Amélia'", !confere("Jardim América", "Jardim Amélia"));
  conferir("'Ouro Verde' não é 'Ouro Preto'", !confere("Ouro Verde", "Ouro Preto"));

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Google como segunda fonte (só com GOOGLE_MAPS_API_KEY) ==");
  const casaNoGoogle = aoSul(1.2, 0.002);
  const respostaDoGoogle = (p: Ponto, cidade = "Cabo Frio") => ({
    status: "OK",
    results: [{
      formatted_address: `Rua Sem Mapa, 55 - Vila Nova, ${cidade} - RJ`,
      geometry: { location: { lat: p.lat, lng: p.lng }, location_type: "ROOFTOP" },
      types: ["street_address"],
      address_components: [
        { long_name: "55", types: ["street_number"] },
        { long_name: "Rua Sem Mapa", types: ["route"] },
        { long_name: "Vila Nova", types: ["sublocality_level_1", "sublocality", "political"] },
        { long_name: cidade, types: ["administrative_area_level_2", "political"] },
      ],
    }],
  });
  const enderecoSemMapa = "Rua Sem Mapa, 55 - Vila Nova";

  zerar();
  antes = chamadas.length;
  const semChave = await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  conferir("sem a chave: o Google nem é perguntado (a cascata é a de sempre)", contar("google", antes) === 0 && semChave.resultado !== "ATENDE", { google: contar("google", antes), resultado: semChave.resultado });

  zerar();
  process.env.GOOGLE_MAPS_API_KEY = "chave-de-teste";
  google.set(norm(`${enderecoSemMapa}, Cabo Frio`), respostaDoGoogle(casaNoGoogle));
  osrm.set(chave4(casaNoGoogle), osrmOk(1600));
  antes = chamadas.length;
  const peloGoogle = await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  conferir("o mapa aberto não acha, o Google acha a CASA: vale, sem confirmação (1,6 km de rua, R$ 10)",
    peloGoogle.resultado === "ATENDE" && peloGoogle.ponto?.lat === casaNoGoogle.lat && peloGoogle.pedeConfirmacao === false && peloGoogle.taxa === 10 && contar("google", antes) === 1,
    { resultado: peloGoogle.resultado, ponto: peloGoogle.ponto, taxa: peloGoogle.taxa, conf: peloGoogle.pedeConfirmacao, google: contar("google", antes) });
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  conferir("o mesmo endereço de novo não paga o Google outra vez (cache)", contar("google", antes) === 0, contar("google", antes));

  zerar();
  process.env.GOOGLE_MAPS_API_KEY = "chave-de-teste";
  google.set(norm(`${enderecoSemMapa}, Cabo Frio`), respostaDoGoogle(aoSul(9, 0.01), "São Pedro da Aldeia"));
  const outraCidadeNoGoogle = await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  conferir("o Google achou em OUTRA cidade: não vale", outraCidadeNoGoogle.resultado !== "ATENDE" || outraCidadeNoGoogle.ponto?.lat !== aoSul(9, 0.01).lat, outraCidadeNoGoogle);

  zerar();
  process.env.GOOGLE_MAPS_API_KEY = "chave-de-teste";
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  await avaliarEntrega(divinos, { endereco: enderecoSemMapa });
  conferir("'não achei' do Google também fica guardado: uma consulta só", contar("google", antes) === 1, contar("google", antes));

  zerar();
  process.env.GOOGLE_MAPS_API_KEY = "chave-de-teste";
  antes = chamadas.length;
  await comPino(aoSul(1.1, 0.0061), 1500);
  conferir("com o pino do cliente o Google não é perguntado", contar("google", antes) === 0);

  zerar();
  const praia = aoSul(3.2, 0.01);
  nominatim.set(norm("Rua da Praia, 10 - Braga, Cabo Frio"), { status: 200, corpo: [lugar(praia, { road: "Rua da Praia", suburb: "Braga", house_number: "10" })] });
  osrm.set(chave4(praia), osrmOk(4300, 351));
  const arrastado = await avaliarEntrega(divinos, { endereco: "Rua da Praia, 10 - Braga, Cabo Frio", partes: { street: "Rua da Praia", number: "10", neighborhood: "Braga", city: "Cabo Frio" } });
  conferir("roteador arrastou o ponto 351 m até a rua: pedeConfirmacao", arrastado.resultado === "ATENDE" && arrastado.pedeConfirmacao === true && (arrastado.motivosDaConfirmacao || []).some((m) => /351 m/.test(m)), arrastado);
  zerar();
  osrm.set(chave4(praia), osrmOk(4300, 351));
  const pinoNaPraia = await avaliarEntrega(divinos, { endereco: "Rua da Praia, 10", coords: praia, origemDasCoords: "pino" });
  conferir("o MESMO ponto vindo do pino do cliente: sem confirmação", pinoNaPraia.resultado === "ATENDE" && pinoNaPraia.pedeConfirmacao === false && pinoNaPraia.ponto?.origem === "pino", pinoNaPraia);
  zerar();
  // O robô recebe só o nome do bairro no texto. O Nominatim devolve o LUGAR
  // (class=place, type=suburb) — o centro dele, não a casa de ninguém.
  const centroPorTexto = aoSul(0.63, 0.0025);
  nominatim.set(norm("Boca do Mato, Cabo Frio"), { status: 200, corpo: [lugar(centroPorTexto, { suburb: "Vila Boca do Mato", classe: "place", tipo: "suburb", display: "Vila Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil" })] });
  osrm.set(chave4(centroPorTexto), osrmOk(840));
  const soOBairro = await avaliarEntrega(divinos, { endereco: "Boca do Mato" });
  conferir("texto que o mapa resolve como ÁREA (bairro): pedeConfirmacao, origem 'bairro'",
    soOBairro.resultado === "ATENDE" && soOBairro.pedeConfirmacao === true && soOBairro.ponto?.origem === "bairro", soOBairro);
  zerar();
  const ruaSemNumero = aoSul(0.8, 0.0007);
  nominatim.set(norm("Rua Beira Alta, Cabo Frio"), { status: 200, corpo: [lugar(ruaSemNumero, { road: "Rua Beira Alta", suburb: "Vila Monte Alegre", classe: "highway", tipo: "residential" })] });
  osrm.set(chave4(ruaSemNumero), osrmOk(950));
  const ruaSem = await avaliarEntrega(divinos, { endereco: "Rua Beira Alta" });
  conferir("rua achada sem número (highway): vale, sem confirmação", ruaSem.resultado === "ATENDE" && ruaSem.pedeConfirmacao === false && ruaSem.ponto?.origem === "mapa", ruaSem);

  zerar();
  const gps = await avaliarEntrega(divinos, { endereco: "x", coords: aoSul(0.7, 0.003) });
  conferir("GPS sem origem declarada é 'gps' e não pede confirmação", gps.ponto?.origem === "gps" && gps.pedeConfirmacao === false, gps);

  zerar();
  const vizinha = aoSul(2.2, 0.004);
  nominatim.set(norm("Rua das Flores, 5 - Centro, Cabo Frio"), { status: 200, corpo: [lugar(vizinha, { road: "Rua das Flores", suburb: "Centro", city: "São Pedro da Aldeia", house_number: "5" })] });
  const outroMunicipio = await avaliarEntrega(divinos, { endereco: "Rua das Flores, 5 - Centro, Cabo Frio", partes: { street: "Rua das Flores", number: "5", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("o mapa achou em OUTRO município: pedeConfirmacao", outroMunicipio.pedeConfirmacao === true && (outroMunicipio.motivosDaConfirmacao || []).some((m) => /São Pedro da Aldeia/.test(m)), outroMunicipio);
  zerar();
  nominatim.set(norm("Rua das Flores, 5 - Centro, São Pedro da Aldeia"), { status: 200, corpo: [lugar(vizinha, { road: "Rua das Flores", suburb: "Centro", city: "São Pedro da Aldeia", house_number: "5" })] });
  const pediuOMunicipio = await avaliarEntrega(divinos, { endereco: "Rua das Flores, 5 - Centro, São Pedro da Aldeia", partes: { street: "Rua das Flores", number: "5", neighborhood: "Centro", city: "São Pedro da Aldeia" } });
  conferir("… mas se o cliente ESCREVEU esse município, não é homônimo", pediuOMunicipio.pedeConfirmacao === false && pediuOMunicipio.resultado === "ATENDE", pediuOMunicipio);

  zerar();
  const longeDemais = aoSul(12);
  nominatim.set(norm("Rua Juriti, 40 - Centro, Cabo Frio"), { status: 200, corpo: [lugar(longeDemais, { road: "Rua Juriti", suburb: "Centro", house_number: "40" })] });
  antes = chamadas.length;
  const juriti = await avaliarEntrega(divinos, { endereco: "Rua Juriti, 40 - Centro, Cabo Frio", partes: { street: "Rua Juriti", number: "40", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("texto que caiu a 12 km (> 2× o raio de 5): DESCONHECIDO + pede o pino, não FORA", juriti.resultado === "DESCONHECIDO" && juriti.pedeConfirmacao === true && !!juriti.ponto, juriti);
  conferir("… e o roteador nem é incomodado (a rua é maior que a reta)", contar("osrm", antes) === 0);
  zerar();
  const pinoLonge = await avaliarEntrega(divinos, { endereco: "x", coords: aoSul(12, 0.001), origemDasCoords: "pino" });
  conferir("o PINO do cliente a 12 km é FORA de verdade", pinoLonge.resultado === "FORA", pinoLonge);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R2: 'não sei' nunca vira a faixa mais cara ==");
  zerar();
  const naoAchou = await avaliarEntrega(divinos, { endereco: "Rua Alecrin, 30 - Monte alegre", partes: { street: "Rua Alecrin", number: "30", neighborhood: "Monte alegre", city: "Cabo Frio" } });
  conferir("o mapa não conhece: DESCONHECIDO, taxa null (nada de R$ 20)", naoAchou.resultado === "DESCONHECIDO" && naoAchou.taxa === null && naoAchou.taxaDoEntregador == null, naoAchou);

  zerar();
  nominatimPadrao = { status: 429, corpo: { error: "Too Many Requests" } };
  avisos.length = 0;
  antes = chamadas.length;
  const com429Nominatim = await avaliarEntrega(divinos, { endereco: "Rua X, 1 - Centro", partes: { street: "Rua X", number: "1", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("Nominatim 429: DESCONHECIDO, e por falha do mapa (não 'não localizado')",
    com429Nominatim.resultado === "DESCONHECIDO" && com429Nominatim.taxa === null && com429Nominatim.falhaDoMapa === "indisponivel", com429Nominatim);
  conferir("o status HTTP do Nominatim vai para o log (R9)", avisos.some((a) => /Nominatim respondeu 429/.test(a)), avisos);
  conferir("depois do 429, trégua: uma pergunta só nesta cotação", contar("nominatim", antes) === 1, contar("nominatim", antes));
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "Rua Y, 2 - Centro", partes: { street: "Rua Y", number: "2", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("… e nenhuma na cotação seguinte", contar("nominatim", antes) === 0 && geocoding.estadoDoNominatim().emTregua);

  zerar();
  nominatimPadrao = "pendura";
  t0 = Date.now();
  const mapaMudo = await avaliarEntrega(divinos, { endereco: "Rua Z, 3 - Centro", partes: { street: "Rua Z", number: "3", neighborhood: "Centro", city: "Cabo Frio" } }, { prazoMs: 4000 });
  gasto = Date.now() - t0;
  conferir("mapa mudo: a cotação respeita o prazo total e responde 'não sei' por PRAZO",
    mapaMudo.resultado === "DESCONHECIDO" && mapaMudo.falhaDoMapa === "prazo" && gasto < 4600, { gasto, r: mapaMudo.resultado, motivo: mapaMudo.motivo, falha: mapaMudo.falhaDoMapa });
  zerar();
  nominatimPadrao = "pendura";
  t0 = Date.now();
  await avaliarEntrega(divinos, { endereco: "Rua W, 4 - Centro", partes: { street: "Rua W", number: "4", neighborhood: "Centro", city: "Cabo Frio" } });
  gasto = Date.now() - t0;
  conferir("prazo padrão da cotação inteira ≤ 12 s", gasto <= 12_500, { gasto });

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R9: cache no caminho da taxa (memória → GeocodeCache) e a fila ==");
  zerar({ intervaloDoNominatimMs: 300 });
  const casaCache = aoSul(1.1, 0.02);
  nominatim.set(norm("Rua Cachoeira, 12 - Centro, Cabo Frio"), { status: 200, corpo: [lugar(casaCache, { road: "Rua Cachoeira", suburb: "Centro", house_number: "12" })] });
  const partesCache = { street: "Rua Cachoeira", number: "12", neighborhood: "Centro", city: "Cabo Frio" };
  antes = chamadas.length;
  const primeira = await avaliarEntrega(divinos, { endereco: "Rua Cachoeira, 12 - Centro, Cabo Frio", partes: partesCache });
  const nPrimeira = contar("nominatim", antes);
  conferir("primeira cotação acha o endereço exato, sem confirmação", primeira.resultado === "ATENDE" && primeira.pedeConfirmacao === false && primeira.ponto?.origem === "mapa", primeira);
  conferir("a mesma pergunta com outra pontuação não sai duas vezes", nPrimeira === 1, nPrimeira);
  conferir("o resultado foi para o GeocodeCache, com chave própria da taxa", [...geoGuardado.keys()].some((k) => k.startsWith("taxa|livre|")), [...geoGuardado.keys()]);
  antes = chamadas.length;
  const segunda = await avaliarEntrega(divinos, { endereco: "Rua Cachoeira, 12 - Centro, Cabo Frio", partes: partesCache });
  conferir("a segunda cotação do mesmo endereço não vai ao mapa nem ao roteador", contar("nominatim", antes) === 0 && contar("osrm", antes) === 0 && segunda.taxa === primeira.taxa);
  zerar({ intervaloDoNominatimMs: 300, manterCaches: true });
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "Rua Cachoeira, 12 - Centro, Cabo Frio", partes: partesCache });
  conferir("processo novo (memória vazia): vem do banco, sem ir ao mapa", contar("nominatim", antes) === 0);

  zerar({ intervaloDoNominatimMs: 300 });
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "Rua Inexistente, 9 - Centro", partes: { street: "Rua Inexistente", number: "9", neighborhood: "Centro", city: "Cabo Frio" } });
  const nom = chamadas.slice(antes).filter((c) => c.tipo === "nominatim");
  conferir("várias buscas numa cotação saem no ritmo da fila (≥ intervalo entre elas)",
    nom.length >= 3 && nom.every((c, i) => i === 0 || c.em - nom[i - 1].em >= 290), nom.map((c, i) => (i ? c.em - nom[i - 1].em : 0)));
  antes = chamadas.length;
  await avaliarEntrega(divinos, { endereco: "Rua Inexistente, 9 - Centro", partes: { street: "Rua Inexistente", number: "9", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("'não existe no mapa' também é lembrado (não martela o Nominatim)", contar("nominatim", antes) === 0);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R8: coordenada de parceiro falsa ==");
  const { coordenadaGrosseira, coordenadasDoParceiro, pontoDoParceiroParaALoja, limiteDoParceiroKm } = parceiro;
  conferir("(-23,-43) do 99Food é enchimento", coordenadaGrosseira(-23, -43));
  conferir("(-22.85,-42.03): duas casas nos dois → enchimento", coordenadaGrosseira(-22.85, -42.03));
  conferir("grau inteiro num só dos dois → enchimento", coordenadaGrosseira(-23, -42.029652));
  conferir("pino real passa", !coordenadaGrosseira(-22.854033, -42.0296526));
  conferir("uma coordenada com 2 casas e a outra precisa passa", !coordenadaGrosseira(-22.85, -42.0296526));
  conferir("o leitor de parceiro recusa (-23,-43)", coordenadasDoParceiro({ lat: -23, lng: -43 }) === undefined);
  conferir("… e (-23,-42) em texto", coordenadasDoParceiro({ latitude: "-23", longitude: "-42" }) === undefined);
  conferir("limite = max(2 × raio, 15 km)", limiteDoParceiroKm(5) === 15 && limiteDoParceiroKm(10) === 20 && limiteDoParceiroKm(null) === 15);
  conferir("ponto a 20 km de loja de raio 5 → descartado", pontoDoParceiroParaALoja(aoSul(20, 0.0001), { ponto: LOJA, raioMaximoKm: 5 }) === undefined);
  conferir("ponto a 12 km de loja de raio 8 (limite 16) → aceito", !!pontoDoParceiroParaALoja(aoSul(12, 0.0001), { ponto: LOJA, raioMaximoKm: 8 }));
  conferir("enchimento é descartado mesmo sem o ponto da loja", pontoDoParceiroParaALoja({ lat: -23, lng: -43 }, { ponto: null }) === undefined);
  t0 = Date.now();
  conferir("distância de pedido com (-23,-43) é null (sem ir ao banco)", (await distancia.distanciaDaEntregaKm("loja-qualquer", { lat: -23, lng: -43 })) === null && Date.now() - t0 < 1000);
  zerar();
  const falsa = await avaliarEntrega(divinos, { endereco: "", coords: { lat: -23, lng: -43 } });
  conferir("coordenada de enchimento não decide a entrega (vira 'sem ponto')", falsa.resultado === "DESCONHECIDO" && falsa.ponto === undefined, falsa);
  conferir("distância do veredito: 0 vale, negativa e absurda não",
    distancia.distanciaDoVeredicto({ distanciaKm: 0 }) === 0 && distancia.distanciaDoVeredicto({ distanciaKm: -1 }) === null && distancia.distanciaDoVeredicto({ distanciaKm: 80 }) === null && distancia.distanciaDoVeredicto({}) === null);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Conferência de bairro (sem prefixo, contém nos dois sentidos) ==");
  const { bairroConfere } = geocoding;
  conferir("Monte Alegre = Vila Monte Alegre", bairroConfere("Monte Alegre", "Vila Monte Alegre"));
  conferir("Jd. Esperança = Jardim Esperança", bairroConfere("jd Esperança", "Jardim Esperança"));
  conferir("Cidade Nova 5 = Cidade Nova V", bairroConfere("Cidade Nova 5", "Cidade Nova V"));
  conferir("Peró ≠ Vila Monte Alegre", !bairroConfere("Peró", "Vila Monte Alegre"));
  conferir("sem um dos lados não dá para afirmar", bairroConfere("", "Centro") && bairroConfere("Centro", ""));


  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Correção (S3b): resultado SEM bairro no mapa não é 'outro bairro' ==");
  zerar();
  const casaBeira = aoSul(0.3, 0.0021);
  nominatim.set(norm("Rua Beira Alta, 100 - Boca do Mato, Cabo Frio"), { status: 200, corpo: [lugar(casaBeira, { road: "Rua Beira Alta", house_number: "100" })] });
  nominatim.set(`${norm("Rua Beira Alta")}|${norm("Cabo Frio")}`, { status: 200, corpo: [lugar(aoSul(0.31, 0.0021), { road: "Rua Beira Alta" })] });
  nominatim.set(norm("Boca do Mato, Cabo Frio"), { status: 200, corpo: [lugar(aoSul(1.7, 0.002), { suburb: "Vila Boca do Mato", classe: "place", tipo: "suburb", display: "Vila Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil" })] });
  osrm.set(chave4(casaBeira), osrmOk(400));
  antes = chamadas.length;
  const beira = await avaliarEntrega(divinos, { endereco: "Rua Beira Alta, 100 - Boca do Mato, Cabo Frio", partes: { street: "Rua Beira Alta", number: "100", neighborhood: "Boca do Mato", city: "Cabo Frio" } });
  conferir("a casa achada com número e SEM bairro no mapa vale: R$ 5, sem confirmação, ponto 'mapa'",
    beira.resultado === "ATENDE" && beira.taxa === 5 && beira.pedeConfirmacao === false && beira.ponto?.origem === "mapa" && beira.ponto?.lat === casaBeira.lat, beira);
  conferir("… já na primeira busca (o centro do bairro, a 1,7 km, nem é perguntado)", contar("nominatim", antes) === 1, contar("nominatim", antes));

  zerar();
  // O OSM chama de "Braga" a esquina que o cliente chama de "Centro": a rua
  // existe num lugar só, perto do centro do bairro dele.
  const casaSol = aoSul(1.0, 0.003);
  nominatim.set(norm("Rua do Sol, 50 - Centro, Cabo Frio"), { status: 200, corpo: [lugar(casaSol, { road: "Rua do Sol", suburb: "Braga", house_number: "50" })] });
  nominatim.set(`${norm("Rua do Sol")}|${norm("Cabo Frio")}`, { status: 200, corpo: [lugar(aoSul(1.02, 0.003), { road: "Rua do Sol", suburb: "Braga" })] });
  nominatim.set(norm("Centro, Cabo Frio"), { status: 200, corpo: [lugar(aoSul(1.6, 0.004), { suburb: "Centro", classe: "place", tipo: "suburb", display: "Centro, Cabo Frio, Rio de Janeiro, Brasil" })] });
  osrm.set(chave4(casaSol), osrmOk(1300));
  const sol = await avaliarEntrega(divinos, { endereco: "Rua do Sol, 50 - Centro, Cabo Frio", partes: { street: "Rua do Sol", number: "50", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("bairro de OUTRO nome no mapa, rua num lugar só e perto do bairro do cliente: vale a casa, sem confirmação",
    sol.resultado === "ATENDE" && sol.pedeConfirmacao === false && sol.ponto?.lat === casaSol.lat && sol.taxa === 8, sol);

  zerar();
  // A Rua Diamante que o mapa conhece fica no Peró, a ~4 km do Monte Alegre
  // que o cliente escreveu: a rua dele não está no mapa.
  const diamantePero = aoSul(4.2, 0.02);
  const centroMonteAlegre = aoSul(0.15, 0.001);
  const mapaDoPero = () => {
    nominatim.set(norm("Rua Diamante, 19 - Monte Alegre, Cabo Frio"), { status: 200, corpo: [lugar(diamantePero, { road: "Rua Diamante", suburb: "Peró", house_number: "19" })] });
    nominatim.set(norm("Rua Diamante, 19 - Peró, Cabo Frio"), { status: 200, corpo: [lugar(diamantePero, { road: "Rua Diamante", suburb: "Peró", house_number: "19" })] });
    nominatim.set(`${norm("Rua Diamante")}|${norm("Cabo Frio")}`, { status: 200, corpo: [lugar(aoSul(4.21, 0.02), { road: "Rua Diamante", suburb: "Peró" })] });
    nominatim.set(norm("Monte Alegre, Cabo Frio"), { status: 200, corpo: [lugar(centroMonteAlegre, { suburb: "Vila Monte Alegre", classe: "place", tipo: "suburb", display: "Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Brasil" })] });
    osrm.set(chave4(centroMonteAlegre), osrmOk(300));
    osrm.set(chave4(diamantePero), osrmOk(4900));
  };
  mapaDoPero();
  const soPero = await avaliarEntrega(divinos, { endereco: "Rua Diamante, 19 - Monte Alegre, Cabo Frio", partes: { street: "Rua Diamante", number: "19", neighborhood: "Monte Alegre", city: "Cabo Frio" } });
  conferir("a rua só existe no mapa a ~4 km do bairro escrito: pede confirmação, ponto no centro do bairro (nunca R$ 20 calado)",
    soPero.pedeConfirmacao === true && soPero.ponto?.origem === "bairro" && soPero.ponto?.lat === centroMonteAlegre.lat && (soPero.motivosDaConfirmacao || []).some((m) => /Peró/.test(m)), soPero);

  console.log("\n== Correção (S6): o bairro ESCRITO no texto também é conferido ==");
  zerar();
  mapaDoPero();
  const s6 = await avaliarEntrega(divinos, { endereco: "Rua Diamante, 19 - Monte Alegre" });
  conferir("só texto, 'Rua Diamante, 19 - Monte Alegre', e o mapa acha a do Peró: pede confirmação (antes: R$ 20 calado)",
    s6.pedeConfirmacao === true && s6.taxa !== 20 && s6.ponto?.origem === "bairro", s6);
  zerar();
  mapaDoPero();
  const s6Certo = await avaliarEntrega(divinos, { endereco: "Rua Diamante, 19 - Peró" });
  conferir("o mesmo texto com o bairro que o mapa confirma (Peró): vale, sem confirmação",
    s6Certo.resultado === "ATENDE" && s6Certo.pedeConfirmacao === false && s6Certo.ponto?.lat === diamantePero.lat, s6Certo);

  const { bairroDoTexto } = geocoding;
  conferir("bairroDoTexto: 'Rua Diamante, 19 - Monte Alegre' → Monte Alegre", bairroDoTexto("Rua Diamante, 19 - Monte Alegre", "Cabo Frio") === "Monte Alegre");
  conferir("bairroDoTexto: vírgulas, cidade e UF no fim", bairroDoTexto("Rua Diamante, 19, Monte Alegre, Cabo Frio - RJ", "Cabo Frio") === "Monte Alegre");
  conferir("bairroDoTexto: complemento não é bairro", bairroDoTexto("Rua X, 10, casa 2, Centro", "Cabo Frio") === "Centro");
  conferir("bairroDoTexto: referência e rótulo 'Bairro:'", bairroDoTexto("Rua X, 10 (perto do mercado), Bairro: Peró", "Cabo Frio") === "Peró");
  conferir("bairroDoTexto: sem separador, sem bairro", bairroDoTexto("Rua Beira Alta 100", "Cabo Frio") === "" && bairroDoTexto("Boca do Mato", "Cabo Frio") === "");
  conferir("bairroDoTexto: só a cidade ou o CEP depois da rua não é bairro", bairroDoTexto("Rua X, 10 - Cabo Frio", "Cabo Frio") === "" && bairroDoTexto("Rua X, 10, 28900-000", "Cabo Frio") === "");

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Correção: 'o mapa não respondeu' não é 'não localizado' ==");
  zerar();
  nominatim.set(norm("Boca do Mato, Cabo Frio"), { status: 200, corpo: [lugar(aoSul(0.63, 0.002), { suburb: "Vila Boca do Mato", classe: "place", tipo: "suburb", display: "Vila Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil" })] });
  await avaliarEntrega(divinos, { endereco: "Boca do Mato", partes: { neighborhood: "Boca do Mato", city: "Cabo Frio" } });
  nominatim.set(norm("Travessa Canaã, 6 - Boca do Mato, Cabo Frio"), { status: 500, corpo: {} });
  const semACasa = await avaliarEntrega(divinos, { endereco: "Travessa Canaã, 6 - Boca do Mato, Cabo Frio", partes: partesCanaa });
  conferir("a busca da casa falhou (HTTP 500) e o centro do bairro estava no cache: NÃO vira ponto aproximado",
    semACasa.resultado === "DESCONHECIDO" && semACasa.falhaDoMapa === "indisponivel" && !semACasa.ponto, semACasa);
  conferir("… o motivo é 'o mapa não respondeu', e a nota diz 'não deu para consultar o mapa'",
    /não respondeu/.test(semACasa.motivo) && /não deu para consultar o mapa/.test(area.descreverVeredicto(semACasa)), { motivo: semACasa.motivo, nota: area.descreverVeredicto(semACasa) });
  zerar();
  const naoExiste = await avaliarEntrega(divinos, { endereco: "Rua Que Não Existe, 1 - Centro", partes: { street: "Rua Que Não Existe", number: "1", neighborhood: "Centro", city: "Cabo Frio" } });
  conferir("o mapa respondeu 'nada' em todas: aí sim, 'não localizado' (sem falhaDoMapa)", naoExiste.resultado === "DESCONHECIDO" && naoExiste.falhaDoMapa === undefined && /não localizado/.test(naoExiste.motivo), naoExiste);
  zerar();
  // Loja SEM pino: a distância é medida do endereço dela achado no mapa, e é
  // esse ponto que abre o mapa de confirmação quando o do cliente não é achado.
  const lojaSemPino = { ...divinos, storeLatLng: null, storeAddress: "Tv Liberdade 11" };
  nominatim.set(norm("Tv Liberdade 11, Cabo Frio"), { status: 200, corpo: [lugar(LOJA, { road: "Travessa Liberdade", house_number: "11" })] });
  const semPinoNaoAchou = await avaliarEntrega(lojaSemPino, { endereco: "Rua Alecrin, 30 - Nenhum", partes: { street: "Rua Alecrin", number: "30", neighborhood: "Nenhum", city: "Cabo Frio" } });
  conferir("loja sem pino, cliente não achado: DESCONHECIDO com o ponto da loja (onde o mapa abre)",
    semPinoNaoAchou.resultado === "DESCONHECIDO" && semPinoNaoAchou.pontoDaLoja?.lat === LOJA.lat, semPinoNaoAchou);
  conferir("… e a loja COM pino não manda ponto da loja (o checkout já tem o pino)", naoExiste.pontoDaLoja === undefined);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== A LOJA sem ponto nenhum: o motor diz no CAMPO (semPontoDaLoja) ==");
  // É o que o site (recusaDoSite), o robô (faltaOPontoDaLoja) e a cotação
  // leem. Antes liam o TEXTO do motivo: reescrever a frase do log mandava a
  // loja sem ponto para o "confirme no mapa", onde nem o pino do cliente mede.
  zerar();
  const semPontoNenhum = { ...divinos, storeLatLng: null, storeAddress: null };
  const vSemPonto = await avaliarEntrega(semPontoNenhum, { endereco: "", coords: aoSul(0.5, 0.0011) });
  conferir("loja sem pino e sem endereço: DESCONHECIDO com semPontoDaLoja: true (nem o GPS do cliente mede)",
    vSemPonto.resultado === "DESCONHECIDO" && vSemPonto.semPontoDaLoja === true && vSemPonto.taxa === null, vSemPonto);
  zerar();
  const lojaNaoAchada = { ...divinos, storeLatLng: null, storeAddress: "Rua Que Some, 9" };
  const partesAlecrin = { street: "Rua Alecrin", number: "30", neighborhood: "Centro", city: "Cabo Frio" };
  const vNaoAchada = await avaliarEntrega(lojaNaoAchada, { endereco: "Rua Alecrin, 30 - Centro", partes: partesAlecrin });
  conferir("loja sem pino e com endereço que o mapa responde 'nada': semPontoDaLoja: true",
    vNaoAchada.resultado === "DESCONHECIDO" && vNaoAchada.semPontoDaLoja === true && vNaoAchada.falhaDoMapa === undefined, vNaoAchada);
  zerar();
  // O mapa FORA ao procurar a loja não é "a loja não existe no mapa": é
  // falhaDoMapa, e o site pede o pino/GPS em vez de aceitar pela 1ª faixa.
  nominatimPadrao = { status: 500, corpo: {} };
  const vMapaFora = await avaliarEntrega(lojaNaoAchada, { endereco: "Rua Alecrin, 30 - Centro", partes: partesAlecrin });
  conferir("… mas com o mapa FORA ao procurar a loja: falhaDoMapa, sem semPontoDaLoja",
    vMapaFora.resultado === "DESCONHECIDO" && vMapaFora.semPontoDaLoja === undefined && vMapaFora.falhaDoMapa === "indisponivel", vMapaFora);
  conferir("… e nenhum outro 'não sei' leva o campo (cliente não achado, mapa fora na casa, loja sem pino achável)",
    naoExiste.semPontoDaLoja === undefined && semACasa.semPontoDaLoja === undefined && semPinoNaoAchou.semPontoDaLoja === undefined);

  if (process.argv.includes("--rede")) {
    console.log("\n== MANUAL (--rede): roteador e Nominatim de verdade ==");
    zerar({ intervaloDoPublicoMs: 1000, intervaloDoNominatimMs: 1100 });
    (globalThis as any).fetch = fetchDeVerdade;
    const r = await rota.rotaEntre(LOJA, { lat: -22.8518, lng: -42.0353 }, { prazo: Date.now() + 8000 });
    conferir("o roteador público responde com km e deslocamento até a rua",
      r.ok && r.km > 0.5 && r.km < 1.5 && typeof r.deslocamentoM === "number", r);
    const v = await avaliarEntrega(divinos, {
      endereco: "Boca do Mato, Cabo Frio",
      partes: { street: "", number: "", neighborhood: "Boca do Mato", city: "Cabo Frio" },
    });
    conferir("Boca do Mato pelo texto: ATENDE pela rua, perto da loja (e pede o pino: é o centro do bairro)",
      v.resultado === "ATENDE" && v.medida === "rota" && (v.distanciaKm ?? 99) < 1.5 && v.pedeConfirmacao === true, v);
  }

  console.warn = warnOriginal;
  console.log(`\n${ok} ok, ${falhou} falharam`);
  // exitCode, e não exit(): encerrar à força com timers do fetch simulado
  // ainda armados derruba o Node no Windows ("UV_HANDLE_CLOSING").
  process.exitCode = falhou ? 1 : 0;
}

// O prazo do `fetch` (AbortSignal.timeout) não segura o processo vivo: sem
// isto, o Node sairia no meio do caso do "roteador mudo", com a promessa
// pendurada esperando um timer que não conta. No servidor, o próprio servidor
// segura o processo.
const vivo = setInterval(() => {}, 1000);
main()
  .catch((e) => {
    console.warn = warnOriginal;
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(vivo));
