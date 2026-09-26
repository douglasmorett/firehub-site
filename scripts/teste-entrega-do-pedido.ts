/**
 * scripts/teste-entrega-do-pedido.ts — o que o PEDIDO faz com a entrega
 * (cluster B da entrega por km, 25/09/2026).
 *
 * Prova, sem banco e sem rede:
 *   R1  a cotação assinada vira o resultado do pedido (mesma loja, mesmo
 *       endereço, dentro da validade) — e o que NÃO serve cai na reavaliação;
 *   R2  em KM/ROTA "não sei" é recusado no site com o pino, nunca vira faixa
 *       mais cara; R3  ponto aproximado pede confirmação, coordenada do
 *       cliente não;
 *   R5  a regra das faixas (limite inclusivo, 0,01 km, folga de 50 m só na
 *       última, sem km mínimo);
 *   R6  repasse por faixa: faixa sem valor NÃO pega o da vizinha, 0 ≠ null,
 *       distância 0 vale;
 *   R7  o que o pedido grava (distância, ponto {lat,lng,origem,medida},
 *       repasse, notas);
 *   R10 a conta da correção de taxa (cortesia não mexe no repasse de quem
 *       rodou; pagamento dividido e o aviso de devolução);
 *   o cron: repasse só em pedido recente, ponto longe da loja apagado;
 *   e o acerto do entregador (lib/ganho-do-entregador.ts) com zero gravado.
 *
 * A loja SEM pino não é exceção do R2/R3 (achado da revisão): só a loja cujo
 * ponto é desconhecido de todo segue pela 1ª faixa.
 *
 *   npx tsx scripts/teste-entrega-do-pedido.ts
 *
 * Caso real usado nas contas: a tabela da Divinos Burger (Cabo Frio, modo
 * ROTA) — km de rua, taxa ao cliente • repasse ao motoboy.
 */
process.env.COTACAO_SECRET = "segredo-de-teste-do-pedido";

import { assinarCotacao, chaveDoEndereco, VALIDADE_DA_COTACAO_MS } from "../src/lib/cotacao-de-entrega";
import {
  ajusteDaTaxa,
  camposDaEntrega,
  chavesDoPedido,
  coordenadaDoCorpo,
  cotacaoDoPedido,
  distanciaNaFraseDeFora,
  distanciaParaGravar,
  entregaDaCotacao,
  entregaDoVeredicto,
  faixaDaDistancia,
  faixasDaLoja,
  geocodificacaoAchou,
  notasDaEntrega,
  origemDaGeocodificacao,
  pontoDaLojaDesconhecido,
  pontoDeEnchimento,
  pontoParaGravar,
  raioDaLojaParaOCorte,
  recusaDoSite,
  repasseDaEntrega,
  repasseQueOCronCompleta,
  REPASSE_DO_CRON_ATE_HORAS,
  taxaDaLojaSemPonto,
  avisoDaDiferencaDeTotal,
  descarteDoPontoGravado,
} from "../src/lib/entrega-do-pedido";
import { validarDivisao } from "../src/lib/pagamento-dividido";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  faixaDaTaxa,
  faixasSemRepasse,
  repasseDaFaixaKm,
  repasseDaZona,
  repasseDoPedido,
  temRepassePorFaixa,
  type RegraDeRepasse,
} from "../src/lib/repasse-do-entregador";
import { ganhoDoPedido, lerAcerto } from "../src/lib/ganho-do-entregador";
import { lerPonto } from "../src/lib/ponto-da-loja";
import type { VeredictoDeEntrega } from "../src/lib/area-de-entrega";

