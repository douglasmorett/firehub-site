/**
 * Trava o relatório "Vendas por área de entrega" (lib/relatorios/areas-de-entrega.ts):
 * a área sai da MESMA régua da taxa (raio, bairro, área desenhada, área de
 * risco), o bairro sai do texto de cada canal como ele chega de verdade, e o
 * que não é entrega não entra.
 *
 *   npx tsx scripts/teste-areas-de-entrega.ts
 *
 * Os endereços são cópias dos que estavam no banco em 24/09/2026 (NIK, Hakim,
 * Frangoso, Supimpa): cada canal escreve de um jeito, e é aí que o bairro se
 * perde.
 */
import {
  areaDoPedido, bairroAchadoNoTexto, bairroDoEndereco, chaveDeGrupo, chaveDoBairro, configDaLoja, vendasPorArea,
  type LinhaDaArea, type LojaParaAreas, type PedidoParaAreas,
} from "../src/lib/relatorios/areas-de-entrega";
import { naLoja } from "../src/lib/relatorios/base";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── 1. O BAIRRO ESCRITO NO ENDEREÇO, CANAL A CANAL ──────────────────────────
console.log("\n— bairro do texto —");
const ifood = { cidades: ["BRASILIA"], ultimaParteEhCidade: true };
confere("iFood: bairro antes da cidade, depois de Comp e Ref",
  bairroDoEndereco("Q 11 Cl, 10 - Comp: Apartamento 102 - Ref: Em Cima Da Academia Multy Forças - Sobradinho - Brasília", ifood), "Sobradinho");
confere("iFood: referência com hífen no meio não vira bairro",
  bairroDoEndereco("Q. 2 Conjunto D4, 39 - Comp: Casa Branca de esquina - Ref: Rua em - Sobradinho - Brasília", ifood), "Sobradinho");
confere("iFood sem bairro (veio dentro da rua): null, não o complemento",
  bairroDoEndereco("Sh Mansões Sobradinho Q 52 conjunto B, 20 - Comp: Condominio verde vale - Brasília", ifood), null);
confere("iFood de outra cidade (Hakim Unamar entregando em Cabo Frio): a cidade do fim não é bairro",
  bairroDoEndereco("Rua A, 10 - Comp: Casa - Tamoios - Cabo Frio", { cidades: ["Unamar"], ultimaParteEhCidade: true }), "Tamoios");
confere("Wabiz: CEP e cidade/UF fora",
  bairroDoEndereco("SES quadra 13, 20 - Empresa Rezgatte - DNOKS - Brasília/DF - CEP 73040134", { cidades: ["BRASILIA"] }), "DNOKS");
confere("Wabiz: rodovia \"DF - 425\" é um nome só",
  bairroDoEndereco("Condominio Vivendas Serrana, 1 - Módulo X casa 01 - DF - 425 - Brasília/DF - CEP 73092900", { cidades: ["BRASILIA"] }), "DF-425");
confere("99Food: \"Bairro, Cidade - UF\"",
  bairroDoEndereco("Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ", { cidades: ["RIO DAS OSTRAS"] }), "Liberdade");
confere("99Food: complemento depois da UF",
  bairroDoEndereco("Estrada Vereador Luiz Carlos Silva, 500 - Galo Branco, São Gonçalo - RJ, bloco 10 ap 303", { cidades: ["SAO GONCALO"] }), "Galo Branco");
confere("99Food: a \"cidade\" da 99 em Brasília é a região administrativa",
  bairroDoEndereco("ar 6, cj 3 LT 1 - Sobradinho II, Sobradinho - DF, apartamento em cima da conveniência do Dudu", { cidades: ["BRASILIA"] }), "Sobradinho II");
confere("Site: complemento entre parênteses",
  bairroDoEndereco("Rua das casuarinas, 20 - Âncora (Apartamento 201)", { cidades: ["Rio das Ostras"] }), "Âncora");
confere("Robô do WhatsApp: tudo com vírgula",
  bairroDoEndereco("Rua Paranaíba, 470, Operário, Rio das Ostras", { cidades: ["Rio das Ostras"] }), "Operário");
confere("JotaJá: bairro no fim da rua, cidade repetida",
  bairroDoEndereco("Rua da Fonte, 512, Portão marrom, Nova Cidade - Rio das Ostras - Brasil - Rio das Ostras", { cidades: ["Rio das Ostras"], ultimaParteEhCidade: true }), "Nova Cidade");
confere("Brendi: complemento antes do bairro",
  bairroDoEndereco("Avenida Rui de Albuquerque, 1052 - bloco 8,102 - Planalto - Montes Claros", { cidades: ["MONTES CLAROS"], ultimaParteEhCidade: true }), "Planalto");
