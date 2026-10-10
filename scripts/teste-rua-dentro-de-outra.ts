/**
 * Nome de rua dentro de outro (lib/geocodificacao.ts, nomeDeRuaParecido).
 * "Rua Marina" do Divinos não é a "Rua Marina do Canal Palmer" (09/10/2026).
 * Rodar: npx tsx scripts/teste-rua-dentro-de-outra.ts
 */
import { nomeDeRuaParecido as parecido } from "../src/lib/geocodificacao";

const casos: [string, string, boolean][] = [
  ["Rua Marina", "Rua Marina do Canal Palmer", false],
  ["Rua Getúlio", "Rua Getúlio Vargas", true],
  ["Av. Brasil", "Avenida Brasil", true],
  ["Rua Francisco Lirola", "Rua Francisco Lirola Sobrinho", true],
  ["Rua das Flores", "Rua das Flores Azuis", true],
  ["Rua Marina", "Rua Marina", true],
  ["Travessa Pantanal", "Travessa Pantanal", true],
];
let falhas = 0;
for (const [a, b, esperado] of casos) {
  const r = parecido(a, b);
  if (r !== esperado) falhas++;
  console.log(`${r === esperado ? "ok  " : "FALHOU"} ${a} × ${b} => ${r}`);
}
console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
