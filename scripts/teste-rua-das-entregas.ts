/**
 * Teste da rua que o mapa não tem, pelas entregas da loja
 * (src/lib/rua-das-entregas.ts), e do nível 4b da cotação que usa ela
 * (src/lib/geocoding.ts, verifyStoreDeliveryAddress).
 *
 * Os casos são da Divinos Burger (Cabo Frio), lidos do banco em 30/10/2026:
 * pedidos "📍 Taxa pelo bairro" cuja rua o Nominatim não conhece, e entregas
 * anteriores da loja nas mesmas ruas com GPS/pino. O mapa é simulado com o que
 * o Nominatim respondeu de verdade naquela noite (rua: nada; bairro: o centro
 * da "Vila Monte Alegre" / "Vila Boca do Mato").
 *
 * Rodar: npx tsx scripts/teste-rua-das-entregas.ts
 */
import { chaveDaRua, ruasDasEntregas, pontoDaRuaNasEntregas, type EntregaComPonto } from "../src/lib/rua-das-entregas";
import { verifyStoreDeliveryAddress, semTipoRepetido, haversineDistanceKm, type GeocodificadorDaTaxa, type ResultadoDoMapa, type TrechoDeRua } from "../src/lib/geocoding";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe: unknown = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${detalhe !== "" ? ` — ${typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)}` : ""}`);
}

// ── 1. A chave do nome da rua ────────────────────────────────────────────
const chaves: [string, string][] = [
  ["Rua Moacir dos Santos Moreira, 16 - Monte alegre (Casa do portão)", "moacir santos moreira"],
  ["Rua Moacir dos Santos Moreira, 16 - Casa do portão de garagem de madeira", "moacir santos moreira"],
  ["rua isabela, 12 - boca do mato", "isabela"],
  ["Rua travessa Monte Horebe, 00 - Monte Alegre (Casa)", "monte horebe"],
  ["Rua monte horebe, 102 - Monte alegre", "monte horebe"],
  ["Rua travessa diamante 7, monte alegre", "diamante"],
  ["Rua Marina n°5, 5 - Boca do mato (Casa)", "marina"],
  ["Rua Marina,14, 14 - Monte alegre", "marina"],
  ["Rua andorinha N°9 Monte Alegre", "andorinha"],
  ["Rua 13 de Maio, 47 - Vila Monte Alegre", "13 maio"],
  ["Rua Dr Cardoso da Fonseca, 95 - Monte Alegre", "doutor cardoso fonseca"],
  ["Rua Doutor Cardoso Fonseca, 80 - Monte Alegre", "doutor cardoso fonseca"],
  ["Travessa liberdade beco 1, 18 - Boca do mato", "liberdade beco"],
  ["Rua travessa da liberdade beco um, 3 - Monte Alegre", "liberdade beco"],
  ["Avenida Caminho de Buzios, 01 - Caminho de búzios", "caminho buzios"],
  ["R. Rio Grande do Sul, 26 - Comp: Casa - Parque Riviera - Cabo Frio", "rio grande sul"],
  ["Rua A, 2 - Parque eldorado 3", ""],
  ["Beco Um, 23 - Monte alegre", ""],
  ["", ""],
];
for (const [texto, esperado] of chaves) conferir(`chave de "${texto}"`, chaveDaRua(texto) === esperado, chaveDaRua(texto));

// ── 2. O ponto da rua pelas entregas ─────────────────────────────────────
const CENTRO_MONTE_ALEGRE = { lat: -22.8501294, lng: -42.0223342 }; // "Vila Monte Alegre" no OSM
const CENTRO_BOCA_DO_MATO = { lat: -22.8517822, lng: -42.0352505 }; // "Vila Boca do Mato" no OSM
const LOJA = { lat: -22.85440922847331, lng: -42.02955545840913 };

const entregas: EntregaComPonto[] = [
  // A véspera do pedido do print: o robô entregou na Moacir pelo GPS.
  { endereco: "Rua Moacir dos Santos Moreira, 16 - Casa do portão de garagem de madeira", bairro: null, ponto: { lat: -22.845283, lng: -42.025718 } },
  { endereco: "Rua Moacir dos Santos Moreira, 12 - Jardim Esperança (Portão prata)", bairro: "Jardim Esperança", ponto: { lat: -22.84558728515855, lng: -42.02516984927571 } },
  // O "pino" da Rua Isabela que ninguém arrastou: está no centro da Vila Monte Alegre.
  { endereco: "Rua Isabela, 3 - Monte Alegre", bairro: "Monte Alegre", ponto: { ...CENTRO_MONTE_ALEGRE } },
  // Duas entregas de verdade na Rua Isabela, no Boca do Mato.
  { endereco: "Rua Isabela, 20 - Boca do Mato", bairro: "Boca do Mato", ponto: { lat: -22.8551, lng: -42.0331 } },
  { endereco: "Rua Isabela, 7 - Boca do mato", bairro: "Boca do mato", ponto: { lat: -22.8547, lng: -42.0335 } },
  // Diamante: a Travessa no Monte Alegre e a Rua Diamante do Peró, a ~5 km.
  { endereco: "Travessa diamante, 24 - Monte Alegre (Casa da Josi)", bairro: "Monte Alegre", ponto: { lat: -22.852232, lng: -42.0287921 } },
  { endereco: "Rua Diamante, 300 - Peró", bairro: "Peró", ponto: { lat: -22.8770, lng: -41.9910 } },
  // Uma rua em dois cantos, sem bairro escrito: não é uma rua.
  { endereco: "Rua Nova, 1", bairro: null, ponto: { lat: -22.850, lng: -42.030 } },
  { endereco: "Rua Nova, 9", bairro: null, ponto: { lat: -22.880, lng: -42.000 } },
  // Uma entrega só, no Porto do Carro.
  { endereco: "Rua Francisco Viana, 40 - Porto do Carro", bairro: "Porto do Carro", ponto: { lat: -22.8509, lng: -42.0404 } },
];
const indice = ruasDasEntregas(entregas, [CENTRO_MONTE_ALEGRE, CENTRO_BOCA_DO_MATO]);

const moacir = pontoDaRuaNasEntregas(["Rua Moacir dos Santos Moreira"], "Monte alegre", indice);
conferir("Moacir (cliente diz Monte Alegre, entregas sem bairro e no Jardim Esperança): usa as duas", moacir?.entregas === 2 && moacir.mesmoBairro === false, moacir);

const isabela = pontoDaRuaNasEntregas(["rua isabela"], "boca do mato", indice);
conferir("Isabela: o pino no centro do bairro fica de fora, valem as duas do Boca do Mato", isabela?.entregas === 2 && isabela.mesmoBairro === true && Math.abs(isabela.lat - -22.8549) < 1e-4, isabela);

const diamante = pontoDaRuaNasEntregas(["Rua travessa diamante"], "Monte Alegre", indice);
conferir("Diamante no Monte Alegre: só a travessa do Monte Alegre (a do Peró é outra)", diamante?.entregas === 1 && diamante.mesmoBairro && diamante.lat === -22.852232, diamante);

const diamanteSemBairro = pontoDaRuaNasEntregas(["Rua Diamante"], null, indice);
conferir("Diamante sem bairro: as duas ficam a 5 km uma da outra — nada", diamanteSemBairro === null, diamanteSemBairro);

conferir("Rua Nova em dois cantos: nada", pontoDaRuaNasEntregas(["Rua Nova"], null, indice) === null);
conferir("Rua que a loja nunca entregou: nada", pontoDaRuaNasEntregas(["Rua Gustavo Ferreira de Carvalho"], "Porto do Carro", indice) === null);
const viana = pontoDaRuaNasEntregas(["Rua Francisco Viana"], "Porto do Carro", indice);
conferir("Francisco Viana: uma entrega, mesmo bairro", viana?.entregas === 1 && viana.mesmoBairro, viana);

// ── 3. O tipo da via escrito duas vezes ──────────────────────────────────
conferir("Rua travessa Monte Horebe → Travessa / Rua Monte Horebe", JSON.stringify(semTipoRepetido("Rua travessa Monte Horebe")) === JSON.stringify(["Rua travessa Monte Horebe", "Travessa Monte Horebe", "Rua Monte Horebe"]), semTipoRepetido("Rua travessa Monte Horebe"));
conferir("Rua Monte Horebe fica como está", JSON.stringify(semTipoRepetido("Rua Monte Horebe")) === JSON.stringify(["Rua Monte Horebe"]));

// ── 4. A cotação inteira, com o mapa simulado ────────────────────────────
const ZONAS = [{ km: 1, fee: 5, time: 50 }, { km: 1.5, fee: 8, time: 30 }, { km: 2, fee: 10, time: 35 }, { km: 3, fee: 15, time: 50 }, { km: 5.5, fee: 20, time: 60 }];
const area = (p: { lat: number; lng: number }, nome: string): ResultadoDoMapa => ({ ...p, displayName: `${nome}, Cabo Frio, Rio de Janeiro, Região Sudeste, Brasil`, rua: nome, bairro: nome, cidades: ["Cabo Frio"], nivel: "area" });
const perguntas: string[] = [];
const mapa: GeocodificadorDaTaxa = {
  async livre(q) {
    perguntas.push(`livre:${q}`);
    const n = q.toLowerCase();
    if (/^monte alegre, cabo frio$/.test(n)) return { ok: true, valor: area(CENTRO_MONTE_ALEGRE, "Vila Monte Alegre") };
    if (/^boca do mato, cabo frio$/.test(n)) return { ok: true, valor: area(CENTRO_BOCA_DO_MATO, "Vila Boca do Mato") };
    return { ok: true, valor: null };
  },
  async estruturada(rua) {
    perguntas.push(`rua:${rua}`);
    const t: TrechoDeRua = { lat: -22.8490646, lng: -42.0288521, displayName: "Rua Monte Horebe, Vila Monte Alegre, Cabo Frio", suburb: "Vila Monte Alegre", rua: "Rua Monte Horebe", cidades: ["Cabo Frio"] };
    return { ok: true, valor: /^(rua|travessa) monte horebe$/i.test(rua) ? [t] : [] };
  },
};
const cotar = (texto: string, partes: any, comEntregas = true) =>
  verifyStoreDeliveryAddress(null, LOJA, "Cabo Frio", ZONAS, "KM", texto, null, {}, partes, {
    geocodificador: mapa,
    prazo: Date.now() + 10_000,
    ...(comEntregas ? { ruaNasEntregas: async (ruas: string[], bairro: string | null) => pontoDaRuaNasEntregas(ruas, bairro, indice) } : {}),
  });

(async () => {
  const partesMoacir = { street: "Rua Moacir dos Santos Moreira", number: "16", neighborhood: "Monte alegre", city: "Cabo Frio" };
  const antes = await cotar("Rua Moacir dos Santos Moreira, 16 - Monte alegre", partesMoacir, false);
  conferir("ANTES (sem as entregas): Moacir sai pelo bairro, centro da Vila Monte Alegre", antes?.origemDoPonto === "bairro" && antes?.peloBairro === true, { origem: antes?.origemDoPonto, km: antes?.distanceKm });
  const depois = await cotar("Rua Moacir dos Santos Moreira, 16 - Monte alegre", partesMoacir);
  conferir("DEPOIS: Moacir pela rua das entregas, sem aviso de taxa pelo bairro", depois?.origemDoPonto === "mapa" && !depois?.peloBairro && !depois?.pedeConfirmacao && depois?.precisao === "rua", { origem: depois?.origemDoPonto, km: depois?.distanceKm, taxa: depois?.deliveryFee, d: depois?.matchedAddress });
  const kmReal = Math.round(haversineDistanceKm(LOJA.lat, LOJA.lng, -22.845283, -42.025718) * 100) / 100;
  // A loja cobrou R$ 8 à mão nesse pedido ("o mapa não achou o endereço"): é a faixa de 1,5 km.
  conferir("DEPOIS: R$ 8, a taxa que a loja corrigiu à mão no pedido de 29/10", depois?.deliveryFee === 8, depois?.deliveryFee);
  conferir("DEPOIS: a distância é a da casa (GPS de antes), não a do centro do bairro", Math.abs((depois?.distanceKm ?? 0) - kmReal) < 0.05, { depois: depois?.distanceKm, gps: kmReal, centro: antes?.distanceKm });

  const isa = await cotar("rua isabela, 12 - boca do mato", { street: "rua isabela", number: "12", neighborhood: "boca do mato", city: "Cabo Frio" });
  conferir("Isabela pelo Boca do Mato: ponto das entregas", isa?.origemDoPonto === "mapa" && !isa?.peloBairro, { origem: isa?.origemDoPonto, km: isa?.distanceKm });

  // A Rua Diamante do Peró escrita por quem mora no Peró: a travessa do Monte
  // Alegre não serve (fica a ~4 km do centro do Peró) — o mapa simulado não
  // conhece o Peró, e com UMA entrega de outro bairro não vale.
  const pero = await cotar("Rua Diamante, 300 - Peró", { street: "Rua Diamante", number: "300", neighborhood: "Peró", city: "Cabo Frio" });
  conferir("Rua Diamante do Peró: não herda a do Monte Alegre", !(pero?.addressFound && Math.abs((pero.clienteLat ?? 0) - -22.852232) < 1e-6), { found: pero?.addressFound, lat: pero?.clienteLat });

  perguntas.length = 0;
  const horebe = await cotar("Rua travessa Monte Horebe, 00 - Monte Alegre", { street: "Rua travessa Monte Horebe", number: "00", neighborhood: "Monte Alegre", city: "Cabo Frio" }, false);
  conferir("Rua travessa Monte Horebe: o mapa acha a Rua Monte Horebe (tipo repetido desfeito)", horebe?.origemDoPonto === "mapa" && !horebe?.peloBairro, { origem: horebe?.origemDoPonto, km: horebe?.distanceKm, perguntas });

  // Sem o gancho (loja sem id): tudo como antes.
  const semGancho = await cotar("rua isabela, 12 - boca do mato", { street: "rua isabela", number: "12", neighborhood: "boca do mato", city: "Cabo Frio" }, false);
  conferir("Sem as entregas: Isabela segue pelo bairro, como antes", semGancho?.origemDoPonto === "bairro" && semGancho?.peloBairro === true);

  // Banco fora: o gancho lança e a cotação segue.
  const comErro = await verifyStoreDeliveryAddress(null, LOJA, "Cabo Frio", ZONAS, "KM", "rua isabela, 12 - boca do mato", null, {}, { street: "rua isabela", number: "12", neighborhood: "boca do mato", city: "Cabo Frio" }, {
    geocodificador: mapa, prazo: Date.now() + 10_000, ruaNasEntregas: async () => { throw new Error("banco fora"); },
  });
  conferir("Banco fora: segue pelo bairro, sem quebrar", comErro?.origemDoPonto === "bairro");

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
