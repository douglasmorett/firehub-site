/**
 * O ROBÔ DE VENDAS COM O MÓDULO RESERVAS LIGADO — o que ele lê e o que ele
 * escreve. Puro (sem banco): chatbot-ai.ts junta com as reservas do banco.
 *
 * Até 19/11/2026 o robô só passava a reserva para a equipe (a ficha da
 * Pizzaria 17, lib/respostas-prontas.ts). Com o módulo, ele vê os horários
 * livres de verdade e reserva sozinho, no mesmo desenho do pedido: o modelo
 * escreve uma MARCA com os dados, o sistema confere a capacidade (regra pura,
 * ./regras.ts), grava e só então a confirmação sai — com o texto do sistema,
 * nunca com a promessa do modelo ("o contrato honesto do pedido").
 *
 * - O que muda pouco (dias, faixas, duração, regras) vai no prompt do sistema,
 *   que é cacheado por loja; os horários livres de agora e as reservas do
 *   cliente vão no contexto da conversa.
 * - Lotado: a resposta vira "lotado, tenho X, Y ou Z" com as sugestões da
 *   regra; o modelo não inventa horário.
 */
import {
  NOMES_DOS_DIAS, DIAS_CURTOS, dataPorExtenso, diaDaSemana, disponibilidadeDoDia, normalizarHora, somarDias,
  textoDasSugestoes, textoDeMinutos, dataValida,
  type Agora, type ConfigDasReservas, type ReservaParaConta, type Sugestao,
} from "./regras";
import type { RespostaPronta } from "@/lib/respostas-prontas";

/**
 * Com o módulo ligado, a resposta pronta de reserva (as regras e fotos da
 * Pizzaria 17) continua sendo enviada como informação, mas a FICHA deixa de ir
 * para a equipe: quem reserva agora é o sistema. As outras respostas não mudam.
 */
export function semFichaDeReserva(lista: RespostaPronta[]): RespostaPronta[] {
  return lista.map((r) => (r.fichaParaALoja && /reserv/i.test(`${r.id} ${r.fichaParaALoja}`) ? { ...r, fichaParaALoja: undefined } : r));
}

/** A linha "reserva" das regras do robô (lib/regras-do-robo.ts) quando o módulo está ligado: vence a ficha e o "chamo a equipe". */
export const REGRA_DA_RESERVA_COM_MODULO =
  `\n   - RESERVA DE MESA — a loja usa o sistema de reservas: você reserva de verdade, seguindo "RESERVAS DE MESA" logo abaixo. Nunca diga que não faz reserva nem passe para a equipe uma reserva comum.`;

function textoDasFaixas(config: ConfigDasReservas): string {
  const linhas: string[] = [];
  config.dias.forEach((d, i) => {
    if (!d.ativo) return;
    linhas.push(`${DIAS_CURTOS[i]} ${d.faixas.map((f) => (f.de === f.ate ? f.de : `${f.de} às ${f.ate}`)).join(" e ")}`);
  });
  return linhas.length ? linhas.join("; ") : "nenhum dia configurado";
}

/** As regras do módulo, no prompt do sistema (mudam só quando o dono mexe na configuração). */
export function blocoDasReservasNoSistema(config: ConfigDasReservas): string {
  return `
RESERVAS DE MESA (sistema de reservas da loja: você RESERVA DE VERDADE):
- Dias e horários de chegada aceitos: ${textoDasFaixas(config)}. Cada reserva fica com a mesa por cerca de ${textoDeMinutos(config.duracaoMin)}. Até ${config.maxPessoasPorReserva} pessoas por reserva${config.antecedenciaMinimaMin > 0 ? `; antecedência mínima de ${textoDeMinutos(config.antecedenciaMinimaMin)}` : ""}; até ${config.diasNoFuturo} dias à frente.${config.toleranciaMin > 0 ? ` A mesa fica segurada ${config.toleranciaMin} minutos depois do horário.` : ""}
- Para reservar são 4 dados: nome de quem reserva, dia, horário e quantas pessoas (observação é opcional: aniversário, cadeirinha, área externa). Pergunte só o que falta, numa mensagem curta. "Hoje", "amanhã", "sábado": converta pela lista "HORÁRIOS DE RESERVA" do contexto, que traz a data de cada dia.
- Confira o horário em "HORÁRIOS DE RESERVA". Lotado ou fora da lista: diga que está cheio e ofereça até 3 horários livres mais perto. Nunca prometa horário que não aparece como livre.
- Com os 4 dados, escreva SÓ a marca abaixo (sem confirmar com as suas palavras): o SISTEMA confere a vaga, grava e manda a confirmação ao cliente.
[[RESERVA_MESA: {"nome":"Nome","data":"AAAA-MM-DD","hora":"HH:MM","pessoas":4,"obs":"aniversário"}]]
- Cancelar: veja "RESERVAS DESTE CLIENTE" e escreva [[CANCELAR_RESERVA: {"data":"AAAA-MM-DD","hora":"HH:MM"}]]; o sistema cancela e avisa. Mudar o horário: confira que o novo está livre e escreva a marca da reserva nova E a de cancelar a antiga, na mesma mensagem.
- Mais de ${config.maxPessoasPorReserva} pessoas, festa fechada ou evento: diga que a equipe combina com ele e chame com [[CHAMAR_ATENDENTE]].
- Reserva é para comer no salão. Agendar um pedido de delivery ou retirada não é reserva.
`;
}

