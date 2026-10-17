/**
 * Prova do pedido agendado pelo robô do WhatsApp (lib/agendamento-do-robo.ts).
 *
 *   npx tsx scripts/teste-agendamento-do-robo.ts
 *
 * O caso de origem é o do Pedro (Pizza Vedana), com a configuração e o horário
 * lidos do banco em 17/10/2026: só encomenda ("só agendado"), só retirada, só
 * sábado, no horário da loja (19h–21h), 4 h de antecedência, 14 dias à frente,
 * de 30 em 30 min, liberada 1 h antes. A régua é sempre a do site: os horários
 * que o robô oferece e aceita são os de `horariosParaAgendar`/`conferirAgendamento`,
 * e o pedido gravado tem os mesmos campos do pedido agendado do site.
 */
// O processo em outro fuso: nada aqui pode depender do relógio do servidor.
process.env.TZ = "Asia/Tokyo";

import {
  lerConfigDeAgendamento, horariosParaAgendar, conferirAgendamento, camposDoPedidoAgendado,
  marcaDoAgendamento, aindaGuardado,
} from "../src/lib/agendamento";
import {
  blocoDoAgendamentoParaORobo, decidirAgendamento, horariosDoRobo, instrucaoDaLojaComAgendamento,
  lerAgendadoDaTag, opcoesEmTexto, agendamentoParaGravar, type LojaQueAgenda,
} from "../src/lib/agendamento-do-robo";
import { estadoDaLoja } from "../src/lib/loja-aberta";
import { previsaoDaEntrega } from "../src/lib/previsao-da-entrega";
import { dataDoPedido } from "../src/lib/pedidos-na-cozinha";
import { comandaDoRobo } from "../src/lib/comanda-do-robo";
import { memoriaDoPedidoParaOPrompt } from "../src/lib/rascunho-do-robo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const contem = (oQue: string, texto: string, trecho: string) => confere(`${oQue} (contém "${trecho}")`, texto.includes(trecho), true);
const naoContem = (oQue: string, texto: string, trecho: string) => confere(`${oQue} (não contém "${trecho}")`, texto.includes(trecho), false);

const SP = "America/Sao_Paulo";

// ── A Pizza Vedana, como está no banco (17/10/2026) ──────────────────────────
const fechadoNoDia = (day: string) => ({ day, open: "18:00", close: "23:00", active: false, shifts: [{ open: "18:00", close: "23:00" }] });
const horasDaVedana = [
  fechadoNoDia("Segunda"), fechadoNoDia("Terça"), fechadoNoDia("Quarta"), fechadoNoDia("Quinta"), fechadoNoDia("Sexta"),
  { day: "Sábado", open: "19:00", close: "21:00", active: true, shifts: [{ open: "19:00", close: "21:00" }] },
  fechadoNoDia("Domingo"),
];
const configDaVedana = lerConfigDeAgendamento({
  de: "18:00", ate: "22:00", dias: [5], ativo: true, entrega: false, horario: "LOJA", retirada: true,
  soAgendado: true, diasAFrente: 14, intervaloMin: 30, antecedenciaMin: 240, liberarAntesMin: 60,
});
const vedana: LojaQueAgenda = { config: configDaVedana, storeHours: horasDaVedana, storePause: null, timezone: SP };

// Sábado, 17/10/2026, 12:00 em Brasília (15:00 UTC; 00:00 de domingo em Tóquio).
const meioDia = new Date("2026-10-17T15:00:00Z");
// O mesmo sábado, 16:00 (a antecedência de 4 h corta o 19:00 e o 19:30).
const quatroDaTarde = new Date("2026-10-17T19:00:00Z");

// ── 1. Os horários são os do site ────────────────────────────────────────────
const doSite = horariosParaAgendar({ config: configDaVedana, storeHours: horasDaVedana, timezone: SP, agora: meioDia });
const doRobo = horariosDoRobo(vedana, meioDia);
confere("robô oferece exatamente os horários do checkout", doRobo, doSite);
confere("Vedana: os sábados dos próximos 14 dias", doRobo.map((d) => d.data), ["2026-10-17", "2026-10-24", "2026-10-31"]);
confere("Vedana: 19:00 a 20:30, de 30 em 30 (21h fecha)", doRobo[0].horarios.map((h) => h.hora), ["19:00", "19:30", "20:00", "20:30"]);
confere("Vedana às 16h: a antecedência de 4 h deixa 20:00 e 20:30 hoje", horariosDoRobo(vedana, quatroDaTarde)[0].horarios.map((h) => h.hora), ["20:00", "20:30"]);
confere("opções em texto para o cliente", opcoesEmTexto(vedana, meioDia),
  "hoje, sáb 17/10: 19:00, 19:30, 20:00 ou 20:30; sáb 24/10: 19:00, 19:30, 20:00 ou 20:30; sáb 31/10: 19:00, 19:30, 20:00 ou 20:30");

