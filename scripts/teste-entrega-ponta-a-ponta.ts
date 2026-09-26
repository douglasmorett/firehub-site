/**
 * A ENTREGA DE PONTA A PONTA — a cotação que o cliente vê é a que o pedido
 * grava (integração dos clusters A, B, C e E, 25/09/2026).
 *
 *   npx tsx scripts/teste-entrega-ponta-a-ponta.ts
 *
 * Cada frente tem o seu teste. Este cobre as COSTURAS, que nenhum deles vê
 * sozinho, usando o código de verdade de cada lado:
 *
 *   1. a tela monta a consulta           (lib/entrega-no-checkout.ts — C)
 *   2. GET /api/delivery-fee responde     (a rota de verdade — A)
 *   3. a tela lê a resposta e monta o corpo do pedido (C)
 *   4. o pedido lê o token com a MESMA chaveDoEndereco, decide se recusa e
 *      o que grava                        (lib/entrega-do-pedido.ts — B)
 *   5. o robô avalia com partes e coordenadas e grava o ponto (E)
 *
 * O passo 4 repete, linha a linha, o que api/customer-order e
 * api/store/orders/presencial fazem com essas funções (as rotas inteiras
 * precisariam de banco). Se a rota mudar a ordem, mude aqui também.
 *
 * O caso que motivou tudo: Divinos Burger (Cabo Frio, ROTA), 25/09/2026 — a
 * cotação achou 0,84 km (R$ 5); 51 s depois o POST geocodificou de novo, o
 * mapa não respondeu, e o pedido saiu a R$ 12 sem distância nem ponto.
 *
 * Sem rede e sem banco: Prisma falso (globalThis.prisma), Nominatim e
 * roteador simulados no `fetch`, caches do banco em memória.
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

// ── O MUNDO SIMULADO ─────────────────────────────────────────────────────────

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
const LOJA_ID = "cmudbzcus0008ka010pmo1e0w";
const DIVINOS = {
  id: LOJA_ID,
  deliveryZoneType: "ROTA", deliveryZones: ZONAS_DIVINOS,
  deliveryConfig: { repasseDoEntregador: { separado: true, marketplace: "TABELA" } },
  storeLatLng: PINO_DA_LOJA, storeAddress: "Tv Liberdade 11, Vila Monte Alegre", city: "Cabo Frio",
};
(globalThis as any).prisma = {
  user: { findUnique: async ({ where }: any) => (where?.id === LOJA_ID ? DIVINOS : null) },
  $queryRawUnsafe: async () => { throw new Error("sem banco no teste"); },
  $executeRawUnsafe: async () => { throw new Error("sem banco no teste"); },
};

/**
 * Nominatim por regra: a primeira cujo trecho aparece na consulta (q= ou
 * "rua|cidade" da busca estruturada) responde. Sem regra: não achou.
 */
