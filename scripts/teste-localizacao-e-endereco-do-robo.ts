/**
 * A LOCALIZAÇÃO DO WHATSAPP E O ENDEREÇO DIGITADO, no robô — com o motor de
 * entrega de verdade (lib/area-de-entrega.ts), mapa e roteador simulados.
 *
 *   npx tsx scripts/teste-localizacao-e-endereco-do-robo.ts
 *
 * Revisão de 25/09/2026 (cluster E). O fluxo feito para o endereço que o mapa
 * não acha — o robô pede a localização, o cliente manda, o robô pede a rua
 * para o entregador — se desfazia na mensagem seguinte: a rua digitada DEPOIS
 * da localização a derrubava, a cotação voltava a procurar pelo texto, dava
 * "não achei", e o robô pedia a localização DE NOVO; na gravação o pedido era
 * segurado com "chamei um atendente". Aqui:
 *
 *   1. localização → o robô pede a rua → o cliente digita a rua que o mapa não
 *      conhece: a taxa continua sendo a da localização, na conversa e no pedido;
 *   2. a rua achada PERTO do ponto é complemento; LONGE (com certeza), é outro
 *      lugar e vale o texto;
 *   3. a loja sem ponto no mapa não faz o robô pedir a localização do cliente;
 *   4. sem localização, a conversa e a gravação decidem igual (partes/bairro
 *      nos dois lados — R1);
 *   5. a oferta da regra 18a não conta como "já pedi a localização".
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

// ── O MUNDO SIMULADO (o mesmo de scripts/teste-entrega-ponta-a-ponta.ts) ────

const PINO_DA_LOJA: Ponto = { lat: -22.854033, lng: -42.0296526 };
const aoSul = (km: number, desvio = 0): Ponto => ({
  lat: Number((PINO_DA_LOJA.lat - km / 111.32).toFixed(6)),
  lng: Number((PINO_DA_LOJA.lng + desvio).toFixed(6)),
});
const chave4 = (p: Ponto) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A tabela real da Divinos: km de rua, taxa ao cliente e repasse ao motoboy. */
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
(globalThis as any).prisma = {
  user: { findUnique: async () => null },
  $queryRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $executeRawUnsafe: async () => { throw new Error("sem banco no teste"); },
};

const regrasDoMapa: { contem: string; naoContem?: string; resposta: unknown[] }[] = [];
const ruas = new Map<string, number>();

function lugar(p: Ponto, a: { road?: string; suburb?: string; house_number?: string; classe?: string; tipo?: string; display?: string }) {
  return {
    lat: String(p.lat), lon: String(p.lng),
    ...(a.classe ? { class: a.classe, type: a.tipo ?? "", addresstype: a.tipo ?? "" } : {}),
    display_name: a.display ?? [a.road, a.house_number, a.suburb, "Cabo Frio", "Rio de Janeiro", "Brasil"].filter(Boolean).join(", "),
    address: { road: a.road, suburb: a.suburb, city: "Cabo Frio", house_number: a.house_number },
  };
}