// ── 2. O bloco do prompt ─────────────────────────────────────────────────────
const bloco = blocoDoAgendamentoParaORobo(vedana, meioDia);
contem("bloco: só encomenda", bloco, "SÓ POR ENCOMENDA");
contem("bloco: só retirada", bloco, "só RETIRADA na loja");
contem("bloco: a lista de hoje com a data da tag", bloco, "hoje, sáb 17/10 [2026-10-17]: 19:00, 19:30, 20:00 ou 20:30");
contem("bloco: a antecedência", bloco, "4 horas");
contem("bloco: o formato do campo", bloco, `"agendadoPara": "2026-10-17 19:00"`);
naoContem("bloco: loja só agendado não oferece 'agora'", bloco, `"agendadoPara": "agora"`);
confere("loja sem agendamento: sem bloco (prompt de sempre)", blocoDoAgendamentoParaORobo({ ...vedana, config: lerConfigDeAgendamento(null) }, meioDia), "");
const lojaComum: LojaQueAgenda = {
  config: lerConfigDeAgendamento({ ativo: true, antecedenciaMin: 60, diasAFrente: 2, intervaloMin: 30 }),
  storeHours: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"].map((day) => ({ day, open: "18:00", close: "23:00", active: true, shifts: [{ open: "18:00", close: "23:00" }] })),
  timezone: SP,
};
const blocoComum = blocoDoAgendamentoParaORobo(lojaComum, meioDia);
contem("loja que agenda e vende para agora: o campo aceita 'agora'", blocoComum, `"agendadoPara": "agora"`);
contem("muitos horários viram faixa", blocoComum, "das 18:00 às 22:30, de 30 em 30 min");

// ── 3. O topo do prompt (situação da loja) ───────────────────────────────────
const fechadaAoMeioDia = estadoDaLoja({ storeHours: horasDaVedana, storeOpen: true, timezone: SP, agora: meioDia });
confere("Vedana ao meio-dia de sábado está fechada", fechadaAoMeioDia.aberta, false);
const topoFechada = instrucaoDaLojaComAgendamento(fechadaAoMeioDia, vedana, meioDia) || "";
contem("fechada que agenda: não recusa pedido, oferece agendar", topoFechada, "A LOJA ACEITA PEDIDO AGENDADO");
naoContem("fechada que agenda: sem o 'PROIBIDO anotar pedido'", topoFechada, "PROIBIDO anotar pedido");
const as1930 = new Date("2026-10-17T22:30:00Z");
const aberta = estadoDaLoja({ storeHours: horasDaVedana, storeOpen: true, timezone: SP, agora: as1930 });
confere("Vedana às 19:30 de sábado está aberta", aberta.aberta, true);
contem("aberta e só agendado: pedido para agora não existe", instrucaoDaLojaComAgendamento(aberta, vedana, as1930) || "", "SÓ POR ENCOMENDA");
confere("loja sem agendamento: topo de sempre", instrucaoDaLojaComAgendamento(fechadaAoMeioDia, { ...vedana, config: lerConfigDeAgendamento(null) }, meioDia), null);
confere("sem conexão: topo de sempre (instabilidade)", instrucaoDaLojaComAgendamento({ ...fechadaAoMeioDia, instabilidade: true }, vedana, meioDia), null);
confere("aberta, agenda mas vende para agora: topo de sempre", instrucaoDaLojaComAgendamento({ ...aberta }, lojaComum, as1930), null);

