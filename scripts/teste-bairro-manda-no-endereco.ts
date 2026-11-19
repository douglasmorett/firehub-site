/**
 * O BAIRRO ESCRITO MANDA (regra do Douglas, 19/11/2026): a rua achada em OUTRO
 * bairro não vale como a casa; sem o endereço exato, o ponto vai para o bairro
 * escrito; e o robô nunca diz que não entrega porque o mapa não achou.
 *
 *   npx tsx scripts/teste-bairro-manda-no-endereco.ts
 *   npx tsx --env-file=.env scripts/teste-bairro-manda-no-endereco.ts --real
 *
 * Caso real (Rush Pizza, Uberaba, 19/11/2026): "Alameda Juriti, 581 - Cyrela
 * Landscape". O mapa não conhece o condomínio e só tem a Alameda Juriti do
 * Residencial Estados Unidos (o IBGE tem duas). Ela entrava calada como a casa
 * (pedeConfirmacao false, origem "mapa"): 3,8 km errado, R$ 10,50.
 *
 * Sem rede e sem banco: o mapa é simulado (o `fetch` do Nominatim, ou o
 * geocodificador da taxa direto). Com --real: a loja de verdade (leitura no
 * banco, nada gravado — os caches ficam na memória), o IBGE de Uberaba e o
 * Nominatim de verdade, para os casos que o IBGE já acertava continuarem certos.
 */
export {};

const REAL = process.argv.includes("--real");
if (!REAL) process.env.DATABASE_URL = "postgresql://teste@localhost:1/nao-usado";

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

type Ponto = { lat: number; lng: number };
const RUSH_ID = "cmvjwuc1d01m3ps07yniw4dzc";
const LOJA: Ponto = { lat: -19.7479351, lng: -47.95315309999999 };
const ZONAS = [[0.5, 6.9], [1.5, 7.5], [2.5, 7.9], [3.5, 8.9], [4.5, 9.9], [5.5, 10.5], [6.5, 12.9], [7, 13.9]].map(([km, fee]) => ({ km, fee, time: 30 }));
const rush: any = { id: "", city: "Uberaba", storeAddress: "Av. Dom Luíz Maria de Santana, 387 - Conjunto Sete Colinas, Uberaba/MG", storeLatLng: LOJA, deliveryZoneType: "KM", deliveryZones: ZONAS, deliveryConfig: {} };

/** A Alameda Juriti que o OSM tem (Residencial Estados Unidos), medida em 19/11/2026. */
const JURITI_EUA: Ponto = { lat: -19.7479087, lng: -47.9050742 };
/** O centro do Fabrício (OSM place/suburb). */
const FABRICIO: Ponto = { lat: -19.7443438, lng: -47.9355576 };
/** 9 km ao sul da loja: além do raio de 7 km. */
const LONGE: Ponto = { lat: LOJA.lat - 9 / 111.32, lng: LOJA.lng };

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const kmEntre = (a: Ponto, b: Ponto) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** Um trecho de rua da busca estruturada / um resultado da livre, como o geocodificador devolve. */
const trecho = (p: Ponto, rua: string, suburb: string) => ({ ...p, rua, suburb, displayName: [rua, suburb, "Uberaba", "Minas Gerais", "Brasil"].filter(Boolean).join(", "), cidades: ["Uberaba"] });

/** O mapa simulado: livre pela consulta normalizada, estruturada pela rua normalizada. */
function mapaFalso(livres: Record<string, any>, estruturadas: Record<string, any[]>) {
  return {
    async livre(q: string) { return { ok: true as const, valor: livres[norm(q)] ?? null }; },
    async estruturada(rua: string) { return { ok: true as const, valor: estruturadas[norm(rua)] ?? [] }; },
  };
}