let ok = 0;
let falhas = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok    ${nome}`); return; }
  falhas++;
  console.log(`  FALHA ${nome}${detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`);
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A tabela real da Divinos: 1 km R$5•4; 1,5 R$8•7; 2 R$10•9; 2,5 R$12•11;
// 3 R$15•14; 3,5 R$17•16; 4 R$18•17; 4,5 R$19•18; 5 R$20•19.
const DIVINOS = [
  { km: 1, fee: 5, time: 30, motoboyFee: 4 },
  { km: 1.5, fee: 8, time: 30, motoboyFee: 7 },
  { km: 2, fee: 10, time: 35, motoboyFee: 9 },
  { km: 2.5, fee: 12, time: 35, motoboyFee: 11 },
  { km: 3, fee: 15, time: 40, motoboyFee: 14 },
  { km: 3.5, fee: 17, time: 40, motoboyFee: 16 },
  { km: 4, fee: 18, time: 45, motoboyFee: 17 },
  { km: 4.5, fee: 19, time: 45, motoboyFee: 18 },
  { km: 5, fee: 20, time: 50, motoboyFee: 19 },
];
// Embaralhada de propósito: a ordem do cadastro não pode decidir a faixa.
const DIVINOS_FORA_DE_ORDEM = [DIVINOS[4], DIVINOS[0], DIVINOS[8], DIVINOS[2], DIVINOS[1], DIVINOS[7], DIVINOS[3], DIVINOS[6], DIVINOS[5]];
const SEPARADO: RegraDeRepasse = { separado: true, marketplace: "TABELA", valorFixoApp: null };
const JUNTO: RegraDeRepasse = { separado: false, marketplace: "TABELA", valorFixoApp: null };
const LOJA = "cmudbzcus0008ka010pmo1e0w";

// ───────────────────────────────────────────────────────────────────────────
console.log("\n1) R6 — repasse por faixa (lib/repasse-do-entregador.ts)");
conferir("0 km é entrega e cai na 1ª faixa (R$ 4)", repasseDaFaixaKm(DIVINOS, 0) === 4, repasseDaFaixaKm(DIVINOS, 0));
conferir("0,84 km (Boca do Mato) → R$ 4", repasseDaFaixaKm(DIVINOS, 0.84) === 4);
conferir("1,00 km é da faixa de 1 km (limite inclusivo)", repasseDaFaixaKm(DIVINOS, 1) === 4);
conferir("1.005 m arredonda para 1,00 km → faixa de 1 km", repasseDaFaixaKm(DIVINOS, 1.005) === 4);
conferir("1,01 km já é a faixa de 1,5 km (R$ 7)", repasseDaFaixaKm(DIVINOS, 1.01) === 7);
conferir("4,99 km → faixa de 5 km (R$ 19)", repasseDaFaixaKm(DIVINOS, 4.99) === 19);
conferir("além da última vale a última", repasseDaFaixaKm(DIVINOS, 12) === 19);
conferir("ordem do cadastro não importa", repasseDaFaixaKm(DIVINOS_FORA_DE_ORDEM, 1.8) === 9);
conferir("sem distância não há faixa", repasseDaFaixaKm(DIVINOS, null) === null && repasseDaFaixaKm(DIVINOS, undefined) === null);
conferir("distância negativa ou lixo não é faixa", repasseDaFaixaKm(DIVINOS, -1) === null && repasseDaFaixaKm(DIVINOS, NaN) === null);

const SEM_A_DE_2KM = DIVINOS.map((z) => (z.km === 2 ? { km: 2, fee: 10, time: 35 } : z));
conferir("FAIXA SEM VALOR NÃO PEGA A VIZINHA: 1,8 km na faixa de 2 km vazia → null (não R$ 11)",
  repasseDaFaixaKm(SEM_A_DE_2KM, 1.8) === null, repasseDaFaixaKm(SEM_A_DE_2KM, 1.8));
conferir("…e as outras faixas continuam respondendo", repasseDaFaixaKm(SEM_A_DE_2KM, 2.2) === 11);
conferir("motoboyFee vazio (\"\") é sem valor", repasseDaFaixaKm(DIVINOS.map((z) => (z.km === 1 ? { ...z, motoboyFee: "" } : z)), 0.5) === null);

const PRIMEIRA_ZERO = DIVINOS.map((z) => (z.km === 1 ? { ...z, motoboyFee: 0 } : z));
conferir("repasse ZERO é resposta (faixa de 1 km a R$ 0)", repasseDaFaixaKm(PRIMEIRA_ZERO, 0.5) === 0);
conferir("repasseDaZona: 0 é 0, \"0\" é 0", repasseDaZona({ motoboyFee: 0 }) === 0 && repasseDaZona({ motoboyFee: "0" }) === 0);
conferir("repasseDaZona: vazio, espaço, nulo, negativo e texto são null",
  [repasseDaZona({ motoboyFee: "" }), repasseDaZona({ motoboyFee: "  " }), repasseDaZona({ motoboyFee: null }),
    repasseDaZona({}), repasseDaZona({ motoboyFee: -2 }), repasseDaZona({ motoboyFee: "quatro" })].every((v) => v === null));
conferir("nenhuma faixa com repasse → null", repasseDaFaixaKm([{ km: 1, fee: 5 }, { km: 3, fee: 8 }], 0.5) === null);
conferir("deliveryZones em TEXTO (JSON serializado) também é lido", repasseDaFaixaKm(JSON.stringify(DIVINOS), 2.3) === 11);
conferir("faixasSemRepasse aponta a faixa de 2 km", igual(faixasSemRepasse(SEM_A_DE_2KM), [2]));
conferir("faixasSemRepasse vazio quando todas têm valor (zero conta)", igual(faixasSemRepasse(PRIMEIRA_ZERO), []));
conferir("temRepassePorFaixa: separado + faixa com valor", temRepassePorFaixa({ repasseDoEntregador: { separado: true } }, DIVINOS) === true);
conferir("temRepassePorFaixa: não separado → false", temRepassePorFaixa({ repasseDoEntregador: { separado: false } }, DIVINOS) === false);
conferir("temRepassePorFaixa: separado sem valor em faixa nenhuma → false",
  temRepassePorFaixa({ repasseDoEntregador: { separado: true } }, [{ km: 1, fee: 5 }]) === false);
conferir("faixaDaTaxa: R$ 5 é a faixa de 1 km (repasse 4)", igual(faixaDaTaxa(DIVINOS, 5), { km: 1, repasse: 4 }));
conferir("faixaDaTaxa: R$ 7 não é faixa nenhuma", faixaDaTaxa(DIVINOS, 7) === null);
conferir("faixaDaTaxa: duas faixas com a mesma taxa e repasses diferentes é ambíguo",
  faixaDaTaxa([{ km: 1, fee: 5, motoboyFee: 4 }, { km: 2, fee: 5, motoboyFee: 3 }], 5) === null);
conferir("repasseDoPedido (loja separada) segue a faixa", repasseDoPedido({ regra: SEPARADO, zonas: DIVINOS, km: 3.2 }) === 16);
conferir("repasseDoPedido (loja NÃO separada) não responde", repasseDoPedido({ regra: JUNTO, zonas: DIVINOS, km: 3.2 }) === null);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n2) R5 — a faixa da distância (sugestão da correção)");
conferir("1,00 km → faixa de 1 km", faixaDaDistancia(DIVINOS, 1)?.km === 1);
conferir("1.005 m → faixa de 1 km", faixaDaDistancia(DIVINOS, 1.005)?.km === 1);
conferir("1,01 km → faixa de 1,5 km (R$ 8)", faixaDaDistancia(DIVINOS, 1.01)?.taxa === 8);
conferir("0 km → primeira faixa (sem km mínimo)", faixaDaDistancia(DIVINOS, 0)?.km === 1);
conferir("5,05 km ainda atende pela última (folga de 50 m)", faixaDaDistancia(DIVINOS, 5.05)?.km === 5);
conferir("5,06 km é FORA", faixaDaDistancia(DIVINOS, 5.06) === null);
conferir("sem distância → null", faixaDaDistancia(DIVINOS, null) === null);
conferir("faixasDaLoja em ordem, com taxa, repasse e tempo",
  igual(faixasDaLoja(DIVINOS_FORA_DE_ORDEM).slice(0, 2), [
    { km: 1, taxa: 5, repasse: 4, tempoMin: 30 },
    { km: 1.5, taxa: 8, repasse: 7, tempoMin: 30 },
  ]));
conferir("distanciaParaGravar: 0 vale, negativo e > 60 km não", distanciaParaGravar(0) === 0 && distanciaParaGravar(-0.1) === null && distanciaParaGravar(61) === null && distanciaParaGravar("2.345") === 2.35);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n3) Coordenada do corpo e ponto de enchimento (R8)");
const gps = coordenadaDoCorpo({ lat: -22.851812, lng: -42.035301 });
conferir("GPS válido passa, origem gps", igual(gps, { lat: -22.851812, lng: -42.035301, origem: "gps" }));
conferir("pino informado vira origem pino",
  coordenadaDoCorpo({ lat: -22.851812, lng: -42.035301, origem: "pino" })?.origem === "pino" &&
  coordenadaDoCorpo({ lat: -22.851812, lng: -42.035301 }, "pino")?.origem === "pino");
conferir("(-23,-43) do 99Food é recusado", coordenadaDoCorpo({ lat: -23, lng: -43 }) === null);
conferir("(0,0) é recusado", coordenadaDoCorpo({ lat: 0, lng: 0 }) === null);
conferir("fora da faixa válida é recusado", coordenadaDoCorpo({ lat: -122.85, lng: -42.03 }) === null);
conferir("lixo é recusado", coordenadaDoCorpo({ lat: "abc", lng: 1 }) === null && coordenadaDoCorpo(null) === null && coordenadaDoCorpo("x") === null);
conferir("pontoDeEnchimento: inteiros", pontoDeEnchimento({ lat: -23, lng: -42 }) === true);
conferir("pontoDeEnchimento: duas casas nos dois", pontoDeEnchimento({ lat: -22.85, lng: -42.03 }) === true);
conferir("pontoDeEnchimento: um só com 2 casas é ponto real", pontoDeEnchimento({ lat: -22.85, lng: -42.0296526 }) === false);
conferir("pontoDeEnchimento: um grau inteiro cravado não é GPS", pontoDeEnchimento({ lat: -23, lng: -42.0296526 }) === true);
conferir("pontoDeEnchimento: GPS de verdade", pontoDeEnchimento({ lat: -22.854033, lng: -42.0296526 }) === false);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n4) R1 — a cotação assinada vira o resultado do pedido");
const agora = 1_800_000_000_000;
const enderecoDaCotacao = { street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" };
// O /api/delivery-fee assina com as peças que recebeu (e o texto livre, que
// só conta quando não há peças).
const chaveDaCotacao = chaveDoEndereco({ ...enderecoDaCotacao, address: "Travessa Canaã 6, Boca do Mato, CABO FRIO" });
const cotacaoBase = {
  loja: LOJA, chave: chaveDaCotacao, lat: -22.8518, lng: -42.0353, origemDoPonto: "mapa" as const,
  distanciaKm: 0.84, medida: "rota" as const, faixaKm: 1, taxa: 5, taxaDoEntregador: 4, tempoMin: 30,
};
const token = assinarCotacao(cotacaoBase, agora);
// O pedido manda o endereço completo formatado de outro jeito, com complemento.
const doPedido = { ...enderecoDaCotacao, address: "Travessa Canaã, 6 - Boca do Mato (casa 2, portão azul)" };
const lida = cotacaoDoPedido(token, { loja: LOJA, endereco: doPedido, coords: null }, agora + 60_000);
conferir("mesma loja e mesmo endereço (complemento diferente) → usa a cotação", !!lida && lida.taxa === 5 && lida.distanciaKm === 0.84);
conferir("caixa e acento não mudam o endereço",
  !!cotacaoDoPedido(token, { loja: LOJA, endereco: { street: "TRAVESSA CANAA", number: "6", neighborhood: "boca do mato" }, coords: null }, agora));
conferir("número diferente → não usa (reavalia)",
  cotacaoDoPedido(token, { loja: LOJA, endereco: { ...enderecoDaCotacao, number: "60" }, coords: null }, agora) === null);
conferir("outra loja → não usa", cotacaoDoPedido(token, { loja: "outra", endereco: doPedido, coords: null }, agora) === null);
conferir("vencida → não usa", cotacaoDoPedido(token, { loja: LOJA, endereco: doPedido, coords: null }, agora + VALIDADE_DA_COTACAO_MS + 1) === null);
conferir("sem token / token lixo → não usa",
  cotacaoDoPedido(undefined, { loja: LOJA, endereco: doPedido, coords: null }, agora) === null &&
  cotacaoDoPedido("abc.def", { loja: LOJA, endereco: doPedido, coords: null }, agora) === null);
{
  const [corpo, ass] = token.split(".");
  const mexido = JSON.parse(Buffer.from(corpo, "base64url").toString());
  mexido.taxa = 0;
  const forjado = Buffer.from(JSON.stringify(mexido)).toString("base64url") + "." + ass;
  conferir("taxa adulterada no token → não usa", cotacaoDoPedido(forjado, { loja: LOJA, endereco: doPedido, coords: null }, agora) === null);
}
conferir("cotação do TEXTO não vale para pedido que trouxe o pino (o pino é melhor)",
  cotacaoDoPedido(token, { loja: LOJA, endereco: doPedido, coords: gps }, agora) === null);
{
  // Pino confirmado: o checkout cota só com lat/lng; o pedido traz as peças
  // do endereço E o ponto. A chave "só o ponto" casa.
  const pino = { lat: -22.8531234, lng: -42.0311234, origem: "pino" as const };
  const tokenDoPino = assinarCotacao({
    ...cotacaoBase, chave: chaveDoEndereco({ lat: pino.lat, lng: pino.lng }), lat: pino.lat, lng: pino.lng,
    origemDoPonto: "pino", distanciaKm: 0.41,
  }, agora);
  const doPino = cotacaoDoPedido(tokenDoPino, { loja: LOJA, endereco: doPedido, coords: pino }, agora);
  conferir("cotação do pino casa com o pedido que traz peças + o mesmo ponto", !!doPino && doPino.distanciaKm === 0.41);
  conferir("…e com o ponto arrastado 1 m (a chave arredonda a ~11 m)",
    !!cotacaoDoPedido(tokenDoPino, { loja: LOJA, endereco: doPedido, coords: { ...pino, lat: pino.lat + 0.000004 } }, agora));
  conferir("…mas não com o pino em outro lugar",
    cotacaoDoPedido(tokenDoPino, { loja: LOJA, endereco: doPedido, coords: { ...pino, lat: pino.lat + 0.01 } }, agora) === null);
  conferir("chavesDoPedido: com ponto são duas chaves, sem ponto uma",
    chavesDoPedido(doPedido, pino).length === 2 && chavesDoPedido(doPedido, null).length === 1);
  // Balcão: cota com o texto do endereço; o pedido manda o mesmo texto.
  const tokenBalcao = assinarCotacao({ ...cotacaoBase, chave: chaveDoEndereco({ address: "Rua Beira Alta, 100 - Monte Alegre" }) }, agora);
  conferir("balcão: mesmo texto (com espaço sobrando) casa",
    !!cotacaoDoPedido(tokenBalcao, { loja: LOJA, endereco: { address: "  Rua Beira Alta, 100 - Monte Alegre " }, coords: null }, agora));
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n5) R7 — o que a cotação deixa gravado no pedido");
const daCotacao = entregaDaCotacao(lida!, "KM", null);
conferir("resultado ATENDE com a taxa da cotação", daCotacao.resultado === "ATENDE" && daCotacao.taxa === 5 && daCotacao.fonte === "cotacao");
const gravadoDaCotacao = camposDaEntrega(daCotacao, SEPARADO, DIVINOS);
conferir("grava distância, ponto {lat,lng,origem,medida} e repasse",
  igual(gravadoDaCotacao, { deliveryDistance: 0.84, customerLatLng: { lat: -22.8518, lng: -42.0353, origem: "mapa", medida: "rota" }, motoboyFee: 4 }),
  gravadoDaCotacao);
conferir("quem lê {lat,lng} (ponto-da-loja.ts) continua lendo o ponto gravado",
  igual(lerPonto(gravadoDaCotacao.customerLatLng), { lat: -22.8518, lng: -42.0353 }));
conferir("loja que NÃO separa: repasse não é gravado", camposDaEntrega(daCotacao, JUNTO, DIVINOS).motoboyFee === null);
conferir("com o pino no pedido, o ponto gravado é o do cliente (origem pino)",
  entregaDaCotacao(lida!, "KM", { lat: -22.8518, lng: -42.0353, origem: "pino" }).ponto?.origem === "pino");
{
  const semRepasseNoToken = entregaDaCotacao({ ...lida!, taxaDoEntregador: null, distanciaKm: 1.8, faixaKm: 2 }, "KM", null);
  conferir("token sem repasse: acha pela faixa (faixa de 2 km → R$ 9)", repasseDaEntrega(semRepasseNoToken, SEPARADO, DIVINOS) === 9);
  conferir("token sem repasse e faixa vazia: null (R6)", repasseDaEntrega(semRepasseNoToken, SEPARADO, SEM_A_DE_2KM) === null);
  conferir("repasse ZERO do token é gravado como zero",
    repasseDaEntrega(entregaDaCotacao({ ...lida!, taxaDoEntregador: 0 }, "KM", null), SEPARADO, DIVINOS) === 0);
  conferir("distância 0 é gravada como 0 (não some)",
    camposDaEntrega(entregaDaCotacao({ ...lida!, distanciaKm: 0 }, "KM", null), SEPARADO, DIVINOS).deliveryDistance === 0);
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n6) R2/R3 — quando o site recusa");
const veredicto = (v: Partial<VeredictoDeEntrega>): VeredictoDeEntrega =>
  ({ modo: "KM", resultado: "ATENDE", taxa: 5, tempoMin: 30, motivo: "teste", ...v }) as VeredictoDeEntrega;
const COM_PINO_DA_LOJA = { temCoordenadaDoCliente: false, lojaTemPonto: true };

const naoSei = entregaDoVeredicto(veredicto({ resultado: "DESCONHECIDO", taxa: null, motivo: "endereço não localizado no mapa" }), null);
const r1 = recusaDoSite(naoSei, COM_PINO_DA_LOJA);
conferir("KM/ROTA sem ponto → recusa e pede o pino (nunca 'faixa mais cara')",
  r1?.status === 400 && r1.corpo.precisaConfirmarNoMapa === true, r1);
{
  // A LOJA SEM PINO (mas com o endereço dela achado) não é mais exceção: o
  // checkout abre o mapa no palpite ou no GPS do cliente. Achado da revisão:
  // "não sei" virava a faixa mais cara (R$ 20) nessas lojas.
  const SEM_PINO_DA_LOJA = { temCoordenadaDoCliente: false, lojaTemPonto: false };
  const rs = recusaDoSite(naoSei, SEM_PINO_DA_LOJA);
  conferir("KM/ROTA com a loja SEM pino e sem palpite → recusa, pede o GPS (não aceita pela faixa mais cara)",
    rs?.status === 400 && rs.corpo.precisaConfirmarNoMapa === true && rs.corpo.pedirGps === true &&
    /Usar minha localização atual \(GPS\)/.test(rs.corpo.error), rs);
  const naoSeiComPalpite = entregaDoVeredicto(veredicto({
    resultado: "DESCONHECIDO", taxa: null, distanciaKm: 5.4, pedeConfirmacao: true, aproximado: true,
    ponto: { lat: -22.8801, lng: -42.0102, origem: "bairro" },
  }), null);
  const rsp = recusaDoSite(naoSeiComPalpite, SEM_PINO_DA_LOJA);
  conferir("…com palpite, o pino abre no palpite (sem pedir GPS)",
    rsp?.corpo.precisaConfirmarNoMapa === true && igual(rsp.corpo.pontoAproximado, { lat: -22.8801, lng: -42.0102 }) && !rsp.corpo.pedirGps, rsp);
  // Pedido #5 da Divinos: rua homônima a 4,95 km, R$ 20, repasse R$ 19.
  const homonimo495 = entregaDoVeredicto(veredicto({
    resultado: "ATENDE", taxa: 20, distanciaKm: 4.95, faixaKm: 5, taxaDoEntregador: 19, medida: "rota",
    pedeConfirmacao: true, aproximado: true, motivosDaConfirmacao: ["rua homônima em outro bairro"],
    ponto: { lat: -22.8912345, lng: -41.9876543, origem: "mapa" },
  } as Partial<VeredictoDeEntrega>), null);
  const rh = recusaDoSite(homonimo495, SEM_PINO_DA_LOJA);
  conferir("ATENDE + ponto aproximado com a loja SEM pino → recusa com a taxa estimada e o pino no ponto (caso #5)",
    rh?.corpo.precisaConfirmarNoMapa === true && rh.corpo.taxaEstimada === 20 &&
    igual(rh.corpo.pontoAproximado, { lat: -22.8912345, lng: -41.9876543 }), rh);
  conferir("…e o mesmo com a loja COM pino", recusaDoSite(homonimo495, COM_PINO_DA_LOJA)?.corpo.precisaConfirmarNoMapa === true);

  // PELO BAIRRO (25/09/2026): o mapa achou o bairro que o cliente escreveu, não
  // a rua. O bairro decide a taxa — o site fecha sem o pino, e a loja é avisada.
  const peloBairro = entregaDoVeredicto(veredicto({
    resultado: "ATENDE", taxa: 8, distanciaKm: 1.3, faixaKm: 1.5, medida: "rota",
    pedeConfirmacao: true, aproximado: true, peloBairro: true,
    motivosDaConfirmacao: ['só o bairro "Jardim Esperança" foi achado no mapa — o ponto é o centro dele'],
    ponto: { lat: -22.8639, lng: -42.0256, origem: "bairro" },
  } as Partial<VeredictoDeEntrega>), null);
  conferir("pelo bairro: não pede o pino (R3 não se aplica), fica marcado", peloBairro.peloBairro === true && peloBairro.pedeConfirmacao === false, peloBairro);
  conferir("…o site ACEITA, com a loja com ou sem pino",
    recusaDoSite(peloBairro, COM_PINO_DA_LOJA) === null && recusaDoSite(peloBairro, SEM_PINO_DA_LOJA) === null);
  const notaPeloBairro = notasDaEntrega(peloBairro, { canal: "site" }).join(" ");
  conferir("…e a nota diz 'Taxa pelo bairro', não 'confira com o cliente' do aproximado",
    /Taxa pelo bairro/.test(notaPeloBairro) && !/localizado só de forma aproximada/.test(notaPeloBairro), notaPeloBairro);
  conferir("…o ponto do bairro é gravado (a roteirização sabe a origem)", pontoParaGravar(peloBairro)?.origem === "bairro");
  conferir("com o GPS do cliente, o bairro não conta: é o ponto dele",
    entregaDoVeredicto(veredicto({ resultado: "ATENDE", taxa: 5, peloBairro: true } as Partial<VeredictoDeEntrega>), gps).peloBairro === false);
  // A cotação pelo bairro volta no pedido com a marca do token.
  const tokenPeloBairro = entregaDaCotacao({ ...lida!, origemDoPonto: "bairro", peloBairro: true }, "KM", null);
  conferir("token pelo bairro: aceita sem pino e fica marcado",
    tokenPeloBairro.peloBairro === true && tokenPeloBairro.pedeConfirmacao === false && recusaDoSite(tokenPeloBairro, COM_PINO_DA_LOJA) === null, tokenPeloBairro);
  const tokenDoCentroSemMarca = entregaDaCotacao({ ...lida!, origemDoPonto: "bairro" }, "KM", null);
  conferir("token do centro do bairro SEM a marca (não sai mais, mas se vier): continua pedindo o pino",
    tokenDoCentroSemMarca.pedeConfirmacao === true && tokenDoCentroSemMarca.peloBairro === false);
  conferir("lojaTemPonto omitido vale como 'tem pino' (texto de sempre)",
    recusaDoSite(naoSei, { temCoordenadaDoCliente: false })?.corpo.pedirGps === undefined);

  // O único "não sei" aceito: o PONTO DA LOJA é desconhecido (sem pino e o
  // endereço dela não achado). O motor diz isso no campo `semPontoDaLoja`
  // (o motivo em texto é só para o log). O veredicto aqui tem a forma que o
  // motor devolve de verdade: o campo E o motivo.
  const MOTIVO_SEM_PONTO = "loja sem localização no mapa (storeLatLng)";
  const lojaSemPonto = entregaDoVeredicto(veredicto({
    resultado: "DESCONHECIDO", taxa: null, raioMaxKm: 5, semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO,
  }), null, "KM");
  conferir("pontoDaLojaDesconhecido lê o CAMPO do motor",
    pontoDaLojaDesconhecido({ resultado: "DESCONHECIDO", semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO }) &&
    !pontoDaLojaDesconhecido({ resultado: "DESCONHECIDO", motivo: "endereço não localizado no mapa" }) &&
    !pontoDaLojaDesconhecido({ resultado: "ATENDE", semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO }) &&
    !pontoDaLojaDesconhecido(null));
  // O defeito que o campo fecha: a frase do log era a regra. Reescrita (ou
  // traduzida), a loja sem ponto ia para o "confirme no mapa" e fechava.
  conferir("…o campo decide mesmo com o motivo reescrito (a frase do log não é mais a regra)",
    pontoDaLojaDesconhecido({ resultado: "DESCONHECIDO", semPontoDaLoja: true, motivo: "a loja não marcou o ponto" }));
  conferir("…e semPontoDaLoja: false vence o texto (o campo presente é a palavra do motor)",
    !pontoDaLojaDesconhecido({ resultado: "DESCONHECIDO", semPontoDaLoja: false, motivo: MOTIVO_SEM_PONTO }));
  conferir("…sem o campo, o texto do motivo ainda vale (reserva)",
    pontoDaLojaDesconhecido({ resultado: "DESCONHECIDO", motivo: MOTIVO_SEM_PONTO }) &&
    entregaDoVeredicto(veredicto({ resultado: "DESCONHECIDO", taxa: null, motivo: MOTIVO_SEM_PONTO }), null, "KM").lojaSemPonto === true);
  conferir("loja sem ponto: lojaSemPonto true e o site ACEITA (fecharia a loja para entrega)",
    lojaSemPonto.lojaSemPonto === true && recusaDoSite(lojaSemPonto, SEM_PINO_DA_LOJA) === null);
  conferir("…mesmo com o GPS do cliente (sem a loja no mapa nem o GPS mede)",
    recusaDoSite(entregaDoVeredicto(veredicto({ resultado: "DESCONHECIDO", taxa: null, semPontoDaLoja: true, motivo: MOTIVO_SEM_PONTO }), gps, "KM"),
      { temCoordenadaDoCliente: true, lojaTemPonto: false }) === null);
  conferir("…e nada de distância, ponto de palpite ou repasse gravado",
    igual(camposDaEntrega(lojaSemPonto, SEPARADO, DIVINOS), { deliveryDistance: null, customerLatLng: null, motoboyFee: null }));
  const notaLoja = notasDaEntrega(lojaSemPonto, { canal: "site" }).join(" ");
  conferir("nota: 'loja sem localização', 1ª faixa — não 'endereço não localizado'",
    /Loja sem localização no mapa/.test(notaLoja) && /1ª faixa/.test(notaLoja) && !/Endereço não localizado/.test(notaLoja), notaLoja);
  conferir("nota do balcão não fala em 1ª faixa (a taxa lá é do atendente)",
    !/1ª faixa/.test(notasDaEntrega(lojaSemPonto, { canal: "balcao", taxaCobrada: 8 }).join(" ")));
  conferir("taxa da loja sem ponto: a 1ª faixa (R$ 5), nunca a mais cara (R$ 20)",
    taxaDaLojaSemPonto(DIVINOS, null) === 5 && taxaDaLojaSemPonto(DIVINOS_FORA_DE_ORDEM, 9) === 5 && taxaDaLojaSemPonto(JSON.stringify(DIVINOS), null) === 5);
  conferir("…sem faixas, a taxa fixa; sem nada, zero",
    taxaDaLojaSemPonto([], 7) === 7 && taxaDaLojaSemPonto(null, null) === 0 && taxaDaLojaSemPonto([], -3) === 0);
  // O contrato com o motor (lib/area-de-entrega.ts) é o CAMPO: o retorno de
  // "sem check" (verifyStoreDeliveryAddress devolveu null = a loja sem ponto)
  // tem de levar `semPontoDaLoja: true`. O comportamento está provado com o
  // motor de verdade em scripts/teste-motor-da-entrega.ts; aqui, sem rede nem
  // banco, só a fonte.
  const motor = readFileSync(join(__dirname, "../src/lib/area-de-entrega.ts"), "utf8");
  const semCheck = motor.match(/if \(!check\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  conferir("contrato: o motor marca semPontoDaLoja: true quando a loja não tem ponto (sem check)",
    /semPontoDaLoja: true/.test(semCheck), semCheck.slice(0, 200));
  conferir("…e só ali (nenhum outro 'não sei' é da loja)",
    (motor.match(/semPontoDaLoja: true/g) ?? []).length === 1);
}
const naoSeiComPino = entregaDoVeredicto(veredicto({ resultado: "DESCONHECIDO", taxa: null }), gps);
const r2 = recusaDoSite(naoSeiComPino, { temCoordenadaDoCliente: true, lojaTemPonto: true });
conferir("com o ponto do cliente e ainda sem resposta → recusa SEM pedir o pino de novo (sem laço)",
  r2?.status === 400 && !r2.corpo.precisaConfirmarNoMapa, r2);
{
  // O motor devolve DESCONHECIDO com o palpite quando o centro do bairro cai
  // além do raio: o pino abre no palpite.
  const palpiteFora = entregaDoVeredicto(veredicto({
    resultado: "DESCONHECIDO", taxa: null, distanciaKm: 5.2, pedeConfirmacao: true, aproximado: true,
    ponto: { lat: -22.8801, lng: -42.0102, origem: "bairro" }, motivosDaConfirmacao: ["centro do bairro"],
  } as Partial<VeredictoDeEntrega>), null);
  const rp = recusaDoSite(palpiteFora, COM_PINO_DA_LOJA);
  conferir("DESCONHECIDO com palpite → pino abre no palpite",
    rp?.corpo.precisaConfirmarNoMapa === true && igual(rp.corpo.pontoAproximado, { lat: -22.8801, lng: -42.0102 }), rp);
  conferir("…e o palpite NÃO é gravado como se fosse o cliente (nem distância, nem repasse)",
    igual(camposDaEntrega(palpiteFora, SEPARADO, DIVINOS), { deliveryDistance: null, customerLatLng: null, motoboyFee: null }));
  const homonimo = entregaDoVeredicto(veredicto({
    resultado: "DESCONHECIDO", taxa: null, distanciaKm: 552, pedeConfirmacao: true, ponto: { lat: -15.12345, lng: -47.54321, origem: "mapa" },
  }), null);
  conferir("homônimo a 552 km: pede o pino, mas não abre o mapa lá",
    recusaDoSite(homonimo, COM_PINO_DA_LOJA)?.corpo.pontoAproximado === undefined &&
    recusaDoSite(homonimo, COM_PINO_DA_LOJA)?.corpo.precisaConfirmarNoMapa === true);
}
conferir("avaliação que falhou (null) em KM → recusa com o pino",
  recusaDoSite(entregaDoVeredicto(null, null, "KM"), COM_PINO_DA_LOJA)?.corpo.precisaConfirmarNoMapa === true);
conferir("área desenhada sem ponto → recusa com o pino (mesmo sem pino da loja)",
  recusaDoSite(entregaDoVeredicto(veredicto({ modo: "POLIGONO", resultado: "DESCONHECIDO", taxa: null }), null),
    { temCoordenadaDoCliente: false, lojaTemPonto: false })?.corpo.precisaConfirmarNoMapa === true);

const aproximado = entregaDoVeredicto(veredicto({
  aproximado: true, pedeConfirmacao: true, distanciaKm: 1.04, taxa: 8,
  ponto: { lat: -22.8531, lng: -42.0292, origem: "bairro" },
}), null);
const r3 = recusaDoSite(aproximado, COM_PINO_DA_LOJA);
conferir("ponto aproximado (centro do bairro) → recusa, mostra a taxa estimada e onde abrir o pino",
  r3?.status === 400 && r3.corpo.precisaConfirmarNoMapa === true && r3.corpo.taxaEstimada === 8 &&
  igual(r3.corpo.pontoAproximado, { lat: -22.8531, lng: -42.0292 }), r3);
const confirmado = entregaDoVeredicto(veredicto({ pedeConfirmacao: true, distanciaKm: 0.3, taxa: 5 }), { ...gps!, origem: "pino" });
conferir("com o pino do cliente NÃO se pede confirmação (mesmo que o motor peça)",
  confirmado.pedeConfirmacao === false && recusaDoSite(confirmado, { temCoordenadaDoCliente: true, lojaTemPonto: true }) === null);
conferir("cotação 'pelo centro do bairro' também pede o pino",
  recusaDoSite(entregaDaCotacao({ ...lida!, origemDoPonto: "bairro" }, "KM", null), COM_PINO_DA_LOJA)?.corpo.precisaConfirmarNoMapa === true);
conferir("cotação normal passa", recusaDoSite(daCotacao, COM_PINO_DA_LOJA) === null);

const fora = entregaDoVeredicto(veredicto({ resultado: "FORA", taxa: null, distanciaKm: 5.69, raioMaxKm: 5, medida: "rota" }), null);
const r4 = recusaDoSite(fora, COM_PINO_DA_LOJA);
conferir("FORA em ROTA explica 'pela rua' e deixa corrigir o pino",
  r4?.status === 400 && /5,69 km pela rua até a loja/.test(r4.corpo.error) && r4.corpo.podeConfirmarNoMapa === true, r4);
// A recusa do pedido e a cotação (/api/delivery-fee) dizem a MESMA frase — a
// rota importa distanciaNaFraseDeFora daqui; scripts/teste-rota-do-frete.ts
// prova o lado da cotação ("(6,1 km pela rua até a loja; entregamos até 5
// km)"). No E7 a recusa dizia "pelas ruas" e a cotação, "pela rua".
conferir("FORA em ROTA: a recusa repete a frase da cotação, palavra por palavra",
  r4?.corpo.error === "Endereço fora da área de entrega (5,69 km pela rua até a loja; entregamos até 5 km). Revise o endereço ou escolha retirar no balcão.",
  r4?.corpo.error);
{
  // Roteador fora (R4): a distância é linha reta × desvio da loja. Chamá-la
  // "pelas ruas" era apresentar estimativa como medida.
  const foraEstimado = recusaDoSite(entregaDoVeredicto(veredicto({ resultado: "FORA", taxa: null, distanciaKm: 6.01, raioMaxKm: 5, medida: "estimada" }), null), COM_PINO_DA_LOJA);
  conferir("FORA com distância ESTIMADA: '~6,01 km estimados até a loja', sem 'pela rua'",
    /\(~6,01 km estimados até a loja; entregamos até 5 km\)/.test(String(foraEstimado?.corpo.error)) && !/pela(s)? rua/.test(String(foraEstimado?.corpo.error)),
    foraEstimado?.corpo.error);
  const foraReta = recusaDoSite(entregaDoVeredicto(veredicto({ resultado: "FORA", taxa: null, distanciaKm: 5.2, raioMaxKm: 5, medida: "linha-reta" }), null), COM_PINO_DA_LOJA);
  conferir("FORA em linha reta (modo KM): '5,2 km até a loja', sem 'rua'",
    /\(5,2 km até a loja; entregamos até 5 km\)/.test(String(foraReta?.corpo.error)) && !/rua/.test(String(foraReta?.corpo.error)),
    foraReta?.corpo.error);
  conferir("distanciaNaFraseDeFora: as três medidas",
    distanciaNaFraseDeFora({ distanciaKm: 6.014, medida: "rota" }) === "6,01 km pela rua até a loja"
      && distanciaNaFraseDeFora({ distanciaKm: 6.01, medida: "estimada" }) === "~6,01 km estimados até a loja"
      && distanciaNaFraseDeFora({ distanciaKm: 5.2, medida: "linha-reta" }) === "5,2 km até a loja"
      && distanciaNaFraseDeFora({ distanciaKm: 5.2, medida: null }) === "5,2 km até a loja");
}
{
  // A rota da cotação não pode voltar a ter a sua cópia da frase.
  const rotaDaCotacao = readFileSync(join(__dirname, "../src/app/api/delivery-fee/route.ts"), "utf8");
  conferir("a cotação usa a frase do pedido (import, sem cópia local)",
    /import \{[^}]*\bdistanciaNaFraseDeFora\b[^}]*\} from "@\/lib\/entrega-do-pedido"/.test(rotaDaCotacao)
      && !/function distanciaNaFraseDeFora/.test(rotaDaCotacao));
}
conferir("FORA por área de risco não fala em km",
  /não entrega nesse endereço/.test(recusaDoSite(entregaDoVeredicto(veredicto({ resultado: "FORA", taxa: null, distanciaKm: 0.9, raioMaxKm: 5, areaDeRisco: "Morro" }), null), COM_PINO_DA_LOJA)!.corpo.error));
conferir("bairro não localizado segue a regra antiga (sem recusa)",
  recusaDoSite(entregaDoVeredicto(veredicto({ modo: "BAIRRO", resultado: "DESCONHECIDO", taxa: null }), null), COM_PINO_DA_LOJA) === null);
conferir("loja sem área cadastrada não recusa",
  recusaDoSite(entregaDoVeredicto(veredicto({ modo: "SEM_AREA", taxa: null }), null), COM_PINO_DA_LOJA) === null);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n7) R7 — pedido reavaliado: ponto, distância, repasse");
{
  const doMapa = entregaDoVeredicto(veredicto({
    distanciaKm: 1.8, faixaKm: 2, taxa: 10, medida: "estimada",
    ponto: { lat: -22.8611, lng: -42.0251, origem: "mapa" },
  }), null);
  const g = camposDaEntrega(doMapa, SEPARADO, DIVINOS);
  conferir("sem taxaDoEntregador no veredicto: repasse pela faixa que decidiu (R$ 9)", g.motoboyFee === 9, g);
  conferir("ponto do mapa gravado com a medida 'estimada'",
    igual(g.customerLatLng, { lat: -22.8611, lng: -42.0251, origem: "mapa", medida: "estimada" }));
  const notas = notasDaEntrega(doMapa, { canal: "site" });
  conferir("nota diz que a distância foi ESTIMADA", notas.length === 1 && /Distância estimada: 1,8 km/.test(notas[0]), notas);

  const bairroComGps = entregaDoVeredicto(veredicto({ modo: "BAIRRO", bairro: "Centro", taxa: 6 }), gps);
  conferir("modo bairro com GPS: o ponto do cliente vai para o pedido",
    igual(pontoParaGravar(bairroComGps), { lat: -22.851812, lng: -42.035301, origem: "gps" }));
  conferir("ponto de enchimento no veredicto não é gravado",
    pontoParaGravar(entregaDoVeredicto(veredicto({ ponto: { lat: -23, lng: -43, origem: "mapa" } }), null)) === null);
  conferir("DESCONHECIDO sem ponto não grava distância nem ponto nem repasse",
    igual(camposDaEntrega(naoSei, SEPARADO, DIVINOS), { deliveryDistance: null, customerLatLng: null, motoboyFee: null }));
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n8) Notas do pedido (site e balcão)");
conferir("site, cotação normal: nenhuma etiqueta", notasDaEntrega(daCotacao, { canal: "site" }).length === 0);
conferir("não localizado", /não localizado/.test(notasDaEntrega(naoSei, { canal: "balcao", taxaCobrada: 12 }).join(" ")));
conferir("avaliação sem resposta não diz 'não localizado'",
  /Não deu para conferir/.test(notasDaEntrega(entregaDoVeredicto(null, null, "KM"), { canal: "balcao" }).join(" ")));
conferir("aproximado", /forma aproximada \(centro do bairro\)/.test(notasDaEntrega(aproximado, { canal: "balcao", taxaCobrada: 8 }).join(" ")));
conferir("aproximado com os porquês do motor",
  /forma aproximada \(rua homônima em outro bairro; ponto arrastado 320 m até a rua\)/.test(notasDaEntrega(entregaDoVeredicto(veredicto({
    pedeConfirmacao: true, motivosDaConfirmacao: ["rua homônima em outro bairro", "ponto arrastado 320 m até a rua"],
  } as Partial<VeredictoDeEntrega>), null), { canal: "balcao", taxaCobrada: 5 }).join(" ")));
conferir("balcão com o ponto do GPS e o gravado leva a origem gps",
  camposDaEntrega(entregaDoVeredicto(veredicto({ distanciaKm: 0.3, faixaKm: 1, taxaDoEntregador: 4, medida: "rota" }), gps), SEPARADO, DIVINOS).customerLatLng?.origem === "gps");
conferir("fora da área lançada no balcão", /Fora da área de entrega \(5,69 km; a loja entrega até 5 km\)/.test(notasDaEntrega(fora, { canal: "balcao", taxaCobrada: 25 }).join(" ")));
conferir("balcão cobrou diferente da tabela",
  /combinada no balcão: R\$ 0,00 \(a tabela dá R\$ 5,00\)/.test(notasDaEntrega(daCotacao, { canal: "balcao", taxaCobrada: 0 }).join(" ")));
conferir("balcão cobrou a da tabela: nada a dizer", notasDaEntrega(daCotacao, { canal: "balcao", taxaCobrada: 5 }).length === 0);

// ───────────────────────────────────────────────────────────────────────────
console.log("\n9) Cron de distâncias pendentes");
{
  const AGORA = Date.UTC(2026, 8, 25, 21, 0);
  const minutosAtras = (m: number) => new Date(AGORA - m * 60_000);
  const recente = { criadoEm: minutosAtras(12), agora: AGORA };
  conferir("pedido próprio RECENTE da loja separada, sem repasse → completa pela faixa",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 2.4, ehMarketplace: false, motoboyFeeAtual: null, ...recente }) === 11);
  conferir("pedido de app → não (a regra do app decide no fechamento)",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 2.4, ehMarketplace: true, motoboyFeeAtual: null, ...recente }) === null);
  conferir("repasse já gravado (inclusive zero) → não mexe",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 2.4, ehMarketplace: false, motoboyFeeAtual: 0, ...recente }) === null);
  conferir("loja que não separa → não",
    repasseQueOCronCompleta({ regra: JUNTO, zonas: DIVINOS, km: 2.4, ehMarketplace: false, motoboyFeeAtual: null, ...recente }) === null);
  conferir("faixa sem valor → não inventa",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: SEM_A_DE_2KM, km: 1.8, ehMarketplace: false, motoboyFeeAtual: null, ...recente }) === null);
  // Achado da revisão: a loja cadastra o repasse em 25/09 e o pedido de 05/09,
  // já pago como "por entrega R$ 6", ganhava R$ 7 "gravado na venda".
  conferir("pedido de 20 dias atrás → só a distância, sem repasse (a semana já foi paga)",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: minutosAtras(20 * 24 * 60), agora: AGORA }) === null);
  conferir(`no limite de ${REPASSE_DO_CRON_ATE_HORAS} h ainda completa; 1 min depois, não`,
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: minutosAtras(REPASSE_DO_CRON_ATE_HORAS * 60), agora: AGORA }) === 7 &&
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: minutosAtras(REPASSE_DO_CRON_ATE_HORAS * 60 + 1), agora: AGORA }) === null);
  conferir("sem data do pedido → não completa",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: null, agora: AGORA }) === null &&
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: "lixo", agora: AGORA }) === null);
  conferir("data em texto (ISO) também serve",
    repasseQueOCronCompleta({ regra: SEPARADO, zonas: DIVINOS, km: 1.3, ehMarketplace: false, motoboyFeeAtual: null, criadoEm: minutosAtras(30).toISOString(), agora: AGORA }) === 7);

  // R8 no cron: o ponto gravado que não é o cliente.
  const LOJA_CABO_FRIO = { lat: -22.8794321, lng: -42.0186789 };
  const lojaDivinos = { ponto: LOJA_CABO_FRIO, zonas: DIVINOS };
  conferir("(-23,-43) do 99Food → enchimento (apaga)", descarteDoPontoGravado({ lat: -23, lng: -43 }, lojaDivinos) === "enchimento");
  conferir("ponto do app a ~120 km (Rio) numa loja de raio 5 km → longe (apaga, fase 2 geocodifica)",
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965 }, lojaDivinos) === "longe");
  conferir("…o mesmo ponto do mapa (origem 'mapa'/'bairro') também apaga",
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965, origem: "mapa" }, lojaDivinos) === "longe" &&
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965, origem: "bairro" }, lojaDivinos) === "longe");
  conferir("…mas o GPS/pino do PRÓPRIO cliente não se apaga (só log)",
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965, origem: "gps" }, lojaDivinos) === "longe-do-cliente" &&
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965, origem: "pino" }, lojaDivinos) === "longe-do-cliente");
  conferir("ponto a ~2,7 km → serve (mede)", descarteDoPontoGravado({ lat: -22.8551234, lng: -42.0186543 }, lojaDivinos) === null);
  conferir("ponto a ~14 km (dentro do mínimo de 15 km) → serve",
    descarteDoPontoGravado({ lat: -22.7534321, lng: -42.0186543 }, lojaDivinos) === null);
  conferir("ponto a ~16 km (além de max(2 × 5, 15)) → longe",
    descarteDoPontoGravado({ lat: -22.7354321, lng: -42.0186543 }, lojaDivinos) === "longe");
  conferir("loja sem ponto: só o enchimento é reconhecido",
    descarteDoPontoGravado({ lat: -22.9068467, lng: -43.1728965 }, { ponto: null, zonas: DIVINOS }) === null &&
    descarteDoPontoGravado({ lat: -23, lng: -43 }, { ponto: null, zonas: DIVINOS }) === "enchimento");
  conferir("lixo não é descartado nem quebra", descarteDoPontoGravado(null, lojaDivinos) === null && descarteDoPontoGravado({ lat: "x" }, lojaDivinos) === null);
  // Área desenhada: o raio é o vértice mais longe (~20 km) → corte em 40 km.
  const areaGrande = [{ nome: "Região", fee: 9, pontos: [[LOJA_CABO_FRIO.lat + 0.18, LOJA_CABO_FRIO.lng], [LOJA_CABO_FRIO.lat, LOJA_CABO_FRIO.lng + 0.05], [LOJA_CABO_FRIO.lat - 0.05, LOJA_CABO_FRIO.lng]] }];
  const raio = raioDaLojaParaOCorte(areaGrande, LOJA_CABO_FRIO);
  conferir("raio da área desenhada = vértice mais longe (~20 km)", raio != null && raio > 19.5 && raio < 20.5, raio);
  conferir("ponto a ~30 km numa área de ~20 km → serve (corte em 40 km)",
    descarteDoPontoGravado({ lat: LOJA_CABO_FRIO.lat + 0.27, lng: LOJA_CABO_FRIO.lng + 0.0000123 }, { ponto: LOJA_CABO_FRIO, zonas: areaGrande }) === null);
  conferir("raio das faixas de km: a maior (5)", raioDaLojaParaOCorte(DIVINOS, LOJA_CABO_FRIO) === 5 && raioDaLojaParaOCorte(JSON.stringify(DIVINOS), null) === 5);
}
conferir("origem da geocodificação: centro de bairro é 'bairro'",
  ["centróide do bairro", "bairro (OSM)", "dicionário de bairros"].every((o) => origemDaGeocodificacao(o) === "bairro"));
conferir("origem da geocodificação: rua é 'mapa' (inclusive 'rua + número + bairro')",
  ["rua (busca estruturada)", "rua + número + bairro", "rua + bairro", "cache"].every((o) => origemDaGeocodificacao(o) === "mapa"),
  ["rua (busca estruturada)", "rua + número + bairro", "rua + bairro", "cache"].map(origemDaGeocodificacao));
conferir("caiu no mar e foi para o dicionário é 'bairro'", origemDaGeocodificacao("rua + bairro → caiu no mar → dicionário") === "bairro");
conferir("geocodificação que caiu na loja NÃO é achado (nem pelo mar)",
  !geocodificacaoAchou("loja (endereço não localizado)") && !geocodificacaoAchou("rua + bairro → caiu no mar → loja") &&
  geocodificacaoAchou("rua (busca estruturada)") && geocodificacaoAchou("centróide do bairro"));

// ───────────────────────────────────────────────────────────────────────────
console.log("\n10) R10 — correção da taxa de um pedido já feito");
{
  // Divinos #2: itens R$ 30 + R$ 12 (faixa mais cara, "não localizado"), sem
  // distância nem repasse. O cliente mora a 0,84 km: era R$ 5.
  const a = ajusteDaTaxa({ totalAntes: 42, taxaAntes: 12, taxaNova: 5, motoboyFeeAntes: null, distanciaAntes: null, regra: SEPARADO, zonas: DIVINOS });
  conferir("total cai a diferença (42 → 35)", a.totalDepois === 35 && a.taxaDepois === 5, a);
  conferir("repasse vem da faixa de R$ 5 (R$ 4)", a.motoboyFeeDepois === 4 && a.repasse === "faixa-da-taxa", a);

  const b = ajusteDaTaxa({ totalAntes: 42, taxaAntes: 12, taxaNova: 5, motoboyFeeAntes: null, distanciaAntes: null, distanciaNova: 0.84, regra: SEPARADO, zonas: DIVINOS });
  conferir("com a distância informada, o repasse vem dela e a distância é gravada",
    b.motoboyFeeDepois === 4 && b.deliveryDistanceDepois === 0.84 && b.repasse === "faixa-da-distancia", b);

  const c = ajusteDaTaxa({ totalAntes: 38, taxaAntes: 8, taxaNova: 7, motoboyFeeAntes: 7, distanciaAntes: 1.3, regra: SEPARADO, zonas: DIVINOS });
  conferir("desconto de cortesia (R$ 8 → 7) não muda o repasse de quem rodou 1,3 km",
    c.motoboyFeeDepois === 7 && c.totalDepois === 37 && c.repasse === "faixa-da-distancia", c);

  // Medida errada (rua homônima a 4,95 km, pedido #5): a loja diz qual era.
  const d = ajusteDaTaxa({ totalAntes: 50, taxaAntes: 20, taxaNova: 5, motoboyFeeAntes: 19, distanciaAntes: 4.95, distanciaNova: 0.8, regra: SEPARADO, zonas: DIVINOS });
  conferir("medida errada (4,95 km, R$ 20) corrigida com a distância certa (0,8 km): repasse 19 → 4",
    d.motoboyFeeDepois === 4 && d.totalDepois === 35 && d.deliveryDistanceDepois === 0.8 && d.repasse === "faixa-da-distancia", d);
  const d2 = ajusteDaTaxa({ totalAntes: 50, taxaAntes: 20, taxaNova: 5, motoboyFeeAntes: 19, distanciaAntes: 4.95, repassePelaTaxa: true, regra: SEPARADO, zonas: DIVINOS });
  conferir("medida errada sem saber a distância: 'repassePelaTaxa' leva o repasse à faixa de R$ 5 (19 → 4)",
    d2.motoboyFeeDepois === 4 && d2.repasse === "faixa-da-taxa" && d2.deliveryDistanceDepois === 4.95, d2);
  const d3 = ajusteDaTaxa({ totalAntes: 50, taxaAntes: 20, taxaNova: 5, motoboyFeeAntes: 19, distanciaAntes: 4.95, regra: SEPARADO, zonas: DIVINOS });
  conferir("sem distância nova nem 'repassePelaTaxa': a distância gravada manda (19 fica)",
    d3.motoboyFeeDepois === 19 && d3.repasse === "faixa-da-distancia" && d3.totalDepois === 35, d3);

  // Achados da revisão: cortesia que bate com a taxa de outra faixa rebaixava
  // o repasse de quem rodou a distância inteira.
  const h = ajusteDaTaxa({ totalAntes: 60, taxaAntes: 20, taxaNova: 19, motoboyFeeAntes: 19, distanciaAntes: 4.9, regra: SEPARADO, zonas: DIVINOS });
  conferir("cortesia R$ 20 → 19 a 4,9 km: o motoboy continua com R$ 19 (não cai para 18)",
    h.motoboyFeeDepois === 19 && h.repasse === "faixa-da-distancia" && h.totalDepois === 59 && h.mudou === true, h);
  const i = ajusteDaTaxa({ totalAntes: 52, taxaAntes: 12, taxaNova: 10, motoboyFeeAntes: 11, distanciaAntes: 2.3, regra: SEPARADO, zonas: DIVINOS });
  conferir("cortesia R$ 12 → 10 a 2,3 km: repasse fica em R$ 11 (não cai para 9)",
    i.motoboyFeeDepois === 11 && i.repasse === "faixa-da-distancia" && i.totalDepois === 50, i);
  const j = ajusteDaTaxa({ totalAntes: 40, taxaAntes: 10, taxaNova: 8, motoboyFeeAntes: 9, distanciaAntes: 1.8, regra: SEPARADO, zonas: DIVINOS });
  conferir("cortesia R$ 10 → 8 a 1,8 km: repasse fica em R$ 9 (não cai para 7)", j.motoboyFeeDepois === 9, j);
  const k = ajusteDaTaxa({ totalAntes: 52, taxaAntes: 12, taxaNova: 0, motoboyFeeAntes: 11, distanciaAntes: 2.3, regra: SEPARADO, zonas: DIVINOS });
  conferir("entrega de graça a 2,3 km: repasse fica em R$ 11", k.motoboyFeeDepois === 11 && k.totalDepois === 40, k);

  const e = ajusteDaTaxa({ totalAntes: 50, taxaAntes: 20, taxaNova: 5, motoboyFeeAntes: 6.5, distanciaAntes: 4.95, regra: SEPARADO, zonas: DIVINOS });
  conferir("repasse gravado que NÃO seguia a tabela fica", e.motoboyFeeDepois === 6.5 && e.repasse === "mantido", e);

  const f = ajusteDaTaxa({ totalAntes: 42, taxaAntes: 12, taxaNova: 5, motoboyFeeAntes: null, distanciaAntes: null, regra: JUNTO, zonas: DIVINOS });
  conferir("loja que não separa: repasse intocado", f.motoboyFeeDepois === null && f.repasse === "sem-tabela", f);

  const g = ajusteDaTaxa({ totalAntes: 42, taxaAntes: 12, taxaNova: 10, motoboyFeeAntes: null, distanciaAntes: null, regra: SEPARADO, zonas: SEM_A_DE_2KM });
  conferir("faixa nova sem valor: repasse null (R6)", g.motoboyFeeDepois === null && g.repasse === "faixa-da-taxa", g);

  conferir("mesma taxa, nada novo: não muda",
    ajusteDaTaxa({ totalAntes: 35, taxaAntes: 5, taxaNova: 5, motoboyFeeAntes: 4, distanciaAntes: 0.84, regra: SEPARADO, zonas: DIVINOS }).mudou === false);
  conferir("total nunca fica negativo",
    ajusteDaTaxa({ totalAntes: 3, taxaAntes: 5, taxaNova: 0, motoboyFeeAntes: null, distanciaAntes: null, regra: JUNTO, zonas: [] }).totalDepois === 0);
  conferir("centavos: 29,9 × 3 + 5,5 → 6,5 não deixa dízima",
    ajusteDaTaxa({ totalAntes: 29.9 * 3 + 5.5, taxaAntes: 5.5, taxaNova: 6.5, motoboyFeeAntes: null, distanciaAntes: null, regra: JUNTO, zonas: [] }).totalDepois === 96.2);
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n10b) R10 — o que fazer com a diferença de total, e o pagamento dividido");
{
  const nada = { pagoOnline: false, finalizado: false, pagamentoConfirmado: false, balcao: false, dividido: false };
  conferir("sem diferença, sem aviso", avisoDaDiferencaDeTotal(0, 35, { ...nada, pagoOnline: true }) === undefined);
  conferir("pago online: devolver por fora",
    /já pagou online: devolva R\$ 7,00/.test(avisoDaDiferencaDeTotal(-7, 35, { ...nada, pagoOnline: true }) || ""));
  conferir("pago online e a taxa subiu: cobrar na entrega",
    /os R\$ 3,00 a mais precisam ser cobrados na entrega/.test(avisoDaDiferencaDeTotal(3, 45, { ...nada, pagoOnline: true }) || ""));
  // Achado da revisão: ENTREGUE pago em dinheiro ao motoboy perdia R$ 7 calado.
  conferir("ENTREGUE pago em dinheiro: 'já foi pago, devolva R$ 7,00'",
    /já foi pago: devolva R\$ 7,00/.test(avisoDaDiferencaDeTotal(-7, 35, { ...nada, finalizado: true }) || ""));
  conferir("pagamento confirmado (paymentPaidAt) também",
    /já foi pago/.test(avisoDaDiferencaDeTotal(-7, 35, { ...nada, pagamentoConfirmado: true }) || ""));
  conferir("pago dividido: já foi pago",
    /já foi pago: devolva R\$ 7,00/.test(avisoDaDiferencaDeTotal(-7, 35, { ...nada, balcao: true, dividido: true }) || ""));
  conferir("balcão ainda não entregue: as duas saídas, com o total novo",
    /Se o cliente já pagou no balcão, devolva R\$ 7,00.*total novo: R\$ 35,00/.test(avisoDaDiferencaDeTotal(-7, 35, { ...nada, balcao: true }) || ""));
  conferir("site, paga na entrega, ainda não saiu: o entregador cobra o total novo",
    /entregador cobra o total novo: R\$ 35,00/.test(avisoDaDiferencaDeTotal(-7, 35, nada) || ""));
  // O contrato que a rota usa: a divisão gravada (Pix 20 + Dinheiro 22 = 42)
  // não fecha com o total novo (35); a divisão nova, sim.
  const antiga = [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 22 }];
  conferir("divisão antiga (42) não fecha com o total corrigido (35)", validarDivisao(antiga, 35).ok === false);
  conferir("divisão nova (Pix 20 + Dinheiro 15) fecha com 35", validarDivisao([{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 15 }], 35).ok === true);
  const rota = readFileSync(join(__dirname, "../src/app/api/store/orders/[id]/taxa-de-entrega/route.ts"), "utf8");
  conferir("a rota de correção pede a divisão nova (precisaDividir) e confere com validarDivisao",
    /precisaDividir: true/.test(rota) && /validarDivisao\(corpo\.paymentMethods, conta\.totalDepois\)/.test(rota));
  conferir("a rota de correção passa 'repassePelaTaxa' do corpo para a conta", /repassePelaTaxa:/.test(rota));
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n10c) Ordem das rotas (sem banco: lê o código)");
{
  const balcao = readFileSync(join(__dirname, "../src/app/api/store/orders/presencial/route.ts"), "utf8");
  const iMapa = balcao.indexOf("avaliarEntrega(loja");
  const iEstoque = balcao.indexOf("await conferirEstoque(");
  const iCreate = balcao.indexOf("prisma.customerOrder.create(");
  // Achado da revisão: a medida (até 10 s esperando o mapa) ficava ENTRE
  // conferir e baixar o estoque — a última unidade era vendida duas vezes.
  conferir("balcão: a medida da entrega vem ANTES da conferência de estoque, e a conferência logo antes de gravar",
    iMapa > 0 && iEstoque > iMapa && iCreate > iEstoque, { iMapa, iEstoque, iCreate });
  const site = readFileSync(join(__dirname, "../src/app/api/customer-order/route.ts"), "utf8");
  conferir("site: loja por km sem medida cobra a 1ª faixa (taxaDaLojaSemPonto), não a mais cara",
    /entrega\?\.modo === "KM"\) \{[\s\S]{0,1200}taxaDaLojaSemPonto\(/.test(site));
}

// ───────────────────────────────────────────────────────────────────────────
console.log("\n11) Acerto do entregador (lib/ganho-do-entregador.ts)");
{
  const porEntrega = lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 3 });
  conferir("repasse ZERO gravado vale zero (não o acordo dele)",
    igual(ganhoDoPedido({ acerto: porEntrega, pedido: { motoboyFee: 0, deliveryFee: 5 } }), { valor: 0, origem: "GRAVADO" }));
  conferir("repasse nulo cai no acordo dele",
    igual(ganhoDoPedido({ acerto: porEntrega, pedido: { motoboyFee: null, deliveryFee: 5 } }), { valor: 3, origem: "POR_ENTREGA" }));
  conferir("repasse gravado vence",
    igual(ganhoDoPedido({ acerto: porEntrega, pedido: { motoboyFee: 4, deliveryFee: 5 } }), { valor: 4, origem: "GRAVADO" }));

  const faixaDele = lerAcerto({ paymentType: "FAIXA_KM", faixasDeKm: [{ ate: 2, valor: 5 }, { ate: 4, valor: 7 }] });
  conferir("0 km medido paga a 1ª faixa dele",
    igual(ganhoDoPedido({ acerto: faixaDele, pedido: { deliveryDistance: 0 } }), { valor: 5, origem: "FAIXA_DELE" }));
  conferir("sem distância e pago por distância: SEM_DISTANCIA",
    igual(ganhoDoPedido({ acerto: faixaDele, pedido: { deliveryDistance: null } }), { valor: 0, origem: "SEM_DISTANCIA" }));
  const porKm = lerAcerto({ paymentType: "PER_KM", perKmRate: 2 });
  conferir("R$/km com 0 km medido: 0 por km, não 'sem distância'",
    igual(ganhoDoPedido({ acerto: porKm, pedido: { deliveryDistance: 0 } }), { valor: 0, origem: "POR_KM" }));
  conferir("R$/km com 2,5 km", igual(ganhoDoPedido({ acerto: porKm, pedido: { deliveryDistance: 2.5 } }), { valor: 5, origem: "POR_KM" }));

  const soDiaria = lerAcerto({ paymentType: "DAILY_PLUS_FEE", dailyRate: 40 });
  conferir("regra da loja pela faixa (1,8 km → R$ 9)",
    igual(ganhoDoPedido({ acerto: soDiaria, pedido: { deliveryDistance: 1.8, deliveryFee: 10 }, regraDaLoja: SEPARADO, zonas: DIVINOS }),
      { valor: 9, origem: "REGRA_DA_LOJA" }));
  conferir("faixa da loja sem valor NÃO paga a vizinha: cai na taxa do cliente",
    igual(ganhoDoPedido({ acerto: soDiaria, pedido: { deliveryDistance: 1.8, deliveryFee: 10 }, regraDaLoja: SEPARADO, zonas: SEM_A_DE_2KM }),
      { valor: 10, origem: "TAXA_DO_CLIENTE" }));
  conferir("regra da loja com 0 km (cliente na porta) → 1ª faixa",
    igual(ganhoDoPedido({ acerto: soDiaria, pedido: { deliveryDistance: 0, deliveryFee: 5 }, regraDaLoja: SEPARADO, zonas: DIVINOS }),
      { valor: 4, origem: "REGRA_DA_LOJA" }));
  conferir("só diária continua só diária",
    igual(ganhoDoPedido({ acerto: lerAcerto({ paymentType: "DAILY_RATE", dailyRate: 50 }), pedido: { motoboyFee: 4 } }), { valor: 0, origem: "SO_DIARIA" }));
}

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
