/**
 * "Fora do KDS" na impressora (lib/momento-da-impressao.ts → planoDoPapel).
 *
 *   npx tsx scripts/teste-impressora-fora-do-kds.ts
 *
 * O caso da Ragnar Burger (16/10/2026): com "Imprimir só quando o KDS
 * finalizar" ligado, o "Ruby" da mesa (categoria Drinks, impressora BAR) nunca
 * saiu — nenhuma tela do KDS finaliza um pedido só de drink — e o drink que
 * veio com o burger saiu 7 min depois, com o burger pronto. O lojista: "a
 * impressora do Bar, eu não quero que passe pelo KDS".
 *
 * Função pura, sem banco: roteia com destinosDoPedido (a mesma da fila) e
 * confere o que sai em cada momento. Com a config REAL da loja.
 */
import { destinosDoPedido, type ImpressoraConfigurada } from "../src/lib/roteamento-de-impressao";
import {
  aguardandoFimDoKds,
  impressoraForaDoKds,
  navegadorSeguraAComanda,
  papelEmDoisMomentos,
  planoDoPapel,
} from "../src/lib/momento-da-impressao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const LOJA = "cmtkosykk01jhk601arcsnu48";
// printerConfig.printers da Ragnar em 16/10/2026 (só o que o roteamento lê).
const BALCAO: ImpressoraConfigurada = { id: "1788554952330", name: "BALCÃO RAGNA", modulos: ["salao"], categories: ["Cerveja", "Entretenimento e Presentes"] };
const PIZZA: ImpressoraConfigurada = {
  id: "1788555170591", name: "COZINHA PIZZA", modulos: ["delivery", "salao"], lojas: ["ifood:ea2c4d55-efd2-4fa7-8aa7-fc1ecd6b8d52", `loja:${LOJA}`],
  categories: ["Pizzas Especiais", "Pizzas Premium", "Pizzas Tradicionais", "Sucos", "Sobremesas", "Refrigerantes", "Bordas"],
};
const ENTREGA: ImpressoraConfigurada = {
  id: "1788555182545", name: "COZINHA ENTREGA RAGNA", modulos: ["delivery", "salao"],
  lojas: ["ifood:469a9863-bf71-46ad-8c3e-2474b7cbe46b", "ifood:17ce82cb-a22b-42f4-b95e-6b912c4ad278", `loja:${LOJA}`, "ifood:ea2c4d55-efd2-4fa7-8aa7-fc1ecd6b8d52"],
  categories: ["Burgers", "Adicionais Burger", "Combos", "Entradas", "Refrigerantes", "Bordas", "Pizzas Especiais", "Pizzas Premium", "Pizzas Tradicionais", "Sobremesas", "Sucos"],
};
const BAR: ImpressoraConfigurada = { id: "1790283148331", name: "BAR", modulos: ["salao", "delivery"], lojas: [`loja:${LOJA}`], categories: ["Drinks"] };

const HOJE = { autoprint: true, imprimirSoNoFimDoKds: true, printers: [BALCAO, PIZZA, ENTREGA, BAR] };
const CORRIGIDA = { ...HOJE, printers: [BALCAO, PIZZA, ENTREGA, { ...BAR, foraDoKds: true }] };

const mesa = (items: { name: string; category: string }[], extra: Record<string, unknown> = {}) => ({
  franchiseeId: LOJA, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "cmvbm7mb102orpm01f7m7anx7",
  kdsStage: null as string | null, printedNaChegadaAt: null as string | null,
  items: items.map((i) => ({ ...i, qty: 1 })), ...extra,
});
// cmvbncq1f001qqi010md25z79 (21:16): só o drink.
const RUBY = mesa([{ name: "Ruby", category: "Drinks" }]);
// cmvbi0kfr03i4ml01x35rkhpr (18:47): burger + combo + drink.
const MISTO = mesa([
  { name: "Ragnarok", category: "Burgers" },
  { name: "Combo Thor", category: "Combos" },
  { name: "Lua de Valhalla", category: "Drinks" },
]);
const SO_BURGER = mesa([{ name: "Thor", category: "Burgers" }]);

