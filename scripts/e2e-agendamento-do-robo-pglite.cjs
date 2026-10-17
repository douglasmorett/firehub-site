/**
 * E2E do PEDIDO AGENDADO PELO ROBÔ (lib/agendamento-do-robo.ts) contra um banco
 * LOCAL (PGlite) e um Gemini FALSO — a resposta do modelo é roteirizada, o que
 * se testa é o caminho inteiro do servidor: prompt → tag → conferência →
 * gravação → comanda para o cliente. E, ao lado, a rota do site gravando o
 * mesmo horário, para comparar os dois pedidos campo a campo.
 *
 *   cd C:\Users\Micro\crm-teste && npx pglite-server --db=./pg-agend-robo --port=5447 --max-connections=10
 *   DATABASE_URL=<pglite local …&connection_limit=1&pgbouncer=true> npx prisma db push --skip-generate --schema node_modules/.prisma/client/schema.prisma
 *   DATABASE_URL=<o mesmo> node scripts/e2e-agendamento-do-robo-pglite.cjs
 *
 * Recusa rodar contra banco que não seja local.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert/strict");

if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "")) throw new Error("só roda contra banco LOCAL (pglite)");
process.env.EVOLUTION_API_URL = "http://127.0.0.1:9";
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "teste";
delete process.env.GEMINI_API_KEY;

// ── O Gemini falso: devolve a próxima fala roteirizada e guarda o prompt ─────
const falso = path.join(os.tmpdir(), `genai-falso-${process.pid}.cjs`);
fs.writeFileSync(falso, `
class GoogleGenAI {
  constructor() {
    this.models = {
      generateContent: async (req) => {
        globalThis.__chamadas.push(req);
        const text = globalThis.__falas.shift();
        if (text == null) throw new Error("sem fala roteirizada");
        return { text, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
      },
    };
  }
}
module.exports = { GoogleGenAI, ThinkingLevel: { MINIMAL: "MINIMAL", LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" } };
`);
globalThis.__chamadas = [];
globalThis.__falas = [];

const { createJiti } = require("jiti");
const src = path.join(__dirname, "..", "src");
const jiti = createJiti(__filename, { alias: { "@/": src + "/", "@google/genai": falso } });

let ok = 0;
const caso = async (nome, f) => { await f(); ok++; console.log("ok -", nome); };

(async () => {
  const { prisma } = jiti("../src/lib/prisma");
  const { processChatbotAI } = jiti("../src/lib/chatbot-ai");
  const { horariosParaAgendar, lerConfigDeAgendamento, aindaGuardado } = jiti("../src/lib/agendamento");
  const SP = "America/Sao_Paulo";

  // ── A loja: a Pizza Vedana como está no banco de produção (17/10/2026) ─────
  const fechado = (day) => ({ day, open: "18:00", close: "23:00", active: false, shifts: [{ open: "18:00", close: "23:00" }] });
  const horas = [fechado("Segunda"), fechado("Terça"), fechado("Quarta"), fechado("Quinta"), fechado("Sexta"),
    { day: "Sábado", open: "19:00", close: "21:00", active: true, shifts: [{ open: "19:00", close: "21:00" }] }, fechado("Domingo")];
  const agendamentoConfig = {
    de: "18:00", ate: "22:00", dias: [5], ativo: true, entrega: false, horario: "LOJA", retirada: true,
    soAgendado: true, diasAFrente: 14, intervaloMin: 30, antecedenciaMin: 240, liberarAntesMin: 60,
  };
  const sufixo = Date.now().toString(36);
  const loja = await prisma.user.create({
    data: {
      name: "Pizza Vedana (teste)", email: `vedana-${sufixo}@teste.local`, password: "x", role: "FRANCHISEE",
      storeName: "Pizza Vedana", slug: `pizza-vedana-${sufixo}`, storeTimezone: SP, storeOpen: true, storeHours: horas,
      agendamentoConfig, allowScheduledOrders: true, storeDeliveryOnly: false,
      chatbotConfig: { geminiApiKey: "falsa", aiOrderingEnabled: true },
    },
  });
  const pizza = await prisma.menuProduct.create({
    data: { franchiseeId: loja.id, name: "Pizza Grande Calabresa", description: "", price: 59.9, category: "Pizzas", active: true, activeDelivery: true },
  });

  // Os horários de AGORA, pela regra do site — o roteiro usa o primeiro e o segundo.
  const dias = horariosParaAgendar({ config: lerConfigDeAgendamento(agendamentoConfig), storeHours: horas, timezone: SP });
  assert.ok(dias.length > 0, "a Vedana tem de ter sábado livre nos próximos 14 dias");
  const [h1, h2] = dias[0].horarios;
  const tagHora = (h) => `${dias[0].data} ${h.hora}`;
  console.log(`horários de ${dias[0].data}: ${dias[0].horarios.map((h) => h.hora).join(", ")}`);

  const item = `{"name": "Pizza Grande Calabresa", "quantity": 1, "options": []}`;
  const tag = (extra, final) =>
    `[[PEDIDO_IA: {"status": "${final ? "NOVO" : "CRIANDO_IA"}", "items": [${item}], "customerName": "Ana", "paymentMethod": "Pix", "deliveryType": "RETIRADA", "deliveryFee": 0, "totalAmount": 59.90${extra}, "finalized": ${final}}]]`;
  const conversa = async (tel, fala, roteiro, historico = []) => {
    globalThis.__falas.push(roteiro);
    globalThis.__chamadas.length = 0;
    const r = await processChatbotAI(loja.id, fala, historico, `${tel}@s.whatsapp.net`, undefined, "Ana");
    return { r, prompt: String(globalThis.__chamadas[0]?.config?.systemInstruction || "") };
  };
  const pedidosDe = (tel) => prisma.customerOrder.findMany({ where: { franchiseeId: loja.id, customerPhone: { contains: tel.slice(-4) } }, orderBy: { createdAt: "asc" } });

  const telAna = "5522999990001";
  let historico = [];

  await caso("o prompt leva os horários do site e a regra do só agendado", async () => {
    const { r, prompt } = await conversa(telAna, `quero uma calabresa grande pra retirar sábado ${h2.hora}`,
      `Anotado! Calabresa grande para retirar ${dias[0].rotulo} às ${h2.hora}. Me confirma o pagamento? ${tag(`, "agendadoPara": "${tagHora(h2)}"`, false)}`);
    assert.match(prompt, /📅 PEDIDO AGENDADO/);
    assert.match(prompt, /SÓ POR ENCOMENDA/);
    assert.ok(prompt.includes(`[${dias[0].data}]: ${dias[0].horarios.map((h) => h.hora).slice(0, -1).join(", ")}`), "a lista do dia no prompt");
    historico = [{ sender: "user", text: "quero uma calabresa" }, { sender: "bot", text: r.reply }];
  });

  await caso("o rascunho guarda o horário (campos e marca do site)", async () => {
    const [rasc] = await pedidosDe(telAna);
    assert.equal(rasc.status, "CRIANDO_IA");
    assert.equal(rasc.agendado, true);
    assert.equal(rasc.scheduledDatetime.toISOString(), h2.iso);
    assert.ok(rasc.notes.startsWith("[📅 AGENDADO para "), rasc.notes);
  });

  let pedidoDoRobo;
  await caso("a confirmação sem repetir o campo herda o horário e fecha agendado", async () => {
    const { r } = await conversa(telAna, "pode confirmar", `Perfeito! Pedido confirmado e enviado pra cozinha 🚀 ${tag("", true)}`, historico);
    const lista = await pedidosDe(telAna);
    assert.equal(lista.length, 1, "um pedido só");
    pedidoDoRobo = lista[0];
    assert.equal(pedidoDoRobo.status, "NOVO");
    assert.equal(pedidoDoRobo.agendado, true);
    assert.equal(pedidoDoRobo.scheduledDatetime.toISOString(), h2.iso);
    assert.ok(pedidoDoRobo.dailyOrderNumber, "número do dia");
    assert.match(r.reply, /AGENDADO\* para/);
    assert.match(r.reply, /Retirada agendada para/);
    assert.doesNotMatch(r.reply, /EM PRODUÇÃO/);
    assert.equal(aindaGuardado(pedidoDoRobo, agendamentoConfig.liberarAntesMin), new Date(h2.iso).getTime() - Date.now() > 60 * 60_000);
    console.log("   resposta ao cliente:\n" + r.reply.split("\n").map((l) => "     " + l).join("\n"));
  });

  await caso("só agendado: fechar 'para agora' é recusado com as opções", async () => {
    const tel = "5522999990002";
    const { r } = await conversa(tel, "quero uma calabresa agora, pode fechar", `Perfeito! Pedido confirmado e enviado pra cozinha 🚀 ${tag(`, "agendadoPara": "agora"`, true)}`);
    assert.match(r.reply, /só com pedido agendado/);
    assert.ok(r.reply.includes(h1.hora), r.reply);
    assert.equal((await pedidosDe(tel)).filter((p) => p.status !== "CRIANDO_IA").length, 0, "nada fechado");
  });

  await caso("horário fora da lista é recusado com as opções", async () => {
    const tel = "5522999990003";
    const fora = `${dias[0].data} ${h1.hora.slice(0, 3)}15`;
    const { r } = await conversa(tel, "quero pra 19:15", `Perfeito! Pedido confirmado e enviado pra cozinha 🚀 ${tag(`, "agendadoPara": "${fora}"`, true)}`);
    assert.match(r.reply, /não está disponível|já não dá/);
    assert.ok(r.reply.includes(h1.hora), r.reply);
    assert.equal((await pedidosDe(tel)).length, 0);
  });

  await caso("entrega na Vedana (só retirada) é recusada", async () => {
    const tel = "5522999990004";
    const tagEntrega = tag(`, "agendadoPara": "${tagHora(h1)}"`, true).replace(`"deliveryType": "RETIRADA"`, `"deliveryType": "DELIVERY", "address": "Rua A, 10, Centro"`);
    const { r } = await conversa(tel, "entrega aqui em casa", `Perfeito! Pedido confirmado 🚀 ${tagEntrega}`);
    assert.match(r.reply, /só para retirada/);
    assert.equal((await pedidosDe(tel)).filter((p) => p.status !== "CRIANDO_IA").length, 0);
  });

  // ── O mesmo horário pela rota do site: os dois pedidos têm de bater ────────
  await caso("o pedido do site no mesmo horário tem os mesmos campos de agendamento", async () => {
    const { POST } = jiti("../src/app/api/customer-order/route");
    const corpo = {
      franchiseeId: loja.id, customerName: "Bia", customerPhone: "(22) 99999-0009", deliveryType: "PICKUP", paymentMethod: "Dinheiro",
      items: [{ menuProductId: pizza.id, quantity: 1 }], agendado: true, scheduledDatetime: h2.iso,
    };
    const resp = await POST(new Request("http://localhost/api/customer-order", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.9" }, body: JSON.stringify(corpo),
    }));
    const json = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(json));
    const doSite = await prisma.customerOrder.findFirst({ where: { franchiseeId: loja.id, customerName: "Bia" } });
    assert.ok(doSite, "pedido do site gravado");
    const doAgendamento = (p) => ({
      agendado: p.agendado,
      scheduledDatetime: p.scheduledDatetime && p.scheduledDatetime.toISOString(),
      marca: (/^\[📅 AGENDADO para [^\]]+\]/.exec(p.notes || "") || [""])[0],
      guardado: aindaGuardado(p, agendamentoConfig.liberarAntesMin),
    });
    assert.deepEqual(doAgendamento(pedidoDoRobo), doAgendamento(doSite));
    console.log("   site × robô:", JSON.stringify(doAgendamento(doSite)));
  });

  // ── Loja SEM agendamento: comportamento de sempre ──────────────────────────
  await caso("loja sem agendamento: o campo é ignorado e o pedido sai para agora", async () => {
    const aberta = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"].map((day) => ({ day, open: "00:00", close: "23:59", active: true, shifts: [{ open: "00:00", close: "23:59" }] }));
    const outra = await prisma.user.create({
      data: {
        name: "Loja comum", email: `comum-${sufixo}@teste.local`, password: "x", role: "FRANCHISEE", storeName: "Loja Comum",
        slug: `comum-${sufixo}`, storeTimezone: SP, storeOpen: true, storeHours: aberta,
        chatbotConfig: { geminiApiKey: "falsa", aiOrderingEnabled: true },
      },
    });
    await prisma.menuProduct.create({ data: { franchiseeId: outra.id, name: "Pizza Grande Calabresa", description: "", price: 59.9, category: "Pizzas", active: true, activeDelivery: true } });
    globalThis.__falas.push(`Perfeito! Pedido confirmado e enviado pra cozinha 🚀 ${tag(`, "agendadoPara": "${tagHora(h1)}"`, true)}`);
    globalThis.__chamadas.length = 0;
    const r = await processChatbotAI(outra.id, "vou retirar, pode fechar", [], "5522999990005@s.whatsapp.net", undefined, "Ana");
    const prompt = String(globalThis.__chamadas[0]?.config?.systemInstruction || "");
    assert.doesNotMatch(prompt, /📅 PEDIDO AGENDADO/);
    const [p] = await prisma.customerOrder.findMany({ where: { franchiseeId: outra.id } });
    assert.ok(p, `pedido gravado (${r.reply})`);
    assert.equal(p.status, "NOVO");
    assert.equal(p.agendado, false);
    assert.equal(p.scheduledDatetime, null);
    assert.ok(!String(p.notes || "").includes("AGENDADO"));
  });

  console.log(`\n${ok} casos ok`);
  await prisma.$disconnect();
  fs.unlinkSync(falso);
  process.exit(0);
})().catch((e) => {
  console.error("FALHOU:", e);
  try { fs.unlinkSync(falso); } catch {}
  process.exit(1);
});
