/**
 * scripts/teste-meu-aplicativo-resultados.ts — as regras da aba Resultados e
 * da notificação direcionada do Meu aplicativo, sem banco e sem rede:
 * canais e destaques (analise.ts), antes × depois, comissão economizada,
 * segmentos (segmentos.ts), regras do texto e sugestões (mensagem.ts),
 * atribuição de pedido ao envio e o que funciona (resultado-dos-envios.ts).
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-meu-aplicativo-resultados.ts
 */
import {
  antesDepois,
  canalDaAnalise,
  comissaoEconomizada,
  destaquesDoApp,
  mapaDeCalor,
  melhorHorario,
  numerosPorCanal,
  participacaoSemanal,
  type PedidoDaAnalise,
} from "../src/lib/app-da-loja/analise";
import { corteDoTicketAlto, mesDiaDoAniversario, segmentoValido, tamanhosDosSegmentos, tokensDoSegmento, type AparelhoDoSegmento, type ClienteDoSegmento } from "../src/lib/app-da-loja/segmentos";
import { avaliarTexto, contarEmojis, envioDuplicado, sugestoesProntas } from "../src/lib/app-da-loja/mensagem";
import { atribuirPedidos, desligaramDepois, oQueFunciona, rankingDosEnvios, type EnvioComResultado } from "../src/lib/app-da-loja/resultado-dos-envios";
import { MENSAGEM_MAX, TITULO_MAX } from "../src/lib/app-da-loja/regras-do-push";

let falhas = 0;
let total = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

const agora = new Date("2026-10-17T22:00:00Z");
const DIA = 86_400_000;
const dias = (n: number) => new Date(agora.getTime() - n * DIA);

// ── Canal do pedido ─────────────────────────────────────────────────────────
const doApp = new Set(["a1"]);
confere("pedido do app (o site dentro do app) é APP", canalDaAnalise({ id: "a1", source: "SITE" }, doApp), "APP");
confere("site pelo navegador é SITE", canalDaAnalise({ id: "s1", source: "SITE" }, doApp), "SITE");
confere("robô do WhatsApp", canalDaAnalise({ id: "w1", source: "WHATSAPP_IA" }, doApp), "WHATSAPP");
confere("balcão (PDV) vai para Loja", canalDaAnalise({ id: "b1", source: "PDV" }, doApp), "LOJA");
confere("mesa vai para Loja", canalDaAnalise({ id: "m1", source: "PRESENCIAL", tableSessionId: "ts" }, doApp), "LOJA");
confere("iFood é marketplace", canalDaAnalise({ id: "i1", source: "IFOOD" }, doApp), "MARKETPLACE");
confere("99Food é marketplace", canalDaAnalise({ id: "n1", source: "99FOOD" }, doApp), "MARKETPLACE");

// ── Números por canal ───────────────────────────────────────────────────────
const P = (id: string, canal: PedidoDaAnalise["canal"], diasAtras: number, valor: number, telefone: string, status = "ENTREGUE"): PedidoDaAnalise =>
  ({ id, canal, createdAt: dias(diasAtras), totalAmount: valor, status, telefone, tableSessionId: null, parentOrderId: null });
