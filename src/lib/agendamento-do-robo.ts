/**
 * PEDIDO AGENDADO PELO ROBÔ DO WHATSAPP — a ponte entre a conversa e a regra
 * única do agendamento (lib/agendamento.ts).
 *
 * Douglas, 17/10/2026, a partir do Pedro (Pizza Vedana: só encomenda, retirada
 * no sábado das 19h às 21h, "só agendado"): o robô respondia que não agendava,
 * enquanto o site da mesma loja agendava. Agora o robô oferece os MESMOS
 * horários que o checkout mostra (`horariosParaAgendar`, no relógio da loja),
 * o servidor confere o horário da tag com a MESMA função da rota do site
 * (`conferirAgendamento`) e o pedido é gravado com os MESMOS campos
 * (`camposDoPedidoAgendado` + `marcaDoAgendamento`): aparece em Pedidos ›
 * Agendamentos e é liberado para a cozinha `liberarAntesMin` antes, igual.
 *
 * Nenhuma regra nova mora aqui: o que é "horário válido", "antecedência",
 * "só agendado" e "entrega/retirada" é do agendamento.ts. Este arquivo só
 * traduz — a lista para o prompt, o campo "agendadoPara" da tag para um
 * instante, e a recusa do servidor para uma frase com as opções.
 *
 * SEM BANCO e sem imports de servidor: o teste (scripts/teste-agendamento-do-robo.ts)
 * carrega este arquivo sozinho.
 */
import {
  aceitaAgendamentoPara, camposDoPedidoAgendado, conferirAgendamento, horariosParaAgendar,
  instanteDaHoraLocal, marcaDoAgendamento, textoDaAntecedencia, textoDoAgendamento,
  type ConfigDeAgendamento, type DiaDeAgendamento,
} from "@/lib/agendamento";
import { FUSO_PADRAO } from "@/lib/fuso";
import type { EstadoDaLoja } from "@/lib/loja-aberta";

/** O que o robô precisa da loja para agendar — os mesmos campos que a rota do site lê. */
export type LojaQueAgenda = {
  config: ConfigDeAgendamento;
  storeHours: unknown;
  storePause?: unknown;
  timezone?: string | null;
};

/** Quantos dias a lista do prompt mostra (o resto o cliente pede e o servidor confere). */
const DIAS_NO_PROMPT = 8;

/** O dia como o cliente lê: "hoje, sáb 17/10", "amanhã, dom 18/10", "sáb 24/10". */
function nomeDoDia(dia: DiaDeAgendamento, tz: string): string {
  const primeiro = dia.horarios[0];
  const data = primeiro ? textoDoAgendamento(primeiro.iso, tz).split(" às ")[0] : dia.rotulo;
  if (dia.rotulo === "Hoje") return `hoje, ${data}`;
  if (dia.rotulo === "Amanhã") return `amanhã, ${data}`;
  return data;
}

const emMinutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/**
 * Os horários de um dia em texto curto: até 8, um a um ("19:00, 19:30, 20:00 ou
 * 20:30"); mais que isso, em faixas ("das 18:00 às 22:30, de 30 em 30 min").
 */
function horariosDoDia(dia: DiaDeAgendamento, passo: number): string {
  const horas = dia.horarios.map((h) => h.hora);
  if (horas.length <= 8) {
    return horas.length > 1 ? `${horas.slice(0, -1).join(", ")} ou ${horas[horas.length - 1]}` : horas[0] || "";
  }
  const faixas: string[][] = [];
  for (const h of horas) {
    const atual = faixas[faixas.length - 1];
    if (atual && emMinutos(h) - emMinutos(atual[atual.length - 1]) === passo) atual.push(h);
    else faixas.push([h]);
  }
  return faixas
    .map((f) => (f.length === 1 ? f[0] : `das ${f[0]} às ${f[f.length - 1]}`))
    .join(" e ") + `, de ${passo} em ${passo} min`;
}

/** Os dias e horários livres AGORA — os mesmos que o checkout do site mostra. */
export function horariosDoRobo(loja: LojaQueAgenda, agora: Date = new Date()): DiaDeAgendamento[] {
  return horariosParaAgendar({
    config: loja.config,
    storeHours: loja.storeHours,
    storePause: loja.storePause,
    timezone: loja.timezone,
    agora,
  });
}

/**
 * As opções numa linha, para a frase ao cliente: "sáb 17/10: 19:00, 19:30,
 * 20:00 ou 20:30; sáb 24/10: …". Só os primeiros dias — é uma mensagem de WhatsApp.
 */
