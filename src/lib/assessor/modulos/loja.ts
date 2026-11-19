/**
 * MÓDULO LOJA DO BILL — horário, pausa de dias, configuração da entrega, robô
 * de vendas e formas de pagamento ("hoje fecho às 22h", "amanhã não abro",
 * "sobe o tempo de entrega pra 60", "desliga o robô", "não aceito mais vale").
 *
 * Abrir/fechar o site e a taxa por bairro já são do Bill (cardapio.ts e
 * entrega.ts) e não se repetem aqui.
 *
 * Grava pelo MESMO caminho das telas:
 *   horário, pausa, entrega e pagamento → o que o PUT api/store-settings faz
 *     com storeHours / storePause / deliveryConfig (mesclado) / paymentFees
 *     (formas próprias por validarFormasProprias) e, no tempo de entrega, o
 *     mapa de Minha Loja › Entrega (cadastroParaGravar, como entrega.ts);
 *   robô → o merge de chatbotConfig do POST api/chatbot/config (campo `active`,
 *     o que o webhook do WhatsApp lê).
 *
 * Não existe horário especial por data no sistema: a exceção que existe é a
 * pausa programada (storePause, "Agendar Pausa / Férias" da tela), que fecha
 * dias inteiros. "Hoje fecho às 22h" vira mudança no dia da semana, com o
 * lembrete de voltar (o "desfaz" volta).
 *
 * O iFood e a 99 não mudam por aqui: a tela só sincroniza o horário com a
 * caixinha "Refletir no iFood", e o Bill não mexe em app parceiro sem o app
 * confirmar.
 *
 * Teste: scripts/teste-bill-loja-e-caixa.ts
 */
import { Type } from "@google/genai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DAYS, DAY_KEY_MAP, isStoreOpen, normalizeStoreHours, type StoreDayHour } from "@/lib/store-hours";
import { dataDaLoja } from "@/lib/fuso";
import { cadastroParaGravar, lerZonasGravadas } from "@/lib/cadastro-da-entrega";
import { modoDaArea } from "@/lib/area-de-entrega";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { esquecerPontoDaLoja } from "@/lib/distancia-da-entrega";
import { atualizarVitrineDaLoja } from "@/lib/pausar-produtos";
import { tempoDeEntregaParaGravar, TEMPO_DE_RETIRADA_PADRAO_MIN } from "@/lib/previsao-da-entrega";
import { formaLigada } from "@/lib/formas-do-cardapio";
import { validarFormasProprias } from "@/lib/formas-proprias";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, semAcento, type ModuloDoBill, type Resultado } from "../modulo";

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? { ...(v as any) } : {});
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/reais|real|r\$/gi, "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};
const PELO_PAINEL = "desfaça pelo painel, em Minha Loja.";

// ── HORÁRIO (puro) ──────────────────────────────────────────────────────────