const pedidos: PedidoDaAnalise[] = [];
// App: 12 pedidos de R$ 60, de 6 clientes (2 cada) — todos voltam.
for (let i = 0; i < 6; i++) { pedidos.push(P(`app${i}a`, "APP", 50, 60, `2299990000${i}`)); pedidos.push(P(`app${i}b`, "APP", 40, 60, `2299990000${i}`)); }
// Site: 12 pedidos de R$ 50, de 12 clientes — ninguém volta.
for (let i = 0; i < 12; i++) pedidos.push(P(`site${i}`, "SITE", 50, 50, `2288880000${String(i).padStart(2, "0")}`));
pedidos.push(P("canc", "APP", 45, 999, "22999900000", "CANCELADO"));
const r = numerosPorCanal(pedidos, dias(60), agora, agora);
const app = r.canais.find((c) => c.canal === "APP")!, site = r.canais.find((c) => c.canal === "SITE")!;
confere("app: 12 pedidos, R$ 720, ticket R$ 60 (cancelado fora)", [app.pedidos, app.faturamento, app.ticketMedio], [12, 720, 60]);
confere("site: 12 pedidos, R$ 600, ticket R$ 50", [site.pedidos, site.faturamento, site.ticketMedio], [12, 600, 50]);
confere("participação do app: 720 de 1320", Math.round(app.participacao * 1000) / 1000, 0.545);
confere("frequência: app 2 por cliente, site 1", [app.frequencia, site.frequencia], [2, 1]);
confere("recorrência: app 100%, site 0% (janelas fechadas)", [app.recorrencia, site.recorrencia], [1, 0]);
const d = destaquesDoApp(r.canais);
confere("destaque: ticket 20% maior que o site", d.find((x) => x.titulo.startsWith("Ticket"))?.titulo, "Ticket 20% maior que o do site");
confere("destaque: pede 100% mais vezes", d.some((x) => x.tipo === "ganha" && x.titulo.includes("pede 100% mais vezes")), true);
const pior = destaquesDoApp(r.canais.map((c) => (c.canal === "APP" ? { ...c, ticketMedio: 40 } : c)));
confere("quando o app perde, diz e sugere ação", [pior[0].tipo, !!pior[0].acao], ["perde", true]);
confere("com menos de 10 pedidos no app, não afirma nada", destaquesDoApp(r.canais.map((c) => (c.canal === "APP" ? { ...c, pedidos: 9 } : c))).length, 0);
// Recorrência: cliente com o primeiro pedido há 10 dias e sem volta ainda não conta.
const rec = numerosPorCanal([P("x1", "APP", 10, 50, "21900000001"), ...Array.from({ length: 5 }, (_, i) => P(`y${i}`, "APP", 50, 50, `2190000010${i}`))], dias(60), agora, agora);
confere("janela de 30 dias aberta e sem volta: fora da conta", rec.canais.find((c) => c.canal === "APP")!.recorrenciaBase, 5);

// ── Comissão economizada ────────────────────────────────────────────────────
const com = comissaoEconomizada(16464, 15, 197, 30);
confere("15% de R$ 16.464 = R$ 2.469,60; plano R$ 197 → 12,5×", [com.economia, com.planoNoPeriodo, com.vezes], [2469.6, 197, 12.5]);
confere("plano proporcional a 7 dias", comissaoEconomizada(1000, 20, 197, 7).planoNoPeriodo, 45.97);
confere("taxa absurda é limitada a 50%", comissaoEconomizada(100, 300, 197, 30).economia, 50);

// ── Antes × depois ──────────────────────────────────────────────────────────
const ad = antesDepois(
  [
    { telefone: "A", instalouEm: dias(40) },
    { telefone: "B", instalouEm: dias(30) },
    { telefone: "C", instalouEm: dias(5) }, // instalou há menos de 14 dias: fora
  ],
  [
    { telefone: "A", em: dias(55), valor: 50 }, { telefone: "A", em: dias(30), valor: 60 }, { telefone: "A", em: dias(20), valor: 60 }, { telefone: "A", em: dias(10), valor: 60 },
    { telefone: "B", em: dias(25), valor: 80 },
    { telefone: "A", em: dias(100), valor: 999 }, // fora da janela simétrica de 40 dias
  ],
  agora,
);
confere("antes×depois: 2 clientes (o de 5 dias fica fora), 1 sem pedido antes", [ad.clientes, ad.novos], [2, 1]);
confere("janela simétrica: A usa 40 dias, B 30", ad.janelaMediaDias, 35);
// A: antes 1 pedido/40d = 0,75/mês; depois 3/40d = 2,25. B: antes 0; depois 1/30d = 1. Média: antes 0,375, depois 1,625.
confere("pedidos por mês antes e depois (normalizado para 30 dias)", [ad.pedidosMesAntes, ad.pedidosMesDepois], [0.38, 1.63]);
confere("variação de pedidos", ad.variacaoPedidos, 3.333);