export function opcoesEmTexto(loja: LojaQueAgenda, agora: Date = new Date(), maxDias = 3): string {
  const tz = loja.timezone || FUSO_PADRAO;
  const dias = horariosDoRobo(loja, agora);
  return dias
    .slice(0, maxDias)
    .map((d) => `${nomeDoDia(d, tz)}: ${horariosDoDia(d, loja.config.intervaloMin)}`)
    .join("; ");
}

/** Para que tipo de pedido a loja agenda, em texto. */
function tiposQueAgenda(config: ConfigDeAgendamento): string {
  if (config.entrega && config.retirada) return "ENTREGA e RETIRADA";
  return config.entrega ? "só ENTREGA (retirada agendada não existe aqui)" : "só RETIRADA na loja (entrega agendada não existe aqui)";
}

/**
 * O bloco do prompt. "" quando a loja não agenda — o prompt dela fica como era.
 * Vai no fim da instrução de sistema (depois do cardápio): a lista muda quando
 * um horário vence, e lá ela não quebra o cache do cardápio.
 */
export function blocoDoAgendamentoParaORobo(loja: LojaQueAgenda, agora: Date = new Date()): string {
  const { config } = loja;
  if (!config.ativo) return "";
  const tz = loja.timezone || FUSO_PADRAO;
  const dias = horariosDoRobo(loja, agora);
  const linhas: string[] = [];
  linhas.push(`📅 PEDIDO AGENDADO — a loja aceita (a mesma regra do site, configurada em Pedidos › Agendamentos):`);
  linhas.push(`- Vale para: ${tiposQueAgenda(config)}.`);
  if (config.soAgendado) {
    linhas.push(
      `- SÓ POR ENCOMENDA: esta loja NÃO faz pedido para agora. Todo pedido pelo WhatsApp é AGENDADO para um dos horários abaixo` +
      `${config.entrega && config.retirada ? "" : config.entrega ? " e é ENTREGA" : " e é RETIRADA na loja (não há entrega)"}. ` +
      `Nunca diga que sai agora ou em X minutos.`,
    );
  }
  linhas.push(
    `- Antecedência mínima: ${textoDaAntecedencia(config.antecedenciaMin)}. O horário é quando o pedido fica pronto para retirar (na entrega, quando chega).`,
  );
  if (dias.length === 0) {
    linhas.push(`- HORÁRIOS LIVRES AGORA: NENHUM. Não há como agendar no momento: não anote pedido agendado nem invente horário — diga que a agenda está sem horário livre e, se o cliente insistir, chame alguém da equipe ([[CHAMAR_ATENDENTE]] no final).`);
    return linhas.join("\n");
  }
  linhas.push(`- HORÁRIOS LIVRES AGORA (relógio da loja) — são os ÚNICOS que existem:`);
  for (const d of dias.slice(0, DIAS_NO_PROMPT)) {
    linhas.push(`  ${nomeDoDia(d, tz)} [${d.data}]: ${horariosDoDia(d, config.intervaloMin)}`);
  }
  if (dias.length > DIAS_NO_PROMPT) {
    linhas.push(`  (e mais dias até ${nomeDoDia(dias[dias.length - 1], tz)}, nos mesmos moldes — confirme o dia com o cliente)`);
  }
  linhas.push(
    `- COMO CONDUZIR: quem quer pedir${config.soAgendado ? "" : " para outro dia ou horário"}: pergunte para qual dia e horário e aceite só um da lista. ` +
    `Pediu um horário que não está lá (outro dia, "às 18h", "19:15", "daqui a meia hora")? Diga com carinho que esse não dá e ofereça os da lista mais próximos do que ele pediu. ` +
    `Não invente, não arredonde e não prometa "a gente dá um jeito".`,
  );
  linhas.push(`- No RESUMO para confirmar, escreva o dia e a hora por extenso ("Retirada agendada para sábado, 17/10, às 19:30").`);
  linhas.push(
    `- NA MARCA [[PEDIDO_IA]] (rascunho e finalização): "agendadoPara": "AAAA-MM-DD HH:MM", com a data entre colchetes e a hora exatamente como na lista ` +
    `(ex.: "agendadoPara": "${dias[0].data} ${dias[0].horarios[0].hora}"). Depois de escolhido, repita o campo em TODA marca.` +
    (config.soAgendado ? "" : ` Pedido para agora: "agendadoPara": "agora".`),
  );
  linhas.push(`- O sistema confere o horário: fora da lista, o pedido não é gravado.`);
  return linhas.join("\n");
}

