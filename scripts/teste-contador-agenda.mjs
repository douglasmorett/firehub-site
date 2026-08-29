import { hojeNaLoja, devoEnviarHoje, periodoDoEnvio } from "../src/lib/contador-agenda.ts";

let falhas = 0;
const t = (nome, fn) => { try { fn(); console.log("  ok  " + nome); } catch (e) { falhas++; console.log("FALHOU " + nome + "\n       " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ""} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

const FUSO = "America/Sao_Paulo";
// Meio-dia UTC para não haver dúvida sobre o dia em Brasília.
const em = (iso) => hojeNaLoja(FUSO, new Date(`${iso}T15:00:00Z`));
const cfg = (o) => ({ email: "contador@x.com", automatico: true, quando: "DIA_1", dia: 5, data: null, copiaParaLoja: true, ultimoEnvioEm: null, ultimoEnvioResultado: null, ...o });

console.log("\n— último dia do mês —");
t("fevereiro de ano comum tem 28", () => eq(em("2026-02-10").ultimoDiaDoMes, 28));
t("fevereiro de ano bissexto tem 29", () => eq(em("2028-02-10").ultimoDiaDoMes, 29));
t("abril tem 30", () => eq(em("2026-04-10").ultimoDiaDoMes, 30));
t("dezembro tem 31", () => eq(em("2026-12-10").ultimoDiaDoMes, 31));

console.log("\n— quando enviar —");
t("DIA_1 dispara no dia 1 e só nele", () => {
  eq(devoEnviarHoje(cfg({ quando: "DIA_1" }), em("2026-09-01")), true);
  eq(devoEnviarHoje(cfg({ quando: "DIA_1" }), em("2026-09-02")), false);
});
t("ULTIMO_DIA dispara em 28/fev de ano comum", () => {
  eq(devoEnviarHoje(cfg({ quando: "ULTIMO_DIA" }), em("2026-02-28")), true);
  eq(devoEnviarHoje(cfg({ quando: "ULTIMO_DIA" }), em("2026-02-27")), false);
});
t("ULTIMO_DIA dispara em 29/fev de ano bissexto (e não em 28)", () => {
  eq(devoEnviarHoje(cfg({ quando: "ULTIMO_DIA" }), em("2028-02-29")), true);
  eq(devoEnviarHoje(cfg({ quando: "ULTIMO_DIA" }), em("2028-02-28")), false);
});
t("DIA_FIXO respeita o dia escolhido", () => {
  eq(devoEnviarHoje(cfg({ quando: "DIA_FIXO", dia: 10 }), em("2026-09-10")), true);
  eq(devoEnviarHoje(cfg({ quando: "DIA_FIXO", dia: 10 }), em("2026-09-11")), false);
});
t("DIA_FIXO acima de 28 é limitado e continua caindo todo mês", () => {
  // 31 vira 28: sem isso, "todo dia 31" pularia fevereiro, abril, junho...
  eq(devoEnviarHoje(cfg({ quando: "DIA_FIXO", dia: 31 }), em("2026-02-28")), true);
});
t("DATA_CERTA dispara só naquele dia", () => {
  eq(devoEnviarHoje(cfg({ quando: "DATA_CERTA", data: "2026-09-15" }), em("2026-09-15")), true);
  eq(devoEnviarHoje(cfg({ quando: "DATA_CERTA", data: "2026-09-15" }), em("2026-09-16")), false);
});
t("desligado não dispara nunca", () => {
  eq(devoEnviarHoje(cfg({ quando: "DIA_1", automatico: false }), em("2026-09-01")), false);
});
t("sem e-mail não dispara", () => {
  eq(devoEnviarHoje(cfg({ quando: "DIA_1", email: null }), em("2026-09-01")), false);
});

console.log("\n— período que vai no pacote —");
t("dia 1 de setembro manda AGOSTO inteiro", () => {
  eq(periodoDoEnvio(cfg({ quando: "DIA_1" }), em("2026-09-01")), { de: "2026-08-01", ate: "2026-08-31" });
});
t("dia 1 de janeiro manda DEZEMBRO do ano anterior", () => {
  eq(periodoDoEnvio(cfg({ quando: "DIA_1" }), em("2026-01-01")), { de: "2025-12-01", ate: "2025-12-31" });
});
t("dia 1 de março manda fevereiro com o dia certo (28 em ano comum)", () => {
  eq(periodoDoEnvio(cfg({ quando: "DIA_1" }), em("2026-03-01")), { de: "2026-02-01", ate: "2026-02-28" });
});
t("dia 1 de março de ano bissexto manda até 29", () => {
  eq(periodoDoEnvio(cfg({ quando: "DIA_1" }), em("2028-03-01")), { de: "2028-02-01", ate: "2028-02-29" });
});
t("último dia manda o mês corrente até hoje", () => {
  eq(periodoDoEnvio(cfg({ quando: "ULTIMO_DIA" }), em("2026-09-30")), { de: "2026-09-01", ate: "2026-09-30" });
});
t("dia fixo manda o mês anterior fechado", () => {
  eq(periodoDoEnvio(cfg({ quando: "DIA_FIXO", dia: 5 }), em("2026-09-05")), { de: "2026-08-01", ate: "2026-08-31" });
});

console.log(falhas === 0 ? "\nTUDO PASSOU\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
