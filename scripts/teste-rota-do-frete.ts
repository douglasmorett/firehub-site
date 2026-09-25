/**
 * A resposta de GET /api/delivery-fee (cluster A, 25/09/2026): o que o
 * checkout, o balcão e o pedido leem dela.
 *
 *   npx tsx scripts/teste-rota-do-frete.ts
 *
 * Sem rede e sem banco: o Prisma é trocado por um falso (globalThis.prisma,
 * que lib/prisma.ts reaproveita fora de produção), e o Nominatim e o roteador
 * são simulados no `fetch`. Os caches do banco viram memória.
 */
// Módulo (e não script): o tsconfig inclui scripts/, e sem isto as variáveis
// deste arquivo colidiriam com as de outros testes no mesmo escopo global.
export {};

process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
process.env.COTACAO_SECRET = "segredo-de-teste";
process.env.NEXTAUTH_SECRET ||= "segredo-de-teste";
delete process.env.OSRM_URL;

type Ponto = { lat: number; lng: number };

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

const LOJA: Ponto = { lat: -22.854033, lng: -42.0296526 };
const aoSul = (km: number, desvio = 0): Ponto => ({ lat: Number((LOJA.lat - km / 111.32).toFixed(6)), lng: Number((LOJA.lng + desvio).toFixed(6)) });
const chave4 = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ZONAS = [
  { km: 1, fee: 5, motoboyFee: 4, time: 30 }, { km: 1.5, fee: 8, motoboyFee: 7, time: 35 },
  { km: 2, fee: 10, motoboyFee: 9, time: 40 }, { km: 5, fee: 20, motoboyFee: 19, time: 60 },
];
const lojas = new Map<string, any>([
  ["divinos", { deliveryZoneType: "ROTA", deliveryZones: ZONAS, deliveryConfig: { repasseDoEntregador: { separado: true } }, storeLatLng: LOJA, storeAddress: "Tv Liberdade 11", city: "Cabo Frio" }],
  // Loja por km SEM pino no mapa: mede pelo endereço cadastrado.
  ["sem-pino", { deliveryZoneType: "KM", deliveryZones: ZONAS, deliveryConfig: {}, storeLatLng: null, storeAddress: "Rua da Loja, 1", city: "Cabo Frio" }],
  // Loja por km SEM pino, com o endereço cadastrado que o mapa acha.
  ["sem-pino-achavel", { deliveryZoneType: "KM", deliveryZones: ZONAS, deliveryConfig: {}, storeLatLng: null, storeAddress: "Tv Liberdade 11", city: "Cabo Frio" }],
  // Outra loja por rota, para a rajada de um IP numa loja não derrubar a outra.
  ["outra-loja", { deliveryZoneType: "ROTA", deliveryZones: ZONAS, deliveryConfig: {}, storeLatLng: LOJA, storeAddress: "Tv Liberdade 11", city: "Cabo Frio" }],
]);
(globalThis as any).prisma = {
  user: { findUnique: async ({ where }: any) => lojas.get(where?.id) ?? null },
  $queryRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $executeRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $queryRaw: async () => [],
};

const nominatim = new Map<string, unknown[]>();
const osrmMetros = new Map<string, number>();
/** Status do Nominatim (503 = fora) e quanto ele demora, para a rajada. */
let nominatimStatus = 200;
let latenciaMs = 0;
let chamadasAoNominatim = 0;
(globalThis as any).fetch = async (entrada: any): Promise<Response> => {
  const url = String(entrada);
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (url.includes("nominatim.openstreetmap.org")) {
    chamadasAoNominatim++;
    if (latenciaMs) await new Promise((r) => setTimeout(r, latenciaMs));
    if (nominatimStatus !== 200) return json({ error: "fora" }, nominatimStatus);
    const u = new URL(url);
    const k = u.searchParams.get("q") != null ? norm(u.searchParams.get("q")!) : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    return json(nominatim.get(k) ?? []);
  }
  if (url.includes("/route/v1/driving/")) {
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const metros = osrmMetros.get(chave4({ lat: Number(m[4]), lng: Number(m[3]) })) ?? 1000;
    return json({ code: "Ok", routes: [{ distance: metros, duration: 120 }], waypoints: [{ distance: 2 }, { distance: 6 }] });
  }
  throw new Error(`fetch inesperado: ${url}`);
};
const warnOriginal = console.warn;
console.warn = () => {};

