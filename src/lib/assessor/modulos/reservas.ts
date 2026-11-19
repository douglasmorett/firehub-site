/**
 * BILL NAS RESERVAS DE MESA — "quantas reservas tenho hoje?", "reserva pro
 * João às 20h, 4 pessoas", "cancela a reserva do João".
 *
 * Grava pelo mesmo caminho do painel /store/reservas (lib/reservas/no-banco.ts):
 * a reserva nova passa pela mesma conferência de vaga (lotado = volta com os
 * horários livres mais perto, nunca encaixa sozinho) e entra com origem BILL.
 * Só com o módulo Reservas ligado (R$ 97/mês, lib/reservas/assinatura.ts).
 */
import { Type } from "@google/genai";
import { reservasDaLoja } from "@/lib/reservas/assinatura";
import { agoraNaLoja, criarReserva, mudarReserva, reservasEntre } from "@/lib/reservas/no-banco";
import { dataPorExtenso, dataValida, disponibilidadeDoDia, normalizarHora, somarDias, textoDasSugestoes } from "@/lib/reservas/regras";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, registrarNoBill, semAcento, type ModuloDoBill, type Resultado } from "../modulo";
import { fusoDaLoja } from "./equipe";

const DESLIGADO: Resultado = {
  ok: false,
  erro: "O módulo Reservas de mesa está desligado nesta loja. O dono ativa em Reservas no painel (R$ 97/mês, 7 dias grátis): aí o Bill e o robô passam a reservar com controle de vagas.",
};

async function reservas(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const { ligado, config } = await reservasDaLoja(ctx.franchiseeId);
  if (!ligado) return DESLIGADO;
  const agora = agoraNaLoja(await fusoDaLoja(ctx));
  const data = dataValida(String(args?.data || "")) ? String(args.data) : agora.data;
  const acao = String(args?.acao || "LISTAR").toUpperCase();

  if (acao === "LISTAR") {
    const lista = (await reservasEntre(ctx.franchiseeId, data, data)).filter((r) => r.status !== "CANCELADA");
    const horarios = disponibilidadeDoDia(config, lista, data, agora);
    return {
      ok: true,
      dia: dataPorExtenso(data),
      reservas: lista.length,
      pessoas: lista.reduce((t, r) => t + r.pessoas, 0),
      lista: lista.map((r) => ({ hora: r.hora, nome: r.nome, pessoas: r.pessoas, status: r.status, obs: r.observacao })),
      horariosLotados: horarios.filter((h) => h.motivo === "lotado" || h.motivo === "lotado_pessoas").map((h) => h.hora),
      horariosLivres: horarios.filter((h) => h.livre).map((h) => h.hora),
      capacidade: `${config.maxReservasSimultaneas} reservas ao mesmo tempo, ${config.duracaoMin} min cada`,
    };
  }

  if (acao === "CRIAR") {
    const hora = normalizarHora(String(args?.hora || ""));
    const pessoas = Math.round(Number(args?.pessoas));
    if (!args?.nome || !hora || !(pessoas >= 1)) return { ok: false, erro: "Para reservar preciso do nome, do horário e de quantas pessoas." };
    const r = await criarReserva(ctx.franchiseeId, {
      nome: String(args.nome), telefone: args.telefone ? String(args.telefone) : null, data, hora, pessoas,
      observacao: args.obs ? String(args.obs) : null, origem: "BILL", criadaPor: ctx.autor || "Bill",
    }, agora);
    if (!r.ok) {
      return { ok: false, naoCoube: true, motivo: r.explicacao, horariosLivresMaisPerto: r.sugestoes.length ? textoDasSugestoes(r.sugestoes, data) : "nenhum nos próximos dias", observacao: "NADA foi gravado. Ofereça ao dono esses horários." };
    }
    await registrarNoBill(ctx, "RESERVA_CRIADA", `Reserva: ${r.reserva.nome}, ${dataPorExtenso(r.reserva.data)} às ${r.reserva.hora}, ${r.reserva.pessoas} pessoas`, { reservaId: r.reserva.id });
    return { ok: true, feito: `Reserva de ${r.reserva.nome} confirmada: ${dataPorExtenso(r.reserva.data)} às ${r.reserva.hora}, ${r.reserva.pessoas} pessoas.`, ocupacaoNoHorario: `${r.ocupacao.reservas} de ${config.maxReservasSimultaneas}` };
  }

  if (acao === "CANCELAR") {
    // Do dia pedido em diante (sem dia: as próximas 30 dias), pelo nome.
    const ate = dataValida(String(args?.data || "")) ? data : somarDias(agora.data, 30);
    const de = dataValida(String(args?.data || "")) ? data : agora.data;
    const alvo = semAcento(String(args?.nome || "")).trim();
    const achadas = (await reservasEntre(ctx.franchiseeId, de, ate))
      .filter((r) => r.status === "CONFIRMADA" && (!alvo || semAcento(r.nome).includes(alvo)) && (!args?.hora || r.hora === normalizarHora(String(args.hora))) && (!args?.reservaId || r.id === args.reservaId));
    if (!achadas.length) return { ok: false, erro: "Não achei reserva confirmada com esse nome nesse período." };
    if (achadas.length > 1) return { ok: false, varias: achadas.map((r) => ({ reservaId: r.id, nome: r.nome, quando: `${dataPorExtenso(r.data)} ${r.hora}`, pessoas: r.pessoas })), observacao: "Pergunte qual e chame de novo com reservaId." };
    const r = achadas[0];
    const pedir = pedirConfirmacao(args, `Vou cancelar a reserva de ${r.nome} (${dataPorExtenso(r.data)} às ${r.hora}, ${r.pessoas} pessoas).`);
    if (pedir) return pedir;
    const feito = await mudarReserva(ctx.franchiseeId, r.id, { acao: "cancelar" }, agora);
    if (!feito.ok) return { ok: false, erro: feito.explicacao };
    await registrarNoBill(ctx, "RESERVA_CANCELADA", `Reserva cancelada: ${r.nome}, ${dataPorExtenso(r.data)} às ${r.hora}`, { reservaId: r.id });
    return { ok: true, feito: `Reserva de ${r.nome} cancelada (${dataPorExtenso(r.data)} às ${r.hora}). O cliente não é avisado automaticamente.` };
  }
  return { ok: false, erro: "Ação desconhecida." };
}

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo !== "RESERVA_CRIADA" && tipo !== "RESERVA_CANCELADA") return null;
  const agora = agoraNaLoja(await fusoDaLoja(ctx));
  const r = await mudarReserva(ctx.franchiseeId, String(refs?.reservaId || ""), { acao: tipo === "RESERVA_CRIADA" ? "cancelar" : "confirmar" }, agora);
  return r.ok ? { ok: true, feito: tipo === "RESERVA_CRIADA" ? "Reserva desfeita (cancelada)." : "Reserva reativada." } : { ok: false, erro: r.explicacao };
}