/**
 * O topo do prompt ("SITUAÇÃO DA LOJA AGORA") quando o agendamento muda o que
 * o robô pode fazer. null = vale o `instrucaoDeHorario` de sempre.
 *
 *  - Loja FECHADA que agenda (e tem horário livre): não anota pedido para
 *    agora, mas anota o AGENDADO — a rota do site também aceita encomenda com
 *    a loja fechada.
 *  - Loja ABERTA "só agendado": aberta, mas pedido para agora não existe.
 *  - Sem conexão (instabilidade): continua o aviso de sempre.
 */
export function instrucaoDaLojaComAgendamento(estado: EstadoDaLoja, loja: LojaQueAgenda, agora: Date = new Date()): string | null {
  const { config } = loja;
  if (!config.ativo || estado.instabilidade) return null;
  const temHorario = horariosDoRobo(loja, agora).length > 0;
  if (estado.aberta) {
    if (!config.soAgendado) return null;
    return `SITUAÇÃO DA LOJA AGORA: ABERTA, mas esta loja trabalha SÓ POR ENCOMENDA: todo pedido é AGENDADO (veja "📅 PEDIDO AGENDADO", mais abaixo). Pedido para agora não existe — nunca diga que sai agora ou em X minutos.`;
  }
  if (!temHorario) return null;
  return `
🔴 SITUAÇÃO DA LOJA AGORA: **FECHADA** para pedido imediato. ${estado.texto}
A LOJA ACEITA PEDIDO AGENDADO (veja "📅 PEDIDO AGENDADO", mais abaixo):
- Pedido para AGORA não se anota: NUNCA diga "vai sair em X minutos" nem que alguém vai preparar agora.
- Quem quer pedir: ofereça agendar para um dos horários livres da lista e anote o pedido normalmente, como AGENDADO ("agendadoPara" na marca [[PEDIDO_IA]]).
- Avise que a loja está fechada UMA VEZ, na primeira resposta da conversa, já oferecendo o agendamento. Cortesia ou encerramento ("obrigado", "boa noite") não leva o aviso.
- Fora isso, atenda normalmente: dúvidas de produto, preço e promoção.
`.trim();
}

// ── O campo "agendadoPara" da tag ───────────────────────────────────────────

export type AgendadoNaTag =
  /** A tag não trouxe o campo: vale o que o rascunho já tinha. */
  | { tipo: "ausente" }
  /** "agora", null ou vazio: pedido imediato. */
  | { tipo: "agora" }
  | { tipo: "horario"; instante: Date }
  /** Veio algo que não é data e hora. */
  | { tipo: "invalido"; texto: string };

const DATA_E_HORA = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const COM_FUSO = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * "2026-10-17 19:30" (o formato que o prompt pede, no relógio DA LOJA) → o
 * instante real. Aceita também o "T" no meio e o ISO com fuso explícito
 * ("…T22:30:00.000Z"), que já é um instante.
 */
export function lerAgendadoDaTag(payload: any, timezone?: string | null): AgendadoNaTag {
  const tem = payload && typeof payload === "object" && (
    "agendadoPara" in payload || "scheduledDatetime" in payload || "agendamento" in payload
  );
  if (!tem) return { tipo: "ausente" };
  const cru = payload.agendadoPara ?? payload.scheduledDatetime ?? payload.agendamento;
  if (cru == null || cru === false) return { tipo: "agora" };
  const texto = String(cru).trim();
  if (!texto || /^(agora|now|imediato|para agora|pra agora|asap)$/i.test(texto)) return { tipo: "agora" };
  if (COM_FUSO.test(texto)) {
    const d = new Date(texto);
    return Number.isFinite(d.getTime()) ? { tipo: "horario", instante: d } : { tipo: "invalido", texto };
  }
  const m = DATA_E_HORA.exec(texto);
  if (m) {
    const hora = `${m[2].padStart(2, "0")}:${m[3]}`;
    const d = instanteDaHoraLocal(m[1], hora, timezone || FUSO_PADRAO);
    if (d) return { tipo: "horario", instante: d };
  }
  return { tipo: "invalido", texto };
}

// ── A decisão do servidor ───────────────────────────────────────────────────

/** A frase da recusa + as opções livres, para a conversa seguir sem o cliente perguntar quais são. */
function fraseComAsOpcoes(loja: LojaQueAgenda, frase: string, agora: Date): string {
  const opcoes = opcoesEmTexto(loja, agora);
  return opcoes
    ? `${frase} Os horários livres são: ${opcoes}. Qual fica melhor pra você? 😊`
    : `${frase} No momento não há horário livre para agendar. 😕`;
}

