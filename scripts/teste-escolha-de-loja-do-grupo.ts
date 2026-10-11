/**
 * Qual loja do grupo fica com o cliente (lib/escolha-de-loja-do-grupo.ts),
 * a regra da página /lojas/[slug].
 *
 *   npx tsx scripts/teste-escolha-de-loja-do-grupo.ts
 *
 * O caso: Pizzaria 17 (Cavaleiros) e Pizzaria 17 Aeroporto, Macaé, 10/10/2026.
 */
import { bairrosDoGrupo, escolherLoja, type ResultadoDaLoja } from "../src/lib/escolha-de-loja-do-grupo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const r = (lojaId: string, resultado: "ATENDE" | "FORA" | "DESCONHECIDO", taxa: number | null, tempoMin: number | null, distanciaRetaKm: number | null = null): ResultadoDaLoja =>
  ({ lojaId, veredicto: { resultado, taxa, tempoMin }, distanciaRetaKm });

confere("só a do Aeroporto atende → Aeroporto",
  escolherLoja([r("p17", "FORA", null, null), r("aero", "ATENDE", 5, 30)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: [] });

confere("as duas atendem o Centro → a mais barata, a outra como 'também'",
  escolherLoja([r("aero", "ATENDE", 8, 45), r("p17", "ATENDE", 7, 40)]),
  { tipo: "ATENDE", lojaId: "p17", tambemAtendem: ["aero"] });

confere("mesma taxa → a mais rápida",
  escolherLoja([r("p17", "ATENDE", 6, 45), r("aero", "ATENDE", 6, 30)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: ["p17"] });

confere("taxa desconhecida perde para taxa conhecida",
  escolherLoja([r("p17", "ATENDE", null, null), r("aero", "ATENDE", 9, 50)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: ["p17"] });

confere("FORA das duas → nenhuma (não chuta loja que recusou)",
  escolherLoja([r("p17", "FORA", null, null, 2), r("aero", "FORA", null, null, 3)]),
  { tipo: "NENHUMA" });

confere("dúvida nas duas (mapa fora) → a mais perto em linha reta",
  escolherLoja([r("p17", "DESCONHECIDO", null, null, 6.2), r("aero", "DESCONHECIDO", null, null, 1.4)]),
  { tipo: "MAIS_PERTO", lojaId: "aero" });

confere("dúvida sem ponto do cliente → nenhuma",
  escolherLoja([r("p17", "DESCONHECIDO", null, null), r("aero", "DESCONHECIDO", null, null)]),
  { tipo: "NENHUMA" });

confere("uma FORA e outra em dúvida → a em dúvida",
  escolherLoja([r("p17", "FORA", null, null, 0.5), r("aero", "DESCONHECIDO", null, null, 4)]),
  { tipo: "MAIS_PERTO", lojaId: "aero" });

confere("bairros do grupo: Centro das duas lojas aparece uma vez, sem diferenciar acento",
  bairrosDoGrupo([
    { cidade: "Macaé", bairros: ["Centro", "Cavaleiros", "Glória"] },
    { cidade: "Macaé", bairros: ["centro", "Aeroporto", "Gloria"] },
  ]).map((b) => b.nome),
  ["Aeroporto", "Cavaleiros", "Centro", "Glória"]);

confere("bairro igual em cidades diferentes fica nas duas",
  bairrosDoGrupo([
    { cidade: "Rio das Ostras", bairros: ["Centro"] },
    { cidade: "Barra de São João", bairros: ["Centro"] },
  ]).map((b) => `${b.nome}/${b.cidade}`),
  ["Centro/Barra de São João", "Centro/Rio das Ostras"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
