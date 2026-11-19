/**
 * A ponte entre o robô de vendas (lib/chatbot-ai.ts) e as reservas: o que o
 * prompt precisa saber ANTES de chamar o modelo, e o que fazer com as marcas
 * [[RESERVA_MESA]] / [[CANCELAR_RESERVA]] DEPOIS. O texto e a regra moram em
 * ./robo.ts e ./regras.ts; aqui só se lê e grava.
 *
 * Módulo desligado (ou qualquer falha ao ler): `{ ligado: false }` e o robô
 * atende reserva exatamente como antes.
 *
 * Simulador do painel (sem telefone da conversa): confere a vaga e responde
 * como se fosse de verdade, mas NÃO grava — avisa "(Simulador…)".
 */
import { avisarDono } from "@/lib/alertas-do-dono";
import { reservasDaLoja } from "./assinatura";
import { agoraNaLoja, cancelarReservaDoCliente, criarReserva, reservasDoTelefone, reservasEntre, type Reserva } from "./no-banco";
import { avaliarReserva, normalizarHora, somarDias, sugerirHorarios, type Agora, type ConfigDasReservas } from "./regras";
import {
  REGRA_DA_RESERVA_COM_MODULO, avisoDeReservaAoDono, blocoDasReservasNaConversa, blocoDasReservasNoSistema,
  cancelamentoParaOCliente, confirmacaoParaOCliente, perguntaDoQueFalta, respostaDeNaoCabe,
  type MarcaDeCancelamento, type MarcaDeReserva,
} from "./robo";

export type ReservasNoRobo =
  | { ligado: false }
  | { ligado: true; config: ConfigDasReservas; agora: Agora; semana: Reserva[]; regra: string; blocoDoSistema: string; blocoDaConversa: string };

export async function prepararReservasDoRobo(franchiseeId: string, timeZone: string | null | undefined, telefone: string): Promise<ReservasNoRobo> {
  try {
    const { ligado, config } = await reservasDaLoja(franchiseeId);
    if (!ligado) return { ligado: false };
    const agora = agoraNaLoja(timeZone);
    const semana = await reservasEntre(franchiseeId, agora.data, somarDias(agora.data, 7));
    const doCliente = telefone.length >= 10 ? await reservasDoTelefone(franchiseeId, telefone, agora.data) : [];
    return {
      ligado: true, config, agora, semana,
      regra: REGRA_DA_RESERVA_COM_MODULO,
      blocoDoSistema: blocoDasReservasNoSistema(config),
      blocoDaConversa: blocoDasReservasNaConversa(config, (d) => semana.filter((r) => r.data === d), agora, doCliente),
    };
  } catch (err: any) {
    console.error("[Reservas] Não consegui preparar as reservas para o robô — segue sem o módulo:", err?.message);
    return { ligado: false };
  }
}

export type ReservaFeitaPeloRobo = { acao: "nova" | "cancelada"; id: string; data: string; hora: string; pessoas: number; simulacao?: boolean };

/**
 * Executa as marcas e devolve a resposta que o cliente lê (substitui a do
 * modelo). `null` = não havia marca de reserva.
 */
