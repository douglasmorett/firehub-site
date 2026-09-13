/**
 * Prova da regra do desconto manual (balcão e mesa).
 *
 *   node scripts/teste-desconto-manual.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/desconto-manual.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { valorDoDesconto, validarDesconto, rotuloDoDesconto, detalheDoDesconto, ratearDesconto, lerNumero } = await import(
  "data:text/javascript," + encodeURIComponent(js)
);

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const igual = (nome, obtido, esperado) =>
  conferir(nome, JSON.stringify(obtido) === JSON.stringify(esperado), { obtido, esperado });

console.log("\n1) Quanto sai da conta");
igual("R$ 15 numa conta de R$ 120", valorDoDesconto({ base: 120, tipo: "VALOR", valor: 15 }), 15);
igual("10% de R$ 132,59 arredonda no centavo", valorDoDesconto({ base: 132.59, tipo: "PERCENTUAL", valor: 10 }), 13.26);
igual("valor maior que a conta fica na conta", valorDoDesconto({ base: 30, tipo: "VALOR", valor: 50 }), 30);
igual("percentual acima de 100 fica em 100", valorDoDesconto({ base: 30, tipo: "PERCENTUAL", valor: 150 }), 30);
igual("negativo vira zero", valorDoDesconto({ base: 30, tipo: "VALOR", valor: -5 }), 0);
igual("conta zerada não tem desconto", valorDoDesconto({ base: 0, tipo: "PERCENTUAL", valor: 10 }), 0);
igual("33,33% de R$ 10,00", valorDoDesconto({ base: 10, tipo: "PERCENTUAL", valor: 33.33 }), 3.33);

console.log("\n2) O que a tela manda");
igual("vazio é sem desconto", validarDesconto({ base: 50, tipo: "VALOR", valor: "", motivo: "" }), { ok: true, semDesconto: true });
igual("zero é sem desconto, mesmo sem motivo", validarDesconto({ base: 50, tipo: "VALOR", valor: 0 }), { ok: true, semDesconto: true });
const semMotivo = validarDesconto({ base: 50, tipo: "VALOR", valor: 5, motivo: "  " });
conferir("desconto sem motivo é recusado", semMotivo.ok === false && /motivo/.test(semMotivo.erro), semMotivo);
const motivoCurto = validarDesconto({ base: 50, tipo: "VALOR", valor: 5, motivo: "ok" });
conferir("motivo de 2 letras é recusado", motivoCurto.ok === false, motivoCurto);
const longo = validarDesconto({ base: 50, tipo: "VALOR", valor: 5, motivo: "x".repeat(201) });
conferir("motivo acima de 200 letras é recusado", longo.ok === false && /200/.test(longo.erro), longo);
const maior = validarDesconto({ base: 50, tipo: "VALOR", valor: "60", motivo: "cliente fiel" });
conferir("valor maior que a conta é RECUSADO (não cortado)", maior.ok === false && maior.erro.includes("R$ 60,00") && maior.erro.includes("R$ 50,00"), maior);
const pct150 = validarDesconto({ base: 50, tipo: "PERCENTUAL", valor: 150, motivo: "cliente fiel" });
conferir("150% é recusado", pct150.ok === false && /100%/.test(pct150.erro), pct150);
const negativo = validarDesconto({ base: 50, tipo: "VALOR", valor: -3, motivo: "cliente fiel" });
conferir("negativo é recusado", negativo.ok === false, negativo);
igual(
  "R$ 10,50 escrito com vírgula",
  validarDesconto({ base: 80, tipo: "VALOR", valor: "10,50", motivo: "  pedido  atrasou  " }),
  { ok: true, semDesconto: false, tipo: "VALOR", informado: 10.5, valor: 10.5, motivo: "pedido atrasou" },
);
igual(
  "10% de R$ 132,59",
  validarDesconto({ base: 132.59, tipo: "percentual", valor: "10", motivo: "aniversário" }),
  { ok: true, semDesconto: false, tipo: "PERCENTUAL", informado: 10, valor: 13.26, motivo: "aniversário" },
);
const semConta = validarDesconto({ base: 0, tipo: "PERCENTUAL", valor: 10, motivo: "aniversário" });
conferir("percentual numa conta zerada é recusado", semConta.ok === false, semConta);
igual("tipo desconhecido vale como VALOR", validarDesconto({ base: 20, tipo: "xyz", valor: 5, motivo: "cortesia" }).tipo, "VALOR");
igual("lerNumero: \"R$ 1.234,56\"", lerNumero("R$ 1.234,56"), 1234.56);
igual("lerNumero: \"12.5\"", lerNumero("12.5"), 12.5);
igual("lerNumero: lixo vira 0", lerNumero("abc"), 0);

console.log("\n3) O que fica gravado");
igual("rótulo em valor", rotuloDoDesconto({ tipo: "VALOR", informado: 15, motivo: "pedido atrasou" }), "Desconto: pedido atrasou");
igual("rótulo em percentual", rotuloDoDesconto({ tipo: "PERCENTUAL", informado: 12.5, motivo: "aniversário" }), "Desconto 12,5%: aniversário");
const det = detalheDoDesconto({ alvo: "PEDIDO", tipo: "PERCENTUAL", informado: 10, valor: 13.26, motivo: "aniversário", por: "Caixa Ana", em: new Date("2026-09-12T23:00:00Z") });
igual("detalhe no formato das integrações", det, {
  target: "PEDIDO", value: 13.26, sponsor: "MERCHANT", description: "Desconto 10%: aniversário", motivo: "aniversário",
  tipo: "PERCENTUAL", percentual: 10, por: "Caixa Ana", em: "2026-09-12T23:00:00.000Z",
});

console.log("\n4) Desconto da mesa espalhado pelos pedidos");
const pedidos = [
  { id: "a", totalAmount: 100 },
  { id: "b", totalAmount: 50 },
  { id: "c", totalAmount: 33.33 },
];
const rateio = ratearDesconto(pedidos, 20);
const somaDesc = Math.round(rateio.reduce((s, r) => s + r.desconto * 100, 0));
conferir("a soma das partes é exatamente o desconto", somaDesc === 2000, rateio);
conferir("cada novo total = total - parte", rateio.every((r, i) => Math.round((pedidos[i].totalAmount - r.desconto) * 100) === Math.round(r.novoTotal * 100)), rateio);
conferir("proporcional: o maior pedido leva mais", rateio[0].desconto > rateio[1].desconto && rateio[1].desconto > rateio[2].desconto, rateio);
igual("desconto igual à conta zera todos", ratearDesconto([{ id: "a", totalAmount: 10 }, { id: "b", totalAmount: 5 }], 15).map((r) => r.novoTotal), [0, 0]);
igual("desconto maior que a conta não deixa total negativo", ratearDesconto([{ id: "a", totalAmount: 10 }], 99).map((r) => r.novoTotal), [0]);
igual("sem desconto nada muda", ratearDesconto([{ id: "a", totalAmount: 10.1 }], 0), [{ id: "a", desconto: 0, novoTotal: 10.1 }]);
igual("mesa sem pedidos", ratearDesconto([], 10), []);
const tres = ratearDesconto([{ id: "a", totalAmount: 10 }, { id: "b", totalAmount: 10 }, { id: "c", totalAmount: 10 }], 10);
conferir("R$ 10 em três pedidos iguais fecha em 10,00", Math.round(tres.reduce((s, r) => s + r.desconto * 100, 0)) === 1000, tres);
const comZero = ratearDesconto([{ id: "a", totalAmount: 0 }, { id: "b", totalAmount: 20 }], 5);
conferir("pedido de R$ 0 não recebe desconto", comZero[0].desconto === 0 && comZero[1].desconto === 5, comZero);

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
