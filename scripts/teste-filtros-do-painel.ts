import { lerFiltrosSalvos, horasDoPeriodo, periodoNasHoras, diaDeOperacaoDe, mostrarSaiuParaEntrega, chaveDosFiltros } from "../src/lib/filtros-do-painel";
let falhas = 0;
const igual = (nome: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${nome}${ok ? "" : ` — veio ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`}`);
};
const todos = { delivery: true, retirada: true, balcao: true, mesa: true };
const semDelivery = { delivery: false, retirada: true, balcao: true, mesa: false };

// Gravar / ler
igual("Chave por loja", chaveDosFiltros("loja1"), "firehub:filtros-do-painel:loja1");
igual("Nada gravado = padrão", lerFiltrosSalvos(null), {});
igual("Lixo = padrão", lerFiltrosSalvos("{nao é json"), {});
igual("Lê horário e tipos", lerFiltrosSalvos(JSON.stringify({ horaDe: "18:00", horaAte: "02:00", tipos: semDelivery })), { horaDe: "18:00", horaAte: "02:00", tipos: semDelivery });
igual("Hora inválida é ignorada", lerFiltrosSalvos(JSON.stringify({ horaDe: "25:00", horaAte: "02:00" })), {});
igual("Tudo desmarcado não vale", lerFiltrosSalvos(JSON.stringify({ tipos: { delivery: false, retirada: false, balcao: false, mesa: false } })), {});
igual("Tipo faltando não vale", lerFiltrosSalvos(JSON.stringify({ tipos: { delivery: true } })), {});

// Horário do período
igual("Dia de operação da madrugada é o anterior", diaDeOperacaoDe("2026-11-14T02:00"), "2026-11-13");
igual("Jantar 18h–2h guarda o horário", horasDoPeriodo("2026-11-13T18:00", "2026-11-14T02:00"), { horaDe: "18:00", horaAte: "02:00" });
igual("Padrão guarda 05:00–04:59", horasDoPeriodo("2026-11-13T05:00", "2026-11-14T04:59"), { horaDe: "05:00", horaAte: "04:59" });
igual("Vários dias não guarda", horasDoPeriodo("2026-11-06T05:00", "2026-11-14T04:59"), null);
igual("Invertido não guarda", horasDoPeriodo("2026-11-13T18:00", "2026-11-13T11:00"), null);
igual("Jantar volta no dia de hoje", periodoNasHoras("2026-11-14", "18:00", "02:00"), { de: "2026-11-14T18:00", ate: "2026-11-15T02:00" });
igual("Almoço no mesmo dia", periodoNasHoras("2026-11-14", "11:00", "16:00"), { de: "2026-11-14T11:00", ate: "2026-11-14T16:00" });
igual("Padrão volta igual ao de antes", periodoNasHoras("2026-11-14", "05:00", "04:59"), { de: "2026-11-14T05:00", ate: "2026-11-15T04:59" });
igual("Virada de mês", periodoNasHoras("2026-11-30", "18:00", "01:00"), { de: "2026-11-30T18:00", ate: "2026-12-01T01:00" });

// Coluna Saiu para Entrega
igual("Com Delivery a coluna aparece", mostrarSaiuParaEntrega(todos, 0), true);
igual("Só Retirada/Balcão some", mostrarSaiuParaEntrega(semDelivery, 0), false);
igual("Sem Delivery mas com pedido nela, fica", mostrarSaiuParaEntrega(semDelivery, 1), true);

if (falhas) { console.log(`${falhas} falha(s)`); process.exit(1); }
console.log("tudo certo");
