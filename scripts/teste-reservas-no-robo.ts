/**
 * O ROBÔ DO WHATSAPP E AS RESERVAS — os dois modos e as tentativas de inventar.
 *   npx tsx scripts/teste-reservas-no-robo.ts
 *
 * Douglas, 19/11/2026:
 *  A) módulo ATIVO: o robô consulta a vaga, reserva, lista e cancela pelos dados reais;
 *  B) módulo DESLIGADO: anota o pedido e chama a equipe — nunca confirma, nunca diz se tem mesa;
 *  C) não inventar: vaga, sinal, taxa, limite, regra da casa só com fonte.
 * Sem banco e sem IA: o que o SISTEMA responde a cada marca, e as redes que
 * trocam a frase do modelo quando ela afirma o que só o sistema sabe.
 */
process.env.DATABASE_URL ||= "postgresql://localhost:5432/teste"; // o import do no-banco pede uma URL; nada conecta

import { CONFIG_PADRAO, disponibilidadeDoDia, type ConfigDasReservas } from "../src/lib/reservas/regras";
import {
  REGRA_DA_RESERVA_SEM_MODULO, blocoDasReservasNaConversa, blocoDasReservasNoSistema, extrairMarcasDeReserva, pedidoDeReservaParaAEquipe,
  reservaInventada, respostaDaConsulta,
} from "../src/lib/reservas/robo";
import { servicosSemFonte } from "../src/lib/afirmacao-sem-fonte";
import { regrasDoRobo } from "../src/lib/regras-do-robo";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};
const mostra = (rotulo: string, texto: string) => console.log(`      ${rotulo}: ${texto.replace(/\n/g, " ⏎ ")}`);

// Quinta 19/11/2026 às 15:00. Sábado 21/11: 18:00–22:00, 3 reservas ao mesmo tempo, 2h cada, até 10 pessoas.
const agora = { data: "2026-11-19", minutos: 15 * 60 };
const SAB = "2026-11-21", SEG = "2026-11-23", ONTEM = "2026-11-18";
const config: ConfigDasReservas = {
  ...CONFIG_PADRAO,
  dias: CONFIG_PADRAO.dias.map((d, i) => (i === 5 ? { ativo: true, faixas: [{ de: "18:00", ate: "22:00" }] } : i === 0 ? { ativo: false, faixas: [] } : d)),
  intervaloMin: 30, duracaoMin: 120, maxReservasSimultaneas: 3, maxPessoasSimultaneas: null,
  antecedenciaMinimaMin: 60, maxPessoasPorReserva: 10, diasNoFuturo: 30, mensagemDeConfirmacao: "",
};
type R = { id: string; nome: string; telefone: string | null; data: string; hora: string; pessoas: number; status: "CONFIRMADA" };
const res = (id: string, data: string, hora: string, pessoas = 4): R => ({ id, nome: `Cliente ${id}`, telefone: null, data, hora, pessoas, status: "CONFIRMADA" });
// Sábado lotado das 19:30 às 21:00 (3 na mesa): 19:00, 19:30 e 20:00.
const semana = [res("a", SAB, "19:00"), res("b", SAB, "19:30"), res("c", SAB, "20:00")];
const de = (d: string) => semana.filter((r) => r.data === d);

