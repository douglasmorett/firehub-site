/**
 * O ENDEREÇO DA ÚLTIMA ENTREGA no robô (lib/ultimo-endereco-do-cliente.ts) —
 * com o motor de entrega de verdade (lib/area-de-entrega.ts), mapa e roteador
 * simulados.
 *
 *   npx tsx scripts/teste-ultimo-endereco-do-cliente.ts
 *
 * Lapastine, 22/10/2026: quem já pediu pelo robô mandava o endereço de novo em
 * todo pedido. Aqui:
 *
 *   a. cliente com entrega anterior (robô/site/balcão) → o robô oferece o
 *      endereço com a taxa; com o ponto do cliente, sem mapa; a gravação mede
 *      pelo mesmo ponto e dá a mesma taxa; a cotação é feita uma vez;
 *   b. cliente que manda outro endereço (ou diz que mudou) → vale o novo;
 *   c. endereço salvo fora da área (ou que o mapa não acha) → não oferece;
 *   d. cliente sem histórico → nada muda;
 *   e. histórico só de marketplace, retirada, mesa ou cancelado → não oferece.
 *
 * Sem rede e sem banco: Prisma falso, Nominatim e roteador no `fetch`.
 */
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

// ── O MUNDO SIMULADO (o mesmo de scripts/teste-localizacao-e-endereco-do-robo.ts) ──

const PINO_DA_LOJA: Ponto = { lat: -22.854033, lng: -42.0296526 };
const aoSul = (km: number, desvio = 0): Ponto => ({
  lat: Number((PINO_DA_LOJA.lat - km / 111.32).toFixed(6)),
  lng: Number((PINO_DA_LOJA.lng + desvio).toFixed(6)),
});
const chave4 = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ZONAS_DIVINOS = [
  { km: 1, fee: 5, motoboyFee: 4, time: 30 }, { km: 1.5, fee: 8, motoboyFee: 7, time: 35 },
  { km: 2, fee: 10, motoboyFee: 9, time: 40 }, { km: 2.5, fee: 12, motoboyFee: 11, time: 40 },
  { km: 3, fee: 15, motoboyFee: 14, time: 45 }, { km: 3.5, fee: 17, motoboyFee: 16, time: 45 },
  { km: 4, fee: 18, motoboyFee: 17, time: 50 }, { km: 4.5, fee: 19, motoboyFee: 18, time: 50 },
  { km: 5, fee: 20, motoboyFee: 19, time: 60 },
];
const DIVINOS = {
  id: "cmudbzcus0008ka010pmo1e0w",
  deliveryZoneType: "ROTA", deliveryZones: ZONAS_DIVINOS,
  deliveryConfig: { repasseDoEntregador: { separado: true, marketplace: "TABELA" } },
  storeLatLng: PINO_DA_LOJA, storeAddress: "Tv Liberdade 11, Vila Monte Alegre", city: "Cabo Frio",
};
/** Loja por bairro: a cotação do endereço salvo nem chega ao mapa. */
const POR_BAIRRO = {
  id: "loja-por-bairro",
  deliveryZoneType: "NEIGHBORHOOD",
  deliveryZones: [{ name: "Centro", fee: 6, time: 40 }, { name: "Vila Nova", fee: 8, time: 50 }],
  deliveryConfig: {},
  storeLatLng: PINO_DA_LOJA, storeAddress: "Rua A, 1, Centro", city: "Cabo Frio",
};
(globalThis as any).prisma = {
  user: { findUnique: async () => null },
  $queryRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $executeRawUnsafe: async () => { throw new Error("sem banco no teste"); },
};

const regrasDoMapa: { contem: string; resposta: unknown[] }[] = [];
const ruas = new Map<string, number>();
let buscasNoMapa = 0;

function lugar(p: Ponto, a: { road?: string; suburb?: string; house_number?: string }) {
  return {
    lat: String(p.lat), lon: String(p.lng),
    display_name: [a.road, a.house_number, a.suburb, "Cabo Frio", "Rio de Janeiro", "Brasil"].filter(Boolean).join(", "),
    address: { road: a.road, suburb: a.suburb, city: "Cabo Frio", house_number: a.house_number },
  };
}