// ── 4. O campo da tag, no relógio da loja ────────────────────────────────────
const t = (agendadoPara: unknown, tz = SP) => lerAgendadoDaTag({ agendadoPara }, tz);
const iso = (r: ReturnType<typeof t>) => (r.tipo === "horario" ? r.instante.toISOString() : r.tipo);
confere("'2026-10-17 19:30' de Brasília = 22:30 UTC", iso(t("2026-10-17 19:30")), "2026-10-17T22:30:00.000Z");
confere("'2026-10-17T19:30' também", iso(t("2026-10-17T19:30")), "2026-10-17T22:30:00.000Z");
confere("hora sem zero à esquerda ('2026-10-17 9:00')", iso(t("2026-10-17 9:00")), "2026-10-17T12:00:00.000Z");
confere("ISO com fuso já é o instante", iso(t("2026-10-17T22:30:00.000Z")), "2026-10-17T22:30:00.000Z");
confere("loja em Manaus (UTC−4): 19:30 = 23:30 UTC", iso(t("2026-10-17 19:30", "America/Manaus")), "2026-10-17T23:30:00.000Z");
confere("'agora' é pedido imediato", t("agora").tipo, "agora");
confere("null é pedido imediato", t(null).tipo, "agora");
confere("sem o campo: herda do rascunho", lerAgendadoDaTag({ items: [] }, SP).tipo, "ausente");
confere("texto solto é inválido", t("sábado às 19h").tipo, "invalido");

// ── 5. A decisão do servidor (a mesma conferência da rota do site) ───────────
const decide = (agendadoPara: unknown, o: { tipo?: string; final?: boolean; agora?: Date; loja?: LojaQueAgenda; herdado?: any } = {}) => {
  const loja = o.loja || vedana;
  const payload = agendadoPara === undefined ? {} : { agendadoPara };
  return decidirAgendamento({
    loja, deliveryType: o.tipo || "RETIRADA", daTag: lerAgendadoDaTag(payload, loja.timezone),
    querFinalizar: o.final !== false, herdado: o.herdado ?? null, agora: o.agora || meioDia,
  });
};
const instanteDe = (d: ReturnType<typeof decide>) => (d.ok ? d.instante?.toISOString() ?? null : "RECUSADO");
const mensagemDe = (d: ReturnType<typeof decide>) => (d.ok ? d.aviso || "" : d.mensagemParaOCliente);

confere("sáb 19:30 retirada: aceito", instanteDe(decide("2026-10-17 19:30")), "2026-10-17T22:30:00.000Z");
confere("o instante aceito é o mesmo que o site posta para 19:30", instanteDe(decide("2026-10-17 19:30")), doSite[0].horarios[1].iso);
confere("e a rota do site aceita esse mesmo instante", conferirAgendamento({ config: configDaVedana, deliveryType: "PICKUP", instante: doSite[0].horarios[1].iso, storeHours: horasDaVedana, timezone: SP, agora: meioDia }), null);
confere("sáb 24/10 20:30: aceito", instanteDe(decide("2026-10-24 20:30")), "2026-10-24T23:30:00.000Z");
const as1915 = decide("2026-10-17 19:15");
confere("19:15 (fora do intervalo): recusado", instanteDe(as1915), "RECUSADO");
contem("19:15: a recusa explica as opções", mensagemDe(as1915), "19:00, 19:30, 20:00 ou 20:30");
confere("domingo: recusado", instanteDe(decide("2026-10-18 19:30")), "RECUSADO");
confere("sáb 21:00 (a loja fecha): recusado", instanteDe(decide("2026-10-17 21:00")), "RECUSADO");
confere("sáb 07/11 (passa dos 14 dias): recusado", instanteDe(decide("2026-11-07 19:30")), "RECUSADO");
const antecedencia = decide("2026-10-17 19:30", { agora: quatroDaTarde });
confere("às 16h, 19:30 de hoje: recusado (4 h de antecedência)", instanteDe(antecedencia), "RECUSADO");
contem("a recusa diz a antecedência", mensagemDe(antecedencia), "4 horas de antecedência");
contem("e oferece o que ainda dá hoje", mensagemDe(antecedencia), "hoje, sáb 17/10: 20:00 ou 20:30");
const entrega = decide("2026-10-17 19:30", { tipo: "DELIVERY" });
confere("entrega agendada na Vedana: recusada", instanteDe(entrega), "RECUSADO");
contem("entrega: explica que é só retirada", mensagemDe(entrega), "só para retirada");
naoContem("entrega: não manda 'pedir para agora' (a loja é só agendado)", mensagemDe(entrega), "agora");

