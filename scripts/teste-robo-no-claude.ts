/**
 * Testa lib/robo-no-claude.ts contra uma API da Anthropic FALSA (servidor local):
 * confere o que vai na requisição e como a resposta volta para o robô.
 * Sem chave, sem custo, sem banco.
 *
 *   npx tsx scripts/teste-robo-no-claude.ts
 */
import http from "node:http";
import assert from "node:assert/strict";

let ultimaRequisicao: any = null;
let proximaResposta: { status: number; corpo: any } = { status: 200, corpo: {} };

const servidor = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => (corpo += c));
  req.on("end", () => {
    ultimaRequisicao = { url: req.url, headers: req.headers, corpo: JSON.parse(corpo || "{}") };
    res.writeHead(proximaResposta.status, { "content-type": "application/json" });
    res.end(JSON.stringify(proximaResposta.corpo));
  });
});

const resposta = (texto: string, extra: any = {}) => ({
  id: "msg_teste", type: "message", role: "assistant", model: "claude-haiku-5-5",
  content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: texto }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 18000 },
  ...extra,
});

async function main() {
  await new Promise<void>((ok) => servidor.listen(0, ok));
  const porta = (servidor.address() as any).port;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${porta}`;
  process.env.ANTHROPIC_API_KEY = "sk-teste";
  // lib/prisma exige a variável ao carregar; o teste nunca chega ao banco (a chave do ambiente vem antes).
  process.env.DATABASE_URL ||= "postgresql://teste@127.0.0.1:1/teste";
  const { respostaDoClaude, lojaNoClaude, chaveDoClaude, MODELO_CLAUDE } = await import("../src/lib/robo-no-claude");
  const { REGRAS_DO_CLAUDE } = await import("../src/lib/regras-do-claude");
  const sinal = () => new AbortController().signal;

  // A conversa como o chatbot-ai.ts monta para o Gemini.
  const contents = [
    { role: "user", parts: [{ text: "════ CONTEXTO DESTA CONVERSA ════ ..." }] },
    { role: "model", parts: [{ text: "Entendido." }] },
    { role: "user", parts: [{ text: "oi" }] },
    { role: "model", parts: [{ text: "Oi! O que vai ser hoje?" }] },
    { role: "model", parts: [{ text: "" }] }, // fala vazia no histórico
    { role: "user", parts: [{ inlineData: { data: "AAAA", mimeType: "image/jpeg" } }, { text: "quero essa" }] },
  ];

  // 1. Requisição: sistema com cache + regras, falas alternadas, foto como imagem, nada de temperatura.
  proximaResposta = { status: 200, corpo: resposta("Essa é a Calabresa, 49,90 reais 😊") };
  const r1 = await respostaDoClaude({ contents, systemInstruction: "PROMPT DA LOJA", signal: sinal(), chave: "sk-teste", geminiApiKey: "" });
  const c = ultimaRequisicao.corpo;
  assert.equal(ultimaRequisicao.url, "/v1/messages");
  assert.equal(c.model, MODELO_CLAUDE);
  assert.equal(c.temperature, undefined, "Haiku 5.5 recusa temperatura");
  assert.equal(c.top_p, undefined);
  assert.equal(c.system[0].text, `PROMPT DA LOJA\n\n${REGRAS_DO_CLAUDE}`);
  assert.deepEqual(c.system[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(c.messages.map((m: any) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(c.messages.at(-1).content[0].type, "image");
  assert.equal(c.messages.at(-1).content[0].source.data, "AAAA");
  assert.equal(c.messages.at(-1).content[1].text, "quero essa");
  assert.ok(c.messages.every((m: any) => m.content.every((b: any) => b.type !== "text" || b.text.trim())), "sem bloco de texto vazio");
  assert.equal(contents[5].parts.length, 2, "não mexe no que o robô montou (a reserva do Gemini usa o mesmo)");
  // 2. Resposta: só o texto (o pensamento fica de fora) e o uso no formato do Gemini.
  assert.equal(r1.text, "Essa é a Calabresa, 49,90 reais 😊");
  assert.deepEqual(r1.usageMetadata, { promptTokenCount: 18120, candidatesTokenCount: 300, cachedContentTokenCount: 18000 });

  // 3. Recusa e resposta cortada voltam SEM texto: o robô passa para o Gemini.
  proximaResposta = { status: 200, corpo: resposta("meio", { stop_reason: "refusal" }) };
  assert.equal((await respostaDoClaude({ contents, systemInstruction: "P", signal: sinal(), chave: "sk-teste", geminiApiKey: "" })).text, "");
  proximaResposta = { status: 200, corpo: resposta("cortad", { stop_reason: "max_tokens" }) };
  const cortada = await respostaDoClaude({ contents, systemInstruction: "P", signal: sinal(), chave: "sk-teste", geminiApiKey: "" });
  assert.equal(cortada.text, "");
  assert.equal(cortada.motivoSemTexto, "max_tokens");

  // 4. Erro da API (crédito, chave) é exceção, uma vez só (sem nova tentativa no SDK).
  let chamadas = 0;
  servidor.on("request", () => chamadas++);
  proximaResposta = { status: 400, corpo: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } } };
  await assert.rejects(respostaDoClaude({ contents, systemInstruction: "P", signal: sinal(), chave: "sk-teste", geminiApiKey: "" }));
  proximaResposta = { status: 529, corpo: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } };
  await assert.rejects(respostaDoClaude({ contents, systemInstruction: "P", signal: sinal(), chave: "sk-teste", geminiApiKey: "" }));
  assert.equal(chamadas, 2, "sem nova tentativa: quem tenta de novo é o Gemini");

  // 5. A marca da loja só vale com a chave; a do ambiente vem antes da matriz.
  assert.equal(lojaNoClaude({ modeloDoRobo: MODELO_CLAUDE }, "sk-teste"), true);
  assert.equal(lojaNoClaude({}, "sk-teste"), false);
  assert.equal(lojaNoClaude(null, "sk-teste"), false);
  assert.equal(lojaNoClaude({ modeloDoRobo: MODELO_CLAUDE }, null), false);
  assert.equal(await chaveDoClaude(), "sk-teste");

  console.log("ok: robô no Claude — requisição, resposta, recusa, erro e marca da loja");
  servidor.close();
}

main().catch((e) => {
  console.error(e);
  servidor.close();
  process.exitCode = 1;
});
