/**
 * O robô sabe que é feriado (lib/holidays.ts → DADOS DA LOJA do prompt).
 *   npx tsx scripts/teste-feriado-do-robo.ts
 *
 * Pizzaria 17, 12/10/2026 (Nossa Senhora Aparecida, segunda): o robô mandou o
 * rodízio "de segunda a quinta" e a equipe corrigiu — no feriado não tem.
 * Sem rede (a brasilapi fica fora) e sem linha nenhuma em dia comum.
 */
import { feriadoLocal, linhaDoFeriadoParaORobo } from "../src/lib/holidays";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

confere("12/10 é feriado nacional", feriadoLocal("2026-10-12", "MACAE") === "Nossa Senhora Aparecida", feriadoLocal("2026-10-12", "MACAE"));
confere("13/10 não é feriado", feriadoLocal("2026-10-13", "MACAE") === null);
confere("municipal de Macaé (com ou sem acento, maiúscula)", feriadoLocal("2026-07-29", "Macaé") === "Aniversário de Macaé" && feriadoLocal("2026-07-29", "MACAE") === "Aniversário de Macaé");
confere("municipal de Macaé não vale em outra cidade", feriadoLocal("2026-07-29", "Rio das Ostras") === null);
confere("Sexta-feira Santa de 2026 (Páscoa 05/04)", feriadoLocal("2026-04-03", null) === "Sexta-feira Santa", feriadoLocal("2026-04-03", null));
confere("Carnaval de 2026 (terça 17/02)", feriadoLocal("2026-02-17", null) === "Carnaval", feriadoLocal("2026-02-17", null));
confere("Corpus Christi de 2026 (04/06)", feriadoLocal("2026-06-04", null) === "Corpus Christi", feriadoLocal("2026-06-04", null));
confere("data torta não quebra", feriadoLocal("", null) === null && feriadoLocal("lixo", "MACAE") === null);

confere("dia comum: nenhuma linha no prompt (custo zero)", linhaDoFeriadoParaORobo(null, null) === "");
const hoje = linhaDoFeriadoParaORobo("Nossa Senhora Aparecida", null);
confere("feriado hoje: a linha diz qual e que o que não funciona em feriado não funciona", /hoje é feriado \(Nossa Senhora Aparecida\)/.test(hoje) && /não funciona em feriado, hoje não funciona/.test(hoje) && hoje.endsWith("\n"), hoje);
const amanha = linhaDoFeriadoParaORobo(null, "Finados");
confere("feriado amanhã: só a linha de amanhã", /amanhã é feriado \(Finados\)/.test(amanha) && !/hoje/.test(amanha), amanha);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
