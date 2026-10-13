import { corrigirPeriodo, fimDoDiaDeOperacao } from "../src/lib/periodo-do-quadro";
let falhas = 0;
const igual = (nome: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${nome}${ok ? "" : ` — veio ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`}`);
};
// O caso da Delícias de Casa: De 12/10 05:00, a loja muda o Até para 12/10 (fica 04:59).
igual("Até 12/10 04:59 vira 13/10 04:59", corrigirPeriodo("2026-10-12T05:00", "2026-10-12T04:59", "ate"), { de: "2026-10-12T05:00", ate: "2026-10-13T04:59" });
// Muda o De para depois do Até: o Até acompanha o dia de operação do De.
igual("De depois do Até puxa o Até", corrigirPeriodo("2026-10-14T05:00", "2026-10-14T04:59", "de"), { de: "2026-10-14T05:00", ate: "2026-10-15T04:59" });
igual("De na madrugada fecha no mesmo dia de operação", corrigirPeriodo("2026-10-12T02:00", "2026-10-11T23:00", "de"), { de: "2026-10-12T02:00", ate: "2026-10-12T04:59" });
igual("Até de tarde antes do De vira fim do dia do De", corrigirPeriodo("2026-10-12T18:00", "2026-10-12T15:00", "ate"), { de: "2026-10-12T18:00", ate: "2026-10-13T04:59" });
igual("Período válido não muda", corrigirPeriodo("2026-10-12T05:00", "2026-10-13T04:59", "de"), { de: "2026-10-12T05:00", ate: "2026-10-13T04:59" });
igual("Período de vários dias não muda", corrigirPeriodo("2026-10-01T05:00", "2026-10-13T04:59", "ate"), { de: "2026-10-01T05:00", ate: "2026-10-13T04:59" });
igual("Virada de mês", fimDoDiaDeOperacao("2026-10-31T20:00"), "2026-11-01T04:59");
igual("Campo vazio não quebra", corrigirPeriodo("", "2026-10-13T04:59", "de"), { de: "", ate: "2026-10-13T04:59" });
if (falhas) { console.log(`${falhas} falha(s)`); process.exit(1); }
console.log("tudo certo");