confere("Brendi: lixo no nome (\"Belvedere ||\")",
  bairroDoEndereco("Rua O, 173 - Belvedere || - Montes Claros", { cidades: ["MONTES CLAROS"], ultimaParteEhCidade: true }), "Belvedere");
confere("Balcão com texto solto (\"quadra 1\"): não chuta", bairroDoEndereco("quadra 1", { cidades: ["BRASILIA"] }), null);
confere("Endereço vazio", bairroDoEndereco("", {}), null);
confere("\"Sobradinho II\" (iFood) e \"SOBRADINHO 2\" (Wabiz) são o mesmo bairro", chaveDoBairro("Sobradinho II"), chaveDoBairro("SOBRADINHO 2"));
confere("\"Quadra 02\" e \"QUADRA 2\" são a mesma quadra", chaveDoBairro("Quadra 02"), chaveDoBairro("QUADRA 2"));
confere("\"Conjunto I\" não vira \"Conjunto 1\" (só II em diante)", chaveDoBairro("Conjunto I"), "conjunto i");
confere("\"JardimBelaVista\" e \"Jardim Bela Vista\" (site da Hakim Centro) juntam", chaveDeGrupo("JardimBelaVista"), chaveDeGrupo("Jardim Bela Vista"));
confere("\"Quadra 11\" e \"Quadra 1\" não juntam", chaveDeGrupo("Quadra 11") === chaveDeGrupo("Quadra 1"), false);
confere("\"St. Oeste\" e \"Setor Oeste\" (iFood da NIK, semanas seguidas) juntam", chaveDeGrupo("St. Oeste"), chaveDeGrupo("Setor Oeste"));
confere("\"Jd. Mariléa\" e \"Jardim Marilea\" juntam", chaveDeGrupo("Jd. Mariléa"), chaveDeGrupo("Jardim Marilea"));

// ── 2. A ÁREA PELA REGRA DA TAXA ────────────────────────────────────────────
const LOJA = { lat: -22.5, lng: -41.9 };
const KM_POR_GRAU = 111.19;
const aoNorte = (km: number) => ({ lat: LOJA.lat + km / KM_POR_GRAU, lng: LOJA.lng });
const quadrado = (lat: number, lng: number, d: number): [number, number][] => [
  [lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d],
];

let seq = 0;
const pedido = (x: Partial<PedidoParaAreas> & { franchiseeId: string }): PedidoParaAreas => ({
  id: `p${++seq}`, status: "ENTREGUE", totalAmount: 50, deliveryType: "DELIVERY", source: "ONLINE", deliveryFee: 5, ...x,
});

console.log("\n— raio em km —");
const lojaKm: LojaParaAreas = {
  id: "km", nome: "Loja Raio", city: "Rio das Ostras", storeLatLng: LOJA, deliveryZoneType: "KM",
  deliveryZones: [{ km: 4, fee: 8, time: 50 }, { km: 2, fee: 5, time: 40 }],
  deliveryConfig: { areasDeRisco: [{ nome: "Morro", pontos: quadrado(aoNorte(3).lat, LOJA.lng + 0.02, 0.003) }] },
};
const cfgKm = configDaLoja(lojaKm);
const areaKm = (x: Partial<PedidoParaAreas>) => {
  const a = areaDoPedido(pedido({ franchiseeId: "km", ...x }), cfgKm);
  return { nome: a.nome, situacao: a.situacao, taxa: a.taxaDaArea, aproximado: a.aproximado };
};
confere("1 km pelo ponto → Até 2 km, taxa da faixa", areaKm({ customerLatLng: aoNorte(1) }), { nome: "Até 2 km", situacao: "AREA", taxa: 5, aproximado: false });
confere("3 km pelo ponto → 2 a 4 km", areaKm({ customerLatLng: aoNorte(3) }), { nome: "2 a 4 km", situacao: "AREA", taxa: 8, aproximado: false });
confere("4,03 km: dentro dos 50 m de tolerância da taxa", areaKm({ customerLatLng: aoNorte(4.03) }).nome, "2 a 4 km");
confere("6 km: fora do raio, agrupado pelo bairro do texto",
  areaKm({ customerLatLng: aoNorte(6), customerAddress: "Rua X, 10 - Mar do Norte" }), { nome: "Mar do Norte", situacao: "FORA", taxa: null, aproximado: false });
confere("ponto já em JSON-texto (como veio de backup) também vale",
  areaKm({ customerLatLng: JSON.stringify(aoNorte(1)) }).nome, "Até 2 km");
confere("sem ponto, com a distância gravada na venda → faixa, marcado aproximado",
  areaKm({ deliveryDistance: 1.5, customerAddress: "Rua Y, 1 - Centro" }), { nome: "Até 2 km", situacao: "AREA", taxa: 5, aproximado: true });
