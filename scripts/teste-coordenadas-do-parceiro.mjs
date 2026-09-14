/**
 * Prova do leitor de coordenadas dos parceiros.
 *
 *   node scripts/teste-coordenadas-do-parceiro.mjs
 *
 * O ponto do parceiro decide onde o pino cai no mapa e qual motoboy é o mais
 * perto. Aceitar lixo aqui é pior que não ter ponto nenhum: o endereço por
 * texto ainda acerta a cidade; uma coordenada errada não acerta nada.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/coordenadas-do-parceiro.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { coordenadasDoParceiro, chavesDoEndereco } = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

// Rio das Ostras, para os casos válidos.
const RJ = { lat: -22.527, lng: -41.945 };
const perto = (p, alvo) => p && Math.abs(p.lat - alvo.lat) < 0.001 && Math.abs(p.lng - alvo.lng) < 0.001;

console.log("\n1) Os formatos que os parceiros usam");
conferir("iFood: coordinates.latitude/longitude",
  perto(coordenadasDoParceiro({ coordinates: { latitude: RJ.lat, longitude: RJ.lng } }), RJ));
conferir("lat/lng soltos no endereço",
  perto(coordenadasDoParceiro({ lat: RJ.lat, lng: RJ.lng }), RJ));
conferir("latitude/longitude soltos",
  perto(coordenadasDoParceiro({ latitude: RJ.lat, longitude: RJ.lng }), RJ));
conferir("lat/lon", perto(coordenadasDoParceiro({ lat: RJ.lat, lon: RJ.lng }), RJ));
conferir("location aninhado", perto(coordenadasDoParceiro({ location: { lat: RJ.lat, lng: RJ.lng } }), RJ));
conferir("geo aninhado", perto(coordenadasDoParceiro({ geo: { latitude: RJ.lat, longitude: RJ.lng } }), RJ));
conferir("poi_lat/poi_lng (estilo 99)", perto(coordenadasDoParceiro({ poi_lat: RJ.lat, poi_lng: RJ.lng }), RJ));
conferir("um nível abaixo, sem saber o caminho",
  perto(coordenadasDoParceiro({ deliveryAddress: { coordinates: { latitude: RJ.lat, longitude: RJ.lng } } }), RJ));
conferir("string com ponto decimal",
  perto(coordenadasDoParceiro({ lat: String(RJ.lat), lng: String(RJ.lng) }), RJ));
conferir("string com vírgula decimal",
  perto(coordenadasDoParceiro({ lat: "-22,527", lng: "-41,945" }), RJ));

console.log("\n2) Vários candidatos: usa o primeiro que responder");
conferir("pula o objeto sem ponto",
  perto(coordenadasDoParceiro({ rua: "x" }, { lat: RJ.lat, lng: RJ.lng }), RJ));
conferir("nulo e indefinido não quebram",
  perto(coordenadasDoParceiro(null, undefined, { lat: RJ.lat, lng: RJ.lng }), RJ));

console.log("\n3) O que NÃO pode virar coordenada");
conferir("zero-zero é 'não consegui localizar'", coordenadasDoParceiro({ lat: 0, lng: 0 }) === undefined);
conferir("fora do Brasil é dado errado",
  coordenadasDoParceiro({ lat: 48.85, lng: 2.35 }) === undefined);
conferir("latitude sem longitude não serve", coordenadasDoParceiro({ lat: RJ.lat }) === undefined);
conferir("texto não numérico", coordenadasDoParceiro({ lat: "perto da praça", lng: "x" }) === undefined);
conferir("objeto vazio", coordenadasDoParceiro({}) === undefined);
conferir("sem nada", coordenadasDoParceiro() === undefined);
conferir("devolve undefined, nunca null (Prisma quebra com null cru)",
  coordenadasDoParceiro({}) === undefined && coordenadasDoParceiro({}) !== null);
conferir("lat e lng trocados caem fora do Brasil e são recusados",
  coordenadasDoParceiro({ lat: RJ.lng, lng: RJ.lat }) === undefined);

console.log("\n4) O log que termina o trabalho no próximo pedido");
const chaves = chavesDoEndereco({ poi_address: "Rua X", house_number: "10", receive: { a: 1, b: 2 } });
conferir("lista as chaves do endereço", /poi_address/.test(chaves) && /house_number/.test(chaves));
conferir("mostra o que tem dentro dos objetos", /receive\{a,b\}/.test(chaves), chaves);
conferir("sem objeto, diz que não há", /sem objeto/.test(chavesDoEndereco(null)));

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