// ── Evolução e horários ─────────────────────────────────────────────────────
const sem = participacaoSemanal([P("w1", "APP", 3, 40, ""), P("w2", "SITE", 3, 60, ""), P("w3", "SITE", 10, 100, "")], "2026-10-03", "2026-10-17", "America/Sao_Paulo");
confere("semanas desde a ativação: 3; a do meio (10 a 16/10) com 40% do app", [sem.length, Math.round(sem[1].participacao * 100), sem[1].inicio], [3, 40, "2026-10-10"]);
const calor = mapaDeCalor([{ createdAt: new Date("2026-10-17T22:30:00Z") }, { createdAt: new Date("2026-10-16T22:10:00Z") }, { createdAt: new Date("2026-10-17T15:00:00Z") }], "America/Sao_Paulo");
confere("mapa de calor: 19h de sexta e de sábado", [calor[5][19], calor[6][19], calor[6][12]], [1, 1, 1]);
confere("melhor horário: 1 h antes do pico das 19h", melhorHorario(calor)?.enviar, 18);
confere("sem pedido, sem horário", melhorHorario(Array.from({ length: 7 }, () => Array(24).fill(0))), null);

// ── Segmentos ───────────────────────────────────────────────────────────────
const T = (n: number) => `ExponentPushToken[seg${n}]`;
const ap: AparelhoDoSegmento[] = [
  { pushToken: T(1), ultimaAbertura: new Date(agora.getTime() - 2 * 60_000), telefones: ["fiel"], pedidosNoApp: 4 },
  { pushToken: T(2), ultimaAbertura: dias(40), telefones: ["sumido"], pedidosNoApp: 1 },
  { pushToken: T(3), ultimaAbertura: dias(1), telefones: [], pedidosNoApp: 0 },
  { pushToken: T(4), ultimaAbertura: dias(3), telefones: ["pizza"], pedidosNoApp: 1 },
  { pushToken: T(5), ultimaAbertura: dias(70), telefones: ["sumido2"], pedidosNoApp: 2 },
];
const ped = (diasAtras: number, valor: number, produtos: string[] = [], categorias: string[] = []) => ({ em: dias(diasAtras), valor, produtos, categorias });
const clientes = new Map<string, ClienteDoSegmento>([
  ["fiel", { pedidos: [ped(2, 40), ped(9, 45), ped(20, 50), ped(25, 42)], ultimoPedidoEm: dias(2), aniversario: "10-05" }],
  ["sumido", { pedidos: [ped(45, 120, ["p-pizza"], ["Pizzas"])], ultimoPedidoEm: dias(45), aniversario: null }],
  ["pizza", { pedidos: [ped(3, 90, ["p-pizza"], ["Pizzas"])], ultimoPedidoEm: dias(3), aniversario: "03-01" }],
  ["sumido2", { pedidos: [], ultimoPedidoEm: dias(80), aniversario: null }],
]);
const ctx = { agora, mesDaLoja: "10" };
const seg = (tipo: any, valor?: string) => tokensDoSegmento(ap, { tipo, valor }, clientes, ctx).sort();
confere("todos", seg("todos").length, 5);
confere("ativos agora (5 min)", seg("ativosAgora"), [T(1)]);
confere("ativos 30 dias", seg("ativos30"), [T(1), T(3), T(4)]);
confere("sumidos 30: último pedido há 45 e 80 dias (de sempre, não só 120 dias)", seg("sumidos30"), [T(2), T(5)]);
confere("sumidos 60", seg("sumidos60"), [T(5)]);
confere("fiéis: 3+ pedidos em 30 dias", seg("fieis"), [T(1)]);
confere("nunca pediu pelo app", seg("nuncaPediuNoApp"), [T(3)]);
confere("pediram o produto (90 dias)", seg("produto", "p-pizza"), [T(2), T(4)]);
confere("pediram da categoria (sem diferenciar maiúscula)", seg("categoria", "pizzas"), [T(2), T(4)]);
confere("aniversariantes de outubro", seg("aniversariantes"), [T(1)]);
confere("ticket alto: corte no 75º percentil", corteDoTicketAlto(ap, clientes, agora), 120);
confere("ticket alto", seg("ticketAlto"), [T(2)]);
confere("tamanhos de todos os segmentos fixos", tamanhosDosSegmentos(ap, clientes, ctx), { todos: 5, ativosAgora: 1, ativos30: 3, sumidos30: 2, sumidos60: 1, fieis: 1, ticketAlto: 1, nuncaPediuNoApp: 1, aniversariantes: 1 });
confere("segmento de produto sem produto é inválido", segmentoValido({ tipo: "produto" }), null);
confere("segmento desconhecido é inválido", segmentoValido({ tipo: "vip" }), null);
confere("aniversário em vários formatos", [mesDiaDoAniversario("1990-03-15"), mesDiaDoAniversario("5/3/1990"), mesDiaDoAniversario("15/03"), mesDiaDoAniversario("abc")], ["03-15", "03-05", "03-15", null]);