confere("sem ponto e sem distância → bairro do texto, \"sem ponto no mapa\"",
  areaKm({ customerAddress: "Rua Y, 1 - Centro" }), { nome: "Centro", situacao: "SEM_PONTO", taxa: null, aproximado: false });
confere("sem nada → Sem endereço identificado", areaKm({ customerAddress: null }).nome, "Sem endereço identificado");
confere("distância absurda (homônimo a 552 km) não decide", areaKm({ deliveryDistance: 552, customerAddress: "Rua Juriti, 3 - Centro" }).situacao, "SEM_PONTO");
confere("ponto na área de risco vence o raio", areaKm({ customerLatLng: { lat: aoNorte(3).lat, lng: LOJA.lng + 0.02 } }), { nome: "Morro", situacao: "RISCO", taxa: null, aproximado: false });

const lojaRota: LojaParaAreas = { ...lojaKm, id: "rota", deliveryZoneType: "ROTA", deliveryConfig: {} };
confere("loja por ROTA: 1,5 km em linha reta, 2,6 km pelas ruas (gravado) → faixa das ruas",
  areaDoPedido(pedido({ franchiseeId: "rota", customerLatLng: aoNorte(1.5), deliveryDistance: 2.6 }), configDaLoja(lojaRota)).nome, "2 a 4 km");
confere("loja por RAIO: a mesma entrega fica na linha reta",
  areaDoPedido(pedido({ franchiseeId: "km", customerLatLng: aoNorte(1.5), deliveryDistance: 2.6 }), cfgKm).nome, "Até 2 km");

console.log("\n— bairros cadastrados —");
const lojaBairro: LojaParaAreas = {
  id: "bairro", nome: "Loja Bairro", city: "Macaé", storeLatLng: LOJA, deliveryZoneType: "NEIGHBORHOOD",
  deliveryZones: [{ name: "Centro", fee: 5, time: 40 }, { name: "Centro Norte", fee: 7, time: 45 }, { name: "Cavaleiros", fee: 9, time: 50 }],
};
const cfgBairro = configDaLoja(lojaBairro);
const areaB = (endereco: string, extra: Partial<PedidoParaAreas> = {}) => {
  const a = areaDoPedido(pedido({ franchiseeId: "bairro", customerAddress: endereco, ...extra }), cfgBairro);
  return [a.nome, a.situacao, a.taxaDaArea];
};
confere("\"Centro Norte\" não vira \"Centro\"", areaB("Rua A, 1 - Centro Norte"), ["Centro Norte", "AREA", 7]);
confere("\"Centro\"", areaB("Rua B, 2 - Centro"), ["Centro", "AREA", 5]);
confere("bairro com outra grafia casa pelo cadastro (acento/caixa)", areaB("Rua B, 2 - Comp: casa - CENTRO - Macaé", { source: "IFOOD", ifoodOrderId: "x" }), ["Centro", "AREA", 5]);
confere("bairro não cadastrado → fora, pelo texto", areaB("Rua C, 3 - Jardim Aeroporto"), ["Jardim Aeroporto", "FORA", null]);
confere("com ponto, loja por bairro: decide o texto (bairro não tem geometria)", areaB("Rua C, 3 - Cavaleiros", { customerLatLng: aoNorte(1) }), ["Cavaleiros", "AREA", 9]);
// Delicias de Casa, 24/09/2026: o iFood manda "Costazul" para o "Costa Azul" cadastrado.
const lojaCosta: LojaParaAreas = { ...lojaBairro, id: "costa", deliveryZones: [{ name: "Costa Azul", fee: 4 }] };
confere("\"Costazul\" (iFood) é o \"Costa Azul\" cadastrado, não \"fora\"",
  (({ nome, situacao }) => [nome, situacao])(areaDoPedido(pedido({ franchiseeId: "costa", source: "IFOOD", ifoodOrderId: "i", customerAddress: "Rua A, 1 - Costazul - Rio das Ostras" }), configDaLoja(lojaCosta))),
  ["Costa Azul", "AREA"]);

