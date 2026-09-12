/**
 * Prova do polígono de exclusão.
 *
 *   node scripts/teste-area-de-risco.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/area-de-risco.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { dentroDoPoligono, areaDeRiscoDoPonto, areasDeRisco } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

// Um quadrado de ~1 km em Rio das Ostras
const quadrado = [
  [-22.520, -41.950],
  [-22.520, -41.940],
  [-22.530, -41.940],
  [-22.530, -41.950],
];

console.log("\n1) Dentro e fora de um quadrado");
conferir("centro está dentro", dentroDoPoligono({ lat: -22.525, lng: -41.945 }, quadrado));
conferir("ao norte está fora", !dentroDoPoligono({ lat: -22.510, lng: -41.945 }, quadrado));
conferir("ao sul está fora", !dentroDoPoligono({ lat: -22.540, lng: -41.945 }, quadrado));
conferir("a leste está fora", !dentroDoPoligono({ lat: -22.525, lng: -41.930 }, quadrado));
conferir("a oeste está fora", !dentroDoPoligono({ lat: -22.525, lng: -41.960 }, quadrado));

console.log("\n2) Polígono em L — o vão do L está FORA");
// Um L: o canto de dentro não pode ser considerado dentro.
const ele = [
  [0, 0], [0, 10], [4, 10], [4, 4], [10, 4], [10, 0],
];
conferir("perna de baixo está dentro", dentroDoPoligono({ lat: 2, lng: 2 }, ele));
conferir("perna da direita está dentro", dentroDoPoligono({ lat: 8, lng: 2 }, ele));
conferir("o vão do L está fora", !dentroDoPoligono({ lat: 8, lng: 8 }, ele), "ray casting falhou no côncavo");

console.log("\n3) Lista lida do deliveryConfig");
const config = {
  areasDeRisco: [
    { nome: "Morro do Cemitério", pontos: quadrado },
    { nome: "Desligada", pontos: quadrado, ativa: false },
    { nome: "Linha, não polígono", pontos: [[0, 0], [1, 1]] },
    { nome: "Lixo", pontos: [["a", "b"], [null, 2], [3, 4]] },
  ],
};
const lidas = areasDeRisco(config);
conferir(`só as válidas entram (${lidas.length} de 4)`, lidas.length === 2);
conferir("a desligada não recusa", areaDeRiscoDoPonto({ lat: -22.525, lng: -41.945 }, {
  areasDeRisco: [{ nome: "Desligada", pontos: quadrado, ativa: false }],
}) === null);
conferir("a ativa recusa e diz o nome",
  areaDeRiscoDoPonto({ lat: -22.525, lng: -41.945 }, config) === "Morro do Cemitério");
conferir("ponto fora não recusa",
  areaDeRiscoDoPonto({ lat: -22.500, lng: -41.900 }, config) === null);

console.log("\n4) Sem coordenada não se recusa ninguém");
conferir("null não recusa", areaDeRiscoDoPonto(null, config) === null);
conferir("NaN não recusa", areaDeRiscoDoPonto({ lat: NaN, lng: -41.9 }, config) === null);
conferir("config vazio não recusa", areaDeRiscoDoPonto({ lat: -22.525, lng: -41.945 }, null) === null);

console.log("\n5) Aceita {lat,lng} além de [lat,lng]");
const comObjetos = { areasDeRisco: [{ nome: "X", pontos: quadrado.map(([lat, lng]) => ({ lat, lng })) }] };
conferir("recusa igual", areaDeRiscoDoPonto({ lat: -22.525, lng: -41.945 }, comObjetos) === "X");

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