// ── Regras do texto ─────────────────────────────────────────────────────────
const niveis = (t: { titulo: string; mensagem: string }, c: { hora: number; enviosNoDia: number; titulosRecentes?: string[] }) => avaliarTexto(t, c).filter((a) => a.nivel === "atencao").map((a) => a.texto.split(":")[0].split(" ").slice(0, 3).join(" "));
const bom = { titulo: "🍕 Pizza G por R$ 49,90 hoje", mensagem: "Só até as 23h. Toque e peça pelo app!" };
confere("texto bom às 18h: nenhum alerta", niveis(bom, { hora: 18, enviosNoDia: 0 }), []);
confere("título longo avisa", avaliarTexto({ ...bom, titulo: "🍕 " + "a".repeat(45) + " R$ 10" }, { hora: 18, enviosNoDia: 0 }).some((a) => a.nivel === "atencao" && a.texto.startsWith("Título com")), true);
confere("sem benefício avisa", avaliarTexto({ titulo: "Olá, tudo bem?", mensagem: "Estamos abertos hoje, venha nos visitar." }, { hora: 18, enviosNoDia: 0 }).some((a) => a.texto.startsWith("Sem um benefício")), true);
confere("madrugada avisa", avaliarTexto(bom, { hora: 2, enviosNoDia: 0 }).some((a) => a.texto.startsWith("Envio às 2h")), true);
confere("3º envio do dia avisa (sem bloquear)", avaliarTexto(bom, { hora: 18, enviosNoDia: 2 }).some((a) => a.nivel === "atencao" && a.texto.startsWith("Você já mandou 2")), true);
confere("emoji demais avisa", avaliarTexto({ titulo: "🍕🔥🎉 Promo", mensagem: "Hoje 50% 🍔" }, { hora: 18, enviosNoDia: 0 }).some((a) => a.texto.startsWith("4 emojis")), true);
confere("MAIÚSCULAS avisam", avaliarTexto({ titulo: "PROMOÇÃO IMPERDÍVEL HOJE", mensagem: "SÓ HOJE 50% OFF NO APP" }, { hora: 18, enviosNoDia: 0 }).some((a) => a.texto.includes("MAIÚSCULAS")), true);
confere("título repetido na semana avisa", avaliarTexto(bom, { hora: 18, enviosNoDia: 0, titulosRecentes: ["🍕 pizza g por r$ 49,90 HOJE"] }).some((a) => a.texto.startsWith("Esse título")), true);
confere("conta emojis", contarEmojis("🍕 Pizza 🔥"), 2);
confere("duplicado: mesmo texto em 1 min", envioDuplicado(bom, [{ ...bom, criadoEm: new Date(agora.getTime() - 60_000) }], agora), true);
confere("não duplicado depois de 2 min", envioDuplicado(bom, [{ ...bom, criadoEm: new Date(agora.getTime() - 3 * 60_000) }], agora), false);
const sug = sugestoesProntas({ loja: "Hakim Centro", produtoTop: { id: "p1", nome: "Esfiha de carne especial da casa com queijo", preco: 8.9 }, categoriaTop: "Esfihas", diaFraco: "terça", horaDeEnvio: 18 });
confere("6 sugestões, todas dentro dos limites", [sug.length, sug.every((s) => [...s.titulo].length <= TITULO_MAX && [...s.mensagem].length <= MENSAGEM_MAX)], [6, true]);
confere("sugestão de dia fraco usa o dia da loja", sug.find((s) => s.objetivo === "diaFraco")?.titulo, "📈 Terça com desconto no app");
confere("trazer de volta vai para os sumidos", sug.find((s) => s.objetivo === "voltar")?.segmento, "sumidos30");