/** "18", "18h", "18:30", "18h30" → "18:30". Inválido = null. */
export function lerHora(v: unknown): string | null {
  const m = String(v ?? "").trim().toLowerCase().match(/^(\d{1,2})(?:[:h](\d{2}))?h?$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Índice em DAYS (0 = Segunda) de uma data AAAA-MM-DD. */
export const diaDaSemana = (data: string) => (new Date(`${data}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Soma dias a uma data AAAA-MM-DD. */
export const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Os índices em DAYS que o dono nomeou: "sexta", "hoje", "amanha", "todos". */
export function diasPedidos(dia: unknown, hoje: string): number[] | null {
  const d = semAcento(String(dia ?? "")).trim();
  if (d === "todos") return DAYS.map((_, i) => i);
  if (d === "hoje") return [diaDaSemana(hoje)];
  if (d === "amanha") return [diaDaSemana(somarDias(hoje, 1))];
  const nome = DAY_KEY_MAP[d] || DAY_KEY_MAP[d.replace("-feira", "")];
  const i = nome ? DAYS.indexOf(nome) : -1;
  return i >= 0 ? [i] : null;
}

/** A mesma conferência da tela (StoreSettingsForm.validateShifts): turnos do mesmo dia não se sobrepõem. */
export function sobreposicao(horas: StoreDayHour[]): string | null {
  const min = (t: string) => { const [h, m] = (t || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
  for (const h of horas) {
    if (!h?.active) continue;
    const turnos = (h.shifts?.length ? h.shifts : [{ open: h.open, close: h.close }]).filter((s) => s?.open && s?.close);
    for (let i = 0; i < turnos.length; i++) {
      for (let j = i + 1; j < turnos.length; j++) {
        if (min(turnos[i].open) < min(turnos[j].close) && min(turnos[j].open) < min(turnos[i].close)) {
          return `${h.day}: o turno ${turnos[i].open}–${turnos[i].close} se sobrepõe ao ${turnos[j].open}–${turnos[j].close}.`;
        }
      }
    }
  }
  return null;
}

export const textoDoDia = (h: StoreDayHour) =>
  h.active ? (h.shifts?.length ? h.shifts : [{ open: h.open, close: h.close }]).map((s) => `${s.open}–${s.close}`).join(" e ") : "fechado";

/**
 * Aplica os pedidos à grade (normalizada) e devolve a grade nova com o que
 * mudou — ou o erro, sem mexer em nada. Mesmo formato que a tela grava.
 */
export function aplicarNaGrade(atual: StoreDayHour[], pedidos: any[], hoje: string): { ok: true; grade: StoreDayHour[]; mudou: { dia: string; antes: string; depois: string }[] } | { ok: false; erro: string } {
  const grade = atual.map((h) => ({ ...h, shifts: (h.shifts || []).map((s) => ({ ...s })) }));
  for (const p of pedidos) {
    const dias = diasPedidos(p?.dia, hoje);
    if (!dias) return { ok: false, erro: `Não entendi o dia "${p?.dia}". Use segunda…domingo, hoje, amanha ou todos.` };
    let turnos: { open: string; close: string }[] | null = null;
    if (p?.fechado !== true) {
      const lista: any[] = Array.isArray(p?.turnos) ? p.turnos : [];
      if (!lista.length) return { ok: false, erro: `Faltou o horário de ${p?.dia}: diga abre e fecha de cada turno, ou que fica fechado.` };
      turnos = [];
      for (const t of lista) {
        const open = lerHora(t?.abre), close = lerHora(t?.fecha);
        if (!open || !close) return { ok: false, erro: `Horário inválido em ${p?.dia}: "${t?.abre}" às "${t?.fecha}". Use HH:MM.` };
        if (open === close) return { ok: false, erro: `Em ${p?.dia} o turno abre e fecha no mesmo horário (${open}).` };
        turnos.push({ open, close });
      }
    }
    for (const i of dias) {
      const h = grade[i];
      grade[i] = turnos
        ? { ...h, active: true, shifts: turnos, open: turnos[0].open, close: turnos[turnos.length - 1].close }
        : { ...h, active: false };
    }
  }
  const erro = sobreposicao(grade);
  if (erro) return { ok: false, erro: `${erro} Nada foi alterado.` };
  const mudou = grade
    .map((h, i) => ({ dia: h.day, antes: textoDoDia(atual[i]), depois: textoDoDia(h) }))
    .filter((m) => m.antes !== m.depois);
  return { ok: true, grade, mudou };
}

// ── HORÁRIO E PAUSA ─────────────────────────────────────────────────────────

const MOTIVOS_DA_PAUSA = ["Férias", "Evento particular", "Reforma / Manutenção", "Feriado", "Outros"];
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const dataBr = (d: string) => d.split("-").reverse().join("/");

async function lojaDoHorario(ctx: ContextoDoAssessor) {
  return prisma.user.findUnique({
    where: { id: ctx.franchiseeId },
    select: { storeHours: true, storePause: true, storeTimezone: true, storeOpen: true, aberturaAutomatica: true },
  });
}

function pausaEmVigor(pausa: any, hoje: string): { de: string; ate: string; motivo: string } | null {
  if (!pausa?.active || !pausa.from || !pausa.to || pausa.to < hoje) return null;
  return { de: pausa.from, ate: pausa.to, motivo: pausa.reason || "Férias" };
}

async function horarioDeFuncionamento(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await lojaDoHorario(ctx);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const tz = ctx.timezone || loja.storeTimezone;
  const hoje = dataDaLoja(tz);
  const grade = normalizeStoreHours(loja.storeHours);
  const pausa = pausaEmVigor(loja.storePause, hoje);
  const acao = String(args?.acao || "CONSULTAR").toUpperCase();
  const NAO_MEXE_NOS_APPS = "iFood e 99 seguem com o horário deles: mude pelo app ou pela tela Minha Loja › Horários (caixinha 'Refletir no iFood').";

  if (acao === "CONSULTAR") {
    return {
      ok: true,
      hoje: `${hoje} (${DAYS[diaDaSemana(hoje)]})`,
      agora: isStoreOpen(loja.storeHours, loja.storePause, tz).text,
      siteAbertoNoBotao: loja.storeOpen,
      abreEFechaSozinha: Boolean(loja.aberturaAutomatica),
      grade: grade.map((h) => `${h.day}: ${textoDoDia(h)}`),
      ...(loja.storeHours ? {} : { observacao: "A loja nunca salvou o horário: vale o padrão (18:00–23:00 todos os dias)." }),
      ...(pausa ? { pausaProgramada: `fechada de ${dataBr(pausa.de)} a ${dataBr(pausa.ate)} (${pausa.motivo})` } : {}),
    };
  }

  if (acao === "MUDAR") {
    const pedidos: any[] = Array.isArray(args?.dias) ? args.dias : [];
    if (!pedidos.length) return { ok: false, erro: "Diga o dia e o novo horário (ou que fica fechado)." };
    const r = aplicarNaGrade(grade, pedidos, hoje);
    if (!r.ok) return r;
    if (!r.mudou.length) return { ok: true, resumo: "O horário já era esse; nada mudou." };
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeHours: r.grade as any } });
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    const resumo = `Horário: ${r.mudou.map((m) => `${m.dia} ${m.antes} → ${m.depois}`).join("; ")}`;
    await registrarNoBill(ctx, "LOJA_HORARIO", resumo, { antes: loja.storeHours ?? null, depois: r.grade });
    const soUmDia = pedidos.some((p) => ["hoje", "amanha"].includes(semAcento(String(p?.dia || ""))));
    return {
      ok: true,
      resumo,
      observacao: [
        soUmDia ? `Atenção: o sistema não tem horário por data — isso muda TODA ${r.mudou.map((m) => m.dia).join("/")}. Lembre o dono de voltar depois (é só pedir "desfaz" ou dizer o horário de sempre).` : "",
        loja.aberturaAutomatica ? "A abertura automática segue este horário novo." : "",
        NAO_MEXE_NOS_APPS,
      ].filter(Boolean).join(" "),
    };
  }

  if (acao === "FECHAR_DIAS") {
    const de = DATA_RE.test(String(args?.de || "")) ? String(args.de) : hoje;
    const ate = DATA_RE.test(String(args?.ate || "")) ? String(args.ate) : de;
    if (de < hoje) return { ok: false, erro: `A pausa começa no passado (${dataBr(de)}); hoje é ${dataBr(hoje)}.` };
    if (ate < de) return { ok: false, erro: "A data de volta vem antes da de início." };
    const motivo = MOTIVOS_DA_PAUSA.find((m) => semAcento(m) === semAcento(String(args?.motivo || ""))) || "Outros";
    if (pausa && (pausa.de !== de || pausa.ate !== ate)) {
      const conf = pedirConfirmacao(args, `Já existe uma pausa de ${dataBr(pausa.de)} a ${dataBr(pausa.ate)} (${pausa.motivo}); o sistema guarda uma só, e ela será trocada por ${dataBr(de)} a ${dataBr(ate)}.`);
      if (conf) return conf;
    }
    const nova = { active: true, from: de, to: ate, reason: motivo };
    if (igual(loja.storePause, nova)) return { ok: true, resumo: "Essa pausa já estava marcada; nada mudou." };
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storePause: nova } });
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    const periodo = de === ate ? `em ${dataBr(de)}` : `de ${dataBr(de)} a ${dataBr(ate)}`;
    const resumo = `Loja fechada ${periodo} (${motivo})${pausa ? ` — antes: ${dataBr(pausa.de)} a ${dataBr(pausa.ate)}` : ""}`;
    await registrarNoBill(ctx, "LOJA_PAUSA", resumo, { antes: loja.storePause ?? null, depois: nova });
    return { ok: true, resumo, observacao: `Site e robô não aceitam pedido nesses dias e o cliente vê "Loja em pausa (${motivo})". ${NAO_MEXE_NOS_APPS}` };
  }

  if (acao === "TIRAR_PAUSA") {
    if (!pausa) return { ok: true, resumo: "Não havia pausa marcada; nada mudou." };
    const nova = { ...objeto(loja.storePause), active: false };
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storePause: nova } });
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    const resumo = `Pausa tirada: a loja volta ao horário normal (era fechada de ${dataBr(pausa.de)} a ${dataBr(pausa.ate)})`;
    await registrarNoBill(ctx, "LOJA_PAUSA", resumo, { antes: loja.storePause ?? null, depois: nova });
    return { ok: true, resumo };
  }

  return { ok: false, erro: `Ação desconhecida: ${acao}. Use CONSULTAR, MUDAR, FECHAR_DIAS ou TIRAR_PAUSA.` };
}

// ── ENTREGA ─────────────────────────────────────────────────────────────────

const minTxt = (n: unknown) => `${Math.round(Number(n) || 0)} min`;

/** O que a tela Minha Loja › Informações mostra, lido do deliveryConfig. */
export function configDaEntrega(cfgBruto: unknown) {
  const cfg = objeto(cfgBruto);
  const minimo = Number(cfg.minimumOrderValue) || 0;
  const retirada = cfg.minimumOrderValuePickup;
  return {
    pedidoMinimoEntrega: minimo > 0 ? reais(minimo) : "sem mínimo",
    pedidoMinimoRetirada: retirada === null || retirada === undefined ? "o mesmo da entrega" : Number(retirada) > 0 ? reais(Number(retirada)) : "sem mínimo",
    entregaGratis: cfg.freeShippingActive ? `acima de ${reais(Number(cfg.freeShippingMinValue) || 0)}` : "desligada",
    tempoDeRetirada: `${tempoDeEntregaParaGravar(cfg.tempoRetiradaMin) ?? TEMPO_DE_RETIRADA_PADRAO_MIN} min${tempoDeEntregaParaGravar(cfg.tempoRetiradaMin) ? "" : " (padrão)"}`,
  };
}

type LojaDaEntrega = { deliveryZoneType: string | null; deliveryZones: unknown; deliveryConfig: unknown };

/** As zonas gravadas com os tempos trocados, pelo caminho do mapa (cadastroParaGravar). */
async function gravarZonas(ctx: ContextoDoAssessor, loja: LojaDaEntrega, zonas: any[]): Promise<{ ok: true } | { ok: false; erro: string }> {
  const separado = lerRegraDeRepasse(loja.deliveryConfig).separado;
  // Como a tela (montarLista): o valor do motoboy por faixa só atravessa com "um valor por faixa" ligado.
  const corpo = separado ? zonas : zonas.map(({ motoboyFee, repasse, repasseAcimaDaTaxa, ...z }: any) => z);
  const d = cadastroParaGravar({ tipo: loja.deliveryZoneType, zonas: loja.deliveryZones }, { deliveryZoneType: loja.deliveryZoneType, deliveryZones: corpo });
  if (d.acao === "recusar") return { ok: false, erro: `${d.erro} Nada foi alterado.` };
  if (d.acao === "gravar") {
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { deliveryZoneType: d.tipo, deliveryZones: d.zonas as any } });
    esquecerPontoDaLoja(ctx.franchiseeId);
  }
  return { ok: true };
}

async function configurarEntrega(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { deliveryZoneType: true, deliveryZones: true, deliveryConfig: true, storeDeliveryOnly: true } });
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const { zonas } = lerZonasGravadas(loja.deliveryZones);
  const modo = modoDaArea(loja as any);
  const comArea = modo === "BAIRRO" || modo === "KM" || modo === "POLIGONO";
  const tempos = zonas.filter((z) => z && typeof z === "object").map((z) => Math.round(Number(z.time) || 0));
  const tempoTxt = !comArea || !tempos.length ? "sem área cadastrada" : Math.min(...tempos) === Math.max(...tempos) ? minTxt(tempos[0]) : `de ${minTxt(Math.min(...tempos))} a ${minTxt(Math.max(...tempos))} (cada área tem o seu)`;

  const novo: Record<string, unknown> = {};
  const mudou: string[] = [];
  const atual = configDaEntrega(loja.deliveryConfig);
  const cfg = objeto(loja.deliveryConfig);

  const minimo = numero(args?.pedidoMinimo);
  if (minimo != null) {
    if (minimo < 0) return { ok: false, erro: "O pedido mínimo não pode ser negativo." };
    novo.minimumOrderValue = Math.round(minimo * 100) / 100;
  }
  const minimoRetirada = numero(args?.pedidoMinimoRetirada);
  if (args?.retiradaComOMinimoDaEntrega === true) novo.minimumOrderValuePickup = null;
  else if (minimoRetirada != null) {
    if (minimoRetirada < 0) return { ok: false, erro: "O pedido mínimo da retirada não pode ser negativo." };
    novo.minimumOrderValuePickup = Math.round(minimoRetirada * 100) / 100;
  }
  const gratis = numero(args?.entregaGratisAcimaDe);
  if (gratis != null) {
    if (gratis < 0) return { ok: false, erro: "O valor da entrega grátis não pode ser negativo." };
    if (gratis === 0) novo.freeShippingActive = false;
    else { novo.freeShippingActive = true; novo.freeShippingMinValue = Math.round(gratis * 100) / 100; }
  }
  const retirada = numero(args?.tempoRetiradaMin);
  if (retirada != null) {
    // 0 = volta ao padrão (vazio na tela); fora de 1–360 a rota grava vazio, então recusa antes.
    if (retirada !== 0 && tempoDeEntregaParaGravar(retirada) == null) return { ok: false, erro: "O tempo de retirada vai de 1 a 360 minutos (0 = padrão de 40)." };
    novo.tempoRetiradaMin = retirada === 0 ? null : tempoDeEntregaParaGravar(retirada);
  }
  const mudarNoCfg = Object.keys(novo).filter((k) => !igual(cfg[k], novo[k]));

  // Tempo de entrega: o de cada área do mapa (deliveryZones[].time), como o "Mudar tempo de entrega".
  const tempoFixo = numero(args?.tempoEntregaMin);
  const somar = numero(args?.somarAoTempoDeEntrega);
  let zonasNovas: any[] | null = null;
  if (tempoFixo != null || somar != null) {
    if (!comArea) return { ok: false, erro: "A loja não tem área de entrega cadastrada, então não há tempo de entrega para mudar. Cadastre em Minha Loja › Entrega." };
    zonasNovas = zonas.filter((z) => z && typeof z === "object").map((z) => ({ ...z, time: tempoFixo != null ? tempoFixo : Math.max(1, (Number(z.time) || 0) + (somar as number)) }));
    if (zonasNovas.some((z) => tempoDeEntregaParaGravar(z.time) == null)) return { ok: false, erro: "O tempo de entrega vai de 1 a 360 minutos." };
    zonasNovas = zonasNovas.map((z) => ({ ...z, time: Math.round(z.time) }));
    if (igual(zonasNovas.map((z) => z.time), tempos)) zonasNovas = null;
  }

  if (!mudarNoCfg.length && !zonasNovas) {
    return {
      ok: true,
      ...(Object.keys(novo).length || tempoFixo != null || somar != null ? { resumo: "Já estava assim; nada mudou." } : {}),
      tempoDeEntrega: tempoTxt,
      ...atual,
      ...(loja.storeDeliveryOnly ? { retirada: "a loja não aceita retirada" } : {}),
    };
  }

  const refs: Record<string, unknown> = {};
  // As zonas primeiro: é a parte que a validação do mapa pode recusar, e aí nada foi gravado.
  if (zonasNovas) {
    const g = await gravarZonas(ctx, loja, zonasNovas);
    if (!g.ok) return g;
    const depoisTempos = zonasNovas.map((z) => z.time);
    refs.tempos = { antes: tempos, depois: depoisTempos };
    const depoisTxt = Math.min(...depoisTempos) === Math.max(...depoisTempos) ? minTxt(depoisTempos[0]) : `de ${minTxt(Math.min(...depoisTempos))} a ${minTxt(Math.max(...depoisTempos))}`;
    mudou.push(`tempo de entrega ${tempoTxt} → ${depoisTxt}`);
  }
  if (mudarNoCfg.length) {
    // Mesclado, nunca substituído — como a rota: o deliveryConfig guarda coisa de outras telas.
    const fresco = objeto((await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { deliveryConfig: true } }))?.deliveryConfig);
    const depois = { ...fresco, ...Object.fromEntries(mudarNoCfg.map((k) => [k, novo[k]])) };
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { deliveryConfig: depois } });
    refs.chaves = Object.fromEntries(mudarNoCfg.map((k) => [k, { antes: fresco[k] ?? null, depois: novo[k] ?? null }]));
    const agora = configDaEntrega(depois);
    if (mudarNoCfg.includes("minimumOrderValue")) mudou.push(`pedido mínimo da entrega ${atual.pedidoMinimoEntrega} → ${agora.pedidoMinimoEntrega}`);
    if (mudarNoCfg.includes("minimumOrderValuePickup")) mudou.push(`pedido mínimo da retirada ${atual.pedidoMinimoRetirada} → ${agora.pedidoMinimoRetirada}`);
    if (mudarNoCfg.includes("freeShippingActive") || mudarNoCfg.includes("freeShippingMinValue")) mudou.push(`entrega grátis ${atual.entregaGratis} → ${agora.entregaGratis}`);
    if (mudarNoCfg.includes("tempoRetiradaMin")) mudou.push(`tempo de retirada ${atual.tempoDeRetirada} → ${agora.tempoDeRetirada}`);
  }
  await atualizarVitrineDaLoja(ctx.franchiseeId);
  const resumo = `Entrega: ${mudou.join("; ")}`;
  await registrarNoBill(ctx, "LOJA_ENTREGA", resumo, refs);
  return { ok: true, resumo, observacao: "Vale para os próximos pedidos do site e do robô. iFood e outros apps seguem com a configuração deles." };
}

// ── ROBÔ DE VENDAS ──────────────────────────────────────────────────────────

async function roboDoWhatsapp(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { chatbotConfig: true } });
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const cfg = objeto(loja.chatbotConfig);
  // Ausente = ligado: é o padrão da tela (api/chatbot/config) e o que o webhook lê (`active === false` cala).
  const ligadoAgora = cfg.active !== false;
  const conectado = Boolean(cfg.connected || cfg.instanceName);
  const estado = { ligado: ligadoAgora, whatsappConectado: conectado };
  if (typeof args?.ligado !== "boolean") return { ok: true, ...estado };
  const ligar = args.ligado;
  if (ligar === ligadoAgora) return { ok: true, resumo: `O robô já estava ${ligar ? "ligado" : "desligado"}; nada mudou.`, ...estado };
  if (!ligar) {
    const conf = pedirConfirmacao(args, "Desligar o robô de vendas: ele para de responder TODOS os clientes no WhatsApp da loja até alguém ligar de novo (o Bill continua falando com você).");
    if (conf) return conf;
  }
  // O mesmo merge do POST api/chatbot/config, sobre o que está gravado agora.
  const fresco = objeto((await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { chatbotConfig: true } }))?.chatbotConfig);
  await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { chatbotConfig: { ...fresco, active: ligar } } });
  const resumo = `Robô de vendas do WhatsApp: ${ligadoAgora ? "ligado" : "desligado"} → ${ligar ? "ligado" : "desligado"}`;
  await registrarNoBill(ctx, "LOJA_ROBO", resumo, { antes: fresco.active ?? null, depois: ligar });
  return {
    ok: true,
    resumo,
    observacao: ligar
      ? conectado ? "Ele volta a responder as mensagens novas dos clientes." : "Ligado, mas o WhatsApp da loja não está conectado: conecte em Robô do WhatsApp para ele responder."
      : "Os clientes ficam sem resposta automática; as mensagens chegam no WhatsApp da loja normalmente.",
  };
}

// ── FORMAS DE PAGAMENTO ─────────────────────────────────────────────────────

/** As formas do liga/desliga de Minha Loja › Formas de Pagamento (pagamento na entrega/retirada). */
export const FORMAS = [
  { chave: "PIX", nome: "Pix na entrega (na chave da loja)" },
  { chave: "DINHEIRO", nome: "Dinheiro" },
  { chave: "CREDITO", nome: "Cartão de crédito (maquininha)" },
  { chave: "DEBITO", nome: "Cartão de débito (maquininha)" },
  { chave: "VOUCHER", nome: "Vale-refeição / voucher" },
] as const;

/** paymentFees com as formas ligadas/desligadas, como a tela grava (o resto fica). */
export function pagamentoComFormas(atual: unknown, mudar: Record<string, boolean>): Record<string, any> {
  const base = objeto(atual);
  for (const [k, ligada] of Object.entries(mudar)) {
    // Formato antigo (número = taxa) vira objeto, como a tela migra ao abrir.
    const forma = base[k] && typeof base[k] === "object" ? base[k] : { rate: Number(base[k]) || 0 };
    base[k] = { ...forma, active: ligada };
  }
  return base;
}

async function formasDePagamento(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { paymentFees: true } });
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const pf = objeto(loja.paymentFees);
  const situacao = () => ({
    formas: FORMAS.map((f) => `${f.nome}: ${formaLigada(pf, f.chave) ? "ligada" : "desligada"}`),
    ...(Array.isArray(pf.formasProprias) && pf.formasProprias.length
      ? { formasPropriasDaLoja: pf.formasProprias.map((f: any) => `${f.nome}: ${f.ativo === false ? "desligada" : "ligada"}`), observacaoFormasProprias: "Formas próprias mudam só pela tela." }
      : {}),
    ...(pf.entregaSoOnline === true ? { naEntregaSoOnline: "ligado (na entrega só Pix/cartão pelo site)" } : {}),
  });
  const pedidos: any[] = Array.isArray(args?.mudar) ? args.mudar : [];
  if (!pedidos.length) return { ok: true, ...situacao(), observacao: "O Pix e o cartão PELO SITE (pagamento online) são outra coisa: ligam em Integrações." };

  const mudar: Record<string, boolean> = {};
  for (const p of pedidos) {
    const chave = String(p?.forma || "").toUpperCase();
    if (!FORMAS.some((f) => f.chave === chave)) return { ok: false, erro: `Forma desconhecida: "${p?.forma}". Use ${FORMAS.map((f) => f.chave).join(", ")}.` };
    if (typeof p?.ligada !== "boolean") return { ok: false, erro: `Diga se ${chave} fica ligada ou desligada.` };
    if (formaLigada(pf, chave) !== p.ligada) mudar[chave] = p.ligada;
  }
  if (!Object.keys(mudar).length) return { ok: true, resumo: "Já estava assim; nada mudou.", ...situacao() };

  let depois = pagamentoComFormas(pf, mudar);
  // A mesma conferência da rota quando as formas próprias vão junto no paymentFees.
  if ("formasProprias" in depois) {
    const r = validarFormasProprias(depois.formasProprias);
    if (!r.ok) return { ok: false, erro: `${r.erro} Nada foi alterado; confira em Minha Loja › Formas de Pagamento.` };
    depois = { ...depois, formasProprias: r.formas };
  }
  await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { paymentFees: depois } });
  await atualizarVitrineDaLoja(ctx.franchiseeId);
  const nome = (k: string) => FORMAS.find((f) => f.chave === k)!.nome;
  const resumo = `Formas de pagamento: ${Object.entries(mudar).map(([k, v]) => `${nome(k)} ${v ? "desligada → ligada" : "ligada → desligada"}`).join("; ")}`;
  await registrarNoBill(ctx, "LOJA_PAGAMENTO", resumo, { formas: Object.fromEntries(Object.entries(mudar).map(([k, v]) => [k, { antes: pf[k]?.active ?? null, depois: v }])) });
  const sobra = FORMAS.filter((f) => formaLigada(depois, f.chave));
  return {
    ok: true,
    resumo,
    observacao: `Vale no cardápio do site e no robô.${sobra.length ? "" : " Atenção: nenhuma forma de pagamento na entrega ficou ligada."}`,
  };
}

// ── DESFAZER ────────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "LOJA_HORARIO" || tipo === "LOJA_PAUSA") {
    const campo = tipo === "LOJA_HORARIO" ? "storeHours" : "storePause";
    const loja: any = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { [campo]: true } as any });
    if (!loja) return { ok: false, erro: "Loja não encontrada." };
    if (!igual(loja[campo], refs?.depois)) return { ok: false, erro: `O ${tipo === "LOJA_HORARIO" ? "horário" : "agendamento de pausa"} foi mudado de novo depois; ${PELO_PAINEL}` };
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { [campo]: refs.antes ?? Prisma.DbNull } as any });
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    return { ok: true };
  }
  if (tipo === "LOJA_ENTREGA") {
    const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { deliveryZoneType: true, deliveryZones: true, deliveryConfig: true } });
    if (!loja) return { ok: false, erro: "Loja não encontrada." };
    const cfg = objeto(loja.deliveryConfig);
    const chaves: Record<string, { antes: unknown; depois: unknown }> = refs?.chaves || {};
    for (const [k, v] of Object.entries(chaves)) {
      if (!igual(cfg[k], v.depois)) return { ok: false, erro: `A configuração da entrega foi mudada de novo depois; ${PELO_PAINEL}` };
    }
    let zonas: any[] | null = null;
    if (refs?.tempos) {
      const atuais = lerZonasGravadas(loja.deliveryZones).zonas.filter((z) => z && typeof z === "object");
      if (!igual(atuais.map((z) => Math.round(Number(z.time) || 0)), refs.tempos.depois)) return { ok: false, erro: `O tempo de entrega foi mudado de novo depois; ${PELO_PAINEL}` };
      zonas = atuais.map((z, i) => ({ ...z, time: refs.tempos.antes[i] }));
    }
    if (zonas) {
      const g = await gravarZonas(ctx, loja, zonas);
      if (!g.ok) return g;
    }
    if (Object.keys(chaves).length) {
      const volta = { ...cfg };
      for (const [k, v] of Object.entries(chaves)) {
        if (v.antes === null || v.antes === undefined) delete volta[k];
        else volta[k] = v.antes;
      }
      await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { deliveryConfig: volta } });
    }
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    return { ok: true };
  }
  if (tipo === "LOJA_ROBO") {
    const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { chatbotConfig: true } });
    const cfg = objeto(loja?.chatbotConfig);
    if ((cfg.active !== false) !== refs?.depois) return { ok: false, erro: "O robô foi ligado/desligado de novo depois; mude pela tela Robô do WhatsApp." };
    if (refs.antes === null || refs.antes === undefined) delete cfg.active;
    else cfg.active = refs.antes;
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { chatbotConfig: cfg } });
    return { ok: true };
  }
  if (tipo === "LOJA_PAGAMENTO") {
    const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { paymentFees: true } });
    const pf = objeto(loja?.paymentFees);
    const formas: Record<string, { antes: boolean | null; depois: boolean }> = refs?.formas || {};
    for (const [k, v] of Object.entries(formas)) {
      if (formaLigada(pf, k) !== v.depois) return { ok: false, erro: `A forma ${k} foi mudada de novo depois; ${PELO_PAINEL}` };
    }
    // Volta ao valor exato de antes (ausente = ligada, como o cardápio lê).
    const volta = pagamentoComFormas(pf, Object.fromEntries(Object.entries(formas).map(([k, v]) => [k, v.antes !== false])));
    for (const [k, v] of Object.entries(formas)) if (v.antes === null || v.antes === undefined) delete volta[k].active;
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { paymentFees: volta } });
    await atualizarVitrineDaLoja(ctx.franchiseeId);
    return { ok: true };
  }
  return null;
}

// ── O MÓDULO ────────────────────────────────────────────────────────────────

const DIAS_ENUM = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo", "hoje", "amanha", "todos"];

export const MODULO_LOJA: ModuloDoBill = {
  nome: "loja",
  declaracoes: [
    {
      name: "horario_de_funcionamento",
      description:
        "Horário da loja (site e robô). CONSULTAR = grade da semana, se está aberta agora e a pausa marcada. " +
        "MUDAR = muda a grade de um ou mais dias da semana (turnos ou fechado) — vale TODA semana. " +
        "FECHAR_DIAS = exceção por data: 'amanhã não abro', 'dia 25 fechado', 'férias de 1 a 10' (fecha o dia inteiro). TIRAR_PAUSA = cancela essa exceção. " +
        "'Hoje fecho às 22h' não existe por data: use MUDAR com dia 'hoje' e lembre o dono de voltar.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["CONSULTAR", "MUDAR", "FECHAR_DIAS", "TIRAR_PAUSA"] },
          dias: {
            type: Type.ARRAY,
            description: "MUDAR: um item por dia (ou 'todos').",
            items: {
              type: Type.OBJECT,
              properties: {
                dia: { type: Type.STRING, enum: DIAS_ENUM },
                fechado: { type: Type.BOOLEAN, description: "true = não abre nesse dia da semana" },
                turnos: {
                  type: Type.ARRAY,
                  description: "os turnos do dia (almoço e jantar = 2); a grade do dia é trocada por estes",
                  items: { type: Type.OBJECT, properties: { abre: { type: Type.STRING, description: "HH:MM" }, fecha: { type: Type.STRING, description: "HH:MM (pode virar a noite: 18:00 às 02:00)" } }, required: ["abre", "fecha"] },
                },
              },
              required: ["dia"],
            },
          },
          de: { type: Type.STRING, description: "FECHAR_DIAS: primeiro dia fechado, AAAA-MM-DD (omita = hoje)" },
          ate: { type: Type.STRING, description: "FECHAR_DIAS: último dia fechado, AAAA-MM-DD (omita = o mesmo de 'de')" },
          motivo: { type: Type.STRING, enum: MOTIVOS_DA_PAUSA, description: "FECHAR_DIAS: o que o cliente vê" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
    {
      name: "configurar_entrega",
      description:
        "Consulta (sem nenhum valor) ou muda o tempo de entrega, o tempo de retirada, o pedido mínimo e a entrega grátis acima de um valor (Minha Loja › Entrega/Informações). " +
        "Mande só o que o dono pediu. A TAXA de cada bairro é com alterar_taxa_de_bairro.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          tempoEntregaMin: { type: Type.NUMBER, description: "põe ESTE tempo (min) em todas as áreas de entrega" },
          somarAoTempoDeEntrega: { type: Type.NUMBER, description: "soma (ou tira, negativo) minutos no tempo de cada área: 'sobe 15 min' = 15" },
          tempoRetiradaMin: { type: Type.NUMBER, description: "minutos da retirada (0 = padrão de 40)" },
          pedidoMinimo: { type: Type.NUMBER, description: "pedido mínimo da ENTREGA em reais (0 = sem mínimo)" },
          pedidoMinimoRetirada: { type: Type.NUMBER, description: "pedido mínimo da RETIRADA em reais (0 = sem mínimo)" },
          retiradaComOMinimoDaEntrega: { type: Type.BOOLEAN, description: "true = a retirada volta a cobrar o mesmo mínimo da entrega" },
          entregaGratisAcimaDe: { type: Type.NUMBER, description: "entrega grátis para pedido a partir deste valor (0 = desliga a entrega grátis)" },
        },
      },
    },
    {
      name: "robo_do_whatsapp",
      description: "Consulta (sem 'ligado'), liga ou desliga o robô de VENDAS que responde os clientes no WhatsApp da loja. Desligar pede confirmação. Não afeta o Bill.",
      parameters: { type: Type.OBJECT, properties: { ligado: { type: Type.BOOLEAN, description: "true = liga; false = desliga; omita = só consultar" }, confirmado: PARAMETRO_CONFIRMADO } },
    },
    {
      name: "formas_de_pagamento",
      description: "Consulta (sem 'mudar') ou liga/desliga as formas de pagamento na entrega/retirada aceitas no site e no robô: Pix na chave da loja, dinheiro, crédito, débito, vale.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mudar: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { forma: { type: Type.STRING, enum: FORMAS.map((f) => f.chave) }, ligada: { type: Type.BOOLEAN } },
              required: ["forma", "ligada"],
            },
          },
        },
      },
    },
  ],
  gravam: ["horario_de_funcionamento", "configurar_entrega", "robo_do_whatsapp", "formas_de_pagamento"],
  regras: `
"Que horas abro?", "muda o horário de sexta", "domingo não abro mais" = horario_de_funcionamento (CONSULTAR / MUDAR). "Amanhã não abro", "fecho dia 25", "vou tirar férias" = FECHAR_DIAS com a data (não mexe na grade da semana).
"Hoje fecho às 22h" muda TODA sexta (não existe horário por data): faça com dia "hoje" e lembre o dono de voltar ou pedir "desfaz".
Tempo de entrega/retirada, pedido mínimo e entrega grátis = configurar_entrega, só com o que ele pediu. Horário, entrega e pagamento NÃO mudam no iFood/99: avise.
"Desliga/liga o robô" = robo_do_whatsapp; desligar só com confirmado=true depois do sim. "Não aceito mais cartão/vale/dinheiro" = formas_de_pagamento.
`,
  tipos: ["LOJA_HORARIO", "LOJA_PAUSA", "LOJA_ENTREGA", "LOJA_ROBO", "LOJA_PAGAMENTO"],
  executar: async (nome, args, ctx) => {
    switch (nome) {
      case "horario_de_funcionamento": return horarioDeFuncionamento(args, ctx);
      case "configurar_entrega": return configurarEntrega(args, ctx);
      case "robo_do_whatsapp": return roboDoWhatsapp(args, ctx);
      case "formas_de_pagamento": return formasDePagamento(args, ctx);
      default: return null;
    }
  },
  desfazer,
};