const regrasDoMapa: { contem: string; naoContem?: string; resposta: unknown[] }[] = [];
/** Roteador: metros de rua por destino (4 casas); "falha" = 503. */
const ruas = new Map<string, number | "falha">();
const chamadas = { nominatim: 0, osrm: 0 };

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
    chamadas.nominatim++;
    const u = new URL(url);
    const consulta = u.searchParams.get("q") != null
      ? norm(u.searchParams.get("q")!)
      : `${norm(u.searchParams.get("street") || "")}|${norm(u.searchParams.get("city") || "")}`;
    const regra = regrasDoMapa.find((r) => consulta.includes(r.contem) && (!r.naoContem || !consulta.includes(r.naoContem)));
    return json(regra ? regra.resposta : []);
  }
  if (url.includes("/route/v1/driving/")) {
    chamadas.osrm++;
    const m = url.match(/driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/)!;
    const metros = ruas.get(chave4({ lat: Number(m[4]), lng: Number(m[3]) }));
    if (metros === "falha") return json({ code: "Erro" }, 503);
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

  const { GET } = await import("../src/app/api/delivery-fee/route");
  const { NextRequest } = await import("next/server");
  const checkout = await import("../src/lib/entrega-no-checkout");
  const pedido = await import("../src/lib/entrega-do-pedido");
  const { avaliarEntrega, modoDaArea } = await import("../src/lib/area-de-entrega");
  const { lerRegraDeRepasse } = await import("../src/lib/repasse-do-entregador");
  const { lerPontoDaLoja } = await import("../src/lib/ponto-da-loja");
  const { lerPonto } = await import("../src/lib/distancia-da-entrega");
  const robo = await import("../src/lib/entrega-do-robo");

  let ip = 0;
  /** GET /api/delivery-fee de verdade, com a query que a tela montou. */
  async function cotar(query: string) {
    const res = await GET(new NextRequest(`http://localhost/api/delivery-fee?${query}`, { headers: { "x-forwarded-for": `10.1.0.${(ip++ % 250) + 1}` } }));
    return { status: res.status, corpo: (await res.json()) as any };
  }

  /**
   * O POST do SITE (api/customer-order), na mesma ordem da rota: coordenada
   * do corpo → cotação → senão avaliarEntrega com as mesmas peças → recusa do
   * site → campos gravados e notas.
   */
  async function postDoSite(corpo: any) {
    const coords = pedido.coordenadaDoCorpo(corpo.customerCoords, corpo.customerCoordsOrigem);
    const partes = {
      street: typeof corpo.customerStreet === "string" ? corpo.customerStreet : undefined,
      number: typeof corpo.customerNumber === "string" ? corpo.customerNumber : undefined,
      neighborhood: typeof corpo.customerNeighborhood === "string" ? corpo.customerNeighborhood : undefined,
      city: DIVINOS.city,
    };
    const modo = modoDaArea(DIVINOS);
    const antes = { ...chamadas };
    const cotacao = pedido.cotacaoDoPedido(corpo.cotacao, { loja: LOJA_ID, endereco: { ...partes, address: corpo.customerAddress }, coords });
    let entrega;
    if (cotacao) entrega = pedido.entregaDaCotacao(cotacao, modo, coords);
    else {
      const v = await avaliarEntrega(DIVINOS, {
        endereco: corpo.customerAddress,
        coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
        ...(coords ? { origemDasCoords: coords.origem === "pino" ? ("pino" as const) : ("gps" as const) } : {}),
        bairro: partes.neighborhood,
        partes,
      }).catch(() => null);
      entrega = pedido.entregaDoVeredicto(v, coords, modo);
    }
    const foiAoMapa = chamadas.nominatim + chamadas.osrm > antes.nominatim + antes.osrm;
    const recusa = pedido.recusaDoSite(entrega, { temCoordenadaDoCliente: coords != null, lojaTemPonto: lerPontoDaLoja(DIVINOS.storeLatLng) != null });
    if (recusa) return { status: recusa.status, recusa: recusa.corpo, entrega, foiAoMapa };
    return {
      status: 200, entrega, foiAoMapa,
      campos: pedido.camposDaEntrega(entrega, lerRegraDeRepasse(DIVINOS.deliveryConfig), DIVINOS.deliveryZones),
      notas: pedido.notasDaEntrega(entrega, { canal: "site" }),
    };
  }

  /** O POST do BALCÃO (api/store/orders/presencial), idem. */
  async function postDoBalcao(corpo: any) {
    const endereco = String(corpo.customerAddress || "").trim();
    const coords = pedido.coordenadaDoCorpo(corpo.customerCoords, corpo.customerCoordsOrigem);
    const partes = {
      street: typeof corpo.customerStreet === "string" ? corpo.customerStreet : undefined,
      number: typeof corpo.customerNumber === "string" ? corpo.customerNumber : undefined,
      neighborhood: typeof corpo.customerNeighborhood === "string" ? corpo.customerNeighborhood : undefined,
      city: DIVINOS.city,
    };
    const modo = modoDaArea(DIVINOS);
    const cotacao = pedido.cotacaoDoPedido(corpo.cotacao, { loja: LOJA_ID, endereco: { ...partes, address: endereco }, coords });
    let entrega;
    if (cotacao) entrega = pedido.entregaDaCotacao(cotacao, modo, coords);
    else {
      const v = await avaliarEntrega(DIVINOS, {
        endereco, coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
        bairro: partes.neighborhood,
        partes: partes.street || partes.number || partes.neighborhood ? partes : undefined,
      }).catch(() => null);
      entrega = pedido.entregaDoVeredicto(v, coords, modo);
    }
    const taxaCobrada = Math.max(0, Math.round((Number(corpo.deliveryFee) || 0) * 100) / 100);
    return {
      entrega,
      campos: pedido.camposDaEntrega(entrega, lerRegraDeRepasse(DIVINOS.deliveryConfig), DIVINOS.deliveryZones),
      notas: pedido.notasDaEntrega(entrega, { canal: "balcao", taxaCobrada }),
    };
  }

  /** O corpo que o CustomerStorePage monta no handleCheckout (só a parte de entrega). */
  function corpoDoSite(end: { street: string; number: string; neighborhood: string }, ponto: any, cotacao: string | null, complemento = "") {
    return {
      customerAddress: `${end.street.trim()}, ${end.number.trim()} - ${end.neighborhood.trim()}${complemento ? ` (${complemento})` : ""}`,
      ...checkout.entregaNoPedidoDoSite(ponto, cotacao),
      customerStreet: end.street || null,
      customerNumber: end.number || null,
      customerNeighborhood: end.neighborhood || null,
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 1. Site: o mapa acha a porta → token → o pedido cobra o que o cliente viu, SEM ir ao mapa (R1, R7) ==");
  zerar();
  const casa = aoSul(0.7, 0.0011);
  regrasDoMapa.push({ contem: "travessa canaa", resposta: [lugar(casa, { road: "Travessa Canaã", suburb: "Boca do Mato", house_number: "6" })] });
  ruas.set(chave4(casa), 840);
  const end1 = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" };
  const r1 = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end1, ponto: null }));
  conferir("cotação: 200, R$ 5 pela faixa de 1 km, 0,84 km pela rua, com token", r1.status === 200 && r1.corpo.fee === 5 && r1.corpo.faixaKm === 1 && r1.corpo.distanceKm === 0.84 && r1.corpo.medida === "rota" && typeof r1.corpo.cotacao === "string", r1.corpo);
  const tela1 = checkout.lerRespostaDaCotacao(r1.corpo, 5);
  conferir("a tela lê taxa, prazo e token; não pede o pino", tela1.taxa === 5 && tela1.tempoMin === 30 && tela1.cotacao === r1.corpo.cotacao && !tela1.pedeConfirmacao && !tela1.precisaConfirmarNoMapa, tela1);
  conferir("o painel mostra '0,84 km pela rua · chega em até ~30 min'", checkout.detalheDaEntrega(tela1) === "0,84 km pela rua · chega em até ~30 min", checkout.detalheDaEntrega(tela1));
  const falta1 = checkout.oQueFaltaParaFechar({
    calculando: false, cotadaPeloServidor: true, assinaturaCotada: checkout.assinaturaDaConsulta(end1, null), assinaturaAtual: checkout.assinaturaDaConsulta(end1, null),
    idadeDaCotacaoMs: 60_000, erro: false, calculada: true, disponivel: tela1.disponivel, precisaConfirmarNoMapa: tela1.precisaConfirmarNoMapa,
    pedeConfirmacao: tela1.pedeConfirmacao, temPontoDoCliente: false, freteGratis: false, mensagem: tela1.mensagem,
  });
  conferir("a tela deixa fechar", falta1 === null, falta1);
  // O cliente completa o complemento DEPOIS de ver a taxa: não pode perder a cotação.
  const p1 = await postDoSite(corpoDoSite(end1, null, tela1.cotacao, "apto 201"));
  conferir("o pedido aceita o token (complemento não muda a chave)", p1.status === 200 && p1.entrega.fonte === "cotacao", p1.entrega);
  conferir("… e não foi ao mapa de novo (a causa dos R$ 12)", p1.foiAoMapa === false);
  conferir("grava a distância, o ponto {lat,lng,origem,medida} e o repasse da mesma faixa",
    p1.campos?.deliveryDistance === 0.84 && p1.campos?.motoboyFee === 4 &&
    p1.campos?.customerLatLng?.lat === casa.lat && p1.campos?.customerLatLng?.origem === "mapa" && p1.campos?.customerLatLng?.medida === "rota", p1.campos);
  conferir("quem só lê {lat,lng} continua lendo o ponto gravado", JSON.stringify(lerPonto(p1.campos?.customerLatLng)) === JSON.stringify({ lat: casa.lat, lng: casa.lng }));
  conferir("sem nota de conferência (nada estimado nem aproximado)", p1.notas?.length === 0, p1.notas);
  conferir("a taxa do pedido é a da cotação", p1.entrega.taxa === 5);
  // Caixa, acento e espaços diferentes no corpo: a mesma normalização dos dois lados.
  const p1b = await postDoSite(corpoDoSite({ street: "  TRAVESSA CANAA ", number: "6", neighborhood: "boca do mato" }, null, tela1.cotacao));
  conferir("o pedido com caixa/acento/espaço diferentes ainda casa com a cotação", p1b.entrega.fonte === "cotacao" && p1b.foiAoMapa === false, p1b.entrega);
  // Número trocado depois da cotação: a tela recota; um corpo velho não usa o token.
  const end1b = { ...end1, number: "60" };
  conferir("número trocado: a tela manda recotar", checkout.oQueFaltaParaFechar({
    calculando: false, cotadaPeloServidor: true, assinaturaCotada: checkout.assinaturaDaConsulta(end1, null), assinaturaAtual: checkout.assinaturaDaConsulta(end1b, null),
    idadeDaCotacaoMs: 1000, erro: false, calculada: true, disponivel: true, precisaConfirmarNoMapa: false, pedeConfirmacao: false, temPontoDoCliente: false, freteGratis: false, mensagem: "",
  })?.acao === "recotar");
  const p1c = await postDoSite(corpoDoSite(end1b, null, tela1.cotacao));
  conferir("número trocado: o pedido não usa o token velho e reavalia no mapa", p1c.entrega.fonte === "avaliacao", p1c.entrega);
  const adulterado = String(tela1.cotacao).replace(/^./, (c) => (c === "a" ? "b" : "a"));
  const p1d = await postDoSite(corpoDoSite(end1, null, adulterado));
  conferir("token adulterado: não vale, reavalia", p1d.entrega.fonte === "avaliacao", p1d.entrega);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 2. Site: só o centro do bairro → taxa PELO BAIRRO, fecha sem o mapa, pedido marcado (25/09/2026) ==");
  // Até 25/09/2026 o centro do bairro pedia o pino (R3). O dono: "se o mapa achou
  // o bairro já sabe o valor da taxa... muito cliente não vai saber apontar no
  // mapa". Agora o bairro fecha a taxa, e o mapa fica como opção.
  zerar();
  const centro = aoSul(1.1, 0.004);
  regrasDoMapa.push({ contem: "rua do beco", resposta: [] });
  regrasDoMapa.push({ contem: "jardim esperanca", naoContem: "rua do beco", resposta: [lugar(centro, { suburb: "Jardim Esperança", classe: "place", tipo: "suburb", display: "Jardim Esperança, Cabo Frio, Rio de Janeiro, Brasil" })] });
  ruas.set(chave4(centro), 1300);
  const end2 = { street: "Rua do Beco", number: "7", neighborhood: "Jardim Esperança" };
  const r2 = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end2, ponto: null }));
  conferir("cotação: disponível PELO BAIRRO, sem pedir o pino, ponto 'bairro', R$ 8, COM token",
    r2.corpo.available === true && r2.corpo.peloBairro === true && r2.corpo.pedeConfirmacao === false && r2.corpo.ponto?.origem === "bairro" &&
    r2.corpo.fee === 8 && typeof r2.corpo.cotacao === "string" && /taxa é a do bairro Jardim Esperança/.test(r2.corpo.message), r2.corpo);
  const tela2 = checkout.lerRespostaDaCotacao(r2.corpo, 5);
  const painel2 = checkout.painelDaEntrega({
    bairroLocal: false, calculando: false, calculada: true, disponivel: tela2.disponivel, erro: false, taxaEfetiva: tela2.taxa ?? 0,
    freteGratisPorMinimo: false, precisaConfirmarNoMapa: tela2.precisaConfirmarNoMapa, pedeConfirmacao: tela2.pedeConfirmacao,
    podeConferirNoMapa: tela2.podeConferirNoMapa, temPontoDoCliente: false, distanciaKm: tela2.distanciaKm, medida: tela2.medida,
    tempoMin: tela2.tempoMin, mensagem: tela2.mensagem, peloBairro: tela2.peloBairro,
  });
  conferir("a tela mostra a taxa 'pelo bairro' (não 'pela rua'), a frase do servidor e o mapa só como opção",
    painel2.tom === "ok" && painel2.titulo === "Taxa de Entrega: R$ 8,00" && painel2.detalhe === "pelo bairro · chega em até ~35 min" &&
    /taxa é a do bairro/.test(painel2.mensagem) && painel2.botaoDoMapa === "opcional" && !painel2.botaoDoGps, { painel2, tela2 });
  const falta2 = checkout.oQueFaltaParaFechar({
    calculando: false, cotadaPeloServidor: true, assinaturaCotada: checkout.assinaturaDaConsulta(end2, null), assinaturaAtual: checkout.assinaturaDaConsulta(end2, null),
    idadeDaCotacaoMs: 1000, erro: false, calculada: true, disponivel: tela2.disponivel, precisaConfirmarNoMapa: tela2.precisaConfirmarNoMapa,
    pedeConfirmacao: tela2.pedeConfirmacao, temPontoDoCliente: false, freteGratis: false, mensagem: tela2.mensagem,
  });
  conferir("sem o pino a tela FECHA", falta2 === null, falta2);
  const p2 = await postDoSite(corpoDoSite(end2, null, tela2.cotacao));
  conferir("o pedido usa o token pelo bairro, sem ir ao mapa, e grava o ponto 'bairro'",
    p2.status === 200 && p2.entrega.fonte === "cotacao" && p2.entrega.peloBairro === true && !p2.entrega.pedeConfirmacao && p2.foiAoMapa === false &&
    p2.campos?.customerLatLng?.origem === "bairro", p2);
  conferir("a nota avisa a loja: taxa pelo bairro, confira o endereço", (p2.notas || []).some((n: string) => /Taxa pelo bairro/.test(n)), p2.notas);
  // Aba antiga (ou POST direto) sem token: reavalia e aceita pelo bairro do mesmo jeito.
  const p2x = await postDoSite(corpoDoSite(end2, null, null));
  conferir("POST sem token: reavalia e aceita pelo bairro (não pede mais o pino)",
    p2x.status === 200 && p2x.entrega.fonte === "avaliacao" && p2x.entrega.peloBairro === true && !p2x.recusa, p2x);

  // O bairro inteiro fica além do raio: pelo bairro é FORA, com o GPS de opção.
  const longe = aoSul(6.0, 0.004);
  regrasDoMapa.push({ contem: "rua sumida", resposta: [] });
  regrasDoMapa.push({ contem: "bairro distante", naoContem: "rua sumida", resposta: [lugar(longe, { suburb: "Bairro Distante", classe: "place", tipo: "suburb", display: "Bairro Distante, Cabo Frio, Rio de Janeiro, Brasil" })] });
  ruas.set(chave4(longe), 6500);
  const endLonge = { street: "Rua Sumida", number: "3", neighborhood: "Bairro Distante" };
  const r2f = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...endLonge, ponto: null }));
  conferir("bairro além do raio: FORA pelo bairro (não 'confirme no mapa'), com a frase do bairro",
    r2f.corpo.available === false && r2f.corpo.peloBairro === true && r2f.corpo.precisaConfirmarNoMapa === false && /O bairro Bairro Distante fica fora/.test(r2f.corpo.message), r2f.corpo);
  const tela2f = checkout.lerRespostaDaCotacao(r2f.corpo, 5);
  const painel2f = checkout.painelDaEntrega({
    bairroLocal: false, calculando: false, calculada: true, disponivel: tela2f.disponivel, erro: false, taxaEfetiva: 0,
    freteGratisPorMinimo: false, precisaConfirmarNoMapa: tela2f.precisaConfirmarNoMapa, pedeConfirmacao: tela2f.pedeConfirmacao,
    podeConferirNoMapa: tela2f.podeConferirNoMapa, temPontoDoCliente: false, distanciaKm: tela2f.distanciaKm, medida: tela2f.medida,
    tempoMin: null, mensagem: tela2f.mensagem, peloBairro: tela2f.peloBairro,
  });
  conferir("a tela diz 'fora' e oferece o GPS (quem mora na beirada mais perto)",
    painel2f.tom === "erro" && painel2f.titulo === "Fora da área de entrega" && painel2f.botaoDoGps, painel2f);

  // Quem quiser ainda ajusta no mapa: o pino decide, como sempre.
  const casa2 = aoSul(0.75, 0.0042);
  ruas.set(chave4(casa2), 960);
  const pino2 = { lat: casa2.lat, lng: casa2.lng, origem: "pino" as const };
  const r2b = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end2, ponto: pino2 }));
  conferir("cotação do pino: R$ 5, ponto 'pino', sem pedir confirmação, com token",
    r2b.corpo.fee === 5 && r2b.corpo.ponto?.origem === "pino" && r2b.corpo.pedeConfirmacao === false && typeof r2b.corpo.cotacao === "string", r2b.corpo);
  const tela2b = checkout.lerRespostaDaCotacao(r2b.corpo, 5);
  const p2b = await postDoSite(corpoDoSite(end2, pino2, tela2b.cotacao));
  conferir("o pedido com o pino usa o token do pino, sem mapa", p2b.status === 200 && p2b.entrega.fonte === "cotacao" && p2b.foiAoMapa === false, p2b);
  conferir("grava o ponto do PINO com a medida e o repasse da faixa de 1 km",
    p2b.campos?.customerLatLng?.origem === "pino" && p2b.campos?.customerLatLng?.lat === casa2.lat && p2b.campos?.customerLatLng?.medida === "rota" &&
    p2b.campos?.deliveryDistance === 0.96 && p2b.campos?.motoboyFee === 4, p2b.campos);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 3. Site: o mapa não acha nada → 'marque no mapa', nunca a faixa mais cara (R2) ==");
  zerar();
  const end3 = { street: "Rua Inexistente", number: "30", neighborhood: "Lugar Nenhum" };
  const r3 = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end3, ponto: null }));
  conferir("cotação: indisponível, precisaConfirmarNoMapa, taxa 0, sem token", r3.corpo.available === false && r3.corpo.precisaConfirmarNoMapa === true && r3.corpo.fee === 0 && !r3.corpo.cotacao, r3.corpo);
  const tela3 = checkout.lerRespostaDaCotacao(r3.corpo, 5);
  const painel3 = checkout.painelDaEntrega({
    bairroLocal: false, calculando: false, calculada: true, disponivel: tela3.disponivel, erro: false, taxaEfetiva: 0,
    freteGratisPorMinimo: false, precisaConfirmarNoMapa: tela3.precisaConfirmarNoMapa, pedeConfirmacao: false,
    podeConferirNoMapa: tela3.podeConferirNoMapa, temPontoDoCliente: false, distanciaKm: null, medida: null, tempoMin: null, mensagem: tela3.mensagem,
  });
  conferir("a tela oferece o GPS e o mapa como opção (não diz 'fora da área')", painel3.botaoDoGps && painel3.botaoDoMapa === "opcional" && !/fora/i.test(painel3.titulo), painel3);
  const p3 = await postDoSite(corpoDoSite(end3, null, null));
  conferir("POST sem ponto: 400 pedindo o mapa, nada de R$ 20", p3.status === 400 && p3.recusa?.precisaConfirmarNoMapa === true, p3.recusa);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 4. Site: GPS do aparelho → token com o ponto → pedido grava origem 'gps' ==");
  zerar();
  const gps = aoSul(1.8, 0.0061);
  ruas.set(chave4(gps), 2400);
  const end4 = { street: "Rua Beira Alta", number: "11", neighborhood: "Vila Monte Alegre" };
  const pontoGps = { lat: gps.lat, lng: gps.lng, origem: "gps" as const };
  const r4 = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end4, ponto: pontoGps }));
  conferir("cotação pelo GPS: R$ 12 (faixa de 2,5 km), com token", r4.corpo.fee === 12 && r4.corpo.faixaKm === 2.5 && typeof r4.corpo.cotacao === "string", r4.corpo);
  const p4 = await postDoSite(corpoDoSite(end4, pontoGps, checkout.lerRespostaDaCotacao(r4.corpo).cotacao));
  conferir("o pedido grava o ponto do GPS, 2,4 km pela rua, repasse R$ 11",
    p4.entrega.fonte === "cotacao" && p4.campos?.customerLatLng?.origem === "gps" && p4.campos?.deliveryDistance === 2.4 && p4.campos?.motoboyFee === 11, p4.campos);
  // O cliente arrastou o GPS para outro lugar e o corpo manda o ponto novo com o token velho.
  const p4b = await postDoSite(corpoDoSite(end4, { ...pontoGps, lat: gps.lat + 0.01 }, checkout.lerRespostaDaCotacao(r4.corpo).cotacao));
  conferir("ponto diferente do cotado: o token não vale, reavalia", p4b.entrega.fonte === "avaliacao", p4b.entrega);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 5. Balcão: a cotação do texto de uma linha volta no POST e grava a medida ==");
  zerar();
  const casa5 = aoSul(1.3, 0.0072);
  regrasDoMapa.push({ contem: "rua diamante", resposta: [lugar(casa5, { road: "Rua Diamante", suburb: "Monte Alegre", house_number: "19" })] });
  ruas.set(chave4(casa5), 1450);
  const texto5 = "Rua Diamante, 19 - Monte Alegre";
  // O balcão pergunta sem franchiseeId (a loja é a sessão); aqui a sessão é
  // trocada pelo id — a chave assinada é a mesma.
  const r5 = await cotar(`${checkout.consultaDoBalcao(texto5)}&franchiseeId=${LOJA_ID}`);
  const lida5 = checkout.lerCotacaoNoBalcao(r5.corpo);
  conferir("balcão: taxa R$ 8 preenchida, tom ok, com token", lida5.taxa === "8.00" && lida5.tom === "ok" && typeof lida5.cotacao === "string", { lida5, corpo: r5.corpo });
  const corpo5 = { customerAddress: texto5, deliveryFee: 8, ...checkout.entregaNoPedidoDoBalcao(texto5, lida5.cotacao ? { token: lida5.cotacao, endereco: texto5.trim() } : null, false) };
  const p5 = await postDoBalcao(corpo5);
  conferir("o POST do balcão aceita o token e grava 1,45 km, ponto e repasse R$ 7",
    p5.entrega.fonte === "cotacao" && p5.campos.deliveryDistance === 1.45 && p5.campos.motoboyFee === 7 && p5.campos.customerLatLng?.origem === "mapa", p5);
  conferir("taxa igual à tabela: sem nota", p5.notas.length === 0, p5.notas);
  const p5b = await postDoBalcao({ ...corpo5, deliveryFee: 0 });
  conferir("o atendente deu a entrega de graça: a nota diz o que a tabela dava", p5b.notas.some((n) => /combinada no balcão: R\$ 0,00 \(a tabela dá R\$ 8,00\)/.test(n)), p5b.notas);

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 6. Roteador fora: distância ESTIMADA declarada na tela, no token e na nota do pedido (R4, R7) ==");
  zerar();
  const casa6 = aoSul(1.0, 0.0093);
  regrasDoMapa.push({ contem: "rua das gaivotas", resposta: [lugar(casa6, { road: "Rua das Gaivotas", suburb: "Braga", house_number: "40" })] });
  ruas.set(chave4(casa6), "falha");
  const end6 = { street: "Rua das Gaivotas", number: "40", neighborhood: "Braga" };
  const r6 = await cotar(checkout.consultaDaCotacao({ franchiseeId: LOJA_ID, cidade: "Cabo Frio", ...end6, ponto: null }));
  conferir("cotação: medida 'estimada' (linha reta × 1,4 sem histórico), com token", r6.corpo.medida === "estimada" && r6.corpo.available === true && typeof r6.corpo.cotacao === "string", r6.corpo);
  const tela6 = checkout.lerRespostaDaCotacao(r6.corpo);
  conferir("a tela diz '(distância estimada)'", /distância estimada/.test(checkout.detalheDaEntrega(tela6)), checkout.detalheDaEntrega(tela6));
  const p6 = await postDoSite(corpoDoSite(end6, null, tela6.cotacao));
  conferir("o pedido grava medida 'estimada' no ponto e a nota de conferência",
    p6.entrega.fonte === "cotacao" && p6.campos?.customerLatLng?.medida === "estimada" && (p6.notas || []).some((n) => /Distância estimada/.test(n)), { campos: p6.campos, notas: p6.notas });

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n== 7. Robô: localização do WhatsApp + partes da tag → avaliarEntrega → ponto gravado ==");
  zerar();
  const loc = aoSul(0.6, 0.0013);
  ruas.set(chave4(loc), 700);
  const partes7 = robo.partesDoEnderecoDaTag({ street: "Rua Um", number: "5", neighborhood: "Centro", city: "Cabo Frio" });
  const v7 = await avaliarEntrega(DIVINOS, { endereco: "Rua Um, 5 - Centro", bairro: "Centro", coords: loc, partes: partes7 });
  conferir("com a localização: ATENDE R$ 5, ponto 'gps', sem pedir confirmação", v7.resultado === "ATENDE" && v7.taxa === 5 && v7.ponto?.origem === "gps" && !v7.pedeConfirmacao, v7);
  const ponto7 = robo.pontoParaGravar(v7, loc);
  conferir("o robô grava {lat,lng,origem:'gps',medida:'rota'}", ponto7?.origem === "gps" && ponto7?.medida === "rota" && ponto7?.lat === loc.lat, ponto7);
  conferir("… e não pede a localização de novo", robo.motivoParaPedirLocalizacao(v7, true) === null);
  regrasDoMapa.push({ contem: "jardim esperanca", resposta: [lugar(centro, { suburb: "Jardim Esperança", classe: "place", tipo: "suburb", display: "Jardim Esperança, Cabo Frio, Rio de Janeiro, Brasil" })] });
  ruas.set(chave4(centro), 1300);
  const v7b = await avaliarEntrega(DIVINOS, { endereco: "Jardim Esperança", bairro: "Jardim Esperança", coords: null, partes: robo.partesDoEnderecoDaTag({ neighborhood: "Jardim Esperança" }) });
  conferir("só o bairro no texto: o robô NÃO pede a localização — a taxa é a do bairro",
    robo.motivoParaPedirLocalizacao(v7b, false) === null && v7b.peloBairro === true && v7b.taxa === 8, v7b);
  conferir("… e a nota do pedido avisa a loja", robo.avisosDaEntregaNaNota(v7b, false).some((a: string) => /taxa pelo bairro/.test(a)), robo.avisosDaEntregaNaNota(v7b, false));
  const v7c = await avaliarEntrega(DIVINOS, { endereco: "Rua Inexistente, 30 - Lugar Nenhum", coords: null });
  conferir("mapa não achou: o robô pede a localização ('desconhecido'), sem taxa", robo.motivoParaPedirLocalizacao(v7c, false) === "desconhecido" && v7c.taxa === null, v7c);

  console.log(`\n${ok} ok, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