console.log("\n— área desenhada —");
const lojaDesenho: LojaParaAreas = {
  id: "desenho", nome: "Loja Desenho", city: "Nova Iguaçu", storeLatLng: LOJA, deliveryZoneType: "POLIGONO",
  deliveryZones: [
    { nome: "Centro", pontos: quadrado(LOJA.lat, LOJA.lng, 0.01), fee: 6, time: 40 },
    { nome: "Anel Largo", pontos: quadrado(LOJA.lat, LOJA.lng, 0.03), fee: 4, time: 50 },
  ],
};
const cfgDesenho = configDaLoja(lojaDesenho);
const areaD = (x: Partial<PedidoParaAreas>) => {
  const a = areaDoPedido(pedido({ franchiseeId: "desenho", ...x }), cfgDesenho);
  return [a.nome, a.situacao, a.taxaDaArea, a.aproximado];
};
confere("dentro das duas: vale a de MENOR taxa (a regra da taxa)", areaD({ customerLatLng: LOJA }), ["Anel Largo", "AREA", 4, false]);
confere("fora de todas → fora, pelo bairro do texto", areaD({ customerLatLng: aoNorte(10), customerAddress: "Rua Z, 5 - Austin" }), ["Austin", "FORA", null, false]);
confere("sem ponto, bairro com o nome de um contorno → aproximado", areaD({ customerAddress: "Rua Z, 5 - Centro" }), ["Centro", "AREA", 6, true]);
confere("sem ponto, bairro sem contorno → sem ponto no mapa", areaD({ customerAddress: "Rua Z, 5 - Austin" }), ["Austin", "SEM_PONTO", null, false]);
confere("fora pelo ponto e sem bairro no texto: continua FORA (não vira \"sem endereço\")",
  areaD({ customerLatLng: aoNorte(10), customerAddress: "Rua Manoel Ribeiro Marinho, 98" }), ["Fora das áreas (sem bairro no endereço)", "FORA", null, false]);
confere("o (-23, -44) da 99 não é ponto: cai no texto",
  areaD({ customerLatLng: { lat: -23, lng: -44 }, customerAddress: "Rua Carlos Laert, 144 - Vila Nova, Nova Iguaçu - RJ", source: "99FOOD" }), ["Vila Nova", "SEM_PONTO", null, false]);