async function puro() {
  const { verifyStoreDeliveryAddress, bairroDoTexto } = await import("../src/lib/geocoding");
  const verificar = (texto: string, partes: any, geo: any, extra: any = {}) =>
    verifyStoreDeliveryAddress(null, LOJA, "Uberaba", ZONAS, "KM", texto, null, {}, partes, { geocodificador: geo, ...extra });
  const juriti = { "alameda juriti": [trecho(JURITI_EUA, "Alameda Juriti", "Residencial Estados Unidos")] };

  console.log("\n1) Juriti/Cyrela: o bairro escrito que ninguém conhece NÃO aceita a rua de outro bairro");
  {
    const partes = { street: "Alameda Juriti", number: "581", neighborhood: "Cyrela Landscape", city: "Uberaba" };
    const r = await verificar("Alameda Juriti, 581 - Cyrela Landscape", partes, mapaFalso({}, juriti), { ibge: async () => null, bairroNoIbge: async () => null });
    conferir("achou um palpite (a Juriti do Residencial Estados Unidos)", !!r?.addressFound && Math.abs((r?.clienteLat ?? 0) - JURITI_EUA.lat) < 1e-6, r);
    conferir("mas pede a confirmação (não é o ponto exato)", r?.pedeConfirmacao === true, r);
    conferir("e não é 'pelo bairro' (o bairro não é conhecido)", r?.peloBairro !== true, r);
    conferir("o motivo diz que o bairro não é conhecido", (r?.motivosDaConfirmacao || []).some((m) => /não conhece o bairro "Cyrela Landscape"/.test(m)), r?.motivosDaConfirmacao);
    // O texto corrido (robô, balcão): o bairro sai do texto.
    const t = await verificar("Alameda Juriti, 581 - Cyrela Landscape", undefined, mapaFalso({}, juriti), { bairroNoIbge: async () => null });
    conferir("no texto corrido também pede a confirmação", t?.pedeConfirmacao === true && t?.peloBairro !== true, t);
  }

  console.log("\n2) Bairro escrito conhecido e rua de outro bairro → o ponto vai para o bairro");
  {
    const partes = { street: "Alameda Juriti", number: "581", neighborhood: "Fabrício", city: "Uberaba" };
    // Só o IBGE conhece o Fabrício (o mapa aberto não devolve nada para ele).
    const r = await verificar("Alameda Juriti, 581 - Fabrício", partes, mapaFalso({}, juriti), {
      bairroNoIbge: async (b: string) => (norm(b) === "fabricio" ? FABRICIO : null),
    });
    conferir("bairro do IBGE: o ponto é o centro do Fabrício", r?.origemDoPonto === "bairro" && kmEntre({ lat: r!.clienteLat!, lng: r!.clienteLng! }, FABRICIO) < 0.01, r);
    conferir("e a taxa vale pelo bairro (peloBairro)", r?.peloBairro === true && r?.deliveryFee === 7.9, { peloBairro: r?.peloBairro, fee: r?.deliveryFee, km: r?.distanceKm });
    // O mapa aberto conhece o Fabrício (place/suburb): o caminho de antes continua.
    const pelaArea = await verificar("Alameda Juriti, 581 - Fabrício", partes, mapaFalso(
      { "fabricio uberaba": { ...FABRICIO, displayName: "Fabrício, Uberaba, Minas Gerais, Brasil", bairro: "Fabrício", cidades: ["Uberaba"], nivel: "area" } },
      juriti,
    ));
    conferir("bairro do mapa: o ponto é o centro do Fabrício, pelo bairro", pelaArea?.origemDoPonto === "bairro" && pelaArea?.peloBairro === true, pelaArea);
    // Rua sem bairro nenhum no mapa, longe do bairro escrito conhecido: também vai para o bairro.
    const semBairro = await verificar("Alameda Juriti, 581 - Fabrício", partes, mapaFalso({}, { "alameda juriti": [trecho(JURITI_EUA, "Alameda Juriti", "")] }), {
      bairroNoIbge: async (b: string) => (norm(b) === "fabricio" ? FABRICIO : null),
    });
    conferir("rua sem bairro no mapa, longe do bairro conhecido → centro do bairro", semBairro?.origemDoPonto === "bairro" && semBairro?.peloBairro === true, semBairro);
    // Rua sem bairro no mapa e bairro que ninguém conhece: nada contradiz o cliente (como antes).
    const nadaContradiz = await verificar("Alameda Juriti, 581 - Cyrela Landscape", { ...partes, neighborhood: "Cyrela Landscape" },
      mapaFalso({}, { "alameda juriti": [trecho(JURITI_EUA, "Alameda Juriti", "")] }), { bairroNoIbge: async () => null });
    conferir("rua sem bairro no mapa e bairro desconhecido → a rua, sem pedir (como antes)", nadaContradiz?.origemDoPonto === "mapa" && nadaContradiz?.pedeConfirmacao === false, nadaContradiz);
    // A rua perto do bairro escrito (o mesmo lugar com outro nome) continua valendo.
    const perto = await verificar("Alameda Juriti, 581 - Fabrício", partes, mapaFalso({}, { "alameda juriti": [trecho({ lat: FABRICIO.lat + 0.005, lng: FABRICIO.lng }, "Alameda Juriti", "Jardim Outro Nome")] }), {
      bairroNoIbge: async (b: string) => (norm(b) === "fabricio" ? FABRICIO : null),
    });
    conferir("rua a 0,6 km do bairro escrito → a rua, sem pedir", perto?.origemDoPonto === "mapa" && perto?.pedeConfirmacao === false, perto);
  }

  console.log("\n3) IBGE: rua única em outro bairro, com bairro escrito que o IBGE não conhece → palpite");
  {
    const ibge = (bairroConfere: boolean) => async () => ({ lat: JURITI_EUA.lat, lng: JURITI_EUA.lng, displayName: "Alameda Juriti, 581 - Residencial Estados Unidos, Uberaba", precisao: "endereco" as const, bairro: "Residencial Estados Unidos", bairroConfere });
    const partes = { street: "Alameda Juriti", number: "581", neighborhood: "Cyrela Landscape", city: "Uberaba" };
    const r = await verificar("x", partes, mapaFalso({}, {}), { ibge: ibge(false) });
    conferir("bairroConfere false → pede a confirmação", r?.pedeConfirmacao === true && r?.peloBairro !== true, r);
    const certo = await verificar("x", { ...partes, neighborhood: "Residencial Estados Unidos" }, mapaFalso({}, {}), { ibge: ibge(true) });
    conferir("bairroConfere true (rua no bairro escrito) → exato, sem pedir", certo?.pedeConfirmacao === false && certo?.precisao === "endereco", certo);
  }

  console.log("\n4) Condomínio no lugar do bairro");
  {
    conferir("'Rua X, 50 - Condomínio Mário Franco' → o condomínio é o lugar escrito", bairroDoTexto("Rua X, 50 - Condomínio Mário Franco", "Uberaba") === "Condomínio Mário Franco");
    conferir("com bairro de verdade escrito, vale o bairro", bairroDoTexto("Rua X, 50, Condomínio Mário Franco, Fabrício", "Uberaba") === "Fabrício");
    conferir("'Rua X, 50, casa 2' continua sem bairro", bairroDoTexto("Rua X, 50, casa 2", "Uberaba") === "");
    const r = await verificar("Rua Mário Franco, 50 - Condomínio Mário Franco", undefined,
      mapaFalso({}, { "rua mario franco": [trecho(LONGE, "Rua Mário Franco", "Bairro Longe")] }), { bairroNoIbge: async () => null });
    conferir("a rua de mesmo nome a 9 km, em outro bairro, não entra calada", r?.pedeConfirmacao === true, r);
  }
}

