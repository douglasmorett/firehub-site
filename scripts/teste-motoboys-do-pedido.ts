/**
 * Quais motoboys o seletor do pedido oferece (lib/motoboys-do-pedido.ts).
 *
 *   npx tsx scripts/teste-motoboys-do-pedido.ts
 *
 * O caso real: Annalu Pizzas (principal) + Rush Pizza + PasteLê do Carioca, em
 * "Todas as Lojas" (30/10/2026). O pedido só aceita motoboy da loja dele.
 */
import { motoboysDosPedidos } from "../src/lib/motoboys-do-pedido";

let falhas = 0;
const confere = (oQue: string, obtido: string[], esperado: string[]) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const nomes = (l: { name: string }[]) => l.map((m) => m.name);

const annalu = "cmvjuzn3100ifps07ux2oir1q";
const pastele = "cmvjx0aga01nhps07u4pbl613";
const rush = "cmvjwuc1d01m3ps07yniw4dzc";

const doGrupo = [
  { id: "m1", name: "João (Annalu)", franchiseeId: annalu },
  { id: "m2", name: "Zé (Annalu)", franchiseeId: annalu },
  { id: "m3", name: "João (PasteLê)", franchiseeId: pastele },
  { id: "m4", name: "Beto (Rush)", franchiseeId: rush },
];
const soDaAnnalu = doGrupo.filter((m) => m.franchiseeId === annalu);

console.log("\n— Fora do \"todas\": lista de uma loja só, nada muda —");
confere("pedido da própria loja", nomes(motoboysDosPedidos(soDaAnnalu, [{ franchiseeId: annalu }])), ["João (Annalu)", "Zé (Annalu)"]);
confere("pedido antigo gravado com outro id (funcionário): a lista inteira", nomes(motoboysDosPedidos(soDaAnnalu, [{ franchiseeId: "staff1" }])), ["João (Annalu)", "Zé (Annalu)"]);
confere("sem pedido (lote vazio): a lista inteira", nomes(motoboysDosPedidos(soDaAnnalu, [])), ["João (Annalu)", "Zé (Annalu)"]);
const nenhum: typeof doGrupo = [];
confere("lista vazia", nomes(motoboysDosPedidos(nenhum, [{ franchiseeId: annalu }])), []);
confere("lista ainda não carregada (null)", nomes(motoboysDosPedidos<(typeof doGrupo)[number]>(null, [{ franchiseeId: annalu }])), []);

console.log("\n— \"Todas as Lojas\": cada pedido com os motoboys da loja dele —");
confere("pedido da PasteLê → só o da PasteLê", nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: pastele }])), ["João (PasteLê)"]);
confere("pedido da Annalu → só os da Annalu", nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: annalu }])), ["João (Annalu)", "Zé (Annalu)"]);
confere("pedido da Rush → só o da Rush", nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: rush }])), ["Beto (Rush)"]);
confere("lote só da PasteLê → só o da PasteLê", nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: pastele }, { franchiseeId: pastele }])), ["João (PasteLê)"]);
confere(
  "lote misto Annalu + Rush → os das duas (o servidor recusa o que não for da loja de cada pedido)",
  nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: annalu }, { franchiseeId: rush }])),
  ["João (Annalu)", "Zé (Annalu)", "Beto (Rush)"],
);
confere("pedido de loja sem motoboy cadastrado → lista vazia", nomes(motoboysDosPedidos(doGrupo, [{ franchiseeId: "loja-sem-motoboy" }])), []);
confere("pedido nulo no lote não quebra", nomes(motoboysDosPedidos(doGrupo, [null, { franchiseeId: rush }])), ["Beto (Rush)"]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
