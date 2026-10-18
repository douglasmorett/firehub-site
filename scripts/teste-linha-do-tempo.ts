/**
 * A linha do tempo da loja (lib/perfil-da-loja/linha-do-tempo.ts): ADMIN vê
 * cada mensagem; VENDEDOR vê o resumo por dia, sem o texto do chat; pedidos de
 * ajuda viram "reportou"; último atendimento humano; ordem mais recente primeiro.
 *
 *   npx tsx scripts/teste-linha-do-tempo.ts
 */
import { montarLinhaDoTempo, type EntradaDaLinhaDoTempo } from "../src/lib/perfil-da-loja/linha-do-tempo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const SEGREDO = "a senha do wifi é 1234";
const msg = (id: string, criadoEm: string, direcao: "ENTRADA" | "SAIDA", autor: string, texto: string, extra: Partial<EntradaDaLinhaDoTempo["mensagens"][number]> = {}) =>
  ({ id, contatoId: "c1", direcao, autor, autorNome: null, texto, tipo: "texto", canal: "WHATSAPP", status: "ENVIADA", criadoEm, ...extra });

const ENTRADA: EntradaDaLinhaDoTempo = {
  contatos: [{ id: "c1", nome: "Pizzaria do Zé", notas: "Dono prefere ligação à tarde", aguardandoHumanoDesde: "2026-10-18T13:00:00.000Z", atualizadoEm: "2026-10-10T12:00:00.000Z" }],
  mensagens: [
    // 17/10 (BRT): a loja escreve, o robô responde, o Douglas atende
    msg("m1", "2026-10-17T14:00:00.000Z", "ENTRADA", "CLIENTE", `oi, ${SEGREDO}`),
    msg("m2", "2026-10-17T14:00:30.000Z", "SAIDA", "ROBO", "Olá! Já vou chamar uma pessoa."),
    msg("m3", "2026-10-17T14:20:00.000Z", "SAIDA", "ADMIN", "Oi Zé, aqui é o Douglas", { autorNome: "Douglas" }),
    // 18/10 pelo chat do painel: só o robô
    msg("m4", "2026-10-18T12:50:00.000Z", "ENTRADA", "CLIENTE", "a impressora não imprime", { canal: "PAINEL" }),
    msg("m5", "2026-10-18T12:50:20.000Z", "SAIDA", "ROBO", "Vou chamar uma pessoa", { canal: "PAINEL" }),
    // falhou no gateway: fora
    msg("m6", "2026-10-18T12:55:00.000Z", "SAIDA", "ADMIN", "não chegou", { status: "FALHOU", autorNome: "Douglas" }),
  ],
  eventos: [
    { id: "e1", contatoId: "c1", tipo: "ROBO", texto: "Chamou uma pessoa: impressora não imprime", autorNome: "Robô", autorTipo: "ROBO", criadoEm: "2026-10-18T12:51:00.000Z" },
    { id: "e2", contatoId: "c1", tipo: "ROBO", texto: "Chamou uma pessoa: Montar a loja", autorNome: "Robô", autorTipo: "ROBO", criadoEm: "2026-10-05T12:00:00.000Z" },
    { id: "e3", contatoId: "c1", tipo: "ETAPA", texto: "Etapa: Negociando → Cliente", autorNome: "Rafael", autorTipo: "VENDEDOR", criadoEm: "2026-10-06T12:00:00.000Z" },
    { id: "e4", contatoId: "c1", tipo: "REUNIAO", texto: "Reunião marcada", autorNome: "Rafael", autorTipo: "VENDEDOR", criadoEm: "2026-10-07T12:00:00.000Z" },
    { id: "e5", contatoId: "c1", tipo: "NOTA", texto: "Quer o app da loja em novembro", autorNome: "Rafael", autorTipo: "VENDEDOR", criadoEm: "2026-10-08T12:00:00.000Z" },
  ],
  reunioes: [{ id: "r1", tipo: "TREINAMENTO", titulo: "Treinar o caixa", inicio: "2026-10-09T17:00:00.000Z", status: "REALIZADA", observacao: null, vendedor: "Rafael" }],
  marcadoAtendidoEm: "2026-10-12T15:00:00.000Z",
  vendedorDaLoja: "Rafael",
};

