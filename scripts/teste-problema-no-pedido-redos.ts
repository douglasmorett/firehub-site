/**
 * O detector de problema no pedido (src/lib/problema-no-pedido.ts) não pode
 * travar com texto longo de cliente (ReDoS, auditoria 23/10/2026) e tem de
 * continuar pegando as mesmas frases.
 *
 *   npx tsx scripts/teste-problema-no-pedido-redos.ts
 *
 * Na versão antiga as regras com `.*` e `\d+...\w*` voltavam quadráticas: o
 * texto de 200 mil caracteres abaixo segurava o processo por minutos.
 */
import { detectarProblemaNoPedido, ehPerguntaSobreOPedido } from "../src/lib/problema-no-pedido";

export {};

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe ?? ""); }
}

// ── As frases de sempre continuam detectadas ─────────────────────────────
const reclamacoes = [
  "faz uma hora que to esperando",
  "1h esperando e nada",
  "esperando já faz 1 hora",
  "estou aguardando há 40 minutos",
  "1h30 de espera, sério?",
  "2 horas de espera",
  "40 minutos esperando",
  "40min aguardando",
  "onde está a comida que ainda não chegou",
  "cadê a entrega, ainda?",
  "cade meu pedido ate agora",
  "tá demorando muito",
  "não chegou",
  "veio sem o refri",
  "quero cancelar",
];
for (const frase of reclamacoes) {
  const r = detectarProblemaNoPedido(frase);
  confere(`reclamação: "${frase}"`, r.escalar && r.motivo === "reclamacao", r);
}

const cobrou = [{ sender: "user", text: "cadê o pedido?", timestamp: 1_000 }];
confere("cobrança repetida escala", detectarProblemaNoPedido("onde tá meu pedido", cobrou, 2_000).motivo === "cobranca_repetida");
confere("cobrança com espaço sobrando", detectarProblemaNoPedido("cadê   tá   o pedido", cobrou, 2_000).motivo === "cobranca_repetida");
confere("primeira cobrança não escala", !detectarProblemaNoPedido("cadê meu pedido?").escalar);
confere("pergunta sobre o pedido", ehPerguntaSobreOPedido("o motoboy já saiu?"));
confere("pergunta de quem nem pediu não é queixa", !detectarProblemaNoPedido("quanto tempo demora?").escalar);
confere("coca gelada não é queixa", !detectarProblemaNoPedido("quero uma coca gelada").escalar);

// ── Texto longo de propósito responde rápido ─────────────────────────────
const N = 200_000;
const ataques: Record<string, string> = {
  "só dígitos": "1".repeat(N),
  "1h 1h 1h…": "1h ".repeat(N / 3),
  "1h1h1h… colado": "1h".repeat(N / 2),
  "esper esper…": "esper ".repeat(N / 6),
  "onde entrega…": "onde entrega ".repeat(N / 13),
  "cade + espaços": "cade" + " ".repeat(N),
};
for (const [nome, texto] of Object.entries(ataques)) {
  const t0 = performance.now();
  detectarProblemaNoPedido(texto, [{ sender: "user", text: texto }]);
  ehPerguntaSobreOPedido(texto);
  const ms = performance.now() - t0;
  confere(`texto longo "${nome}" em menos de 1 s`, ms < 1000, `${ms.toFixed(0)} ms`);
}

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