export async function aplicarMarcasDeReserva(p: {
  preparo: ReservasNoRobo;
  franchiseeId: string;
  /** O usuário da instância (o aviso vai para o dono dele). */
  userId: string;
  telefone: string;
  marcas: { reserva: MarcaDeReserva | null; cancelar: MarcaDeCancelamento | null };
  simulacao: boolean;
}): Promise<{ resposta: string; feita?: ReservaFeitaPeloRobo } | null> {
  const { preparo, marcas } = p;
  if (!preparo.ligado || (!marcas.reserva && !marcas.cancelar)) return null;
  const { config, agora } = preparo;
  const telefone = p.telefone.length >= 10 ? p.telefone : (marcas.reserva?.telefone || "");
  const SIMULADOR = "\n\n(Simulador: nada foi gravado.)";

  if (marcas.reserva) {
    const m = marcas.reserva;
    const falta = perguntaDoQueFalta(m);
    if (falta) return { resposta: falta };
    const hora = normalizarHora(m.hora)!;
    const pedido = { data: m.data, hora, pessoas: m.pessoas };

    if (p.simulacao) {
      const doDia = preparo.semana.filter((r) => r.data === m.data);
      const a = avaliarReserva(config, doDia, pedido, agora);
      if (!a.ok) {
        const sugestoes = sugerirHorarios(config, (d) => preparo.semana.filter((r) => r.data === d), pedido, agora);
        return { resposta: respostaDeNaoCabe(pedido, a.motivo, a.explicacao, sugestoes) };
      }
      return { resposta: confirmacaoParaOCliente({ ...m, hora, observacao: m.obs }, config) + SIMULADOR, feita: { acao: "nova", id: "", data: m.data, hora, pessoas: m.pessoas, simulacao: true } };
    }

    const r = await criarReserva(p.franchiseeId, {
      nome: m.nome, telefone: telefone || null, data: m.data, hora, pessoas: m.pessoas, observacao: m.obs, origem: "ROBO", criadaPor: "Robô do WhatsApp",
    }, agora);
    if (!r.ok) {
      console.warn(`[Reservas] Robô: não coube (${r.motivo}) loja=${p.franchiseeId} ${m.data} ${hora} ${m.pessoas}p`);
      return { resposta: respostaDeNaoCabe(pedido, r.motivo, r.explicacao, r.sugestoes) };
    }
    console.log(`[Reservas] ✅ Robô reservou loja=${p.franchiseeId} ${r.reserva.data} ${r.reserva.hora} ${r.reserva.pessoas}p`);
    avisarDono(p.userId, "reserva_nova", avisoDeReservaAoDono("nova", r.reserva, r.ocupacao, r.config)).catch(() => {});
    let resposta = confirmacaoParaOCliente(r.reserva, r.config);
    // Mudança de horário: a nova já está gravada; só agora a antiga sai.
    if (marcas.cancelar && telefone) {
      const c = await cancelarReservaDoCliente(p.franchiseeId, telefone, { ...marcas.cancelar, excetoId: r.reserva.id }, agora.data);
      if (c.ok) {
        resposta = `${resposta}\n\nA reserva de antes (${c.reserva.data.slice(8, 10)}/${c.reserva.data.slice(5, 7)} às ${c.reserva.hora}) foi cancelada.`;
        avisarDono(p.userId, "reserva_nova", avisoDeReservaAoDono("cancelada", c.reserva, null, config)).catch(() => {});
      }
    }
    return { resposta, feita: { acao: "nova", id: r.reserva.id, data: r.reserva.data, hora: r.reserva.hora, pessoas: r.reserva.pessoas } };
  }

  // Só cancelar.
  const c = marcas.cancelar!;
  if (p.simulacao) {
    return { resposta: `Pronto, cancelei sua reserva${c.data ? ` de ${c.data.slice(8, 10)}/${c.data.slice(5, 7)}` : ""}${c.hora ? ` às ${c.hora}` : ""}.${SIMULADOR}` };
  }
  if (!telefone) return { resposta: "Para cancelar, me confirma o número de WhatsApp em que a reserva foi feita?" };
  const res = await cancelarReservaDoCliente(p.franchiseeId, telefone, c, agora.data);
  if (res.ok) {
    avisarDono(p.userId, "reserva_nova", avisoDeReservaAoDono("cancelada", res.reserva, null, config)).catch(() => {});
    return { resposta: cancelamentoParaOCliente(res.reserva), feita: { acao: "cancelada", id: res.reserva.id, data: res.reserva.data, hora: res.reserva.hora, pessoas: res.reserva.pessoas } };
  }
  if (res.motivo === "varias") {
    const lista = res.reservas.map((r) => `• ${r.data.slice(8, 10)}/${r.data.slice(5, 7)} às ${r.hora} (${r.pessoas} pessoas)`).join("\n");
    return { resposta: `Você tem mais de uma reserva:\n${lista}\nQual delas eu cancelo?` };
  }
  return { resposta: "Não encontrei reserva confirmada no seu número para esse dia. Pode me dizer o dia e o horário da reserva?" };
}
