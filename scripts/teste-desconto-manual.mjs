/**
 * Prova do desconto do balcão e da mesa — é dinheiro saindo do caixa.
 *
 *   node scripts/teste-desconto-manual.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/desconto-manual.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const { valorDoDesconto, descreverDesconto, problemaDoDesconto, notaDoDesconto, SEM_DESCONTO } = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

console.log("\n1) Quanto vale");
conferir("10% de 80 = 8", valorDoDesconto({ tipo: "percent", valor: 10 }, 80) === 8);
conferir("R$ 5 é R$ 5", valorDoDesconto({ tipo: "valor", valor: 5 }, 80) === 5);
conferir("arredonda em centavos", valorDoDesconto({ tipo: "percent", valor: 15 }, 33.33) === 5);
conferir("sem desconto vale zero", valorDoDesconto(SEM_DESCONTO, 80) === 0);
conferir("nulo vale zero", valorDoDesconto(null, 80) === 0);
conferir("sacola vazia vale zero", valorDoDesconto({ tipo: "percent", valor: 50 }, 0) === 0);

console.log("\n2) Nunca deixa o total negativo");
conferir("valor maior que a conta para na conta", valorDoDesconto({ tipo: "valor", valor: 200 }, 80) === 80);
conferir("porcentagem acima de 100 para em 100%", valorDoDesconto({ tipo: "percent", valor: 300 }, 80) === 80);
conferir("valor negativo é ignorado", valorDoDesconto({ tipo: "valor", valor: -10 }, 80) === 0);

console.log("\n3) O que fica escrito");
conferir("porcentagem mostra o valor em reais junto",
  descreverDesconto({ tipo: "percent", valor: 10, motivo: "Cliente fiel" }, 80) === "10% (R$ 8,00) — Cliente fiel");
conferir("valor fixo com motivo",
  descreverDesconto({ tipo: "valor", valor: 5, motivo: "Pedido atrasado" }, 80) === "R$ 5,00 — Pedido atrasado");
conferir("sem motivo, só o quanto",
  descreverDesconto({ tipo: "valor", valor: 5 }, 80) === "R$ 5,00");
conferir("motivo em branco não vira travessão solto",
  descreverDesconto({ tipo: "valor", valor: 5, motivo: "   " }, 80) === "R$ 5,00");
conferir("zero não escreve nada", descreverDesconto(SEM_DESCONTO, 80) === "");
conferir("a nota vai marcada para a comanda",
  notaDoDesconto({ tipo: "percent", valor: 10, motivo: "Cortesia" }, 50) === "[Desconto: 10% (R$ 5,00) — Cortesia]");
conferir("sem desconto não suja a observação", notaDoDesconto(SEM_DESCONTO, 50) === "");

console.log("\n4) O que a tela barra");
conferir("valor zero é barrado", /Informe quanto/.test(problemaDoDesconto({ tipo: "percent", valor: 0 }, 80)));
conferir("acima de 100% é barrado", /não passa de 100/.test(problemaDoDesconto({ tipo: "percent", valor: 120 }, 80)));
conferir("maior que a conta é barrado", /maior que o valor/.test(problemaDoDesconto({ tipo: "valor", valor: 90 }, 80)));
conferir("desconto válido passa", problemaDoDesconto({ tipo: "valor", valor: 10 }, 80) === "");
conferir("100% é permitido (cortesia total)", problemaDoDesconto({ tipo: "percent", valor: 100 }, 80) === "");

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