export type ReservaDoCliente = { data: string; hora: string; pessoas: number; nome: string };

/**
 * Os horários de hoje e dos próximos dias, no contexto da conversa:
 * "sáb 2026-11-21 (Sábado, 21/11): livres 18:00 18:30 21:30 · lotados 19:00 a 21:00".
 */
export function blocoDasReservasNaConversa(
  config: ConfigDasReservas, reservasDe: (data: string) => ReservaParaConta[], agora: Agora, doCliente: ReservaDoCliente[], dias = 7,
): string {
  const linhas: string[] = [];
  for (let d = 0; d < Math.min(dias, config.diasNoFuturo + 1); d++) {
    const data = somarDias(agora.data, d);
    const rotulo = `${DIAS_CURTOS[diaDaSemana(data)]} ${data} (${d === 0 ? "hoje" : d === 1 ? "amanhã" : NOMES_DOS_DIAS[diaDaSemana(data)].toLowerCase()})`;
    const horarios = disponibilidadeDoDia(config, reservasDe(data), data, agora, 2);
    if (!horarios.length) { linhas.push(`${rotulo}: não aceita reserva`); continue; }
    const livres = horarios.filter((h) => h.livre).map((h) => h.hora);
    const lotados = horarios.filter((h) => !h.livre && (h.motivo === "lotado" || h.motivo === "lotado_pessoas")).map((h) => h.hora);
    const passou = horarios.every((h) => !h.livre && (h.motivo === "passou" || h.motivo === "antecedencia"));
    if (passou) { linhas.push(`${rotulo}: horários de hoje já fechados para reserva`); continue; }
    linhas.push(`${rotulo}: ${livres.length ? `livres ${livres.join(" ")}` : "LOTADO"}${lotados.length && livres.length ? ` · lotados ${lotados.join(" ")}` : ""}`);
  }
  const cliente = doCliente.length
    ? doCliente.map((r) => `- ${dataPorExtenso(r.data)} (${r.data}) às ${r.hora}, ${r.pessoas} pessoas, no nome de ${r.nome}`).join("\n")
    : "- nenhuma";
  return `
HORÁRIOS DE RESERVA (agora, já com as reservas feitas; "livres" vale para até ${Math.min(2, config.maxPessoasPorReserva)} pessoas, grupo maior o sistema confere na hora):
${linhas.join("\n")}
RESERVAS DESTE CLIENTE (confirmadas, de hoje em diante):
${cliente}
`;
}

// ─── As marcas ────────────────────────────────────────────────────────────

export type MarcaDeReserva = { nome: string; data: string; hora: string; pessoas: number; obs: string | null; telefone: string | null };
export type MarcaDeCancelamento = { data: string | null; hora: string | null };

const MARCA_RESERVA = /\[\[\s*RESERVA[_\s]?(?:DE[_\s]?)?MESA\s*[:=]?\s*(\{[\s\S]*?\})?\s*\]\]/gi;
const MARCA_CANCELAR = /\[\[\s*CANCELAR[_\s]?RESERVA\s*[:=]?\s*(\{[\s\S]*?\})?\s*\]\]/gi;

