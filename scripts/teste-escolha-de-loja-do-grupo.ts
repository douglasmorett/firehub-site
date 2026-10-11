/**
 * Qual loja do grupo fica com o cliente (lib/escolha-de-loja-do-grupo.ts),
 * a regra da página /lojas/[slug].
 *
 *   npx tsx scripts/teste-escolha-de-loja-do-grupo.ts
 *
 * O caso: Pizzaria 17 (Cavaleiros) e Pizzaria 17 Aeroporto, Macaé, 10/10/2026.
 */
import { bairroDoEndereco, bairrosDoGrupo, escolherLoja, type ResultadoDaLoja } from "../src/lib/escolha-de-loja-do-grupo";

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
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: [], porDistancia: false });

confere("as duas atendem o Centro, só pelo bairro → a mais barata primeiro, a outra também aparece",
  escolherLoja([r("aero", "ATENDE", 8, 45), r("p17", "ATENDE", 7, 40)]),
  { tipo: "ATENDE", lojaId: "p17", tambemAtendem: ["aero"], porDistancia: false });

confere("as duas atendem e o GPS dá a distância → a mais perto primeiro, mesmo mais cara",
  escolherLoja([r("p17", "ATENDE", 7, 40, 3.8), r("aero", "ATENDE", 8, 45, 1.2)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: ["p17"], porDistancia: true });

confere("distância de uma só → não ordena por distância (volta para a taxa)",
  escolherLoja([r("p17", "ATENDE", 7, 40, null), r("aero", "ATENDE", 8, 45, 1.2)]),
  { tipo: "ATENDE", lojaId: "p17", tambemAtendem: ["aero"], porDistancia: false });

confere("mesma taxa → a mais rápida",
  escolherLoja([r("p17", "ATENDE", 6, 45), r("aero", "ATENDE", 6, 30)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: ["p17"], porDistancia: false });

confere("taxa desconhecida perde para taxa conhecida",
  escolherLoja([r("p17", "ATENDE", null, null), r("aero", "ATENDE", 9, 50)]),
  { tipo: "ATENDE", lojaId: "aero", tambemAtendem: ["p17"], porDistancia: false });

confere("FORA das duas → nenhuma (não chuta loja que recusou)",
  escolherLoja([r("p17", "FORA", null, null, 2), r("aero", "FORA", null, null, 3)]),
  { tipo: "NENHUMA" });

confere("dúvida nas duas (mapa fora) → a mais perto em linha reta",
  escolherLoja([r("p17", "DESCONHECIDO", null, null, 6.2), r("aero", "DESCONHECIDO", null, null, 1.4)]),
  { tipo: "MAIS_PERTO", lojaId: "aero" });

confere("GPS no Rio dá 'Centro' e o Centro de Macaé 'atende' a 158 km → nenhuma (bairro homônimo)",
  escolherLoja([r("p17", "ATENDE", 10, 45, 161), r("aero", "ATENDE", 10, 45, 158)]),
  { tipo: "NENHUMA" });

confere("a 5 km com o bairro certo continua valendo",
  escolherLoja([r("p17", "ATENDE", 7, 45, 5), r("aero", "FORA", null, null, 9)]),
  { tipo: "ATENDE", lojaId: "p17", tambemAtendem: [], porDistancia: false });

confere("dúvida e o cliente a 150 km (GPS em outra cidade) → nenhuma, não manda para longe",
  escolherLoja([r("p17", "DESCONHECIDO", null, null, 150), r("aero", "DESCONHECIDO", null, null, 148)]),
  { tipo: "NENHUMA" });

confere("dúvida sem ponto do cliente (mapa fora) → DÚVIDA, não 'não entregamos'",
  escolherLoja([r("p17", "DESCONHECIDO", null, null), r("aero", "DESCONHECIDO", null, null)]),
  { tipo: "DUVIDA" });

confere("uma FORA com certeza e outra em dúvida sem ponto → DÚVIDA",
  escolherLoja([r("p17", "FORA", null, null), r("aero", "DESCONHECIDO", null, null)]),
  { tipo: "DUVIDA" });

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

confere("bairro da loja pelo endereço — Pizzaria 17 (real)",
  bairroDoEndereco("Avenida W 24 - Lagomar, Macaé - Rio de Janeiro"), "Lagomar");
confere("bairro da loja pelo endereço — Aeroporto (real)",
  bairroDoEndereco("R. Dr. Bezerra Menezes, 55 - Jardim Aeroporto, Macaé - RJ, 27950-140"), "Jardim Aeroporto");
confere("endereço sem ' - ' não inventa bairro", bairroDoEndereco("Rua A, 10, Macaé"), null);
confere("endereço vazio", bairroDoEndereco(null), null);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