// ── Atribuição ──────────────────────────────────────────────────────────────
const e1 = { id: "e1", enviadoEm: dias(2), destinos: new Set(["tokA", "i:instB"]) };
const e2 = { id: "e2", enviadoEm: new Date(dias(2).getTime() + 3 * 3600_000), destinos: new Set(["tokA"]) };
const at = atribuirPedidos([e1, e2], [
  { id: "p1", em: new Date(dias(2).getTime() + 3600_000), valor: 50, chaves: ["tokA"] },     // só e1 tinha saído: e1
  { id: "p2", em: new Date(dias(2).getTime() + 5 * 3600_000), valor: 70, chaves: ["tokA"] }, // e1 e e2: a mais recente (e2)
  { id: "p3", em: new Date(dias(2).getTime() + 2 * 3600_000), valor: 30, chaves: ["i:instB"] }, // pela instalação
  { id: "p4", em: new Date(dias(2).getTime() + 30 * 3600_000), valor: 99, chaves: ["tokA"] }, // depois de 24 h: nada
  { id: "p5", em: new Date(dias(2).getTime() + 3600_000), valor: 99, chaves: ["outro"] },   // não recebeu: nada
]);
confere("e1: p1 e p3 (R$ 80)", [at.get("e1")!.ids, at.get("e1")!.faturamento], [["p1", "p3"], 80]);
confere("e2: p2 (último toque)", at.get("e2")!.ids, ["p2"]);
confere("desligaram em 48 h só entre quem recebeu", desligaramDepois(dias(2), new Set(["i:instB", "i:x"]), [
  { chave: "i:instB", em: new Date(dias(2).getTime() + 3600_000) },
  { chave: "i:x", em: new Date(dias(2).getTime() + 50 * 3600_000) },
  { chave: "i:fora", em: new Date(dias(2).getTime() + 3600_000) },
]), 1);

// ── O que funciona na loja ──────────────────────────────────────────────────
const E = (id: string, comProduto: boolean, hora: number, pedidos: number): EnvioComResultado => ({ id, titulo: comProduto ? "🍕 Pizza hoje" : "Promoção da semana chegou para você aproveitar agora", mensagem: "x", hora, diaSemana: 3, comProduto, entregues: 100, abertos: 10, pedidos, faturamento: pedidos * 50 });
confere("ainda aprendendo com 5 envios", oQueFunciona([E("1", true, 19, 5), E("2", true, 19, 5), E("3", false, 15, 1), E("4", false, 15, 1), E("5", true, 19, 5)]).faltam, 1);
const aprendeu = oQueFunciona([E("1", true, 19, 6), E("2", true, 19, 4), E("3", false, 15, 1), E("4", false, 15, 1), E("5", true, 19, 5), E("6", false, 15, 2)]);
confere("aprendeu: com produto rende mais", aprendeu.achados.some((a) => a.melhor === "com produto no link"), true);
confere("ranking por faturamento", rankingDosEnvios([E("a", true, 19, 2), E("b", true, 19, 6), E("c", false, 19, 0)]).map((e) => e.id), ["b", "a"]);

console.log(`\n${total - falhas}/${total} conferências passaram.`);
if (falhas) process.exit(1);