console.log("\n── ADMIN: vê tudo ──");
const a = montarLinhaDoTempo(ENTRADA, "ADMIN");
confere("cada mensagem é um item (a que FALHOU fica fora)", a.contagem.CONVERSA, 5);
confere("o texto do chat aparece para o admin", a.itens.some((i) => i.texto?.includes(SEGREDO)), true);
confere("último atendimento: Douglas, 17/10, WhatsApp", a.ultimoAtendimento, { em: "2026-10-17T14:20:00.000Z", por: "Douglas", canal: "WHATSAPP" });
confere("pedidos de ajuda: 2", a.contagem.AJUDA, 2);
confere("reportou, o mais recente primeiro", a.reportou.map((r) => r.motivo), ["impressora não imprime", "Montar a loja"]);
confere("pedido de ajuda aberto agora", a.ajudaAberta, { desde: "2026-10-18T13:00:00.000Z" });
confere("evento REUNIAO não repete (a agenda é a fonte)", a.contagem.REUNIAO, 1);
confere("reunião da agenda com o status", a.itens.find((i) => i.tipo === "REUNIAO")?.titulo, "Treinamento realizada");
confere("anotações: o evento NOTA + as notas da ficha", a.contagem.NOTA, 2);
confere("conversas contadas", a.conversas, { total: 5, daLoja: 2, doFireHub: 3, ultimaEm: "2026-10-18T12:50:20.000Z", peloPainel: 2 });
const emOrdem = a.itens.every((i, k) => k === 0 || a.itens[k - 1].em >= i.em);
confere("mais recente primeiro", emOrdem, true);
confere("o primeiro item é o pedido de ajuda de hoje", a.itens[0].tipo, "AJUDA");

console.log("\n── VENDEDOR: só resumo, nunca o texto ──");
const v = montarLinhaDoTempo(ENTRADA, "VENDEDOR");
const tudo = JSON.stringify(v);
confere("o texto da loja NÃO aparece", tudo.includes(SEGREDO), false);
confere("a resposta do Douglas NÃO aparece", tudo.includes("aqui é o Douglas"), false);
confere("a mensagem do robô NÃO aparece", tudo.includes("Já vou chamar"), false);
confere("um resumo por dia e canal (17/10 WhatsApp, 18/10 painel)", v.contagem.CONVERSA, 2);
const d17 = v.itens.find((i) => i.tipo === "CONVERSA" && i.em.startsWith("2026-10-17"));
confere("resumo de 17/10: contagens e quem atendeu", [d17?.mensagens, d17?.texto], [{ daLoja: 1, doFireHub: 2 }, "1 mensagem da loja, 2 do FireHub · atendeu: Douglas."]);
const d18 = v.itens.find((i) => i.tipo === "CONVERSA" && i.em.startsWith("2026-10-18"));
confere("resumo de 18/10 no painel: só o robô", [d18?.canal, d18?.texto], ["PAINEL", "1 mensagem da loja, 1 do FireHub · só o robô respondeu."]);
confere("último atendimento igual ao do admin", v.ultimoAtendimento, a.ultimoAtendimento);
confere("o vendedor vê o que a loja reportou (resumo do pedido de ajuda)", v.reportou.map((r) => r.motivo), ["impressora não imprime", "Montar a loja"]);
confere("…e o item diz 'Reportou: …'", v.itens.find((i) => i.tipo === "AJUDA")?.texto, "Reportou: impressora não imprime");
confere("as contagens de conversa são as mesmas", v.conversas, a.conversas);
confere("modo marcado", [a.modo, v.modo], ["ADMIN", "VENDEDOR"]);

console.log("\n── Sem contato no CRM ──");
const vazia = montarLinhaDoTempo({ contatos: [], mensagens: [], eventos: [], reunioes: [], marcadoAtendidoEm: null, vendedorDaLoja: null }, "VENDEDOR");
confere("semContato e nada na lista", [vazia.semContato, vazia.itens.length, vazia.ultimoAtendimento, vazia.ajudaAberta], [true, 0, null, null]);
confere("diz o que não é registrado", vazia.naoRegistrado.length >= 3, true);

console.log("\n── Celular do FireHub sem nome ──");
const cel = montarLinhaDoTempo({ ...ENTRADA, mensagens: [msg("x", "2026-10-18T10:00:00.000Z", "SAIDA", "CELULAR", "oi")] }, "ADMIN");
confere("aparece como Equipe (celular do FireHub)", cel.ultimoAtendimento?.por, "Equipe (celular do FireHub)");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
