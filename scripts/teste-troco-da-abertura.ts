/**
 * Trava o aviso de troco da abertura (lib/troco-da-abertura.ts).
 *   npx tsx scripts/teste-troco-da-abertura.ts
 */
import { avisoDoTrocoDaAbertura } from "../src/lib/troco-da-abertura";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};
const TZ = "America/Sao_Paulo";
const ontem = new Date("2026-10-11T02:40:00Z"); // 10/10 às 23:40

const bate = avisoDoTrocoDaAbertura({ anterior: { closingCash: 287.55, closedAt: ontem }, haviaCaixaAberto: false, troco: 287.55, tz: TZ });
confere("troco igual ao contado: sem aviso", bate === null, bate);

const falta = avisoDoTrocoDaAbertura({ anterior: { closingCash: 1287.55, closedAt: ontem }, haviaCaixaAberto: false, troco: 287.55, tz: TZ });
confere("troco menor: diz quanto falta, com milhar", !!falta && falta.includes("faltam R$ 1.000,00") && falta.includes("10/10 às 23:40") && falta.includes("R$ 1.287,55"), falta);

const sobra = avisoDoTrocoDaAbertura({ anterior: { closingCash: 200, closedAt: ontem }, haviaCaixaAberto: false, troco: 250, tz: TZ });
confere("troco maior: diz quanto sobra", !!sobra && sobra.includes("sobram R$ 50,00"), sobra);

const centavo = avisoDoTrocoDaAbertura({ anterior: { closingCash: 100.004, closedAt: ontem }, haviaCaixaAberto: false, troco: 100, tz: TZ });
confere("arredondamento de centavo não avisa", centavo === null, centavo);

const semContar = avisoDoTrocoDaAbertura({ anterior: { closingCash: null, closedAt: ontem }, haviaCaixaAberto: false, troco: 100, tz: TZ });
confere("fechou sem contar: avisa que não dá para conferir", !!semContar && semContar.includes("sem contar"), semContar);

const aberto = avisoDoTrocoDaAbertura({ anterior: { closingCash: 100, closedAt: ontem }, haviaCaixaAberto: true, troco: 100, tz: TZ });
confere("caixa anterior ainda aberto: avisa que não foi fechado", !!aberto && aberto.includes("não foi fechado"), aberto);

const primeiro = avisoDoTrocoDaAbertura({ anterior: null, haviaCaixaAberto: false, troco: 100, tz: TZ });
confere("primeiro caixa da loja: sem aviso", primeiro === null, primeiro);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