export const MODULO_RESERVAS: ModuloDoBill = {
  nome: "reservas",
  declaracoes: [
    {
      name: "reservas",
      description: "Reservas de mesa (módulo Reservas): LISTAR as de um dia (quantas, pessoas, horários lotados e livres), CRIAR uma (nome, dia, hora, pessoas — confere a vaga) ou CANCELAR uma pelo nome (pede confirmação).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["LISTAR", "CRIAR", "CANCELAR"] },
          data: { type: Type.STRING, description: "AAAA-MM-DD; vazio = hoje" },
          hora: { type: Type.STRING, description: "HH:MM" },
          nome: { type: Type.STRING, description: "nome de quem reserva (no CANCELAR, para achar a reserva)" },
          pessoas: { type: Type.NUMBER },
          telefone: { type: Type.STRING },
          obs: { type: Type.STRING },
          reservaId: { type: Type.STRING, description: "id vindo da lista 'varias', quando houver mais de uma" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
  ],
  gravam: ["reservas"],
  regras: [
    "Reservas de mesa: 'quantas reservas hoje/sábado' = reservas LISTAR; 'reserva pro João às 20h, 4 pessoas' = CRIAR; 'cancela a reserva do João' = CANCELAR (com confirmação).",
    "CRIAR lotado volta naoCoube com os horários livres mais perto: ofereça-os, nunca diga que reservou. O módulo desligado: diga como ativar.",
  ].join("\n"),
  executar: async (nome, args, ctx) => (nome === "reservas" ? reservas(args, ctx) : null),
  tipos: ["RESERVA_CRIADA", "RESERVA_CANCELADA"],
  desfazer,
};
