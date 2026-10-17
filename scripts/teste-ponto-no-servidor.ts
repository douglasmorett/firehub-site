/**
 * O ponto do pedido no SERVIDOR (lib/geocodificacao-servidor.ts,
 * `resolverPontosNoServidor`) e a posição que a loja ensina
 * (lib/ponto-aprendido.ts) — com um banco FALSO em memória (o `globalThis.prisma`
 * que lib/prisma reaproveita) e o mapa servido com as respostas reais de
 * 16/10/2026. Nada sai para a rede, nada toca banco de verdade.
 *
 *   DATABASE_URL=postgresql://x@127.0.0.1:1/x npx tsx scripts/teste-ponto-no-servidor.ts
 */
// Módulo (e não script solto): sem isto o tsc junta este arquivo ao escopo global
// dos outros scripts e reclama de `ok` e `main` repetidos.
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

// ── O banco falso: só o SQL cru que estas duas libs usam ────────────────────
type LinhaDoCache = { chave: string; lat: number; lng: number; origem: string | null };
const geocodeCache = new Map<string, LinhaDoCache>();
const aprendidos = new Map<string, { franchiseeId: string; chave: string; lat: number; lng: number; endereco: string | null }>();
const sqlFeito: string[] = [];
(globalThis as any).prisma = new Proxy(
  {
    $executeRawUnsafe: async (sql: string, ...args: any[]) => {
      sqlFeito.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
      if (/INSERT INTO "GeocodeCache"/.test(sql)) {
        const [chave, lat, lng, origem] = args;
        geocodeCache.set(chave, { chave, lat, lng, origem });
        return 1;
      }
      if (/INSERT INTO "PontoAprendido"/.test(sql)) {
        const [franchiseeId, chave, lat, lng, endereco] = args;
        aprendidos.set(`${franchiseeId}|${chave}`, { franchiseeId, chave, lat, lng, endereco });
        return 1;
      }
      return 0; // CREATE/ALTER/UPDATE de uso
    },
    $queryRawUnsafe: async (sql: string, ...args: any[]) => {
      if (/FROM "GeocodeCache"/.test(sql)) {
        const chaves: string[] = args[0];
        return chaves.map((c) => geocodeCache.get(c)).filter(Boolean);
      }
      if (/FROM "PontoAprendido"/.test(sql)) {
        const [franchiseeId, chaves] = args as [string, string[]];
        return chaves.map((c) => aprendidos.get(`${franchiseeId}|${c}`)).filter(Boolean);
      }
      return [];
    },
  },
  { get: (t, k) => (k in t ? (t as any)[k] : async () => []) },
);

// ── O mapa e o ViaCEP com as respostas reais ──────────────────────────────────
const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const NOMINATIM: Record<string, unknown[]> = {
  "q:sobradinho 2, brasilia df, brasil": [
    { class: "boundary", type: "administrative", addresstype: "town", name: "Sobradinho II", lat: "-15.6437253", lon: "-47.8260143", address: { town: "Sobradinho II" } },
  ],
  "q:avenida central conjunto 02, sobradinho 2, brasilia df, brasil": [
    { class: "highway", type: "residential", addresstype: "road", name: "Avenida Central Conjunto 3", lat: "-15.6448773", lon: "-47.8249946", address: { road: "Avenida Central Conjunto 3", suburb: "Setor de Mansões de Sobradinho", town: "Sobradinho II" } },
  ],
};
let mapaFora = false;
let buscasNoMapa = 0;
globalThis.fetch = (async (url: string) => {
  const u = new URL(String(url));
  if (u.hostname.includes("viacep")) {
    return { ok: true, status: 200, json: async () => ({ erro: true }) } as any; // 73062-892 não existe nos Correios
  }
  buscasNoMapa++;
  if (mapaFora) return { ok: false, status: 429, json: async () => ({}) } as any;
  if (u.hostname.includes("nominatim")) {
    const q = u.searchParams.get("q");
    return { ok: true, status: 200, json: async () => (q != null ? NOMINATIM[`q:${sem(q)}`] || [] : []) } as any;
  }
  return { ok: true, status: 200, json: async () => ({ features: [] }) } as any;
}) as unknown as typeof fetch;

const NIK = { lat: -15.6467899133085, lng: -47.80763973611775 };
const ASA_SUL = { lat: -15.81266, lng: -47.88503 };
const W30 = "Avenida central conjunto 02, 17 - SOBRADINHO 2 - Brasília/DF - CEP 73062892";

