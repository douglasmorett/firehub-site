/**
 * O endereço que o robô da Ragnar Burger não achava (24/09/2026):
 *
 *   "WE 62, 661 - Cidade Nova 5 (próximo ao Colina)" — Ananindeua
 *
 * O mapa não voltava NADA: a referência entre parênteses derrubava a busca
 * livre, e a busca pela rua nem rodava porque "WE 62" não tem "Rua" nem
 * "Travessa" na frente (o mapa conhece como "Travessa WE 62"). O robô segurou o
 * pedido sem taxa e chamou atendente — o certo, sem endereço — mas o endereço
 * existia, a 390 m da loja.
 *
 *   npx tsx scripts/teste-endereco-sem-tipo-de-rua.ts          (sem internet)
 *   npx tsx scripts/teste-endereco-sem-tipo-de-rua.ts --mapa   (pergunta ao mapa de verdade)
 *
 * lib/geocoding carrega o prisma (via distancia-por-rota), que exige uma
 * DATABASE_URL só para subir o módulo: o teste põe uma que nunca é usada.
 */
process.env.DATABASE_URL ||= "postgresql://teste@localhost:1/nao-usado";
type Geo = typeof import("../src/lib/geocoding");
let G: Geo;

let ok = 0, falhou = 0;
const conferir = (nome: string, cond: boolean, extra = "") => {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome} ${extra}`); }
};

function semMapa() {
  console.log("== A referência sai do texto que vai ao mapa ==");
  conferir("parêntese inteiro", G.semReferencias("WE 62, 661 - Cidade Nova 5 (próximo ao Colina)") === "WE 62, 661 - Cidade Nova 5");
  conferir("frase de referência no meio", G.semReferencias("Rua das Flores, 12, perto do mercado, Centro") === "Rua das Flores, 12, Centro");
  conferir("\"em frente\" e \"ref:\"", G.semReferencias("Av. Brasil, 300, em frente à igreja, ref: portão azul") === "Av. Brasil, 300");
  conferir("endereço sem referência não muda", G.semReferencias("Rua Sol Nascente, 23, Aquários") === "Rua Sol Nascente, 23, Aquários");

  console.log("\n== A rua sem tipo vira as ruas que vale procurar ==");
  conferir("WE 62 → Travessa/Rua WE 62", JSON.stringify(G.logradourosCandidatos("WE 62, 661 - Cidade Nova 5")) === JSON.stringify(["Travessa WE 62", "Rua WE 62"]));
  conferir("we-62 no meio da conversa", JSON.stringify(G.logradourosCandidatos("sim, pode ser pix. fica na we-62 nº 661")) === JSON.stringify(["Travessa WE 62", "Rua WE 62"]));
  conferir("SN 10", JSON.stringify(G.logradourosCandidatos("SN 10, 45 - Cidade Nova")) === JSON.stringify(["Travessa SN 10", "Rua SN 10"]));
  conferir("com o tipo escrito é ela e pronto", JSON.stringify(G.logradourosCandidatos("Rua Sol Nascente, 23, Aquários")) === JSON.stringify(["Rua Sol Nascente"]));
  conferir("frase comum não vira rua", G.logradourosCandidatos("quero 2 x-burguer de 10 reais").length === 0);
}

async function noMapa() {
  console.log("\n== No mapa de verdade (Ragnar Burger, raio 1,5 / 2,5 / 3,5 km) ==");
  const r = await G.verifyStoreDeliveryAddress(
    "Travessa WE 55 - Cidade Nova V, Ananindeua - Pará",
    { lat: -1.358612821312498, lng: -48.39584693312646 },
    "ANANINDEUA",
    [{ km: 1.5, fee: 6, time: 30 }, { km: 2.5, fee: 8, time: 45 }, { km: 3.5, fee: 11, time: 60 }],
    "KM",
    "WE 62, 661 - Cidade Nova 5 (próximo ao Colina)",
    null, {}, undefined,
  );
  conferir("acha o endereço", !!r?.addressFound, JSON.stringify(r));
  conferir("é a Travessa WE 62", /WE 62/i.test(String(r?.matchedAddress || "")), String(r?.matchedAddress));
  conferir("no bairro do cliente (Cidade Nova 5 = V), perto da loja", (r?.distanceKm ?? 99) < 0.6, `${r?.distanceKm} km`);
  conferir("primeira faixa, R$ 6", r?.deliveryFee === 6, `R$ ${r?.deliveryFee}`);
}

(async () => {
  G = await import("../src/lib/geocoding");
  semMapa();
  if (process.argv.includes("--mapa")) await noMapa();
  console.log(`\n${ok} ok, ${falhou} falharam`);
  // exitCode, e não exit(): encerrar à força com a conexão do mapa fechando
  // derruba o Node no Windows ("UV_HANDLE_CLOSING").
  process.exitCode = falhou ? 1 : 0;
})();