// ── 3. O RELATÓRIO INTEIRO: O QUE ENTRA E O QUE NÃO ENTRA ───────────────────
console.log("\n— o que entra —");
const NIK: LojaParaAreas = { id: "nik", nome: "NIK", city: "BRASILIA", storeLatLng: null, deliveryZones: null, deliveryZoneType: null };
const IFOOD = { source: "IFOOD", ifoodOrderId: "if", deliveryBy: "MERCHANT" };
const PEDIDOS: PedidoParaAreas[] = [
  // iFood, entrega própria, bairro "Sobradinho II".
  pedido({ id: "a1", franchiseeId: "nik", ...IFOOD, totalAmount: 60, deliveryFee: 7, deliveryDistance: 2, customerAddress: "Ar 9 Conjunto 8, 30 - Sobradinho II - Brasília" }),
  // Wabiz grita "SOBRADINHO 2": mesmo bairro. Pagamento dividido não muda nada.
  pedido({ id: "a2", franchiseeId: "nik", source: "WABIZ", totalAmount: 40, deliveryFee: 5, customerAddress: "Ar 11 Conjunto 2, 18 - Casa - SOBRADINHO 2 - Brasília/DF - CEP 73060202" }),
  pedido({ id: "a3", franchiseeId: "nik", source: "WABIZ", totalAmount: 20, deliveryFee: 0, customerAddress: "Qr 4 conjunto i, 27 - SOBRADINHO 2 - Brasília/DF - CEP 73061295", paymentMethods: [{ method: "Pix", amount: 10 }, { method: "Dinheiro", amount: 10 }] } as any),
  // Madrugada: 01:30 de 18/09 no relógio da loja (04:30 UTC) é do dia 17 — o
  // corte do período é da rota; a conta não joga fora pedido pela hora.
  pedido({ id: "a4", franchiseeId: "nik", ...IFOOD, totalAmount: 30, deliveryFee: 7, customerAddress: "Q 8, 47 - Sobradinho - Brasília", createdAt: new Date("2026-09-18T04:30:00Z") } as any),
  // Acréscimo do a4 (a Coca pedida por telefone): soma o valor, não a entrega.
  pedido({ id: "a5", franchiseeId: "nik", source: "PRESENCIAL", parentOrderId: "a4", totalAmount: 10, deliveryFee: 0, customerAddress: "Q 8, 47 - Sobradinho - Brasília" }),
  // Acréscimo cujo pai não está na lista: vira pedido próprio.
  pedido({ id: "a6", franchiseeId: "nik", source: "PRESENCIAL", parentOrderId: "fora-da-lista", totalAmount: 12, deliveryFee: 0, customerAddress: "Rua P, 1 - Sobradinho" }),
  // Cancelado: não soma venda, mas conta na área.
  pedido({ id: "c1", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 99, customerAddress: "Q 8, 47 - Sobradinho - Brasília" }),
  // Esperando pagamento e rascunho do robô: nada.
  pedido({ id: "c2", franchiseeId: "nik", status: "AGUARDANDO_PAGAMENTO", totalAmount: 77, customerAddress: "Rua K - Sobradinho" }),
  pedido({ id: "c3", franchiseeId: "nik", status: "CRIANDO_IA", totalAmount: 77, customerAddress: "Rua K - Sobradinho" }),
  // Entrega do parceiro: iFood mandou o entregador dele; 99 idem.
  pedido({ id: "e1", franchiseeId: "nik", source: "IFOOD", ifoodOrderId: "if2", deliveryBy: "IFOOD", totalAmount: 45, deliveryFee: 6, customerAddress: "Q 11, 3 - Sobradinho - Brasília" }),
  pedido({ id: "e2", franchiseeId: "nik", source: "99FOOD", deliveryBy: "99FOOD", totalAmount: 35, deliveryFee: 0, customerAddress: "q 11 cj a, 56 - Sobradinho, Sobradinho - DF, lote 56" }),
  // Sem endereço.
  pedido({ id: "s1", franchiseeId: "nik", source: "PRESENCIAL", totalAmount: 25, deliveryFee: 5, customerAddress: "" }),
  // Retirada do site: linha à parte.
  pedido({ id: "r1", franchiseeId: "nik", source: "ONLINE", deliveryType: "RETIRADA", totalAmount: 33, deliveryFee: 0 }),
  // Balcão (PRESENCIAL + RETIRADA é balcão, não retirada), mesa e totem: fora.
  pedido({ id: "b1", franchiseeId: "nik", source: "PRESENCIAL", deliveryType: "RETIRADA", totalAmount: 1000 }),
  pedido({ id: "m1", franchiseeId: "nik", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "t1", totalAmount: 1000 }),
  // Mesa com deliveryType DELIVERY (lançamento torto): a sessão de mesa manda.
  pedido({ id: "m2", franchiseeId: "nik", source: "PRESENCIAL", deliveryType: "DELIVERY", tableSessionId: "t2", totalAmount: 1000, customerAddress: "Rua M - Sobradinho" }),
  pedido({ id: "t1", franchiseeId: "nik", source: "TOTEM", deliveryType: "RETIRADA", totemLicenseId: "tt", totalAmount: 1000 }),
];
const ANTERIOR: PedidoParaAreas[] = [
  pedido({ id: "x1", franchiseeId: "nik", ...IFOOD, totalAmount: 50, customerAddress: "Q 1, 2 - Sobradinho II - Brasília" }),
  pedido({ id: "x2", franchiseeId: "nik", ...IFOOD, totalAmount: 50, customerAddress: "Q 1, 2 - Sobradinho II - Brasília" }),
  pedido({ id: "x3", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 50, customerAddress: "Q 1, 2 - Sobradinho II - Brasília" }),
  // Um bairro que pediu antes e parou: não tem linha agora, mas tem que fechar a conta.
  pedido({ id: "x4", franchiseeId: "nik", ...IFOOD, totalAmount: 70, customerAddress: "Q 3, 4 - Vila Rabelo - Brasília" }),
  pedido({ id: "x5", franchiseeId: "nik", source: "IFOOD", ifoodOrderId: "if9", deliveryBy: "IFOOD", totalAmount: 30, customerAddress: "Q 3, 5 - Sobradinho - Brasília" }),
];

confere("madrugada: 01:30 do dia 18 é o dia operacional 17", naLoja(new Date("2026-09-18T04:30:00Z"), "America/Sao_Paulo").dia, "2026-09-17");

const r = vendasPorArea(PEDIDOS, [NIK], { anteriores: ANTERIOR, incluirRetirada: true });
const linha = (lista: LinhaDaArea[], nome: string) => lista.find((l) => l.nome === nome);
// A grafia que mais aparece dá o nome (2 × "SOBRADINHO 2" contra 1 × "Sobradinho II"),
// e o que veio todo em maiúscula é escrito como gente.
const sob2 = linha(r.linhas, "Sobradinho 2");
confere("iFood \"Sobradinho II\" + Wabiz \"SOBRADINHO 2\" numa linha só, com o nome mais comum", sob2 && [sob2.pedidos, sob2.valor], [3, 120]);
confere("a linha é \"bairro do endereço\" (loja sem área cadastrada, sem marca de fora)", sob2?.situacao, "BAIRRO");
confere("ticket médio e taxa média por entrega (a3 sem taxa conta como zero)", sob2 && [sob2.ticketMedio, sob2.taxaMedia, sob2.semTaxa], [40, 4, 1]);
confere("distância média só de quem tem distância", sob2 && [sob2.distanciaMedia, sob2.comDistancia], [2, 1]);
confere("canais da área", sob2?.canais, [{ nome: "Wabiz", pedidos: 2 }, { nome: "iFood", pedidos: 1 }]);
confere("comparação: 2 pedidos / R$ 100 no período anterior (o cancelado de lá não conta)", sob2?.anterior, { pedidos: 2, valor: 100 });