// Só agendado: "para agora" não fecha; o rascunho pode esperar a escolha.
const paraAgora = decide("agora");
confere("só agendado: fechar para agora é recusado", instanteDe(paraAgora), "RECUSADO");
contem("só agendado: a recusa oferece os horários", mensagemDe(paraAgora), "só com pedido agendado");
confere("só agendado: sem o campo e sem rascunho agendado também é 'agora' (recusado)", instanteDe(decide(undefined)), "RECUSADO");
confere("só agendado: rascunho para agora é gravado (ainda vai escolher)", instanteDe(decide("agora", { final: false })), null);
const rascunhoRuim = decide("2026-10-17 19:15", { final: false });
confere("rascunho com horário inválido: grava sem horário", instanteDe(rascunhoRuim), null);
contem("rascunho com horário inválido: o cliente lê as opções", mensagemDe(rascunhoRuim), "19:00, 19:30, 20:00 ou 20:30");
confere("tag ilegível no fechamento: recusada", instanteDe(decide("sábado às 19h")), "RECUSADO");

// Herança: a tag que não repete o campo fica com o horário do rascunho.
const herdadoOk = { instante: new Date("2026-10-17T22:30:00Z"), jaEnviado: false };
confere("sem o campo: herda o horário do rascunho (conferido)", instanteDe(decide(undefined, { herdado: herdadoOk })), "2026-10-17T22:30:00.000Z");
confere("rascunho cujo horário venceu: recusado no fechamento", instanteDe(decide(undefined, { herdado: herdadoOk, agora: quatroDaTarde })), "RECUSADO");
confere("pedido JÁ ENVIADO alterado: mantém o horário sem nova conferência", instanteDe(decide(undefined, { herdado: { ...herdadoOk, jaEnviado: true }, agora: quatroDaTarde })), "2026-10-17T22:30:00.000Z");
confere("cliente trocou para 'agora' numa loja que vende para agora: sai do agendamento", instanteDe(decide("agora", { herdado: herdadoOk, loja: lojaComum })), null);

// Loja sem agendamento: comportamento de sempre (o campo é ignorado).
const semAgendamento: LojaQueAgenda = { ...vedana, config: lerConfigDeAgendamento(null) };
confere("loja sem agendamento: o campo é ignorado", instanteDe(decide("2026-10-17 19:30", { loja: semAgendamento })), null);
confere("loja sem agendamento: para agora fecha", instanteDe(decide("agora", { loja: semAgendamento })), null);
confere("loja que agenda e vende para agora: 'agora' fecha", instanteDe(decide("agora", { loja: lojaComum })), null);
confere("loja comum: 19:00 de hoje (sábado) aceito", instanteDe(decide("2026-10-17 19:00", { loja: lojaComum, tipo: "DELIVERY" })), "2026-10-17T22:00:00.000Z");

// Férias: o sábado em pausa sai da lista e é recusado.
const emFerias: LojaQueAgenda = { ...vedana, storePause: { active: true, from: "2026-10-24", to: "2026-10-25" } };
confere("pausa de férias: 24/10 some da lista", horariosDoRobo(emFerias, meioDia).map((d) => d.data), ["2026-10-17", "2026-10-31"]);
confere("pausa de férias: 24/10 recusado", instanteDe(decide("2026-10-24 19:30", { loja: emFerias })), "RECUSADO");

// ── 6. Fuso da loja ──────────────────────────────────────────────────────────
// A mesma loja em Manaus (UTC−4): o "19:00" da lista é 23:00 UTC, e o robô,
// lendo "2026-10-17 19:00" no relógio de Manaus, chega no mesmo instante.
const manaus: LojaQueAgenda = { ...vedana, timezone: "America/Manaus" };
const listaManaus = horariosDoRobo(manaus, meioDia);
confere("Manaus: 19:00 da lista = 23:00 UTC", listaManaus[0].horarios[0].iso, "2026-10-17T23:00:00.000Z");
confere("Manaus: o robô lê o mesmo instante e aceita", instanteDe(decide("2026-10-17 19:00", { loja: manaus })), "2026-10-17T23:00:00.000Z");
confere("processo em Tóquio não mexe no relógio da loja", new Date().getTimezoneOffset(), -540);