async function comOMotorInteiro() {
  // O motor inteiro (avaliarEntrega) e o robô, com o Nominatim simulado no fetch.
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const geocoding = await import("../src/lib/geocoding");
  const googleDaLoja = await import("../src/lib/google-maps-da-loja-servidor");
  const { avaliarEntrega } = await import("../src/lib/area-de-entrega");
  const robo = await import("../src/lib/entrega-do-robo");
  const { lerPontoGravado } = await import("../src/lib/ponto-do-pedido");
  const { pontoNoMapa } = await import("../src/lib/app-motoboy/pedido-no-app");

  googleDaLoja.leituraDaLoja.ler = async () => ({ chave: null, hakim: false });
  const guardado = new Map<string, string>();
  Object.assign(servidor.armazemDaTaxa, { ler: async (c: string) => guardado.get(c) ?? null, gravar: async (g: any) => { guardado.set(g.chave, g.resposta); } });
  servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
  geocoding.reiniciarNominatimParaTeste();
  console.warn = () => {};

  /** Estruturada: "rua|cidade" normalizados → lista do Nominatim. Livre: sempre vazio. */
  const estruturadas = new Map<string, any[]>();
  const lugar = (p: Ponto, road: string, suburb: string) => ({
    lat: String(p.lat), lon: String(p.lng), class: "highway", type: "residential", addresstype: "road",
    display_name: [road, suburb, "Uberaba", "Minas Gerais", "Brasil"].filter(Boolean).join(", "),
    address: { road, suburb: suburb || undefined, city: "Uberaba" },
  });
  (globalThis as any).fetch = async (entrada: any) => {
    const u = new URL(String(entrada));
    if (!u.hostname.includes("nominatim")) throw new Error(`fetch inesperado: ${u}`);
    const corpo = u.searchParams.get("q") != null ? [] : estruturadas.get(`${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`) ?? [];
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  };
  estruturadas.set("alameda juriti|uberaba", [lugar(JURITI_EUA, "Alameda Juriti", "Residencial Estados Unidos")]);
  estruturadas.set("rua mario franco|uberaba", [lugar(LONGE, "Rua Mário Franco", "Bairro Longe")]);
  estruturadas.set("rua longe|uberaba", [lugar(LONGE, "Rua Longe", "Bairro Longe")]);

  const peloRobo = (loja: any, endereco: string, bairro?: string) =>
    robo.avaliarEntregaDoRobo((p) => avaliarEntrega(loja, p), { endereco, bairro, partes: robo.partesDoEnderecoDigitado(endereco, loja.city) });

  console.log("\n5) O robô não recusa endereço que não localizou");
  {
    const { veredito: v } = await peloRobo(rush, "Alameda Juriti, 581 - Cyrela Landscape");
    conferir("Juriti/Cyrela (loja por km): não é FORA", v.resultado !== "FORA", v);
    conferir("Juriti/Cyrela: aproximado, e o robô pede a localização", v.aproximado === true && v.pedeConfirmacao === true && robo.motivoParaPedirLocalizacao(v, false) === "aproximado", v);
    const { veredito: c } = await peloRobo(rush, "Rua Mário Franco, 50 - Condomínio Mário Franco");
    conferir("condomínio que o mapa não conhece, rua de mesmo nome a 9 km: NÃO é FORA", c.resultado !== "FORA", c);
    conferir("…é 'não sei', e o robô pede a localização", c.resultado === "DESCONHECIDO" && robo.motivoParaPedirLocalizacao(c, false) === "desconhecido", c);

    const porBairro: any = { ...rush, deliveryZoneType: "NEIGHBORHOOD", deliveryZones: [{ name: "Fabrício", fee: 7, time: 30 }, { name: "Centro", fee: 5, time: 30 }] };
    const { veredito: b } = await peloRobo(porBairro, "Alameda Juriti, 581 - Fabrício");
    conferir("loja por bairro: bairro reconhecido → a taxa do bairro, sem depender do ponto", b.resultado === "ATENDE" && b.taxa === 7 && b.bairro === "Fabrício", b);
    const { veredito: cond } = await peloRobo(porBairro, "Rua Mário Franco, 50", "Condomínio Mário Franco");
    conferir("loja por bairro: condomínio no lugar do bairro → pergunta o bairro (não recusa)", cond.resultado === "DESCONHECIDO" && cond.faltaBairro === true, cond);
    const { veredito: fora } = await peloRobo(porBairro, "Rua X, 10", "Jardim Que Não Atende");
    conferir("loja por bairro: bairro dito e fora da lista continua FORA", fora.resultado === "FORA", fora);
    const { veredito: longe } = await peloRobo(rush, "Rua Longe, 10");
    conferir("loja por km: rua única achada a 9 km (sem bairro contra) continua FORA", longe.resultado === "FORA", longe);
  }

  console.log("\n6) Ponto pelo texto chega à roteirização e ao app como aproximado (só o aviso)");
  {
    const g = lerPontoGravado({ lat: JURITI_EUA.lat, lng: JURITI_EUA.lng, origem: "mapa" }, false);
    conferir("roteirização: origem 'mapa' é aproximado", g?.fonte === "texto" && g?.aproximado === true, g);
    const b = lerPontoGravado({ lat: FABRICIO.lat, lng: FABRICIO.lng, origem: "bairro" }, false);
    conferir("roteirização: centro do bairro é aproximado", b?.fonte === "bairro" && b?.aproximado === true, b);
    const gps = lerPontoGravado({ lat: FABRICIO.lat, lng: FABRICIO.lng, origem: "gps" }, false);
    conferir("roteirização: GPS do cliente não é aproximado", gps?.aproximado === false, gps);
    const app = pontoNoMapa({ lat: JURITI_EUA.lat, lng: JURITI_EUA.lng, origem: "mapa" });
    conferir("app do motoboy: origem 'mapa' mostra o aviso (confira) sem mudar a navegação", app?.confira === true && app?.aproximado === false, app);
    const appBairro = pontoNoMapa({ lat: FABRICIO.lat, lng: FABRICIO.lng, origem: "bairro" });
    conferir("app do motoboy: centro do bairro, aproximado e com aviso", appBairro?.aproximado === true && appBairro?.confira === true, appBairro);
    const appGps = pontoNoMapa({ lat: FABRICIO.lat, lng: FABRICIO.lng, origem: "gps" });
    conferir("app do motoboy: GPS sem aviso", appGps?.confira === false, appGps);
  }
}