(globalThis as any).fetch = async (entrada: any): Promise<Response> => {
  const url = String(entrada);
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (url.includes("nominatim.openstreetmap.org")) {
    buscasNoMapa++;
    const u = new URL(url);
    const consulta = u.searchParams.get("q") != null
      ? norm(u.searchParams.get("q")!)
      : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    const regra = regrasDoMapa.find((r) => consulta.includes(r.contem));
    return json(regra ? regra.resposta : []);
  }
  if (url.includes("/route/v1/driving/")) {
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const metros = ruas.get(chave4({ lat: Number(m[4]), lng: Number(m[3]) }));
    return json({ code: "Ok", routes: [{ distance: metros ?? 1000, duration: 120 }], waypoints: [{ distance: 3 }, { distance: 5 }] });
  }
  if (url.includes("viacep")) return json({ erro: true });
  throw new Error(`fetch inesperado: ${url}`);
};
console.warn = () => {};

async function main() {
  const rota = await import("../src/lib/distancia-por-rota");
  const servidor = await import("../src/lib/geocodificacao-servidor");
  const geocoding = await import("../src/lib/geocoding");
  const rotasGuardadas = new Map<string, any>();
  Object.assign(rota.cacheDeRotas, {
    ler: async (c: string) => rotasGuardadas.get(c) ?? null,
    gravar: async (c: string, r: any) => { rotasGuardadas.set(c, { ...r, criadoEm: Date.now() }); },
    daOrigem: async () => [],
  });
  Object.assign(servidor.armazemDaTaxa, { ler: async () => null, gravar: async () => {} });
  function zerar() {
    rota.reiniciarRoteadorParaTeste({ intervaloDoPublicoMs: 0 });
    servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
    geocoding.reiniciarNominatimParaTeste();
    rotasGuardadas.clear();
    regrasDoMapa.length = 0;
    ruas.clear();
    buscasNoMapa = 0;
  }

  const { avaliarEntrega } = await import("../src/lib/area-de-entrega");
  const robo = await import("../src/lib/entrega-do-robo");
  const ue = await import("../src/lib/ultimo-endereco-do-cliente");

  const TELEFONE = "5522998765432"; // o JID do WhatsApp: 55 + DDD + 9 dígitos
  const agora = Date.now();
  const dias = (n: number) => new Date(agora - n * 24 * 60 * 60 * 1000);
  const pedido = (p: Partial<Record<string, any>>) => ({
    customerPhone: "+55 (22) 99876-5432", deliveryType: "DELIVERY", status: "ENTREGUE", source: "WHATSAPP_IA", createdAt: dias(10),
    customerAddress: "Rua das Flores, 120 - Centro", customerLatLng: null, ...p,
  });

  /**
   * A conversa, como processChatbotAI a monta (lib/chatbot-ai.ts): sem endereço
   * na conversa, o salvo entra na cotação; só é oferecido se fechar sem pergunta.
   */
  let cotacoesFeitas = 0;
  async function conversa(loja: any, pedidos: any[], falasDoCliente: string[]) {
    if (ue.conversaJaTemEndereco(falasDoCliente)) return { salvo: null, oferecido: null, bloco: "" };
    const salvo = ue.ultimoEnderecoDoCliente(pedidos, TELEFONE, agora);
    if (!salvo) return { salvo: null, oferecido: null, bloco: "" };
    const gps = salvo.ponto;
    const cotar = () => {
      cotacoesFeitas++;
      return robo.avaliarEntregaDoRobo((p) => avaliarEntrega(loja, p), {
        endereco: salvo.endereco, partes: robo.partesDoEnderecoDigitado(salvo.endereco, loja.city), gps, textoDepoisDoPonto: null,
      });
    };
    const a = await ue.cotacaoGuardada(`${loja.id}|${salvo.endereco}|${gps ? `${gps.lat},${gps.lng}` : ""}`, cotar, (r) => r.veredito.resultado !== "DESCONHECIDO");
    const pedir = robo.motivoParaPedirLocalizacao(a.veredito, Boolean(a.coords));
    const oferece = ue.enderecoSalvoFechaSemPergunta(a.veredito, pedir);
    return {
      salvo, veredito: a.veredito, oferecido: oferece ? salvo : null,
      bloco: oferece ? ue.blocoDoUltimoEndereco({ endereco: salvo.endereco, quando: salvo.quando, taxa: a.veredito.taxa ?? 0, tempoMin: a.veredito.tempoMin }) : "",
    };
  }

  /** A gravação, como syncAiOrderToDatabase decide o ponto e avalia (sem localização na conversa). */
  async function gravacao(loja: any, tag: any, salvo: any) {
    const endereco = String(tag.address || "");
    let coords: Ponto | null = null;
    if (!coords && salvo?.ponto && robo.mesmoEnderecoDeEntrega(salvo.endereco, endereco)) coords = salvo.ponto;
    const r = await robo.avaliarEntregaDoRobo((p) => avaliarEntrega(loja, p), {
      endereco, bairro: tag.neighborhood || null,
      partes: robo.partesDoEnderecoDaTag(tag) ?? robo.partesDoEnderecoDigitado(endereco, loja.city),
      gps: coords, textoDepoisDoPonto: null,
    });
    return { ...r, ponto: robo.pontoParaGravar(r.veredito, r.coords) };
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== Qual pedido dá o endereço ==");
  const casa = aoSul(0.6, 0.0013);
  const comPonto = pedido({ customerLatLng: { lat: casa.lat, lng: casa.lng, origem: "gps", medida: "rota" } });
  const r1 = ue.ultimoEnderecoDoCliente([comPonto], TELEFONE, agora);
  conferir("entrega do robô com o ponto do cliente: endereço e ponto", r1?.endereco === "Rua das Flores, 120 - Centro" && r1?.ponto?.lat === casa.lat, r1);
  const r2 = ue.ultimoEnderecoDoCliente([pedido({ source: "ONLINE", customerPhone: "22998765432", customerLatLng: { lat: 1, lng: 1, origem: "mapa" } })], TELEFONE, agora);
  conferir("pedido do site (ONLINE): endereço sim; ponto achado pelo MAPA não se herda", r2?.endereco === "Rua das Flores, 120 - Centro" && r2?.ponto === null, r2);
  const r3 = ue.ultimoEnderecoDoCliente([pedido({ source: "PRESENCIAL", customerPhone: "(22) 9876-5432" })], TELEFONE, agora);
  conferir("balcão com o telefone sem o nono dígito: é o mesmo cliente", r3?.endereco === "Rua das Flores, 120 - Centro", r3);
  const r4 = ue.ultimoEnderecoDoCliente([
    pedido({ createdAt: dias(40), customerAddress: "Rua Antiga, 10 - Centro" }),
    pedido({ createdAt: dias(2), customerAddress: "Rua Nova, 20 - Vila Nova" }),
    pedido({ createdAt: dias(1), customerAddress: "📍 Localização enviada pelo WhatsApp (-22.1, -42.1)" }),
  ], TELEFONE, agora);
  conferir("vale o MAIS RECENTE com endereço escrito (a reserva da localização não conta)", r4?.endereco === "Rua Nova, 20 - Vila Nova", r4);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== d/e. Sem histórico, ou só marketplace/retirada/mesa/cancelado: não oferece ==");
  conferir("sem pedido nenhum: nada", ue.ultimoEnderecoDoCliente([], TELEFONE, agora) === null);
  const soDeFora = [
    pedido({ source: "IFOOD" }), pedido({ source: "99FOOD" }), pedido({ source: "BRENDI" }), pedido({ source: "WABIZ" }), pedido({ source: "JOTAJA" }),
    pedido({ deliveryType: "RETIRADA" }), pedido({ deliveryType: "MESA" }), pedido({ status: "CANCELADO" }), pedido({ status: "CRIANDO_IA" }),
  ];
  conferir("marketplace, retirada, mesa, cancelado e rascunho: nada", ue.ultimoEnderecoDoCliente(soDeFora, TELEFONE, agora) === null);
  conferir("outro DDD com o mesmo final (21 × 22): não é o cliente", ue.ultimoEnderecoDoCliente([pedido({ customerPhone: "(21) 99876-5432" })], TELEFONE, agora) === null);
  conferir("pedido de mais de 12 meses: nada", ue.ultimoEnderecoDoCliente([pedido({ createdAt: dias(400) })], TELEFONE, agora) === null);
  conferir("telefone do pedido vazio ou 0800 do iFood: nada",
    ue.ultimoEnderecoDoCliente([pedido({ customerPhone: "" }), pedido({ customerPhone: "0800 705 6070 ID: 70378422" })], TELEFONE, agora) === null);
  zerar();
  const d1 = await conversa(DIVINOS, [], ["boa noite, quero uma pizza grande"]);
  conferir("conversa de quem nunca pediu: sem bloco e sem cotação extra", d1.bloco === "" && buscasNoMapa === 0);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== a. Entrega anterior com o ponto do cliente: oferece, sem mapa, e grava igual ==");
  zerar();
  ruas.set(chave4(casa), 900);
  cotacoesFeitas = 0;
  const a1 = await conversa(DIVINOS, [comPonto], ["boa noite, quero 2 x-tudo pra entrega"]);
  conferir("oferece o endereço salvo com a taxa da área (0,9 km → R$ 5)", a1.oferecido?.endereco === "Rua das Flores, 120 - Centro" && (a1 as any).veredito?.taxa === 5, (a1 as any).veredito);
  conferir("o bloco do contexto traz o endereço, a taxa e a pergunta", /ENDEREÇO DA ÚLTIMA ENTREGA/.test(a1.bloco) && a1.bloco.includes("Rua das Flores, 120 - Centro") && a1.bloco.includes("R$ 5,00") && /mesmo endereço da última vez/.test(a1.bloco), a1.bloco);
  conferir("mediu pelo ponto do pedido antigo: nenhuma busca no mapa", buscasNoMapa === 0, buscasNoMapa);
  const a2 = await conversa(DIVINOS, [comPonto], ["boa noite, quero 2 x-tudo pra entrega", "sim, pode ser", "pix"]);
  conferir("nas mensagens seguintes ('sim', 'pix'): mesma oferta, sem medir de novo", a2.oferecido !== null && cotacoesFeitas === 1, cotacoesFeitas);
  const g1 = await gravacao(DIVINOS, { address: "Rua das Flores, 120, Centro, casa 2", neighborhood: "Centro", deliveryFee: 5 }, a1.oferecido);
  conferir("gravação com o endereço reescrito pelo modelo: a MESMA taxa (R$ 5)", g1.veredito.resultado === "ATENDE" && g1.veredito.taxa === 5, g1.veredito);
  conferir("… e grava o ponto do pedido antigo (origem 'gps')", g1.ponto?.lat === casa.lat && g1.ponto?.origem === "gps", g1.ponto);
  conferir("… ainda sem busca no mapa", buscasNoMapa === 0, buscasNoMapa);

  console.log("\n== a'. Entrega anterior sem ponto do cliente: cota pelo texto, uma vez ==");
  zerar();
  const ruaDasFlores = aoSul(1.2, 0.001);
  ruas.set(chave4(ruaDasFlores), 1400);
  regrasDoMapa.push({ contem: "rua das flores", resposta: [lugar(ruaDasFlores, { road: "Rua das Flores", suburb: "Centro", house_number: "120" })] });
  const semPonto = pedido({ source: "ONLINE", customerAddress: "Rua das Flores, 120 - Centro (sem ponto)", customerLatLng: { lat: 9, lng: 9, origem: "mapa" } });
  const b1 = await conversa(DIVINOS, [semPonto], ["oi, quero pedir"]);
  const buscasDaPrimeira = buscasNoMapa;
  conferir("oferece com a taxa do texto achado no mapa (1,4 km → R$ 8)", b1.oferecido !== null && (b1 as any).veredito?.taxa === 8, (b1 as any).veredito);
  await conversa(DIVINOS, [semPonto], ["oi, quero pedir", "sim"]);
  conferir("na mensagem seguinte não busca no mapa de novo", buscasDaPrimeira > 0 && buscasNoMapa === buscasDaPrimeira, { buscasDaPrimeira, buscasNoMapa });

  console.log("\n== a''. Loja por bairro: o bairro do endereço salvo decide, sem mapa ==");
  zerar();
  const c0 = await conversa(POR_BAIRRO, [pedido({ customerAddress: "Rua Tiradentes, 512 - Vila Nova" })], ["boa noite"]);
  conferir("bairro cadastrado (Vila Nova → R$ 8): oferece, sem busca no mapa", c0.oferecido !== null && (c0 as any).veredito?.taxa === 8 && buscasNoMapa === 0, (c0 as any).veredito);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== b. O cliente manda outro endereço (ou diz que mudou): vale o novo ==");
  for (const fala of [
    "Rua Nova Esperança, 45 - Jardim Esperança",
    "é na Av. Brasil 845",
    "mudei de endereço",
    "entrega em outro endereço hoje",
    "📍 Localização enviada pelo WhatsApp: -22.860000, -42.030000",
  ]) {
    conferir(`"${fala}" → a conversa já tem endereço`, ue.conversaJaTemEndereco(["quero uma pizza", fala]));
  }
  for (const fala of ["sim", "isso mesmo", "pix", "quero 2 pizzas grandes", "vcs entregam hoje?"]) {
    conferir(`"${fala}" → ainda sem endereço`, !ue.conversaJaTemEndereco([fala]));
  }
  zerar();
  ruas.set(chave4(casa), 900);
  const casaNova = aoSul(3.1, -0.004);
  ruas.set(chave4(casaNova), 3400);
  regrasDoMapa.push({ contem: "rua nova esperanca", resposta: [lugar(casaNova, { road: "Rua Nova Esperança", suburb: "Jardim Esperança", house_number: "45" })] });
  const outra = await conversa(DIVINOS, [comPonto], ["quero 2 x-tudo", "não, é na Rua Nova Esperança, 45 - Jardim Esperança"]);
  conferir("com outro endereço na conversa: o salvo não entra", outra.salvo === null && outra.bloco === "");
  const g2 = await gravacao(DIVINOS, { address: "Rua Nova Esperança, 45 - Jardim Esperança", neighborhood: "Jardim Esperança" }, a1.oferecido);
  conferir("gravação com o endereço NOVO: não usa o ponto antigo (3,4 km → R$ 17)", g2.veredito.taxa === 17 && g2.ponto?.lat === casaNova.lat && g2.ponto?.origem === "mapa", g2.veredito);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== c. Endereço salvo fora da área (ou que o mapa não acha): não oferece ==");
  zerar();
  const longe = aoSul(5.5, 0.002);
  ruas.set(chave4(longe), 6200);
  const fora = await conversa(DIVINOS, [pedido({ customerLatLng: { lat: longe.lat, lng: longe.lng, origem: "pino" } })], ["oi"]);
  conferir("6,2 km com a loja até 5 km: FORA, sem bloco", (fora as any).veredito?.resultado === "FORA" && fora.oferecido === null && fora.bloco === "", (fora as any).veredito);
  zerar();
  cotacoesFeitas = 0;
  const naoAcha = pedido({ source: "ONLINE", customerAddress: "Rua Que Não Existe, 9 - Lugar Nenhum" });
  const n1 = await conversa(DIVINOS, [naoAcha], ["oi"]);
  conferir("o mapa não acha: sem bloco (o robô pede o endereço como sempre)", n1.oferecido === null && n1.bloco === "", (n1 as any).veredito);
  await conversa(DIVINOS, [naoAcha], ["oi", "quero pedir"]);
  conferir("'não sei' não fica guardado: tenta de novo na mensagem seguinte", cotacoesFeitas === 2, cotacoesFeitas);
  const foraDoBairro = await conversa(POR_BAIRRO, [pedido({ customerAddress: "Rua X, 5 - Bairro Distante" })], ["oi"]);
  conferir("loja por bairro, bairro que não atende mais: sem bloco", foraDoBairro.oferecido === null && foraDoBairro.bloco === "", (foraDoBairro as any).veredito);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