/** Loja "só agendado" e o cliente quer para agora — aberta ou fechada, a mesma frase. */
export function fraseDoSoAgendado(loja: LojaQueAgenda, agora: Date = new Date()): string {
  return fraseComAsOpcoes(loja, "Aqui a gente trabalha só com pedido agendado!", agora);
}

export type DecisaoDoAgendamento =
  | {
      ok: true;
      /** null = pedido para agora (ou loja que não agenda). */
      instante: Date | null;
      /** Rascunho com horário que não vale: grava sem ele e o cliente lê isto. */
      aviso?: string;
    }
  | { ok: false; motivo: string; mensagemParaOCliente: string };

/**
 * O que vale para ESTA tag. A conferência é a da rota do site
 * (`conferirAgendamento`); a recusa ganha as opções livres, para a conversa
 * seguir sem o cliente ter de perguntar quais são.
 *
 * `herdado`: o horário que o pedido-alvo já tem gravado, para a tag que não
 * repetiu o campo. Pedido JÁ ENVIADO (a loja já tem) mantém o horário sem
 * nova conferência — a alteração é de itens, não de horário.
 */
export function decidirAgendamento(opts: {
  loja: LojaQueAgenda;
  deliveryType: unknown;
  daTag: AgendadoNaTag;
  /** A tag fecha o pedido ("finalized": true). Rascunho não é recusado: só não guarda horário inválido. */
  querFinalizar: boolean;
  herdado?: { instante: Date; jaEnviado: boolean } | null;
  agora?: Date;
}): DecisaoDoAgendamento {
  const { loja, daTag, querFinalizar } = opts;
  const { config } = loja;
  const agora = opts.agora || new Date();
  // Loja que não agenda: comportamento de sempre, o campo é ignorado.
  if (!config.ativo) return { ok: true, instante: null };

  const comAsOpcoes = (frase: string) => fraseComAsOpcoes(loja, frase, agora);

  let instante: Date | null = null;
  if (daTag.tipo === "horario") instante = daTag.instante;
  else if (daTag.tipo === "ausente" && opts.herdado) {
    if (opts.herdado.jaEnviado) return { ok: true, instante: opts.herdado.instante };
    instante = opts.herdado.instante;
  } else if (daTag.tipo === "invalido") {
    const frase = comAsOpcoes("Não consegui entender o dia e o horário do agendamento.");
    return querFinalizar
      ? { ok: false, motivo: `agendamento ilegível na tag ("${daTag.texto}")`, mensagemParaOCliente: frase }
      : { ok: true, instante: null, aviso: frase };
  }

  if (!instante) {
    // Para agora. Na loja "só agendado" isso não fecha (a rota do site recusa igual).
    if (config.soAgendado && querFinalizar) {
      return {
        ok: false,
        motivo: "a loja só aceita pedido agendado e a tag veio para agora",
        mensagemParaOCliente: fraseDoSoAgendado(loja, agora),
      };
    }
    return { ok: true, instante: null };
  }

  const erro = conferirAgendamento({
    config,
    deliveryType: opts.deliveryType,
    instante,
    storeHours: loja.storeHours,
    storePause: loja.storePause,
    timezone: loja.timezone,
    agora,
  });
  if (!erro) return { ok: true, instante };

  // A frase do servidor diz "peça para agora" quando o tipo não agenda; na
  // loja "só agendado" esse caminho não existe.
  const frase = !aceitaAgendamentoPara(config, opts.deliveryType) && config.soAgendado
    ? config.retirada
      ? "Aqui o pedido agendado é só para retirada na loja."
      : "Aqui o pedido agendado é só para entrega."
    : erro;
  const mensagem = aceitaAgendamentoPara(config, opts.deliveryType) ? comAsOpcoes(frase) : frase;
  return querFinalizar
    ? { ok: false, motivo: `agendamento recusado: ${erro}`, mensagemParaOCliente: mensagem }
    : { ok: true, instante: null, aviso: mensagem };
}

/**
 * O que vai ao banco, igual ao site: os campos (`camposDoPedidoAgendado`) e a
 * marca no começo das observações (`marcaDoAgendamento`). Sem horário, nada.
 */
export function agendamentoParaGravar(instante: Date | null, timezone: string | null | undefined, notas: string): {
  /** Vazio sem horário: o spread no `create`/`update` não grava nada. */
  campos: { scheduledDatetime?: Date; agendado?: true };
  notas: string;
} {
  if (!instante) return { campos: {}, notas };
  return { campos: camposDoPedidoAgendado(instante), notas: `${marcaDoAgendamento(instante, timezone)} ${notas}`.trim() };
}

