/**
 * A prioridade do KDS é de cada etapa (lib/kds-telas.ts → prioridadeDaEtapa).
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-prioridade-por-etapa.ts
 * Pizzaria 17 (15/10/2026): mesa fura a fila na produção; na finalização, a
 * ordem de chegada nela (a primeira baixa da produção).
 */
import { lerKdsConfig, ordenarPelaPrioridade, furaAFila } from "../src/lib/kds-telas";

let falhas = 0;
const confere = (o: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${o}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const t = (h: string) => `2026-10-14T${h}:00Z`;
// delivery entrou 20:00 e saiu do forno 20:30; mesa entrou 20:10 e saiu do forno 20:35
const DELIV = { id: "deliv", deliveryType: "DELIVERY", source: "ONLINE", createdAt: t("20:00"), items: [{ prontoEm: t("20:30") }] };
const MESA = { id: "mesa", deliveryType: "MESA", source: "GARCOM", createdAt: t("20:10"), items: [{ prontoEm: t("20:35") }] };
const ids = (l: any[]) => l.map((p) => p.id);

const antiga = lerKdsConfig({ prioridade: ["MESA"] });
confere("config antiga: finalização segue a da produção", antiga.prioridadeNaFinalizacao, null);
confere("config antiga, produção: mesa na frente", ids(ordenarPelaPrioridade([DELIV, MESA], antiga, "production")), ["mesa", "deliv"]);
confere("config antiga, finalização: mesa na frente (como sempre)", ids(ordenarPelaPrioridade([DELIV, MESA], antiga, "finishing")), ["mesa", "deliv"]);

const separada = lerKdsConfig({ prioridade: ["MESA"], prioridadeNaFinalizacao: [] });
confere("separada, produção: mesa na frente", ids(ordenarPelaPrioridade([DELIV, MESA], separada, "production")), ["mesa", "deliv"]);
confere("separada, finalização: quem saiu do forno primeiro", ids(ordenarPelaPrioridade([MESA, DELIV], separada, "finishing")), ["deliv", "mesa"]);
confere("selo na produção", furaAFila(MESA, separada, "production"), true);
confere("sem selo na finalização", furaAFila(MESA, separada, "finishing"), false);

const soFinal = lerKdsConfig({ prioridade: [], prioridadeNaFinalizacao: ["BALCAO"] });
const BALCAO = { id: "balcao", deliveryType: "RETIRADA", source: "PRESENCIAL", createdAt: t("20:20"), items: [{ prontoEm: t("20:40") }] };
confere("só finalização com balcão: balcão na frente lá", ids(ordenarPelaPrioridade([DELIV, BALCAO], soFinal, "finishing")), ["balcao", "deliv"]);
confere("e a produção na ordem de sempre", ids(ordenarPelaPrioridade([DELIV, BALCAO], soFinal, "production")), ["deliv", "balcao"]);
confere("ninguém marcado e nada separado: lista intacta", ids(ordenarPelaPrioridade([MESA, DELIV], lerKdsConfig({}), "finishing")), ["mesa", "deliv"]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
