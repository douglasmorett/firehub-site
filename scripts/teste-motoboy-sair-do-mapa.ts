/**
 * Teste do "Sair" do entregador tirando o capacete do mapa da loja
 * (lib/motoboy-sair-do-mapa.ts, usado no DELETE /api/motoboys/location). Rodar:
 * npx tsx scripts/teste-motoboy-sair-do-mapa.ts
 */
import { tirarMotoboyDoMapa } from "../src/lib/motoboy-sair-do-mapa";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

function bancoFalso(achados: number) {
  const chamadas: any[] = [];
  return {
    chamadas,
    motoboy: {
      async updateMany(args: any) { chamadas.push(args); return { count: achados }; },
    },
  };
}

(async () => {
  // Sessão válida: apaga as três colunas, preso à loja da sessão.
  const db = bancoFalso(1);
  const saiu = await tirarMotoboyDoMapa(db, { id: "mb1", franchiseeId: "loja1" });
  confere("sessão válida sai do mapa", saiu, true);
  confere("uma escrita só", db.chamadas.length, 1);
  confere("escopo é o entregador E a loja da sessão", db.chamadas[0]?.where, { id: "mb1", franchiseeId: "loja1" });
  confere("apaga posição e horário (nada mais)", db.chamadas[0]?.data, { lastLat: null, lastLng: null, lastLocationUpdate: null });

  // Sessão vencida/ausente: não escreve nada e não lança.
  const db2 = bancoFalso(1);
  confere("sem sessão não sai de nada", await tirarMotoboyDoMapa(db2, null), false);
  confere("sem sessão não toca no banco", db2.chamadas.length, 0);

  // Cadastro que sumiu entre a sessão e a escrita: só devolve false.
  const db3 = bancoFalso(0);
  confere("linha não achada devolve false", await tirarMotoboyDoMapa(db3, { id: "x", franchiseeId: "y" }), false);

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
})();