function json(bruto: string | undefined): Record<string, unknown> {
  if (!bruto) return {};
  try { return JSON.parse(bruto); } catch {
    // O modelo às vezes esquece aspas ou usa aspas simples.
    try { return JSON.parse(bruto.replace(/'/g, '"').replace(/([{,]\s*)([a-zA-Z_]+)\s*:/g, '$1"$2":')); } catch { return {}; }
  }
}

/**
 * Tira as marcas do texto do modelo (ANTES da limpeza de markdown, que comeria
 * o "_") e devolve a primeira reserva e o primeiro cancelamento.
 */
export function extrairMarcasDeReserva(texto: string): { texto: string; reserva: MarcaDeReserva | null; cancelar: MarcaDeCancelamento | null; tinhaMarca: boolean } {
  let reserva: MarcaDeReserva | null = null;
  let cancelar: MarcaDeCancelamento | null = null;
  let tinhaMarca = false;
  let limpo = texto.replace(MARCA_RESERVA, (_, corpo: string) => {
    tinhaMarca = true;
    const o = json(corpo);
    if (!reserva) {
      reserva = {
        nome: String(o.nome ?? o.name ?? "").trim(),
        data: String(o.data ?? o.date ?? "").trim(),
        hora: String(o.hora ?? o.horario ?? o.time ?? "").trim(),
        pessoas: Math.round(Number(o.pessoas ?? o.people ?? 0)),
        obs: String(o.obs ?? o.observacao ?? "").trim() || null,
        telefone: String(o.telefone ?? "").replace(/\D/g, "") || null,
      };
    }
    return "";
  });
  limpo = limpo.replace(MARCA_CANCELAR, (_, corpo: string) => {
    tinhaMarca = true;
    const o = json(corpo);
    if (!cancelar) {
      const data = String(o.data ?? "").trim();
      cancelar = { data: dataValida(data) ? data : null, hora: normalizarHora(String(o.hora ?? "")) };
    }
    return "";
  });
  return { texto: limpo, reserva, cancelar, tinhaMarca };
}

// ─── O que o cliente lê ───────────────────────────────────────────────────

export function confirmacaoParaOCliente(r: { nome: string; data: string; hora: string; pessoas: number; observacao?: string | null }, config: ConfigDasReservas): string {
  return [
    `Reserva confirmada! ✅`,
    `📅 ${dataPorExtenso(r.data)} às ${r.hora}`,
    `👥 ${r.pessoas} ${r.pessoas === 1 ? "pessoa" : "pessoas"}, no nome de ${r.nome}`,
    config.toleranciaMin > 0 ? `A mesa fica segurada até ${config.toleranciaMin} minutos depois do horário.` : "",
    config.mensagemDeConfirmacao,
    `Se precisar mudar ou cancelar, é só me falar por aqui.`,
  ].filter(Boolean).join("\n");
}

/** Não coube: a explicação curta e os horários livres mais perto. */
export function respostaDeNaoCabe(
  pedido: { data: string; hora: string; pessoas: number }, motivo: string, explicacao: string, sugestoes: Sugestao[],
): string {
  const quando = dataValida(pedido.data) ? `${NOMES_DOS_DIAS[diaDaSemana(pedido.data)].toLowerCase()} (${pedido.data.slice(8, 10)}/${pedido.data.slice(5, 7)})` : "esse dia";
  const abre = motivo === "lotado" || motivo === "lotado_pessoas"
    ? `Às ${normalizarHora(pedido.hora) || pedido.hora} de ${quando} já estamos lotados 😕`
    : explicacao;
  if (motivo === "grupo_grande") return `${explicacao} Vou chamar alguém da equipe para combinar com você.\n[[CHAMAR_ATENDENTE]]`;
  if (!sugestoes.length) return `${abre} Não achei outro horário livre nos próximos dias. Quer que eu chame alguém da equipe?`;
  return `${abre} Tenho livre: ${textoDasSugestoes(sugestoes, pedido.data)}. Qual fica melhor?`;
}

/** Faltou dado na marca (o modelo se adiantou): pergunta só o que falta. */
export function perguntaDoQueFalta(m: MarcaDeReserva): string | null {
  const falta: string[] = [];
  if (!m.nome) falta.push("o nome para a reserva");
  if (!dataValida(m.data)) falta.push("o dia");
  if (!normalizarHora(m.hora)) falta.push("o horário");
  if (!(m.pessoas >= 1)) falta.push("quantas pessoas");
  if (!falta.length) return null;
  const lista = falta.length > 1 ? `${falta.slice(0, -1).join(", ")} e ${falta[falta.length - 1]}` : falta[0];
  return `Para eu fazer a reserva, me diz ${lista}?`;
}

export function cancelamentoParaOCliente(r: { data: string; hora: string }): string {
  return `Pronto, cancelei sua reserva de ${dataPorExtenso(r.data)} às ${r.hora}. Quando quiser, é só chamar.`;
}

// ─── O aviso do dono ──────────────────────────────────────────────────────

const SITE = "https://firehubfood.com.br";

export function avisoDeReservaAoDono(
  acao: "nova" | "cancelada",
  r: { nome: string; telefone: string | null; data: string; hora: string; pessoas: number; observacao?: string | null },
  ocupacao: { reservas: number } | null,
  config: ConfigDasReservas,
): string {
  const tel = String(r.telefone || "").replace(/^55(?=\d{10,11}$)/, "");
  const corpo = [
    `${r.nome}${tel ? ` (${tel})` : ""}`,
    `${dataPorExtenso(r.data)} às ${r.hora} · ${r.pessoas} ${r.pessoas === 1 ? "pessoa" : "pessoas"}`,
    r.observacao ? `Obs.: ${r.observacao}` : "",
    acao === "nova" && ocupacao ? `Nesse horário: ${ocupacao.reservas} de ${config.maxReservasSimultaneas} reservas ao mesmo tempo.` : "",
  ].filter(Boolean);
  const titulo = acao === "nova" ? `📅 *Reserva nova pelo robô*` : `❌ *Reserva cancelada pelo cliente*`;
  return [titulo, "", ...corpo, "", `Ver as reservas: ${SITE}/store/reservas`].join("\n");
}