(async () => {
  const { aplicarMarcasDeReserva, resolverReservaSemModulo } = await import("../src/lib/reservas/no-robo");
  const ligado = { ligado: true as const, config, agora, semana: semana as any, regra: "", blocoDoSistema: "", blocoDaConversa: "" };
  const aplicar = (texto: string, preparo: any = ligado) =>
    aplicarMarcasDeReserva({ preparo, franchiseeId: "loja", userId: "dono", telefone: "", marcas: extrairMarcasDeReserva(texto), simulacao: true });

  console.log("\n── A) MÓDULO ATIVO: consulta, reserva, lista, cancela ──");
  let r = respostaDaConsulta(config, de, { data: SAB, hora: "18:00", pessoas: 4 }, agora);
  mostra("tem mesa sábado 18h pra 4?", r.texto);
  confere("com espaço: 'Tem sim' e pede o nome, sem gravar", r.cabe && /Tem sim/.test(r.texto) && /nome/.test(r.texto), r);

  r = respostaDaConsulta(config, de, { data: SAB, hora: "20:00", pessoas: 4 }, agora);
  mostra("tem mesa sábado 20h pra 4? (lotado)", r.texto);
  confere("lotado: diz lotado e oferece horários livres reais", !r.cabe && /lotados/.test(r.texto) && /Tenho livre/.test(r.texto), r);
  const livres = disponibilidadeDoDia(config, de(SAB), SAB, agora, 4).filter((h) => h.livre).map((h) => h.hora);
  const oferecidos = r.texto.match(/\d{2}:\d{2}/g)!.filter((h) => h !== "20:00");
  confere("lotado: todo horário oferecido está livre de verdade", oferecidos.every((h) => livres.includes(h)), { oferecidos, livres });

  r = respostaDaConsulta(config, de, { data: SAB, hora: "20:00", pessoas: 12 }, agora);
  mostra("tem mesa sábado 20h pra 12?", r.texto);
  confere("12 pessoas (limite 10): não confirma, chama a equipe", !r.cabe && r.texto.includes("[[CHAMAR_ATENDENTE]]"), r);

  r = respostaDaConsulta(config, de, { data: ONTEM, hora: "20:00", pessoas: 2 }, agora);
  mostra("tem mesa ontem 20h?", r.texto);
  confere("data passada: não diz que tem", !r.cabe && !/Tem sim/.test(r.texto), r);

  r = respostaDaConsulta(config, de, { data: SEG, hora: "20:00", pessoas: 2 }, agora);
  mostra("tem mesa segunda 20h? (loja não abre reserva)", r.texto);
  confere("dia sem reserva: não diz que tem", !r.cabe && !/Tem sim/.test(r.texto), r);

  r = respostaDaConsulta(config, de, { data: SAB, hora: null, pessoas: 4 }, agora);
  mostra("que horas tem mesa sábado pra 4?", r.texto);
  confere("sem hora: lista só os livres de verdade", r.cabe && (r.texto.match(/\d{2}:\d{2}/g) || []).every((h) => livres.includes(h)), r);

  let a = await aplicar(`[[CONSULTAR_RESERVA: {"data":"${SAB}","hora":"18:00","pessoas":4}]]`);
  confere("marca CONSULTAR_RESERVA: o sistema responde e NÃO grava", !!a && /Tem sim/.test(a.resposta) && !a.feita, a);

  a = await aplicar(`[[RESERVA_MESA: {"nome":"Ana","data":"${SAB}","hora":"18:00","pessoas":4}]]`);
  mostra("reserva sábado 18h, 4, Ana", a?.resposta || "");
  confere("reserva com espaço: confirmação do sistema", !!a && /Reserva confirmada/.test(a.resposta) && a.feita?.acao === "nova", a);

  a = await aplicar(`[[RESERVA_MESA: {"nome":"Ana","data":"${SAB}","hora":"20:00","pessoas":4}]]`);
  mostra("reserva sábado 20h (lotado)", a?.resposta || "");
  confere("reserva lotada: não confirma, oferece livres", !!a && !/confirmada/i.test(a.resposta) && /lotados/.test(a.resposta), a);

  a = await aplicar(`[[RESERVA_MESA: {"nome":"Ana","data":"${SAB}","pessoas":4}]]`);
  confere("reserva sem horário: pergunta o que falta", !!a && /horário/.test(a.resposta) && !/confirmada/i.test(a.resposta), a);

  a = await aplicar(`[[CANCELAR_RESERVA: {"data":"${SAB}","hora":"21:30"}]]`);
  mostra("cancela minha reserva (não existe)", a?.resposta || "");
  confere("cancelar sem ter reserva: não diz que cancelou", !!a && !/cancelei/i.test(a.resposta), a);

  const lista = blocoDasReservasNaConversa(config, de, agora, [{ data: SAB, hora: "19:00", pessoas: 4, nome: "Ana" }]);
  confere("listar: as reservas do cliente vêm do banco no contexto", lista.includes("Sábado, 21/11 (2026-11-21) às 19:00, 4 pessoas, no nome de Ana"), lista);
  confere("prompt do sistema ensina a consultar sem reservar", blocoDasReservasNoSistema(config).includes("[[CONSULTAR_RESERVA"));

  confere("rede (ativo): 'confirmei sua reserva' sem marca é invenção", reservaInventada("Confirmei sua reserva para sábado!", { moduloLigado: true, comMarca: false }) !== null);
  confere("rede (ativo): listar a reserva real do cliente passa", reservaInventada("Sua reserva de sábado às 19:00 está confirmada.", { moduloLigado: true, comMarca: false }) === null);
  confere("rede (ativo): horários livres do contexto passam", reservaInventada("Sábado tenho mesa às 18:00 ou 21:30, qual prefere?", { moduloLigado: true, comMarca: false }) === null);

  console.log("\n── B) MÓDULO DESLIGADO: anota e chama a equipe ──");
  confere("desligado: aplicarMarcasDeReserva não age (sem módulo, sem vaga)", (await aplicar(`[[RESERVA_MESA: {"nome":"Ana","data":"${SAB}","hora":"20:00","pessoas":4}]]`, { ligado: false })) === null);
  const anotar = (texto: string) => resolverReservaSemModulo({ marcas: extrairMarcasDeReserva(texto), timeZone: "America/Sao_Paulo", telefone: "5522999990000", agora });
  let s = anotar(`[[ANOTAR_RESERVA: {"nome":"Ana","data":"${SAB}","hora":"20:00","pessoas":4,"obs":"aniversário"}]]`);
  mostra("quero reservar sábado 20h, 4, Ana (desligado)", s?.resposta || "");
  confere("desligado: anota e diz que AINDA NÃO está confirmada", !!s && /Anotei/.test(s.resposta) && /não está confirmada/.test(s.resposta), s);
  confere("desligado: nunca diz que tem/não tem mesa", !!s && reservaInventada(s.resposta, { moduloLigado: false, comMarca: false }) === null, s?.resposta);
  confere("desligado: a ficha vai para a equipe com nome, dia, horário, pessoas, telefone e obs",
    !!s?.ficha && ["Nome: Ana", "Horário: 20:00", "Pessoas: 4", "Telefone: 22999990000", "Observação: aniversário"].every((x) => s!.ficha!.dados.includes(x)) && s.chamarEquipe, s?.ficha);
  s = anotar(`[[RESERVA_MESA: {"nome":"Ana","data":"${SAB}","hora":"20:00","pessoas":4}]]`);
  confere("desligado: marca de reserva 'de verdade' também só anota", !!s?.ficha && !/Reserva confirmada/.test(s.resposta), s);
  s = anotar(`[[ANOTAR_RESERVA: {"nome":"Ana","data":"${SAB}","pessoas":4}]]`);
  confere("desligado: faltou o horário, pergunta (sem ficha ainda)", !!s && /horário/.test(s.resposta) && !s.ficha, s);
  s = anotar(`[[ANOTAR_RESERVA: {"nome":"Ana","data":"${ONTEM}","hora":"20:00","pessoas":4}]]`);
  confere("desligado: data passada não vira pedido", !!s && /já passou/.test(s.resposta) && !s.ficha, s);
  s = anotar(`[[CANCELAR_RESERVA: {"data":"${SAB}"}]]`);
  mostra("cancela minha reserva (desligado)", s?.resposta || "");
  confere("desligado: cancelar chama a equipe, não diz que cancelou", !!s && s.chamarEquipe && !/cancelei/i.test(s.resposta), s);
  s = anotar(`[[CONSULTAR_RESERVA: {"data":"${SAB}","hora":"20:00","pessoas":12}]]`);
  confere("desligado: 'tem mesa pra 12?' chama a equipe, sem sim nem não", !!s && s.chamarEquipe && reservaInventada(s.resposta, { moduloLigado: false, comMarca: false }) === null, s);

  for (const [frase, inventa] of [
    ["Temos mesa sim para sábado às 20h! 😊", true],
    ["Sábado já está lotado, infelizmente.", true],
    ["Sua reserva está confirmada para sábado!", true],
    ["Reservei uma mesa para você.", true],
    ["Claro! Para qual dia, horário e quantas pessoas?", false],
    ["Fazemos sim! Me diz o nome, o dia, o horário e quantas pessoas.", false],
  ] as const) {
    confere(`rede (desligado): "${frase}" ${inventa ? "é invenção" : "passa"}`, (reservaInventada(frase, { moduloLigado: false, comMarca: false }) !== null) === inventa);
  }
  const ctxBase = {
    storeLink: "https://x", cardapioArquivoUrl: null, cardapioArquivoNoInicio: false, temCupomParaCitar: false, regraDoPrazo: "", personalidade: "",
    diaDeHoje: "quinta", codigoDoDia: "QUI", diaDeAmanha: "sexta", lojaFisica: true, enderecoDaLoja: "Rua A", fazReservaDeMesa: null, modoDaArea: "BAIRRO", ehRota: false, regraDoPix: "",
    anotaPedido: true, soReferencia: false, notaFiscal: null, regraDoMinimo: "", lembreteDoMinimo: "",
  } as any;
  const regras = regrasDoRobo({ ...ctxBase, regraDaReserva: REGRA_DA_RESERVA_SEM_MODULO });
  confere("regras (desligado): manda anotar e proíbe dizer se tem mesa", regras.includes("[[ANOTAR_RESERVA") && regras.includes("Você NÃO sabe se tem mesa"));

  console.log("\n── C) NÃO INVENTAR: sinal, bolo, taxa, limite ──");
  const fonte = "Cantina da Praça\nRua A, 10\nPizza Margherita R$ 50\nBolo de chocolate R$ 12\nA loja faz reserva de mesa.";
  confere("'precisa pagar sinal?' → 'não precisa de sinal' sem fonte vira 'não sei'", servicosSemFonte("Não precisa pagar sinal, é só chegar!", fonte).length > 0);
  confere("'precisa pagar sinal?' → 'cobramos sinal de R$ 50' sem fonte vira 'não sei'", servicosSemFonte("Cobramos um sinal de R$ 50 para reservar.", fonte).length > 0);
  confere("'posso levar bolo?' → 'pode trazer o bolo' sem fonte vira 'não sei' (o bolo do cardápio não conta)", servicosSemFonte("Pode trazer o bolo sim!", fonte).length > 0);
  confere("'posso levar bolo?' com a regra da casa escrita pelo dono: passa", servicosSemFonte("Pode trazer o bolo sim!", `${fonte}\nPode trazer o bolo! Área kids gratuita.`).length === 0);
  confere("consumação mínima e rolha sem fonte viram 'não sei'", servicosSemFonte("Não tem consumação mínima nem taxa de rolha.", fonte).length >= 2);
  confere("'sinal do wi-fi' não é sinal de reserva (mas wi-fi sem fonte segue barrado)", !servicosSemFonte("O sinal do wi-fi é bom", fonte).includes("sinal da reserva"));

  console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