async function main() {
  const rota = await import("../src/lib/distancia-por-rota");
  const servidor = await import("../src/lib/geocodificacao-servidor");
  rota.reiniciarRoteadorParaTeste({ intervaloDoPublicoMs: 0 });
  servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
  Object.assign(rota.cacheDeRotas, { ler: async () => null, gravar: async () => {}, daOrigem: async () => [] });
  Object.assign(servidor.armazemDaTaxa, { ler: async () => null, gravar: async () => {} });
  const geocoding = await import("../src/lib/geocoding");
  const { GET } = await import("../src/app/api/delivery-fee/route");
  const { NextRequest } = await import("next/server");
  const { lerCotacao, chaveDoEndereco } = await import("../src/lib/cotacao-de-entrega");

  let ipSeq = 0;
  async function pedir(params: Record<string, string>, ip = `10.0.0.${(ipSeq++ % 250) + 1}`) {
    const qs = new URLSearchParams(params).toString();
    const res = await GET(new NextRequest(`http://localhost/api/delivery-fee?${qs}`, { headers: { "x-forwarded-for": ip } }));
    return { status: res.status, corpo: (await res.json()) as any, headers: res.headers };
  }

  console.log("\n== ATENDE com o pino: resposta nova + token da cotação (R1) ==");
  const casa = aoSul(0.9, 0.0004);
  osrmMetros.set(chave4(casa), 1400);
  const endereco = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato", address: "Travessa Canaã, 6 - Boca do Mato, Cabo Frio" };
  const atende = await pedir({ franchiseeId: "divinos", ...endereco, lat: String(casa.lat), lng: String(casa.lng), origem: "pino" });
  const a = atende.corpo;
  conferir("200 e disponível, pela faixa de 1,5 km (R$ 8)", atende.status === 200 && a.available === true && a.fee === 8 && a.faixaKm === 1.5, a);
  conferir("campos novos: tempoMin, medida, ponto com origem, pedeConfirmacao",
    a.tempoMin === 35 && a.medida === "rota" && a.ponto?.origem === "pino" && a.ponto?.lat === casa.lat && a.pedeConfirmacao === false, a);
  conferir("campos antigos mantidos: type, distanceKm, maxRadiusKm, message", a.type === "radius" && a.distanceKm === 1.4 && a.maxRadiusKm === 5 && typeof a.message === "string");
  conferir("precisaConfirmarNoMapa false e podeConfirmarNoMapa true (pode conferir, não é obrigado)", a.precisaConfirmarNoMapa === false && a.podeConfirmarNoMapa === true);
  conferir("o repasse do motoboy não vai para o cardápio público", a.taxaDoEntregador === null);
  const chave = chaveDoEndereco({ ...endereco, lat: casa.lat, lng: casa.lng });
  const lida = lerCotacao(a.cotacao, { loja: "divinos", chave });
  conferir("o token volta pelo contrato (mesma loja, mesmo endereço + ponto)", !!lida, a.cotacao);
  conferir("… com taxa, distância, medida, faixa, prazo e ponto de quem decidiu",
    !!lida && lida.taxa === 8 && lida.distanciaKm === 1.4 && lida.medida === "rota" && lida.faixaKm === 1.5 && lida.tempoMin === 35 && lida.origemDoPonto === "pino" && lida.lat === casa.lat, lida);
  // O token é assinado, não cifrado: o corpo se lê em base64url. No cardápio
  // público ele não leva o repasse do motoboy (o pedido acha pela faixa).
  const corpoDoToken = JSON.parse(Buffer.from(String(a.cotacao).split(".")[0], "base64url").toString("utf8"));
  conferir("o token público não leva o repasse do motoboy (lido do base64 do corpo)",
    !!lida && lida.taxaDoEntregador === null && corpoDoToken.taxaDoEntregador == null, corpoDoToken);
  conferir("outro endereço não usa o token", lerCotacao(a.cotacao, { loja: "divinos", chave: chaveDoEndereco({ ...endereco, number: "7", lat: casa.lat, lng: casa.lng }) }) === null);
  conferir("outra loja não usa o token", lerCotacao(a.cotacao, { loja: "outra", chave }) === null);

  console.log("\n== ATENDE com ponto aproximado: taxa estimada, pino obrigatório, SEM token (R3) ==");
  const centro = aoSul(0.63, 0.002);
  nominatim.set(norm("Boca do Mato, Cabo Frio"), [{ lat: String(centro.lat), lon: String(centro.lng), display_name: "Vila Boca do Mato, Cabo Frio", address: { suburb: "Vila Boca do Mato", city: "Cabo Frio" } }]);
  osrmMetros.set(chave4(centro), 840);
  const aprox = (await pedir({ franchiseeId: "divinos", ...endereco })).corpo;
  conferir("available + pedeConfirmacao + ponto 'bairro' (onde o pino abre)", aprox.available === true && aprox.pedeConfirmacao === true && aprox.ponto?.origem === "bairro" && aprox.fee === 5, aprox);
  conferir("precisaConfirmarNoMapa false (senão o checkout some com a taxa estimada)", aprox.precisaConfirmarNoMapa === false);
  conferir("sem token: o pedido só fecha depois do pino", aprox.cotacao === null);

  console.log("\n== DESCONHECIDO em KM/ROTA: confirme no mapa, nunca a faixa mais cara (R2) ==");
  const nada = (await pedir({ franchiseeId: "divinos", street: "Rua Alecrin", number: "30", neighborhood: "Nenhum", address: "Rua Alecrin, 30 - Nenhum, Cabo Frio" })).corpo;
  conferir("available false, precisaConfirmarNoMapa true, fee 0", nada.available === false && nada.precisaConfirmarNoMapa === true && nada.fee === 0 && nada.unknown === true, nada);
  conferir("sem token", !nada.cotacao);
  const semPino = (await pedir({ franchiseeId: "sem-pino", street: "Rua Alecrin", number: "31", neighborhood: "Nenhum", address: "Rua Alecrin, 31 - Nenhum, Cabo Frio" })).corpo;
  conferir("loja por km SEM pino (e endereço dela não achado): regra antiga, como o pedido (recusaDoSite)",
    semPino.available === true && semPino.unknown === true && semPino.precisaConfirmarNoMapa !== true, semPino);

  console.log("\n== FORA ==");
  const longe = aoSul(4.8, 0.0004);
  osrmMetros.set(chave4(longe), 6100);
  const fora = (await pedir({ franchiseeId: "divinos", lat: String(longe.lat), lng: String(longe.lng), origem: "pino" })).corpo;
  conferir("fora pela rua: indisponível, a mensagem diz 'pela rua', pode ajustar o pino", fora.available === false && /pela rua/.test(fora.message) && fora.podeConfirmarNoMapa === true && fora.precisaConfirmarNoMapa === false, fora);

  console.log("\n== Coordenada de enchimento na query não decide nada (R8) ==");
  const falsa = (await pedir({ franchiseeId: "divinos", lat: "-23", lng: "-43" })).corpo;
  conferir("(-23,-43) é ignorada: 'informe o endereço', não 'fora a 100 km'", falsa.available === false && !/fora/i.test(String(falsa.message)), falsa);

  console.log("\n== Limite por IP e por loja ==");
  let bloqueado: { status: number; corpo: any; headers: Headers } | null = null;
  for (let i = 0; i < 41; i++) {
    const r = await pedir({ franchiseeId: "nao-existe" }, "200.1.1.1");
    if (r.status === 429) { bloqueado = r; break; }
  }
  conferir("41ª consulta do mesmo IP no minuto → 429 com Retry-After", !!bloqueado && Number(bloqueado.headers.get("retry-after")) > 0 && /Espere/.test(bloqueado.corpo.message), bloqueado?.corpo);
  // O teto por loja não conta requisição (a cotação que sai do cache não
  // gasta nada do mapa): 241 IPs cotando a mesma loja não travam o checkout.
  let travouALoja = false;
  for (let i = 0; i < 245; i++) {
    const r = await pedir({ franchiseeId: "loja-alvo" }, `172.16.${Math.floor(i / 200)}.${(i % 200) + 1}`);
    if (r.status === 429) { travouALoja = true; break; }
  }
  conferir("a mesma loja, de 241 IPs diferentes no minuto, sem gastar busca: nenhum 429", !travouALoja);

  // IPv6: o cliente doméstico recebe um /64 inteiro — cada endereço dele
  // seria um balde novo.
  let bloqueou6: number | null = null;
  for (let i = 0; i < 41; i++) {
    const r = await pedir({ franchiseeId: "nao-existe" }, `2804:14c:5b:8000::${(i + 1).toString(16)}`);
    if (r.status === 429) { bloqueou6 = i; break; }
  }
  conferir("41 consultas de endereços IPv6 diferentes do MESMO /64 → a 41ª é 429", bloqueou6 === 40, bloqueou6);
  const outro64 = await pedir({ franchiseeId: "nao-existe" }, "2804:14c:5b:8001::1");
  conferir("… e outro /64 segue", outro64.status !== 429, outro64.status);

  console.log("\n== Rajada de UM IP não derruba a cotação das outras lojas (teto por busca) ==");
  servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 50 });
  geocoding.reiniciarNominatimParaTeste();
  latenciaMs = 60;
  const casaOutra = aoSul(0.8, 0.0031);
  nominatim.set(norm("Rua Diamante, 19 - Centro, Cabo Frio"), [{ lat: String(casaOutra.lat), lon: String(casaOutra.lng), display_name: "19, Rua Diamante, Centro, Cabo Frio", address: { road: "Rua Diamante", suburb: "Centro", city: "Cabo Frio", house_number: "19" } }]);
  osrmMetros.set(chave4(casaOutra), 950);
  const rajada = Array.from({ length: 40 }, (_, i) =>
    pedir({ franchiseeId: "divinos", street: `Rua Inventada ${i}`, number: String(i + 1), neighborhood: "Centro", address: `Rua Inventada ${i}, ${i + 1} - Centro, Cabo Frio` }, "177.1.1.1"),
  );
  await new Promise((r) => setTimeout(r, 30));
  const t0 = Date.now();
  const daOutra = await pedir({ franchiseeId: "outra-loja", street: "Rua Diamante", number: "19", neighborhood: "Centro", address: "Rua Diamante, 19 - Centro, Cabo Frio" }, "10.9.9.9");
  const msDaOutra = Date.now() - t0;
  const respostas = await Promise.all(rajada);
  const barradas = respostas.filter((r) => r.status === 429).length;
  conferir("a cotação de OUTRA loja, de outro IP, no meio da rajada: ATENDE, rápido", daOutra.corpo.available === true && daOutra.corpo.fee === 5 && msDaOutra < 1500, { corpo: daOutra.corpo, msDaOutra });
  conferir("o IP da rajada passa do teto de buscas e leva 429 (não 'não localizado')", barradas >= 30 && respostas.every((r) => r.status === 429 || r.corpo.available === false), { barradas });
  latenciaMs = 0;

  console.log("\n== DESCONHECIDO: onde o mapa abre ==");
  servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
  geocoding.reiniciarNominatimParaTeste();
  // Rua Juriti "- Centro": o mapa acha a de São Paulo, a ~476 km.
  nominatim.set(norm("Rua Juriti, 10 - Centro, Cabo Frio"), [{ lat: "-23.5505", lon: "-46.6333", display_name: "10, Rua Juriti, Centro, São Paulo", address: { road: "Rua Juriti", suburb: "Centro", city: "Cabo Frio", house_number: "10" } }]);
  const juriti = (await pedir({ franchiseeId: "divinos", street: "Rua Juriti", number: "10", neighborhood: "Centro", address: "Rua Juriti, 10 - Centro, Cabo Frio" })).corpo;
  conferir("homônimo a ~476 km: confirme no mapa, mas o mapa NÃO abre lá (sem ponto, sem distância)",
    juriti.available === false && juriti.precisaConfirmarNoMapa === true && juriti.ponto === null && juriti.distanceKm === null, juriti);
  nominatim.set(norm("Tv Liberdade 11, Cabo Frio"), [{ lat: String(LOJA.lat), lon: String(LOJA.lng), display_name: "11, Travessa Liberdade, Cabo Frio", address: { road: "Travessa Liberdade", city: "Cabo Frio", house_number: "11" } }]);
  const semPinoAchavel = (await pedir({ franchiseeId: "sem-pino-achavel", street: "Rua Alecrin", number: "32", neighborhood: "Nenhum", address: "Rua Alecrin, 32 - Nenhum, Cabo Frio" })).corpo;
  conferir("loja por km SEM pino (endereço dela achado): confirme no mapa, aberto no endereço da loja — nada de faixa",
    semPinoAchavel.available === false && semPinoAchavel.fee === 0 && semPinoAchavel.precisaConfirmarNoMapa === true && semPinoAchavel.ponto?.lat === LOJA.lat && !semPinoAchavel.pedirGps, semPinoAchavel);
  nominatimStatus = 503;
  const ocupado = (await pedir({ franchiseeId: "divinos", street: "Rua Nova", number: "5", neighborhood: "Centro", address: "Rua Nova, 5 - Centro, Cabo Frio" })).corpo;
  nominatimStatus = 200;
  geocoding.reiniciarNominatimParaTeste();
  conferir("o mapa fora (503): a mensagem diz que o mapa está ocupado, não 'não localizamos'",
    ocupado.precisaConfirmarNoMapa === true && /ocupado/.test(ocupado.message) && !/Não localizamos/.test(ocupado.message), ocupado);

  console.log("\n== /api/health?sondar=1 ==");
  const { GET: saude } = await import("../src/app/api/health/route");
  const antesDaSonda = chamadasAoNominatim;
  const publico = (await (await saude(new NextRequest("https://firehub.example/api/health?sondar=1", { headers: { "x-forwarded-for": "1.2.3.4", host: "firehub.example" } }))).json()) as any;
  conferir("de fora, sem CRON_SECRET: não sonda (e não gasta a fila)", typeof publico.entrega?.sondas === "string" && chamadasAoNominatim === antesDaSonda, publico.entrega?.sondas);
  nominatim.set(norm("Cabo Frio, Rio de Janeiro, Brasil"), [{ lat: String(LOJA.lat), lon: String(LOJA.lng), display_name: "Cabo Frio", address: { city: "Cabo Frio" } }]);
  const internas = await Promise.all(Array.from({ length: 30 }, () =>
    saude(new NextRequest("http://localhost:3000/api/health?sondar=1", { headers: { host: "localhost:3000" } })).then((r) => r.json() as any)));
  conferir("30 sondas internas ao mesmo tempo: uma pergunta ao Nominatim", chamadasAoNominatim - antesDaSonda === 1 && internas.every((j) => j.entrega?.sondas?.nominatim?.ok === true), { n: chamadasAoNominatim - antesDaSonda });
  conferir("o health mostra a fila do mapa", typeof internas[0].entrega?.nominatim?.fila?.cotacoesEsperando === "number");

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
    // lib/rateLimit.ts arma um setInterval de limpeza no carregamento (certo
    // no servidor, que vive para sempre): sem sair à mão, o teste não termina.
    // Não há conexão aberta aqui (fetch e banco são simulados).
    setTimeout(() => process.exit(process.exitCode ?? 0), 20);
  });