const sob = linha(r.linhas, "Sobradinho");
confere("Sobradinho: a4 + acréscimo a5 = 1 entrega de R$ 40; a6 (pai fora da lista) = outra entrega", sob && [sob.pedidos, sob.valor], [2, 52]);
confere("o cancelado conta na área, fora da venda", sob && [sob.cancelados, sob.valorCancelado], [1, 99]);

const sem = linha(r.linhas, "Sem endereço identificado");
confere("sem endereço: linha própria", sem && [sem.pedidos, sem.valor, sem.situacao], [1, 25, "SEM_ENDERECO"]);
confere("\"Sem endereço identificado\" vai para o fim", r.linhas[r.linhas.length - 1].nome, "Sem endereço identificado");

confere("entrega do parceiro separada, pelo parceiro", r.parceiro.map((l) => [l.parceiro, l.nome, l.pedidos, l.valor]), [["iFood", "Sobradinho", 1, 45], ["99Food", "Sobradinho", 1, 35]]);
confere("total de entregas = loja + parceiro; mesa, balcão, totem, retirada e intenções fora",
  [r.total.pedidos, r.total.valor, r.propria.pedidos, r.doParceiro.pedidos], [8, 277, 6, 2]);
confere("% pelo valor soma 100 nas duas tabelas", Math.round([...r.linhas, ...r.parceiro].reduce((s, l) => s + l.pct, 0)), 100);
confere("retirada à parte (só a do site; o balcão não é retirada)", r.retirada, { pedidos: 1, valor: 33, ticketMedio: 33 });
confere("sem retirada no filtro de tipo → sem a linha", vendasPorArea(PEDIDOS, [NIK]).retirada, null);
confere("total do período anterior, separado em loja e parceiro",
  r.anterior && [r.anterior.pedidos, r.anterior.valor, r.anterior.propria, r.anterior.doParceiro], [4, 200, { pedidos: 3, valor: 170 }, { pedidos: 1, valor: 30 }]);
confere("o bairro que parou de pedir aparece em \"pararam\" (e fecha a conta do anterior)",
  r.anterior?.pararam.map((a) => [a.nome, a.pedidos, a.valor]), [["Vila Rabelo", 1, 70]]);
confere("linhas + pararam = anterior da loja",
  r.linhas.reduce((s, l) => s + (l.anterior?.pedidos || 0), 0) + (r.anterior?.pararam.filter((a) => a.situacao !== "PARCEIRO").reduce((s, a) => s + a.pedidos, 0) || 0), r.anterior?.propria.pedidos);
confere("cancelados no total", [r.total.cancelados, r.total.valorCancelado], [1, 99]);
confere("% pela quantidade", vendasPorArea(PEDIDOS, [NIK], { pctPor: "pedidos" }).linhas.find((l) => l.nome === "Sobradinho 2")?.pct, 37.5);
confere("a loja sem área aparece como tal", r.cadastroDasLojas, [{ id: "nik", nome: "NIK", modo: "SEM_AREA", rotuloDoModo: "sem área cadastrada", areasCadastradas: 0, temPontoDaLoja: false }]);

console.log("\n— bairro achado no meio do texto —");
// O iFood tira o bairro quando ele já está no nome da rua (NIK, 17 a 23/09/2026).
const vistos = ["Sobradinho", "SOBRADINHO 2", "QUADRA 5"].map((nome) => ({ nome, chave: chaveDoBairro(nome) }));
confere("\"Sh Mansões Sobradinho Ar 1…\" → Sobradinho", bairroAchadoNoTexto("Sh Mansões Sobradinho Ar 1 Conjunto 4, casa 17 - Brasília", vistos), "Sobradinho");
confere("o mais longo vence (\"Sobradinho 2\" antes de \"Sobradinho\")", bairroAchadoNoTexto("Terminal de Sobradinho 2, 0 - Brasília", vistos), "SOBRADINHO 2");
confere("balcão \"quadra 05\" é a QUADRA 5 da Wabiz", bairroAchadoNoTexto("quadra 05", vistos), "QUADRA 5");
confere("palavra inteira: \"quadra 15\" não é a quadra 5", bairroAchadoNoTexto("quadra 15", vistos), null);
const rv = vendasPorArea([
  pedido({ id: "v1", franchiseeId: "nik", ...IFOOD, totalAmount: 30, customerAddress: "Q 8, 47 - Sobradinho - Brasília" }),
  pedido({ id: "v2", franchiseeId: "nik", ...IFOOD, totalAmount: 20, customerAddress: "Sh Mansões Sobradinho Ar 1 Conjunto 4, casa 17 - Brasília" }),
], [NIK]);
confere("no relatório: o pedido sem bairro entra em Sobradinho, contado como deduzido", rv.linhas.map((l) => [l.nome, l.pedidos, l.aproximados]), [["Sobradinho", 2, 1]]);
// Numeral romano no MEIO do endereço (revisão de 24/09/2026): a chave só
// trocava "II" por "2" na última palavra, e o texto inteiro não casava com o
// "Sobradinho II" já visto. O mais curto ganhava.
const vistosII = ["Sobradinho", "Sobradinho II"].map((nome) => ({ nome, chave: chaveDoBairro(nome) }));
confere("\"Ar 13 Sobradinho II Conjunto 5…\" → Sobradinho II (romano no meio do texto)",
  bairroAchadoNoTexto("Ar 13 Sobradinho II Conjunto 5, casa 3 - Brasília", vistosII), "Sobradinho II");