async function real() {
  // A loja de verdade (só leitura), o IBGE de Uberaba e o Nominatim de verdade.
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const { avaliarEntrega } = await import("../src/lib/area-de-entrega");
  const { prisma } = await import("../src/lib/prisma");
  const guardado = new Map<string, string>();
  Object.assign(servidor.armazemDaTaxa, { ler: async (c: string) => guardado.get(c) ?? null, gravar: async (g: any) => { guardado.set(g.chave, g.resposta); } });
  const loja: any = await prisma.user.findUnique({
    where: { id: RUSH_ID },
    select: { id: true, city: true, storeAddress: true, storeLatLng: true, deliveryZoneType: true, deliveryZones: true, deliveryConfig: true },
  });
  const avaliar = (endereco: string, partes?: any) => avaliarEntrega(loja, { endereco, partes }, { prazoMs: 30_000 });

  console.log("\n7) REAL — Rush Pizza (Uberaba): o IBGE continua acertando, o Juriti não vira ponto exato");
  const j = await avaliar("Alameda Juriti, 581 - Cyrela Landscape", { street: "Alameda Juriti", number: "581", neighborhood: "Cyrela Landscape", city: "Uberaba" });
  conferir("Juriti/Cyrela: não é ponto exato no Residencial Estados Unidos", j.resultado !== "FORA" && (j.pedeConfirmacao === true || j.resultado === "DESCONHECIDO"), j);
  const p = await avaliar("Av. Pedro Lucas, 601 - Fabrício");
  conferir("Pedro Lucas 601 - Fabrício: ~3,4 km, R$ 8,90, exato", p.resultado === "ATENDE" && Math.abs((p.distanciaKm ?? 0) - 3.44) < 0.15 && p.taxa === 8.9 && !p.pedeConfirmacao, p);
  const rgn = await avaliar("Rua Rio Grande do Norte, 1231 - Santa Maria");
  conferir("Rio Grande do Norte 1231 - Santa Maria: no Santa Maria, exato", rgn.resultado === "ATENDE" && /Santa Maria/.test(rgn.enderecoNoMapa || "") && !rgn.pedeConfirmacao, rgn);
  const gf = await avaliar("Av. Geraldo Formiga do Nascimento, 841 - Recreio dos Bandeirantes");
  conferir("Geraldo Formiga 841 - Recreio dos Bandeirantes: no Recreio, exato", gf.resultado === "ATENDE" && /Recreio dos Bandeirantes/.test(gf.enderecoNoMapa || "") && !gf.pedeConfirmacao, gf);
  await prisma.$disconnect();
}

(async () => {
  if (REAL) {
    await real();
  } else {
    await puro();
    await comOMotorInteiro();
  }
  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