async function main() {
  const { resolverPontosNoServidor, chaveDaBusca, reiniciarGeocodificacaoParaTeste, esquecerIncertosParaTeste } = await import("../src/lib/geocodificacao-servidor");
  const { aprenderPonto, pontosAprendidos, sqlDaFaxinaDosPontosAprendidos } = await import("../src/lib/ponto-aprendido");
  const { areaDaLoja, distanciaKm } = await import("../src/lib/ponto-do-pedido");
  reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });

  const area = areaDaLoja({ deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [] }, NIK);
  const loja = { cidade: "BRASILIA DF", endereco: "QUADRA 5 RUA 5 CL 17 - SOBRADINHO I", centro: NIK, area, franchiseeId: "nik" };

  console.log("\n1) O ponto antigo da Asa Sul no cache é refeito (não volta para o mapa)");
  const chave30 = chaveDaBusca(W30, "BRASILIA DF");
  geocodeCache.set(chave30, { chave: chave30, ...ASA_SUL, origem: "bairro (OSM)" });
  const r1 = await resolverPontosNoServidor([{ id: "p30", endereco: W30, ehMarketplace: true }], loja);
  const a1 = r1.achados[0];
  confere("achado em Sobradinho II, pelo texto com o bairro certo", !!a1 && a1.fonte === "texto" && distanciaKm(NIK, a1) < 3 && !a1.doCache, r1);
  confere("o cache foi corrigido (a Asa Sul saiu)", distanciaKm(NIK, geocodeCache.get(chave30)!) < 3);
  const r1b = await resolverPontosNoServidor([{ id: "p30", endereco: W30, ehMarketplace: true }], loja);
  confere("na segunda vez sai do cache, sem ir ao mapa", r1b.achados[0]?.doCache === true);

  console.log("\n2) Sem a área (quem não passa a loja): a régua antiga de 30 km continua valendo");
  geocodeCache.set(chave30, { chave: chave30, ...ASA_SUL, origem: "bairro (OSM)" });
  const r2 = await resolverPontosNoServidor([{ id: "p30", endereco: W30 }], { cidade: "BRASILIA DF", centro: NIK });
  confere("a 20 km, dentro dos 30: vale como antes (só quem conhece a área recusa)", r2.achados[0]?.doCache === true && distanciaKm(NIK, r2.achados[0]) > 20);

  console.log("\n3) Nada plausível: incerto (não vai para o mapa), e o mapa não é perguntado de novo por 30 min");
  esquecerIncertosParaTeste();
  geocodeCache.clear();
  const longe = "Rua Que Não Existe, 10 - Bairro Nenhum - Brasília/DF";
  const antes = buscasNoMapa;
  const r3 = await resolverPontosNoServidor([{ id: "px", endereco: longe, ehMarketplace: true }], loja);
  confere("incerto com motivo", r3.achados.length === 0 && r3.incertos[0]?.id === "px" && /não achou/.test(r3.incertos[0].motivo), r3);
  const gastas = buscasNoMapa - antes;
  const r3b = await resolverPontosNoServidor([{ id: "px", endereco: longe, ehMarketplace: true }], loja);
  confere("de novo: incerto da memória, sem nenhuma busca", r3b.incertos[0]?.id === "px" && buscasNoMapa - antes === gastas && gastas > 0);
  confere("incerto não entra no cache", ![...geocodeCache.values()].some((l) => /nao existe/.test(l.chave)));

  console.log("\n4) Mapa fora (429): nem achado nem incerto — a tela pergunta de novo");
  esquecerIncertosParaTeste();
  geocodeCache.clear();
  mapaFora = true;
  const r4 = await resolverPontosNoServidor([{ id: "p30", endereco: W30, ehMarketplace: true }], loja);
  mapaFora = false;
  confere("sem resposta", r4.achados.length === 0 && r4.incertos.length === 0, r4);
  confere("e nada gravado no cache", geocodeCache.size === 0);

  console.log("\n5) A loja ensina: a posição vem antes do mapa nos próximos pedidos");
  esquecerIncertosParaTeste();
  const casa = { lat: -15.644712, lng: -47.825331 };
  const gravadas = await aprenderPonto({ franchiseeId: "nik", endereco: W30, ponto: casa, pedidoId: "p30", autor: "operador@nik" });
  confere("duas chaves: o texto e o CEP com o número", gravadas === 2 && aprendidos.has("nik|c:73062892|17"), [...aprendidos.keys()]);
  const antesDoAprendido = buscasNoMapa;
  const r5 = await resolverPontosNoServidor([{ id: "p31", endereco: W30, ehMarketplace: true }], loja);
  confere("o próximo pedido do endereço: posição da loja, sem mapa", r5.achados[0]?.fonte === "aprendido" && r5.achados[0].lat === casa.lat && buscasNoMapa === antesDoAprendido, r5);
  const outroJeito = "Avenida Central Conjunto 2, 17 - casa da esquina - SOBRADINHO 2 - Brasília/DF - CEP 73062-892";
  const pelaChaveDoCep = await pontosAprendidos("nik", [outroJeito]);
  confere("escrito de outro jeito, mesmo CEP e número: a mesma porta", pelaChaveDoCep.get(outroJeito)?.lat === casa.lat);
  const deOutraLoja = await resolverPontosNoServidor([{ id: "q1", endereco: W30, ehMarketplace: true }], { ...loja, franchiseeId: "outra" });
  confere("outra loja não herda a posição desta", deOutraLoja.achados[0]?.fonte !== "aprendido");
  confere("faxina: um ano sem uso", /INTERVAL '365 days'/.test(sqlDaFaxinaDosPontosAprendidos()));

  console.log(`\n${ok} ok, ${falhas} falharam`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
