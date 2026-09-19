/**
 * Prova do prazo que não descarta o resultado tardio (lib/com-prazo.ts).
 *
 *   node scripts/teste-com-prazo.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/com-prazo.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { comPrazo } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const espera = (ms, valor) => new Promise((r) => setTimeout(() => r(valor), ms));
const falha = (ms, erro) => new Promise((_, rej) => setTimeout(() => rej(erro), ms));

// Rejeição solta derrubaria o processo em produção: o teste falha se acontecer.
let rejeicaoSolta = null;
process.on("unhandledRejection", (e) => { rejeicaoSolta = e; });

console.log("\n1) Dentro do prazo");
{
  let tardio = false;
  const r = await comPrazo(espera(10, "pedido ok"), 200, () => { tardio = true; });
  conferir("devolve o valor", r.noPrazo === true && r.valor === "pedido ok", r);
  await espera(30);
  conferir("não chama o gancho tardio", tardio === false);
}

console.log("\n2) Estourou o prazo — e o resultado NÃO é jogado fora");
{
  let recebido = null;
  const r = await comPrazo(espera(80, { pedido: { ok: true, numero: 8 } }), 20, (v, atraso) => { recebido = { v, atraso }; });
  conferir("quem espera é liberado no prazo", r.noPrazo === false, r);
  conferir("o gancho ainda não rodou", recebido === null);
  await espera(120);
  conferir("o resultado tardio chega ao gancho", recebido?.v?.pedido?.numero === 8, recebido);
  conferir("com o atraso medido", typeof recebido?.atraso === "number" && recebido.atraso >= 0, recebido?.atraso);
}

console.log("\n3) Erros");
{
  let pegou = null;
  try { await comPrazo(falha(10, new Error("boom")), 200); } catch (e) { pegou = e; }
  conferir("rejeição dentro do prazo sobe para quem chamou", pegou?.message === "boom");

  let erroTardio = null;
  const r = await comPrazo(falha(60, new Error("tarde")), 10, undefined, (e) => { erroTardio = e; });
  conferir("rejeição depois do prazo não derruba quem esperava", r.noPrazo === false);
  await espera(100);
  conferir("e chega ao gancho de falha tardia", erroTardio?.message === "tarde");

  await comPrazo(espera(40, 1), 5, () => { throw new Error("gancho quebrado"); });
  await comPrazo(espera(40, 1), 5, async () => { throw new Error("gancho assíncrono quebrado"); });
  await comPrazo(falha(40, new Error("sem gancho")), 5);
  await espera(120);
  conferir("gancho que lança (síncrono e assíncrono) e rejeição sem gancho não viram unhandledRejection", rejeicaoSolta === null, String(rejeicaoSolta));
}

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