// Ragnar Burger: 27 endereços "Cidade Nova <romano>" em 400 dias.
const vistosCN = ["Cidade Nova", "Cidade Nova 6"].map((nome) => ({ nome, chave: chaveDoBairro(nome) }));
confere("\"Tv. We 77 Cidade Nova VI, 762\" → Cidade Nova 6, não Cidade Nova",
  bairroAchadoNoTexto("Tv. We 77 Cidade Nova VI, 762 - Ananindeua", vistosCN), "Cidade Nova 6");
confere("romano no meio do nome também junta (\"Setor II Norte\" = \"Setor 2 Norte\")", chaveDoBairro("Setor II Norte"), chaveDoBairro("Setor 2 Norte"));
confere("a primeira palavra não vira número (\"Vi\" sozinho não é seis)", chaveDoBairro("Vi Rio"), "vi rio");
const RAGNAR: LojaParaAreas = { id: "rag", nome: "Ragnar", city: "Ananindeua", storeLatLng: null, deliveryZones: null, deliveryZoneType: null };
const rcn = vendasPorArea([
  pedido({ franchiseeId: "rag", ...IFOOD, totalAmount: 30, customerAddress: "Rua A, 1 - Cidade Nova 6 - Ananindeua" }),
  pedido({ franchiseeId: "rag", ...IFOOD, totalAmount: 20, customerAddress: "Tv. We 77 Cidade Nova VI, 762 - Ananindeua" }),
  pedido({ franchiseeId: "rag", ...IFOOD, totalAmount: 10, customerAddress: "Rua B, 2 - Cidade Nova - Ananindeua" }),
], [RAGNAR]);
confere("no relatório: o \"Cidade Nova VI\" da rua cai na linha \"Cidade Nova 6\", deduzido",
  rcn.linhas.map((l) => [l.nome, l.pedidos, l.aproximados]), [["Cidade Nova 6", 2, 1], ["Cidade Nova", 1, 0]]);

confere("rodovia continua em maiúscula no nome", vendasPorArea([
  pedido({ franchiseeId: "nik", source: "WABIZ", customerAddress: "Condominio Vivendas Serrana, 1 - Módulo X casa 01 - DF - 425 - Brasília/DF - CEP 73092900" }),
], [NIK]).linhas[0].nome, "DF-425");

console.log("\n— áreas cadastradas sem pedido e várias lojas —");
const rk = vendasPorArea([
  pedido({ franchiseeId: "km", customerLatLng: aoNorte(1), totalAmount: 30 }),
  pedido({ franchiseeId: "bairro", customerAddress: "Rua A, 1 - Centro", totalAmount: 20 }),
  pedido({ franchiseeId: "km", customerAddress: "Rua A, 1 - Centro", totalAmount: 10 }),
], [lojaKm, lojaBairro]);
confere("a faixa sem pedido aparece zerada (e no fim)", rk.linhas.filter((l) => l.lojaId === "km" && l.situacao === "AREA").map((l) => [l.nome, l.pedidos, l.taxaDaArea]), [["Até 2 km", 1, 5], ["2 a 4 km", 0, 8]]);
confere("os bairros cadastrados sem pedido também", rk.linhas.filter((l) => l.lojaId === "bairro" && l.pedidos === 0).map((l) => l.nome).sort(), ["Cavaleiros", "Centro Norte"]);
confere("\"Centro\" de duas lojas são duas linhas", rk.linhas.filter((l) => l.nome === "Centro").map((l) => [l.loja, l.situacao]), [["Loja Bairro", "AREA"], ["Loja Raio", "SEM_PONTO"]]);
confere("linhas zeradas depois das com venda", rk.linhas.slice(-3).every((l) => l.pedidos === 0), true);
const ro = vendasPorArea([
  pedido({ franchiseeId: "nik", status: "CANCELADO", totalAmount: 80, customerAddress: "Rua A, 1 - Vila Só Cancelou" }),
  pedido({ franchiseeId: "nik", totalAmount: 10, customerAddress: "" }),
  pedido({ franchiseeId: "nik", totalAmount: 20, customerAddress: "Rua B, 2 - Vendeu" }),
], [NIK]);
confere("ordem: com venda → sem endereço → só cancelamento", ro.linhas.map((l) => l.nome), ["Vendeu", "Sem endereço identificado", "Vila Só Cancelou"]);

