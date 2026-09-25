/**
 * A FILA do mapa e o ponto do PARCEIRO (cluster A, correções de 25/09/2026):
 *
 *   - a cotação de frete e a roteirização dividem UM relógio (≥ 1 req/s entre
 *     quaisquer duas chamadas), por chamada, e a cotação passa na frente do lote;
 *   - fila cheia, prazo e 429 voltam como FALHA ("o mapa não respondeu"), não
 *     como "endereço não localizado";
 *   - o voo compartilhado usa o maior prazo de quem espera;
 *   - teto por dono (IP, loja) em voo e por minuto;
 *   - a sonda do /api/health é uma só por vez;
 *   - o log do Nominatim não grava o endereço do cliente;
 *   - R8: o ponto do parceiro longe da loja não vai para o pedido; o GPS do
 *     próprio cliente vale até 60 km (loja por bairro e sem área);
 *   - R4: queda longa do roteador (> 2 h) passa a dar a estimativa declarada.
 *
 *   npx tsx scripts/teste-fila-do-mapa.ts
 *
 * Sem rede e sem banco: o `fetch` (Nominatim, Photon, OSRM) e o Prisma
 * (globalThis.prisma, que lib/prisma.ts reaproveita fora de produção) são
 * simulados aqui.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
process.env.COTACAO_SECRET = "segredo-de-teste";
delete process.env.OSRM_URL;

type Ponto = { lat: number; lng: number };

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

const LOJA: Ponto = { lat: -22.854033, lng: -42.0296526 };
const aoSul = (km: number, desvio = 0): Ponto => ({ lat: Number((LOJA.lat - km / 111.32).toFixed(6)), lng: Number((LOJA.lng + desvio).toFixed(6)) });
const aLeste = (km: number): Ponto => ({ lat: LOJA.lat, lng: Number((LOJA.lng + km / (111.32 * Math.cos((LOJA.lat * Math.PI) / 180))).toFixed(6)) });
const chave4 = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ZONAS = [
  { km: 1, fee: 5, motoboyFee: 4, time: 30 }, { km: 2, fee: 10, motoboyFee: 9, time: 40 },
  { km: 3, fee: 15, motoboyFee: 14, time: 45 }, { km: 5, fee: 20, motoboyFee: 19, time: 60 },
];
const lojas = new Map<string, any>([
  ["divinos", { storeLatLng: LOJA, deliveryZoneType: "ROTA", deliveryZones: ZONAS }],
  ["bairro", { storeLatLng: LOJA, deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Tamoios", fee: 8 }] }],
  ["sem-area", { storeLatLng: LOJA, deliveryZoneType: null, deliveryZones: [] }],
]);
(globalThis as any).prisma = {
  user: { findUnique: async ({ where }: any) => lojas.get(where?.id) ?? null },
  $queryRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $executeRawUnsafe: async () => { throw new Error("sem banco no teste"); },
};

// ── O MUNDO SIMULADO ─────────────────────────────────────────────────────────
type Resposta = { status: number; corpo: unknown } | "pendura";
const nominatim = new Map<string, Resposta>();
let nominatimPadrao: Resposta = { status: 200, corpo: [] };
let latenciaMs = 0;
const osrmFalha = new Set<string>();
const chamadas: { tipo: "nominatim" | "photon" | "osrm"; quem: string; url: string; em: number }[] = [];

function esperarAbortar(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, rejeita) => {
    const erro = () => rejeita(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    if (!signal) return;
    if (signal.aborted) return erro();
    signal.addEventListener("abort", erro);
  });
}
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

(globalThis as any).fetch = async (entrada: any, init?: RequestInit): Promise<Response> => {
  const url = String(entrada);
  const ua = String((init?.headers as any)?.["User-Agent"] || "");
  if (url.includes("nominatim.openstreetmap.org")) {
    chamadas.push({ tipo: "nominatim", quem: /Roteirizacao/.test(ua) ? "roteirizacao" : "taxa", url, em: Date.now() });
    if (latenciaMs) await dormir(latenciaMs);
    const u = new URL(url);
    const k = u.searchParams.get("q") != null ? norm(u.searchParams.get("q")!) : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    const r = nominatim.get(k) ?? nominatimPadrao;
    if (r === "pendura") return esperarAbortar(init?.signal);
    return json(r.corpo, r.status);
  }
  if (url.includes("photon.komoot.io")) {
    chamadas.push({ tipo: "photon", quem: "roteirizacao", url, em: Date.now() });
    if (latenciaMs) await dormir(latenciaMs);
    return json({ features: [] });
  }
  if (url.includes("/route/v1/driving/")) {
    chamadas.push({ tipo: "osrm", quem: "rota", url, em: Date.now() });
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const destino = { lat: Number(m[4]), lng: Number(m[3]) };
    if (osrmFalha.has(chave4(destino))) return json({ message: "fora" }, 503);
    const R = 6371, a = { lat: Number(m[2]), lng: Number(m[1]) };
    const dLat = ((destino.lat - a.lat) * Math.PI) / 180, dLng = ((destino.lng - a.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((destino.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    const metros = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 1300;
    return json({ code: "Ok", routes: [{ distance: metros, duration: metros / 8 }], waypoints: [{ distance: 3 }, { distance: 5 }] });
  }
  throw new Error(`fetch inesperado no teste: ${url}`);
};

function casa(p: Ponto, road: string, suburb: string, numero: string) {
  return [{
    lat: String(p.lat), lon: String(p.lng), class: "place", type: "house", addresstype: "place",
    display_name: `${numero}, ${road}, ${suburb}, Cabo Frio, Rio de Janeiro, Brasil`,
    address: { road, suburb, city: "Cabo Frio", house_number: numero },
  }];
}

const avisos: string[] = [];
const warnOriginal = console.warn;
console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };

async function main() {
  const rota = await import("../src/lib/distancia-por-rota");
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const geocoding = await import("../src/lib/geocoding");
  const area = await import("../src/lib/area-de-entrega");
  const distancia = await import("../src/lib/distancia-da-entrega");
  const { avaliarEntrega } = area;

  Object.assign(rota.cacheDeRotas, { ler: async () => null, gravar: async () => {}, daOrigem: async () => [] });
  Object.assign(servidor.armazemDaTaxa, { ler: async () => null, gravar: async () => {} });

  function zerar(intervaloDoNominatimMs = 0) {
    rota.reiniciarRoteadorParaTeste({ intervaloDoPublicoMs: 0 });
    servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs });
    geocoding.reiniciarNominatimParaTeste();
    distancia.esquecerPontoDaLoja();
    nominatim.clear();
    nominatimPadrao = { status: 200, corpo: [] };
    latenciaMs = 0;
    osrmFalha.clear();
  }
  const lojaKm = { storeAddress: "Tv Liberdade 11", storeLatLng: LOJA, city: "Cabo Frio", deliveryZoneType: "KM", deliveryZones: ZONAS, deliveryConfig: {} };
  const partes = (street: string, number: string, neighborhood: string) => ({ street, number, neighborhood, city: "Cabo Frio" });

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Um relógio só: a roteirização por CHAMADA, a cotação na frente ==");
  zerar(300);
  latenciaMs = 100;
  const casaDiamante = aoSul(0.9, 0.001);
  nominatim.set(norm("Rua Diamante, 19 - Centro, Cabo Frio"), { status: 200, corpo: casa(casaDiamante, "Rua Diamante", "Centro", "19") });
  const antes = chamadas.length;
  const lote = servidor.geocodificarNoServidor(
    [{ id: "1", endereco: "Travessa Canaã, 6 - Boca do Mato" }, { id: "2", endereco: "Rua Alecrin, 30 - Alecrin" }],
    { cidade: "Cabo Frio", endereco: "Tv Liberdade 11, Cabo Frio - RJ", centro: LOJA },
  );
  await dormir(350);
  const t0 = Date.now();
  const cotacao = await avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Centro, Cabo Frio", partes: partes("Rua Diamante", "19", "Centro") });
  const gasto = Date.now() - t0;
  await lote;
  const doMapa = chamadas.slice(antes).filter((c) => c.tipo !== "osrm");
  const intervalos = doMapa.slice(1).map((c, i) => c.em - doMapa[i].em);
  conferir("a cotação acha o endereço no meio do lote da roteirização (ATENDE)", cotacao.resultado === "ATENDE" && cotacao.pedeConfirmacao === false, cotacao);
  conferir("… e não espera o endereço inteiro do lote: sai em menos de 1,5 s", gasto < 1500, { gasto });
  conferir("entre QUAISQUER duas chamadas ao mapa (taxa, roteirização, Photon): ≥ o intervalo", intervalos.every((d) => d >= 290), intervalos);
  const iTaxa = doMapa.findIndex((c) => c.quem === "taxa");
  conferir("a roteirização entrou por chamada: houve chamada dela DEPOIS da cotação", iTaxa > 0 && doMapa.slice(iTaxa + 1).some((c) => c.quem === "roteirizacao"), doMapa.map((c) => c.quem));

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Lote cheio não trava a cotação; fila cheia é FALHA, não 'não localizado' ==");
  zerar(0);
  // Uma rodando + 25 esperando: a seguinte é recusada.
  const pendentes: Promise<unknown>[] = [];
  for (let i = 0; i < 26; i++) pendentes.push(servidor.naFila(() => dormir(60)).catch(() => undefined));
  let recusouLote: unknown = null;
  await servidor.naFila(() => dormir(1)).catch((e) => { recusouLote = e; });
  conferir("com 25 chamadas do lote esperando, a seguinte é recusada (fila cheia)",
    recusouLote instanceof servidor.RecusaDaFila && (recusouLote as any).tipo === "cheia" && servidor.estadoDaFilaDoMapa().loteEsperando === 25, String(recusouLote));
  nominatim.set(norm("Rua Diamante, 19 - Centro, Cabo Frio"), { status: 200, corpo: casa(casaDiamante, "Rua Diamante", "Centro", "19") });
  const t1 = Date.now();
  const comLoteCheio = await avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Centro, Cabo Frio", partes: partes("Rua Diamante", "19", "Centro") });
  conferir("com o lote cheio, a cotação passa na frente (ATENDE em < 400 ms)", comLoteCheio.resultado === "ATENDE" && Date.now() - t1 < 400, { r: comLoteCheio.resultado, ms: Date.now() - t1 });
  await Promise.all(pendentes);

  zerar(0);
  const cotacoesPresas: Promise<unknown>[] = [];
  for (let i = 0; i < 26; i++) cotacoesPresas.push(servidor.naFila(() => dormir(100), undefined, { prioridade: "cotacao" }).catch(() => undefined));
  const cheia = await avaliarEntrega(lojaKm, { endereco: "Rua Qualquer, 1 - Centro, Cabo Frio", partes: partes("Rua Qualquer", "1", "Centro") });
  conferir("fila de cotações cheia: DESCONHECIDO com falhaDoMapa 'indisponivel' (não 'não localizado')",
    cheia.resultado === "DESCONHECIDO" && cheia.falhaDoMapa === "indisponivel" && !/não localizado/i.test(cheia.motivo), cheia);
  conferir("… e a nota diz 'não deu para consultar o mapa'", /não deu para consultar o mapa/.test(area.descreverVeredicto(cheia)), area.descreverVeredicto(cheia));
  await Promise.all(cotacoesPresas);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== O voo compartilhado usa o MAIOR prazo de quem espera ==");
  zerar(0);
  nominatim.set(norm("Rua Diamante, 19 - Centro, Cabo Frio"), { status: 200, corpo: casa(casaDiamante, "Rua Diamante", "Centro", "19") });
  const ocupada = servidor.naFila(() => dormir(2500));
  const antesDoVoo = chamadas.length;
  const [curta, longa] = await Promise.all([
    avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Centro, Cabo Frio", partes: partes("Rua Diamante", "19", "Centro") }, { prazoMs: 2000 }),
    avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Centro, Cabo Frio", partes: partes("Rua Diamante", "19", "Centro") }, { prazoMs: 9000 }),
  ]);
  await ocupada;
  conferir("a cotação de 2 s perde o prazo: DESCONHECIDO por PRAZO (não 'não localizado')", curta.resultado === "DESCONHECIDO" && curta.falhaDoMapa === "prazo", curta);
  conferir("a de 9 s, que entrou no mesmo voo, recebe o endereço (ATENDE)", longa.resultado === "ATENDE" && longa.pedeConfirmacao === false, longa);
  conferir("… com UMA busca no mapa para as duas", chamadas.slice(antesDoVoo).filter((c) => c.tipo === "nominatim").length === 1);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Teto por dono (IP, loja) ==");
  zerar(0);
  const { RecusaDaFila, TETOS_DO_DONO } = servidor;
  const doIp = { donos: ["ip:9.9.9.9"] };
  const presos = [servidor.naFila(() => dormir(200), undefined, doIp), servidor.naFila(() => dormir(200), undefined, doIp)];
  let terceira: unknown = null;
  await servidor.naFila(() => dormir(1), undefined, doIp).catch((e) => { terceira = e; });
  conferir(`o IP com ${TETOS_DO_DONO.ip.emVoo} buscas em voo não põe a 3ª na fila`, terceira instanceof RecusaDaFila && (terceira as any).tipo === "limite", String(terceira));
  await Promise.all(presos);
  zerar(0);
  let recusadaNoMinuto = -1;
  for (let i = 0; i < TETOS_DO_DONO.ip.porMinuto + 1; i++) {
    const r = await servidor.naFila(async () => 1, undefined, { donos: ["ip:8.8.8.8"] }).catch(() => "recusada");
    if (r === "recusada") { recusadaNoMinuto = i; break; }
  }
  conferir(`o IP passa de ${TETOS_DO_DONO.ip.porMinuto} buscas no minuto: a seguinte é recusada`, recusadaNoMinuto === TETOS_DO_DONO.ip.porMinuto, recusadaNoMinuto);
  const outroIp = await servidor.naFila(async () => "foi", undefined, { donos: ["ip:7.7.7.7"] }).catch(() => "recusada");
  conferir("… e outro IP segue normal", outroIp === "foi");
  zerar(0);
  for (let i = 0; i < TETOS_DO_DONO.ip.porMinuto; i++) await servidor.naFila(async () => 1, undefined, { donos: ["ip:6.6.6.6"] });
  const estourado = await avaliarEntrega(lojaKm, { endereco: "Rua Nova, 3 - Centro, Cabo Frio", partes: partes("Rua Nova", "3", "Centro") }, { donos: ["ip:6.6.6.6", "loja:x"] });
  conferir("a cotação de quem passou do teto: DESCONHECIDO com falhaDoMapa 'limite' (a rota responde 429)", estourado.resultado === "DESCONHECIDO" && estourado.falhaDoMapa === "limite", estourado);
  const semDono = await avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Centro, Cabo Frio", partes: partes("Rua Diamante", "19", "Centro") });
  conferir("o robô e o pedido (sem dono) não entram no teto", semDono.falhaDoMapa !== "limite");

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Sonda do /api/health: uma por vez ==");
  zerar(0);
  latenciaMs = 150;
  nominatim.set(norm("Cabo Frio, Rio de Janeiro, Brasil"), { status: 200, corpo: casa(LOJA, "Centro", "Centro", "1") });
  let antesDaSonda = chamadas.length;
  const sondas = await Promise.all(Array.from({ length: 30 }, () => servidor.sondarNominatim()));
  conferir("30 sondas simultâneas do Nominatim = 1 chamada", chamadas.slice(antesDaSonda).filter((c) => c.tipo === "nominatim").length === 1 && sondas.every((s) => s.ok), sondas[0]);
  antesDaSonda = chamadas.length;
  const sondasRota = await Promise.all(Array.from({ length: 30 }, () => rota.sondarRoteador()));
  conferir("30 sondas simultâneas do roteador = 1 chamada", chamadas.slice(antesDaSonda).filter((c) => c.tipo === "osrm").length === 1 && sondasRota.every((s) => s.ok), sondasRota[0]);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== O log do Nominatim não grava o endereço do cliente ==");
  zerar(0);
  nominatimPadrao = { status: 503, corpo: {} };
  avisos.length = 0;
  const comFalha = await avaliarEntrega(lojaKm, { endereco: "Rua Diamante, 19 - Boca do Mato, Cabo Frio", partes: partes("Rua Diamante", "19", "Boca do Mato") });
  const doNominatim = avisos.filter((a) => /Nominatim/.test(a));
  conferir("o 503 foi para o log (status e tipo da busca)", doNominatim.some((a) => /respondeu 503 \(busca livre #[0-9a-f]{8}/.test(a)), doNominatim);
  conferir("… sem a rua, o número ou o bairro", doNominatim.every((a) => !/Diamante|Boca do Mato|, 19/.test(a)), doNominatim);
  conferir("… e a cotação diz 'o mapa não respondeu', não 'não localizado'", comFalha.resultado === "DESCONHECIDO" && comFalha.falhaDoMapa === "indisponivel", comFalha);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R8: o ponto do parceiro longe da loja não vai para o pedido ==");
  zerar(0);
  const longe40 = aoSul(40, 0.0001);
  const r40 = await distancia.pontoEDistanciaDoParceiro("divinos", longe40);
  conferir("ponto preciso a 40 km (raio 5 → limite 15): sem ponto e sem distância", r40.ponto === undefined && r40.km === null, r40);
  conferir("… e o log avisa", avisos.some((a) => /\[Parceiro\] ponto do cliente a \d+(\.\d+)? km da loja divinos/.test(a)), avisos.filter((a) => /Parceiro/.test(a)));
  const perto = aoSul(3, 0.0002);
  const r3 = await distancia.pontoEDistanciaDoParceiro("divinos", { latitude: String(perto.lat), longitude: String(perto.lng) });
  conferir("ponto a 3 km: vai para o pedido, com a distância pela rua", !!r3.ponto && r3.ponto.lat === perto.lat && r3.km != null && r3.km >= 3, r3);
  const enchimento = await distancia.pontoEDistanciaDoParceiro("divinos", { lat: -23, lng: -43 });
  conferir("(-23,-43) do 99Food: sem ponto e sem distância", enchimento.ponto === undefined && enchimento.km === null);
  conferir("pontoDoParceiroDaLoja (o webhook do iFood) aplica o mesmo corte", (await distancia.pontoDoParceiroDaLoja("divinos", longe40)) === undefined);
  conferir("sem o cadastro da loja, só a regra do enchimento vale", !!(await distancia.pontoDoParceiroDaLoja("loja-que-nao-existe", perto)));

  console.log("\n== O GPS do próprio cliente não tem o corte do parceiro (até 60 km) ==");
  zerar(0);
  const gps18 = aLeste(18);
  const kmBairro = await distancia.distanciaDaEntregaKm("bairro", gps18);
  conferir("loja por BAIRRO, localização real a 18 km: 18 km (antes do corte: null)", kmBairro != null && Math.abs(kmBairro - 18) < 0.1, kmBairro);
  const kmSemArea = await distancia.distanciaDaEntregaKm("sem-area", aLeste(20));
  conferir("loja SEM área, ponto a 20 km: 20 km", kmSemArea != null && Math.abs(kmSemArea - 20) < 0.1, kmSemArea);
  conferir("o MESMO ponto vindo do parceiro, na loja por bairro (limite 15 km): sem ponto", (await distancia.pontoEDistanciaDoParceiro("bairro", gps18)).ponto === undefined);
  conferir("acima de 60 km continua nulo para todo mundo", (await distancia.distanciaDaEntregaKm("sem-area", aLeste(70))) === null);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== R4: queda LONGA do roteador passa a dar a estimativa declarada ==");
  zerar(0);
  const destinoFora = aoSul(2, 0.0003);
  osrmFalha.add(chave4(destinoFora));
  const primeira = await distancia.medirEntrega("divinos", destinoFora);
  conferir("roteador fora agora: null (o cron mede pela rua quando ele voltar)", primeira === null, primeira);
  const pedida = await distancia.medirEntrega("divinos", destinoFora, { estimarSeORoteadorCair: true });
  conferir("com estimarSeORoteadorCair: estimada na hora", pedida?.medida === "estimada" && (pedida?.km ?? 0) > 2, pedida);
  distancia.envelhecerFalhasDoRoteadorParaTeste(2 * 60 * 60_000 + 1000);
  const depoisDe2h = await distancia.medirEntrega("divinos", destinoFora);
  conferir("o mesmo par falhando há mais de 2 h: estimada (linha reta × fator), sem esperar o roteador", depoisDe2h?.medida === "estimada" && (depoisDe2h?.km ?? 0) > 2, depoisDe2h);
  conferir("… e distanciaDaEntregaKm (o cron) recebe o número", (await distancia.distanciaDaEntregaKm("divinos", destinoFora)) === depoisDe2h?.km);

  // A medida do pedido arredonda UMA vez, como a cotação (R5): a reta exata ×
  // fator. Arredondada antes, 0,715 km virava 0,72 × 1,4 = 1,01 km — a faixa
  // seguinte no repasse do motoboy.
  zerar(0);
  const retaExata = (p: Ponto) => {
    const dLat = ((p.lat - LOJA.lat) * Math.PI) / 180, dLng = ((p.lng - LOJA.lng) * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos((LOJA.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  let noLimite: Ponto | null = null;
  for (let m = 700; m <= 740 && !noLimite; m++) {
    const p = aoSul(m / 1000);
    const r = retaExata(p);
    if (Math.round(r * 1.4 * 100) === 100 && Math.round((Math.round(r * 100) / 100) * 1.4 * 100) === 101) noLimite = p;
  }
  conferir("(achado um ponto em que arredondar a reta antes sobe de faixa)", !!noLimite);
  if (noLimite) {
    osrmFalha.add(chave4(noLimite));
    const umaVez = await distancia.medirEntrega("divinos", noLimite, { estimarSeORoteadorCair: true });
    conferir("medida estimada do pedido: reta exata × 1,4 = 1,00 km (não 1,01)", umaVez?.medida === "estimada" && umaVez?.km === 1, { umaVez, reta: retaExata(noLimite) });
  }

  console.warn = warnOriginal;
  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exitCode = falhou ? 1 : 0;
}

const vivo = setInterval(() => {}, 1000);
main()
  .catch((e) => {
    console.warn = warnOriginal;
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(vivo);
    setTimeout(() => process.exit(process.exitCode ?? 0), 20);
  });