const plano = (pedido: any, config: any) => {
  const destinos = destinosDoPedido(config.printers, pedido);
  const p = planoDoPapel(pedido, config, destinos, (d) => impressoraForaDoKds(d.impressora));
  const nomes = (l: typeof destinos | null) => (l === null ? null : l.map((d) => `${d.impressora.name}:${d.itens.map((i: any) => i.name).join("+")}`));
  return { agora: nomes(p.agora), naChegada: nomes(p.naChegada), chegadaSemPapel: p.chegadaSemPapel };
};

console.log("\n== O roteamento já mandava o drink para o BAR (não é categoria) ==");
confere("Ruby → BAR", destinosDoPedido(HOJE.printers, RUBY).map((d) => d.impressora.name), ["BAR"]);

console.log("\n== Hoje (sem impressora fora do KDS): o drink espera a cozinha ==");
confere("Ruby sem etapa no KDS: segura", aguardandoFimDoKds(RUBY, HOJE), true);
confere("Ruby: nenhum papel agora", plano(RUBY, HOJE), { agora: null, naChegada: [], chegadaSemPapel: true });
confere("misto: tudo só no fim do KDS", plano({ ...MISTO, kdsStage: "FINISHED" }, HOJE).agora, ["COZINHA ENTREGA RAGNA:Ragnarok+Combo Thor", "BAR:Lua de Valhalla"]);
confere("sem impressora marcada não liga os dois momentos", papelEmDoisMomentos(HOJE), false);

console.log("\n== BAR fora do KDS ==");
confere("dois momentos ligados", papelEmDoisMomentos(CORRIGIDA), true);
confere("Ruby sai inteiro na chegada, pelo papel principal", plano(RUBY, CORRIGIDA), { agora: ["BAR:Ruby"], naChegada: [], chegadaSemPapel: false });
confere("misto na chegada: só o drink, à parte; a cozinha espera", plano(MISTO, CORRIGIDA), { agora: null, naChegada: ["BAR:Lua de Valhalla"], chegadaSemPapel: false });
confere("misto em produção com o drink já impresso: nada", plano({ ...MISTO, kdsStage: "PRODUCTION", printedNaChegadaAt: "2026-10-16T21:47:33Z" }, CORRIGIDA), { agora: null, naChegada: [], chegadaSemPapel: false });
confere("misto finalizado: a cozinha, SEM o bar de novo", plano({ ...MISTO, kdsStage: "FINISHED", printedNaChegadaAt: "2026-10-16T21:47:33Z" }, CORRIGIDA), { agora: ["COZINHA ENTREGA RAGNA:Ragnarok+Combo Thor"], naChegada: [], chegadaSemPapel: false });
confere("misto finalizado sem a chegada ter saído (Assistente desligado): os dois", plano({ ...MISTO, kdsStage: "FINISHED" }, CORRIGIDA), { agora: ["COZINHA ENTREGA RAGNA:Ragnarok+Combo Thor"], naChegada: ["BAR:Lua de Valhalla"], chegadaSemPapel: false });
confere("só burger: espera o KDS como sempre, chegada resolvida sem papel", plano(SO_BURGER, CORRIGIDA), { agora: null, naChegada: [], chegadaSemPapel: true });
confere("só burger finalizado: sai na cozinha", plano({ ...SO_BURGER, kdsStage: "FINISHED" }, CORRIGIDA).agora, ["COZINHA ENTREGA RAGNA:Thor"]);

console.log("\n== Opção da loja desligada: a marca não muda nada ==");
const DESLIGADA = { ...CORRIGIDA, imprimirSoNoFimDoKds: false };
confere("misto sai inteiro na chegada", plano(MISTO, DESLIGADA), { agora: ["COZINHA ENTREGA RAGNA:Ragnarok+Combo Thor", "BAR:Lua de Valhalla"], naChegada: [], chegadaSemPapel: false });
confere("sem dois momentos", papelEmDoisMomentos(DESLIGADA), false);

console.log("\n== O navegador deixa os dois momentos para a fila ==");
confere("dois momentos: segura até o finalizado", navegadorSeguraAComanda({ kdsStage: "FINISHED" }, CORRIGIDA), true);
confere("só a opção da loja: libera o finalizado (como antes)", navegadorSeguraAComanda({ kdsStage: "FINISHED" }, HOJE), false);
confere("só a opção da loja: segura o que está na cozinha (como antes)", navegadorSeguraAComanda({ kdsStage: "PRODUCTION" }, HOJE), true);
confere("opção desligada: não segura", navegadorSeguraAComanda({ kdsStage: null }, DESLIGADA), false);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
