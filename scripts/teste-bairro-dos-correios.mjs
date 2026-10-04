/**
 * Prova do bairro com o nome dos Correios no texto do mapa que vai ao robô.
 *
 *   node scripts/teste-bairro-dos-correios.mjs          (sem rede)
 *   node scripts/teste-bairro-dos-correios.mjs --viacep  (+ ViaCEP de verdade)
 *
 * Os textos são os que o OpenStreetMap devolveu para a Divinos Burger (Cabo
 * Frio, 03/10/2026).
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/bairro-dos-correios.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { enderecoDoMapaComBairroDosCorreios, mesmoBairroSemPrefixo, lerTextoDoMapa } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const igual = (nome, obtido, esperado) => {
  if (obtido === esperado) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log(`  FALHA ${nome}\n        obtido   ${obtido}\n        esperado ${esperado}`);
};

// ViaCEP falso: rua → lista de { logradouro, bairro }.
const correios = {
  "Rua Beira Alta": [{ logradouro: "Rua Beira Alta", bairro: "Monte Alegre" }, { logradouro: "Travessa Beira Alta", bairro: "Monte Alegre" }],
  "Rua do Ouro": [{ logradouro: "Rua do Ouro", bairro: "Monte Alegre" }, { logradouro: "Rua Visconde do Ouro Preto", bairro: "São Cristóvão" }],
  "Rua Rosalina Cardoso da Fonseca": [{ logradouro: "Rua Rosalina Cardoso da Fonseca", bairro: "Porto do Carro" }],
  "Rua Duas Pontas": [{ logradouro: "Rua Duas Pontas", bairro: "Centro" }, { logradouro: "Rua Duas Pontas", bairro: "Vila Nova" }],
};
let chamadas = 0;
const fetchFalso = async (url) => {
  chamadas++;
  const rua = decodeURIComponent(url.split("/").slice(-3, -2)[0]);
  return { ok: true, json: async () => correios[rua] ?? [] };
};

console.log("\n1) Mesmo bairro sem o prefixo");
igual("Vila Monte Alegre = Monte Alegre", mesmoBairroSemPrefixo("Vila Monte Alegre", "Monte Alegre"), true);
igual("Vila Jardim Esperança = Jardim Esperança", mesmoBairroSemPrefixo("Vila Jardim Esperança", "Jardim Esperança"), true);
igual("Jardim Esperança ≠ Vila Esperança (dois bairros possíveis)", mesmoBairroSemPrefixo("Jardim Esperança", "Vila Esperança"), false);
igual("Monte Alegre ≠ Monte Alto",mesmoBairroSemPrefixo("Monte Alegre", "Monte Alto"), false);
igual("Vila Boca do Mato ≠ Porto do Carro", mesmoBairroSemPrefixo("Vila Boca do Mato", "Porto do Carro"), false);

console.log("\n2) Leitura do texto do mapa");
const lido = lerTextoDoMapa("18, Rua do Ouro, Vila Monte Alegre, Cabo Frio, Região Geográfica Imediata de Cabo Frio, Rio de Janeiro, Região Sudeste, 28922-000, Brasil", "CABO FRIO");
igual("rua", lido.pedacos[lido.rua], "Rua do Ouro");
igual("bairro", lido.pedacos[lido.bairro], "Vila Monte Alegre");
igual("cidade", lido.cidade, "Cabo Frio");
igual("uf", lido.uf, "RJ");

console.log("\n3) O texto que vai ao robô");
const f = { fetch: fetchFalso };
igual(
  "endereço da loja",
  await enderecoDoMapaComBairroDosCorreios("Rua Beira Alta, Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Região Sudeste, 28922-000, Brasil", "CABO FRIO", f),
  "Rua Beira Alta, Monte Alegre, Cabo Frio, Rio de Janeiro, 28922-000",
);
igual(
  "rua achada pelo mapa, com número",
  await enderecoDoMapaComBairroDosCorreios("18, Rua do Ouro, Vila Monte Alegre, Cabo Frio, Região Geográfica Imediata de Cabo Frio, Rio de Janeiro, Região Sudeste, 28922-000, Brasil", "CABO FRIO", f),
  "18, Rua do Ouro, Monte Alegre, Cabo Frio, Rio de Janeiro, 28922-000",
);
igual(
  "Correios dizem OUTRO bairro: o do mapa fica",
  await enderecoDoMapaComBairroDosCorreios("Rua Rosalina Cardoso da Fonseca, Vila Boca do Mato, Cabo Frio, Rio de Janeiro, Brasil", "CABO FRIO", f),
  "Rua Rosalina Cardoso da Fonseca, Vila Boca do Mato, Cabo Frio, Rio de Janeiro",
);
igual(
  "rua em dois bairros: o do mapa fica",
  await enderecoDoMapaComBairroDosCorreios("Rua Duas Pontas, Vila Centro, Cabo Frio, Rio de Janeiro, Brasil", "CABO FRIO", f),
  "Rua Duas Pontas, Vila Centro, Cabo Frio, Rio de Janeiro",
);
igual(
  "sem rua reconhecível: só tira a região",
  await enderecoDoMapaComBairroDosCorreios("Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Região Sudeste, Brasil", "CABO FRIO", f),
  "Vila Monte Alegre, Cabo Frio, Rio de Janeiro",
);
igual(
  "Correios fora do ar: texto como veio (sem região)",
  await enderecoDoMapaComBairroDosCorreios("Rua X Y, Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Brasil", "CABO FRIO", { fetch: async () => { throw new Error("rede"); } }),
  "Rua X Y, Vila Monte Alegre, Cabo Frio, Rio de Janeiro",
);
igual("vazio", await enderecoDoMapaComBairroDosCorreios("", "CABO FRIO", f), "");
const antes = chamadas;
await enderecoDoMapaComBairroDosCorreios("Rua Beira Alta, Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Brasil", "CABO FRIO", f);
igual("a mesma rua não pergunta de novo (cache)", chamadas, antes);

if (process.argv.includes("--viacep")) {
  console.log("\n4) ViaCEP de verdade");
  igual(
    "Rua do Ouro (Cabo Frio)",
    await enderecoDoMapaComBairroDosCorreios("Rua do Ouro, Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Região Sudeste, Brasil", "CABO FRIO", { prazoMs: 8000 }),
    "Rua do Ouro, Monte Alegre, Cabo Frio, Rio de Janeiro",
  );
  igual(
    "Rua Rouxinol (Cabo Frio)",
    await enderecoDoMapaComBairroDosCorreios("Rua Rouxinol, Vila Monte Alegre, Cabo Frio, Rio de Janeiro, Brasil", "CABO FRIO", { prazoMs: 8000 }),
    "Rua Rouxinol, Monte Alegre, Cabo Frio, Rio de Janeiro",
  );
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