console.log("\n— acréscimo cancelado —");
// Revisão de 24/09/2026: o acréscimo cancelado ia direto para a área como
// OUTRA entrega cancelada — pedido e acréscimo cancelados davam "2 cancelados"
// para uma viagem só.
const END = "Q 8, 47 - Sobradinho - Brasília";
const cancelDe = (lista: PedidoParaAreas[]) => {
  const r = vendasPorArea(lista, [NIK]);
  return { linhas: r.linhas.map((l) => [l.nome, l.pedidos, l.valor, l.cancelados, l.valorCancelado]), cancelados: r.total.cancelados, valorCancelado: r.total.valorCancelado };
};
confere("pedido de R$ 60 e acréscimo de R$ 10, os dois cancelados: 1 cancelado, R$ 70",
  cancelDe([
    pedido({ id: "cp1", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 60, customerAddress: END }),
    pedido({ id: "cf1", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 10, parentOrderId: "cp1", customerAddress: END }),
  ]),
  { linhas: [["Sobradinho", 0, 0, 1, 70]], cancelados: 1, valorCancelado: 70 });
confere("o acréscimo cancelado ANTES do pai na lista vai para o pai do mesmo jeito",
  cancelDe([
    pedido({ id: "cf2", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 10, parentOrderId: "cp2", customerAddress: END }),
    pedido({ id: "cp2", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 60, customerAddress: END }),
  ]).cancelados, 1);
confere("pedido entregue com o acréscimo cancelado: 1 entrega, 0 entrega cancelada, R$ 10 cancelados na área",
  cancelDe([
    pedido({ id: "cp3", franchiseeId: "nik", ...IFOOD, totalAmount: 60, customerAddress: END }),
    pedido({ id: "cf3", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 10, parentOrderId: "cp3", customerAddress: END }),
  ]),
  { linhas: [["Sobradinho", 1, 60, 0, 10]], cancelados: 0, valorCancelado: 10 });
confere("acréscimo cancelado sem o pai na lista: é o cancelamento daquele endereço (conta 1)",
  cancelDe([pedido({ id: "cf4", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 10, parentOrderId: "fora-da-lista", customerAddress: END })]),
  { linhas: [["Sobradinho", 0, 0, 1, 10]], cancelados: 1, valorCancelado: 10 });
confere("acréscimo vendido de pai cancelado continua contando como entrega (foi o que chegou lá)",
  cancelDe([
    pedido({ id: "cp5", franchiseeId: "nik", ...IFOOD, status: "CANCELADO", totalAmount: 60, customerAddress: END }),
    pedido({ id: "cf5", franchiseeId: "nik", ...IFOOD, totalAmount: 10, parentOrderId: "cp5", customerAddress: END }),
  ]),
  { linhas: [["Sobradinho", 1, 10, 1, 60]], cancelados: 1, valorCancelado: 60 });

console.log("\n— % dos totais —");
// Revisão de 24/09/2026: a planilha escrevia 100% fixo no TOTAL, e o período
// sem entrega saía "0 pedidos, R$ 0, 100%" logo abaixo do subtotal com 0%.
const rVazio = vendasPorArea([], [NIK], { incluirRetirada: true });
confere("período sem entrega: total, loja e parceiro com 0%", [rVazio.total.pct, rVazio.propria.pct, rVazio.doParceiro.pct], [0, 0, 0]);
const rSoRetirada = vendasPorArea([pedido({ franchiseeId: "nik", source: "ONLINE", deliveryType: "RETIRADA", totalAmount: 33 })], [NIK], { incluirRetirada: true });
confere("só retirada (fora do 100%): o total de entregas continua 0%", [rSoRetirada.total.pedidos, rSoRetirada.total.pct], [0, 0]);
confere("com entrega: total 100%, e loja + parceiro fecham 100", [r.total.pct, Math.round(r.propria.pct + r.doParceiro.pct)], [100, 100]);
confere("o % da loja é a soma das linhas dela (a menos do arredondamento de cada linha)",
  Math.abs(r.propria.pct - r.linhas.reduce((s, l) => s + l.pct, 0)) < 0.05, true);

if (falhas) {
  console.log(`\n${falhas} falha(s).`);
  process.exit(1);
}
console.log("\nTudo certo.");