(globalThis as any).fetch = async (entrada: any): Promise<Response> => {
  const url = String(entrada);
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (url.includes("nominatim.openstreetmap.org")) {
    const u = new URL(url);
    const consulta = u.searchParams.get("q") != null
      ? norm(u.searchParams.get("q")!)
      : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    const regra = regrasDoMapa.find((r) => consulta.includes(r.contem) && (!r.naoContem || !consulta.includes(r.naoContem)));
    return json(regra ? regra.resposta : []);
  }
  if (url.includes("/route/v1/driving/")) {
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const metros = ruas.get(chave4({ lat: Number(m[4]), lng: Number(m[3]) }));
    return json({ code: "Ok", routes: [{ distance: metros ?? 1000, duration: 120 }], waypoints: [{ distance: 3 }, { distance: 5 }] });
  }
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
  const geoGuardado = new Map<string, string>();
  Object.assign(servidor.armazemDaTaxa, {
    ler: async (c: string) => geoGuardado.get(c) ?? null,
    gravar: async (g: any) => { geoGuardado.set(g.chave, g.resposta); },
  });
  function zerar() {
    rota.reiniciarRoteadorParaTeste({ intervaloDoPublicoMs: 0 });
    servidor.reiniciarGeocodificacaoParaTeste({ intervaloDoNominatimMs: 0 });
    geocoding.reiniciarNominatimParaTeste();
    rotasGuardadas.clear();
    geoGuardado.clear();
    regrasDoMapa.length = 0;
    ruas.clear();
  }

  const { avaliarEntrega } = await import("../src/lib/area-de-entrega");
  const robo = await import("../src/lib/entrega-do-robo");
  const whats = await import("../src/lib/localizacao-do-whatsapp");
  const avaliarNa = (loja: any) => (p: any) => avaliarEntrega(loja, p);

  /** A cotação da conversa, como processChatbotAI a monta (lib/chatbot-ai.ts). */
  async function cotacaoDaConversa(loja: any, historico: { sender: string; text: string }[], mensagem: string) {
    const estado = whats.estadoDaLocalizacao(historico, mensagem, robo.pareceEnderecoEscrito);
    const loc = estado.localizacao;
    const gps = loc ? { lat: loc.lat, lng: loc.lng } : null;
    const falas = [...historico.filter((h) => h.sender === "user").slice(-3).map((h) => h.text), mensagem]
      .map((t) => whats.semLinhaDaLocalizacao(t)).filter(Boolean);
    const regua = /\b(rua|r\.|avenida|av\.|bairro|estrada|est\.|alameda|travessa|praça|praca|rodovia|rod\.|quadra|qd|lote|lt|condomínio|condominio|loteamento|km)\b|\b(we|sn)\s*-?\s*\d{1,4}\b/i;
    const digitado = whats.enderecoDasFalas(falas.filter((t) => regua.test(t)));
    const textoDepoisDoPonto = gps ? loc?.enderecoDigitadoDepois || null : null;
    const endereco = textoDepoisDoPonto || digitado || falas.join(" ");
    const r = await robo.avaliarEntregaDoRobo(avaliarNa(loja), {
      endereco, partes: robo.partesDoEnderecoDigitado(endereco, loja.city), gps, textoDepoisDoPonto,
    });
    return { ...r, estado, pedirLocalizacao: robo.motivoParaPedirLocalizacao(r.veredito, Boolean(r.coords)) };
  }

  /** A gravação, como syncAiOrderToDatabase decide o ponto e avalia. */
  async function gravacao(loja: any, tag: any, loc: any) {
    const endereco = String(tag.address || "");
    const digitado = Boolean(endereco) && !robo.ehEnderecoDaLocalizacao(endereco);
    const r = await robo.avaliarEntregaDoRobo(avaliarNa(loja), {
      endereco,
      bairro: tag.neighborhood || null,
      partes: robo.partesDoEnderecoDaTag(tag) ?? (digitado ? robo.partesDoEnderecoDigitado(endereco, loja.city) : undefined),
      gps: loc ? { lat: loc.lat, lng: loc.lng } : null,
      textoDepoisDoPonto: loc?.enderecoDigitadoDepois && digitado ? endereco : null,
    });
    return {
      ...r,
      ponto: robo.pontoParaGravar(r.veredito, r.coords),
      avisos: robo.avisosDaEntregaNaNota(r.veredito, Boolean(r.coords)),
      pedirLocalizacao: robo.motivoParaPedirLocalizacao(r.veredito, Boolean(r.coords)),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 1. Localização → o robô pede a rua → o cliente digita a rua que o mapa NÃO conhece (Divinos) ==");
  zerar();
  const casa = aoSul(0.6, 0.0013);
  ruas.set(chave4(casa), 900);
  const linha = whats.textoDaLocalizacao({ lat: casa.lat, lng: casa.lng });
  const conversa = [
    { sender: "user", text: "boa noite, quero 2 x-tudo pra entrega" },
    { sender: "bot", text: "Anotado! A nossa taxa de entrega é calculada conforme o seu endereço. Me passa a rua, o número e o bairro (ou manda sua localização pelo 📎) que eu vejo o valor certinho pra você? 😊" },
    { sender: "user", text: linha },
    { sender: "bot", text: "Recebi sua localização! A taxa fica R$ 5,00. Me passa a rua, o número e um ponto de referência pro entregador?" },
  ];
  const rua = "Travessa Canaã, 6 - Boca do Mato";
  const c1 = await cotacaoDaConversa(DIVINOS, conversa, rua);
  conferir("a rua digitada depois NÃO derruba a localização", c1.estado.localizacao?.lat === casa.lat && c1.estado.localizacao?.enderecoDigitadoDepois === rua, c1.estado);
  conferir("cotação: ATENDE R$ 5 pela LOCALIZAÇÃO (0,9 km de rua), ponto 'gps'",
    c1.veredito.resultado === "ATENDE" && c1.veredito.taxa === 5 && c1.veredito.ponto?.origem === "gps" && c1.coords?.lat === casa.lat, c1.veredito);
  conferir("… e NÃO pede a localização de novo a quem acabou de mandar", c1.pedirLocalizacao === null);
  const c2 = await cotacaoDaConversa(DIVINOS, [...conversa, { sender: "user", text: rua }, { sender: "bot", text: "Anotado! Forma de pagamento?" }], "pix");
  conferir("na mensagem seguinte ('pix') continua a mesma taxa pela localização", c2.veredito.taxa === 5 && c2.coords?.lat === casa.lat && c2.pedirLocalizacao === null, c2.veredito);
  const tag = { address: rua, street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato", deliveryFee: 5, finalized: true };
  const g1 = await gravacao(DIVINOS, tag, c2.estado.localizacao);
  conferir("gravação: a MESMA taxa (R$ 5), sem segurar nem pedir localização",
    g1.veredito.resultado === "ATENDE" && g1.veredito.taxa === 5 && g1.pedirLocalizacao === null, g1.veredito);
  conferir("gravação: o ponto gravado é o do aparelho {origem:'gps', medida:'rota'}", g1.ponto?.origem === "gps" && g1.ponto?.lat === casa.lat && g1.ponto?.medida === "rota", g1.ponto);
  conferir("a nota diz 'localização enviada pelo cliente' e NÃO 'ponto aproximado (sem localização)'",
    g1.avisos.some((a) => /localização enviada/.test(a)) && !g1.avisos.some((a) => /aproximado/.test(a)), g1.avisos);
  conferir("a oferta da regra 18a no histórico NÃO conta como 'já pedi a localização'", !whats.roboJaPediuLocalizacao(conversa));

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 2. A rua digitada é achada PERTO do ponto: complemento, vale a localização ==");
  zerar();
  ruas.set(chave4(casa), 900);
  const trechoPerto = { lat: Number((casa.lat - 0.0025).toFixed(6)), lng: casa.lng }; // ~280 m: o meio do trecho da rua
  ruas.set(chave4(trechoPerto), 1250);
  regrasDoMapa.push({ contem: "rua das palmeiras", resposta: [lugar(trechoPerto, { road: "Rua das Palmeiras", suburb: "Jardim Excelsior", house_number: "45" })] });
  const ruaPerto = "Rua das Palmeiras, 45, casa 2, Jardim Excelsior";
  const soOTexto = await avaliarEntrega(DIVINOS as any, { endereco: ruaPerto, partes: robo.partesDoEnderecoDigitado(ruaPerto, "Cabo Frio") });
  conferir("(o mapa acha a rua com certeza: sozinha ela daria R$ 8)",
    soOTexto.resultado === "ATENDE" && soOTexto.taxa === 8 && !soOTexto.pedeConfirmacao && soOTexto.ponto?.origem === "mapa", soOTexto);
  const c3 = await cotacaoDaConversa(DIVINOS, conversa, ruaPerto);
  conferir("cotação: a taxa é a da localização (R$ 5), não a do meio da rua (R$ 8)", c3.veredito.taxa === 5 && c3.coords?.lat === casa.lat && !c3.trocouPeloTexto, c3.veredito);
  const g3 = await gravacao(DIVINOS, { address: ruaPerto, street: "Rua das Palmeiras", number: "45", neighborhood: "Jardim Excelsior" }, c3.estado.localizacao);
  conferir("gravação igual: R$ 5, ponto 'gps'", g3.veredito.taxa === 5 && g3.ponto?.origem === "gps", g3.ponto);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 3. O endereço digitado é achado LONGE, com certeza: outro lugar, vale o texto ==");
  zerar();
  ruas.set(chave4(casa), 900);
  const casaDaMae = aoSul(3.1, -0.004);
  ruas.set(chave4(casaDaMae), 3400);
  regrasDoMapa.push({ contem: "rua nova esperanca", resposta: [lugar(casaDaMae, { road: "Rua Nova Esperança", suburb: "Jardim Esperança", house_number: "45" })] });
  const outroLugar = "entrega na Rua Nova Esperança, 45 - Jardim Esperança, casa da minha mãe";
  const c4 = await cotacaoDaConversa(DIVINOS, conversa, outroLugar);
  conferir("cotação: vale o endereço digitado (3,4 km → R$ 17), e o robô é avisado da troca",
    c4.trocouPeloTexto && c4.coords === null && c4.veredito.taxa === 17 && c4.veredito.ponto?.origem === "mapa", { veredito: c4.veredito, trocou: c4.trocouPeloTexto });
  const g4 = await gravacao(DIVINOS, { address: "Rua Nova Esperança, 45 - Jardim Esperança", street: "Rua Nova Esperança", number: "45", neighborhood: "Jardim Esperança" }, c4.estado.localizacao);
  conferir("gravação: R$ 17 com o ponto do endereço (não o GPS de casa, R$ 5)", g4.veredito.taxa === 17 && g4.ponto?.origem === "mapa" && g4.ponto?.lat === casaDaMae.lat, g4.ponto);
  const mae = await cotacaoDaConversa(DIVINOS, conversa, "na verdade entrega no Jardim Esperança, 45, casa da minha mãe");
  conferir("'na verdade entrega no …': a localização é descartada pelo cliente", mae.estado.localizacao === null && mae.estado.descartadaPeloCliente === true, mae.estado);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 4. A LOJA sem ponto no mapa: não adianta pedir a localização do cliente ==");
  zerar();
  const semPonto = { ...DIVINOS, storeLatLng: null, storeAddress: null };
  const v5 = await avaliarEntrega(semPonto as any, { endereco: "Rua Inexistente, 30", coords: null });
  conferir("sem a localização: DESCONHECIDO pela loja, e o robô NÃO pede o 📎",
    v5.resultado === "DESCONHECIDO" && robo.faltaOPontoDaLoja(v5) && robo.motivoParaPedirLocalizacao(v5, false) === null, v5);
  const v5b = await avaliarEntrega(semPonto as any, { endereco: "", coords: casa });
  conferir("com a localização: o mesmo DESCONHECIDO (a localização não resolve)", v5b.resultado === "DESCONHECIDO" && robo.faltaOPontoDaLoja(v5b), v5b);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 5. Sem localização: a conversa e a gravação decidem IGUAL (R1) ==");
  zerar();
  const centroDoBairro = aoSul(1.3, 0.003);
  ruas.set(chave4(centroDoBairro), 1400);
  regrasDoMapa.push({ contem: "boca do mato", naoContem: "travessa", resposta: [lugar(centroDoBairro, { suburb: "Boca do Mato", classe: "place", tipo: "suburb", display: "Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil" })] });
  const textoAuditoria = "Travessa canaã, 6 - Boca do mato";
  const c6 = await cotacaoDaConversa(DIVINOS, [{ sender: "user", text: "quero 1 x-tudo" }, { sender: "bot", text: "Me passa a rua, o número e o bairro?" }], textoAuditoria);
  const g6 = await gravacao(DIVINOS, { address: textoAuditoria, street: "Travessa canaã", number: "6", neighborhood: "Boca do mato" }, null);
  conferir("conversa e gravação: mesmo resultado e mesma taxa",
    c6.veredito.resultado === g6.veredito.resultado && c6.veredito.taxa === g6.veredito.taxa, { conversa: c6.veredito, gravacao: g6.veredito });
  conferir("… pelo centro do bairro (aproximado): os dois pedem a localização uma vez (R3)",
    c6.pedirLocalizacao === "aproximado" && g6.pedirLocalizacao === "aproximado", { c: c6.pedirLocalizacao, g: g6.pedirLocalizacao });

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