// ── 7. A gravação: o pedido do robô igual ao do site ─────────────────────────
// A rota do site (api/customer-order) grava `camposDoPedidoAgendado(new Date(body.scheduledDatetime))`
// e abre as notas com `marcaDoAgendamento`. O pedido do site da Vedana no banco
// (17/10/2026): scheduledDatetime 2026-10-17T22:30:00.000Z, agendado true,
// notes "[📅 AGENDADO para sáb 17/10 às 19:30]".
const decisao = decide("2026-10-17 19:30");
const instante = decisao.ok ? decisao.instante : null;
const gravacao = agendamentoParaGravar(instante, SP, "🤖 Pedido finalizado via IA pelo WhatsApp");
const doSitePost = camposDoPedidoAgendado(new Date(doSite[0].horarios[1].iso));
confere("campos do robô = campos do site", { ...gravacao.campos, scheduledDatetime: (gravacao.campos as any).scheduledDatetime?.toISOString() }, { ...doSitePost, scheduledDatetime: doSitePost.scheduledDatetime.toISOString() });
confere("campos = o pedido real do site no banco", { scheduledDatetime: (gravacao.campos as any).scheduledDatetime?.toISOString(), agendado: (gravacao.campos as any).agendado }, { scheduledDatetime: "2026-10-17T22:30:00.000Z", agendado: true });
confere("marca do agendamento = a do pedido real do site", marcaDoAgendamento(instante!, SP), "[📅 AGENDADO para sáb 17/10 às 19:30]");
confere("notas do robô abrem com a marca do site", gravacao.notas, "[📅 AGENDADO para sáb 17/10 às 19:30] 🤖 Pedido finalizado via IA pelo WhatsApp");
confere("sem agendamento: nada muda na gravação", agendamentoParaGravar(null, SP, "🤖 x"), { campos: {}, notas: "🤖 x" });

const pedidoDoRobo = { createdAt: meioDia, deliveryType: "RETIRADA", ...gravacao.campos };
confere("fica em Agendamentos ao meio-dia (libera 1 h antes)", aindaGuardado(pedidoDoRobo, configDaVedana.liberarAntesMin, meioDia), true);
confere("às 18:29 ainda guardado", aindaGuardado(pedidoDoRobo, 60, new Date("2026-10-17T21:29:00Z")), true);
confere("às 18:31 vai para a cozinha", aindaGuardado(pedidoDoRobo, 60, new Date("2026-10-17T21:31:00Z")), false);
confere("o dia do pedido é o agendado (relatórios/cozinha)", dataDoPedido(pedidoDoRobo).toISOString(), "2026-10-17T22:30:00.000Z");
confere("a previsão da comanda é AGENDADO", previsaoDaEntrega(pedidoDoRobo)?.tipo, "AGENDADO");

// ── 8. O que o cliente lê ───────────────────────────────────────────────────
const comanda = comandaDoRobo({
  numero: 7, status: "ACEITO", itens: [{ quantity: 1, productName: "Pizza Grande", price: 59.9 }],
  formaDePagamento: "Pix", entrega: false, taxaDeEntrega: 0, total: 59.9, fuso: SP, agendadoPara: "sáb 17/10 às 19:30",
});
contem("comanda: título do agendado", comanda, "Seu pedido está *AGENDADO* para sáb 17/10 às 19:30");
naoContem("comanda: agendado não está 'em produção'", comanda, "EM PRODUÇÃO");
contem("comanda: a retirada com o horário", comanda, "📅 Retirada agendada para sáb 17/10 às 19:30");
const comandaNova = comandaDoRobo({
  numero: 7, status: "NOVO", itens: [{ quantity: 1, productName: "Pizza Grande", price: 59.9 }],
  formaDePagamento: "Pix", entrega: false, taxaDeEntrega: 0, total: 59.9, agendadoPara: "sáb 17/10 às 19:30",
});
contem("comanda (loja aceita depois): recebido como agendado", comandaNova, "Recebemos seu pedido *AGENDADO*");
const comandaComum = comandaDoRobo({
  numero: 8, status: "ACEITO", itens: [{ quantity: 1, productName: "Pizza Grande", price: 59.9 }],
  formaDePagamento: "Pix", entrega: false, taxaDeEntrega: 0, total: 59.9,
});
contem("comanda sem agendamento: a de sempre", comandaComum, "EM PRODUÇÃO");

const memoria = memoriaDoPedidoParaOPrompt([{
  id: "r1", status: "CRIANDO_IA", source: "WHATSAPP_IA", createdAt: meioDia.getTime(), deliveryType: "RETIRADA",
  notes: gravacao.notas, items: [{ productName: "Pizza Grande", quantity: 1 } as any],
}], meioDia.getTime() + 60_000);
contem("a memória do rascunho lembra o horário", memoria, "Agendado para: sáb 17/10 às 19:30");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
