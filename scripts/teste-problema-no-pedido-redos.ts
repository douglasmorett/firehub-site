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
import { detectarProblemaNoPedido, ehPerguntaSobreOPedido, soPedeCancelamento, desistenciaDoCliente } from "../src/lib/problema-no-pedido";

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

// ── "Cancela" sem pedido na loja (Charlie Brown, 11 e 12/11/2026) ─────────
const rascunho = [{ status: "CRIANDO_IA", notes: "🤖 Pedido sendo montado pela IA no WhatsApp" }];
const naCozinha = [{ status: "ACEITO", notes: "" }];
const esperandoALoja = [{ status: "CRIANDO_IA", notes: "🙋 AGUARDANDO A LOJA: conferir o pedido do robô · 🤖 Pedido sendo montado" }];
confere("'Cancela obrigada' com rascunho: cancela o rascunho", desistenciaDoCliente("Cancela obrigada", rascunho) === "cancelar-rascunho");
confere("'Cancela por favor' com rascunho: cancela o rascunho", desistenciaDoCliente("Cancela por favor", rascunho) === "cancelar-rascunho");
confere("'pode cancelar o pedido, obg' com rascunho", desistenciaDoCliente("pode cancelar o pedido, obg", rascunho) === "cancelar-rascunho");
confere("'cancela a borda' com rascunho: é mexer no pedido, fica com o robô", desistenciaDoCliente("cancela a borda", rascunho) === "com-o-robo");
confere("'Cancela' sem pedido nenhum: com o robô", desistenciaDoCliente("Cancela", []) === "com-o-robo");
confere("'Pode cancelar o guaraná' com pedido na cozinha: equipe (07/11)", desistenciaDoCliente("Pode cancelar o guaraná por favor", naCozinha) === "escalar");
confere("'cancela' com o rascunho esperando a loja aceitar: equipe", desistenciaDoCliente("cancela", esperandoALoja) === "escalar");
confere("rascunho cancelado + pedido entregue hoje: equipe", desistenciaDoCliente("cancela", [{ status: "CANCELADO" }, { status: "ENTREGUE" }]) === "escalar");
confere("'cancela, tá demorando' é reclamação de verdade", desistenciaDoCliente("cancela, tá demorando demais", rascunho) === "escalar");
confere("soPedeCancelamento: 'quero cancelar'", soPedeCancelamento("quero cancelar"));
confere("soPedeCancelamento: 'não chegou, cancela' não é só cancelar", !soPedeCancelamento("não chegou, cancela"));
confere("soPedeCancelamento: sem a palavra", !soPedeCancelamento("quero uma calabresa"));

// ── Texto longo de propósito responde rápido ─────────────────────────────
const N = 200_000;
const ataques: Record<string, string> = {
  "só dígitos": "1".repeat(N),
  "1h 1h 1h…": "1h ".repeat(N / 3),
  "1h1h1h… colado": "1h".repeat(N / 2),
  "esper esper…": "esper ".repeat(N / 6),
  "onde entrega…": "onde entrega ".repeat(N / 13),
  "cade + espaços": "cade" + " ".repeat(N),
  "cancela + espaços": "cancela" + " ".repeat(N) + "x",
  "cancela + vírgulas e 'ok'": "cancela" + ", ok".repeat(N / 4) + "x",
};
for (const [nome, texto] of Object.entries(ataques)) {
  const t0 = performance.now();
  detectarProblemaNoPedido(texto, [{ sender: "user", text: texto }]);
  ehPerguntaSobreOPedido(texto);
  desistenciaDoCliente(texto, [{ status: "CRIANDO_IA" }]);
  desistenciaDoCliente("cancela" + texto, [{ status: "CRIANDO_IA" }]);
  const ms = performance.now() - t0;
  confere(`texto longo "${nome}" em menos de 1 s`, ms < 1000, `${ms.toFixed(0)} ms`);
}

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
