/**
 * lib/disparo-oficial/regras.ts — as contas e as leituras do Disparo oficial,
 * sem banco e sem rede (provadas por scripts/teste-disparo-oficial.ts).
 *
 * ── O QUE É ──────────────────────────────────────────────────────────────────
 *
 * Disparo de promoção pela API OFICIAL da Meta (Cloud API), do número DA LOJA,
 * em COEXISTÊNCIA: o WhatsApp Business continua no celular e o robô continua
 * no gateway (Baileys 7, que entende o aparelho hospedado). Só a promoção sai
 * pela API; quem responde é o robô da loja, de graça, na conversa de sempre
 * (decisão do Douglas, 12/10/2026: "pro cliente dar continuidade na conversa
 * tem que ser no número dele com o robô dele").
 *
 * O disparo antigo pelo Baileys continua desligado (lib/disparo-em-massa.ts):
 * foi ele que pôs o número da Hakim Centro em risco em 02/09/2026.
 *
 * ── COMO COBRA ───────────────────────────────────────────────────────────────
 *
 * Crédito pré-pago em DISPAROS, comprado por Pix (Asaas do FireHub). A Meta
 * cobra só a mensagem ENTREGUE; o crédito acompanha: conta enquanto está na
 * fila ou enviada, fica gasto quando entrega, e volta sozinho quando falha,
 * expira ou é cancelada.
 *
 * Preço = custo da Meta × (1 + margem). Margem padrão 43%: os 30% combinados
 * com o Douglas mais a taxa do Pix do Asaas embutida (ele: "imbuti no valor
 * total sem avisar que é o custo do Asaas, ou bota 0,46 mesmo"). Com o custo
 * de outubro/2026 (R$ 0,3217 por marketing entregue no Brasil) dá R$ 0,46. Se
 * a Meta aumentar, troca-se DISPARO_CUSTO_META no servidor e o preço sobe
 * junto; o crédito já comprado continua valendo (é contado em disparos).
 */

/** Custo da Meta por mensagem de MARKETING entregue no Brasil, em reais (tabela de 01/10/2026). */
export const CUSTO_META_PADRAO = 0.3217;
/** 30% de lucro + a taxa do Pix embutida. */
export const MARGEM_PADRAO = 0.43;
/** A menor recarga: abaixo disso a taxa fixa do Pix come o lucro. */
export const RECARGA_MINIMA_REAIS = 50;
export const RECARGA_MAXIMA_DISPAROS = 50_000;

const numeroPositivo = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** O preço de um disparo, em reais, com duas casas. */
export function precoPorDisparo(env: { DISPARO_CUSTO_META?: string; DISPARO_MARGEM?: string } = process.env as any): number {
  const custo = numeroPositivo(env.DISPARO_CUSTO_META) ?? CUSTO_META_PADRAO;
  const margemBruta = Number(String(env.DISPARO_MARGEM ?? "").replace(",", "."));
  const margem = Number.isFinite(margemBruta) && margemBruta >= 0 && String(env.DISPARO_MARGEM ?? "").trim() !== "" ? margemBruta : MARGEM_PADRAO;
  return Math.round(custo * (1 + margem) * 100) / 100;
}

export function custoMeta(env: { DISPARO_CUSTO_META?: string } = process.env as any): number {
  return numeroPositivo(env.DISPARO_CUSTO_META) ?? CUSTO_META_PADRAO;
}

/** Quantos disparos é a recarga mínima, ao preço atual. */
export function minimoDeDisparos(preco: number): number {
  return Math.ceil(RECARGA_MINIMA_REAIS / preco);
}

/** Valor da recarga de N disparos. */
export function valorDaRecarga(disparos: number, preco: number): number {
  return Math.round(disparos * preco * 100) / 100;
}

// ── TELEFONE ────────────────────────────────────────────────────────────────

/**
 * O telefone no formato da Meta (55 + DDD + número), ou null se não for um
 * CELULAR brasileiro. Fixo não tem WhatsApp na maioria dos casos e a Meta
 * cobra a tentativa só se entregar — mas mandar para fixo é lixo na fila.
 * Aceita o celular antigo de 8 dígitos (sem o 9) e devolve COM o 9.
 */
export function telefoneDaMeta(bruto: unknown): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (!d.startsWith("55")) return null;
  if (d.length !== 12 && d.length !== 13) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  const local = d.slice(4);
  if (local.length === 9 && local[0] !== "9") return null;
  if (local.length === 8 && !/^[6-9]/.test(local)) return null;
  // Uma forma só, com o 9: a Meta manda o `from` muitas vezes SEM o 9
  // (553199999999) e o pedido tem COM (5531999999999). Sem isto, quem tocou em
  // "Parar promoções" voltava a receber — o Set do descadastro não casava.
  return local.length === 8 ? d.slice(0, 4) + "9" + local : d;
}

/** "Maria Aparecida" → "Maria"; vazio → "cliente". É a {{1}} do modelo. */
export function primeiroNome(nome: unknown): string {
  const limpo = String(nome ?? "")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .trim()
    .split(/\s+/)[0];
  if (!limpo || limpo.length < 2 || /^cliente$/i.test(limpo) || /^whatsapp$/i.test(limpo)) return "cliente";
  return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
}

// ── SALDO ───────────────────────────────────────────────────────────────────

/** Envios que gastam crédito: na fila, enviados, e entregues/lidos que a Meta cobrou. */
/** INCERTO: a rede caiu depois de mandar — pode ter saído e a Meta pode cobrar; não reenvia e não devolve. */
export const STATUS_QUE_RESERVAM = ["FILA", "PROCESSANDO", "ENVIADO", "INCERTO"] as const;
export const STATUS_ENTREGUES = ["ENTREGUE", "LIDO"] as const;

export function envioGastaCredito(e: { status: string; gratis?: boolean | null }): boolean {
  if ((STATUS_QUE_RESERVAM as readonly string[]).includes(e.status)) return true;
  if ((STATUS_ENTREGUES as readonly string[]).includes(e.status)) return !e.gratis;
  return false;
}

export function saldoDeDisparos(recargasPagas: number, enviosQueGastam: number): number {
  return Math.max(0, recargasPagas - enviosQueGastam);
}

// ── STATUS DO ENVIO ─────────────────────────────────────────────────────────

const ORDEM: Record<string, number> = { FILA: 0, PROCESSANDO: 0, ENVIADO: 1, ENTREGUE: 2, LIDO: 3 };

/**
 * O status que o envio passa a ter com o aviso da Meta. Os avisos chegam fora
 * de ordem (o "read" antes do "delivered" é comum): nunca volta para trás. O
 * "failed" vale enquanto não entregou; entregue não desentrega. Um "delivered"
 * atrasado tira do EXPIRADO — a Meta entregou e vai cobrar.
 */
export function proximoStatus(atual: string, aviso: string): string {
  const novo = ({ sent: "ENVIADO", delivered: "ENTREGUE", read: "LIDO", failed: "FALHOU" } as Record<string, string>)[aviso];
  if (!novo) return atual;
  if (novo === "FALHOU") return atual === "ENTREGUE" || atual === "LIDO" ? atual : "FALHOU";
  if (atual === "FALHOU" || atual === "CANCELADO") return atual;
  if (atual === "EXPIRADO") return novo === "ENVIADO" ? atual : novo;
  return (ORDEM[novo] ?? 0) > (ORDEM[atual] ?? 0) ? novo : atual;
}

/**
 * Enviado e sem notícia por este tempo: devolve o crédito. A Meta tenta
 * entregar por até 30 dias (e cobra se entregar), então só depois disso.
 */
export const EXPIRA_SEM_ENTREGA_MS = 31 * 24 * 60 * 60 * 1000;

// ── ERROS DA META ───────────────────────────────────────────────────────────

export type LeituraDoErro = {
  /** O texto para a loja. */
  motivo: string;
  /** Tentar de novo mais tarde (fila), em vez de dar como falha. */
  tentarDeNovo: boolean;
  /** Parar a campanha inteira (token, pagamento, número bloqueado). */
  pararCampanha: boolean;
};

/** Códigos em https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes */
export function lerErroDaMeta(codigo: unknown, titulo?: unknown): LeituraDoErro {
  const c = Number(codigo);
  const t = String(titulo ?? "").trim();
  switch (c) {
    case 131049:
      return { motivo: "A Meta segurou: este cliente já recebeu muitas promoções de empresas hoje (não foi cobrado)", tentarDeNovo: false, pararCampanha: false };
    case 131026:
      return { motivo: "Número sem WhatsApp ou que não pode receber", tentarDeNovo: false, pararCampanha: false };
    case 131050:
      return { motivo: "O cliente parou de receber promoções pelo WhatsApp", tentarDeNovo: false, pararCampanha: false };
    case 130429:
    case 131056:
    case 80007:
    case 4:
      return { motivo: "Limite de velocidade da Meta — tenta de novo em seguida", tentarDeNovo: true, pararCampanha: false };
    case 131048:
      return { motivo: "A Meta limitou o número por denúncias de spam", tentarDeNovo: false, pararCampanha: true };
    case 131042:
      return { motivo: "Problema no pagamento da conta na Meta", tentarDeNovo: false, pararCampanha: true };
    case 190:
    case 10:
    case 200:
      return { motivo: "A conexão com a Meta caiu (token sem permissão) — conecte de novo", tentarDeNovo: false, pararCampanha: true };
    case 132001:
    case 132015:
    case 132016:
      return { motivo: "O modelo da mensagem não está aprovado ou foi pausado pela Meta", tentarDeNovo: false, pararCampanha: true };
    case 368:
    case 131031:
      return { motivo: "A conta da loja foi bloqueada na Meta", tentarDeNovo: false, pararCampanha: true };
    default:
      return { motivo: t ? `Meta: ${t}${Number.isFinite(c) ? ` (${c})` : ""}` : `Erro da Meta${Number.isFinite(c) ? ` ${c}` : ""}`, tentarDeNovo: false, pararCampanha: false };
  }
}

// ── O MODELO (TEMPLATE) ─────────────────────────────────────────────────────

export const TEXTO_DO_BOTAO_PARAR = "Parar promoções";
export const TEXTO_DO_BOTAO_PEDIR = "Quero pedir";

/** Nome do modelo na Meta: minúsculas, números e _, até 512 — e único. */
export function nomeDoModelo(titulo: string, agora = Date.now()): string {
  const base = String(titulo || "promo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "promo";
  return `fh_${base}_${agora.toString(36)}`;
}

export type ProblemaDoTexto = string | null;

/**
 * O texto do lojista vira o corpo do modelo. `{nome}` é o primeiro nome do
 * cliente ({{1}} na Meta). Regras da Meta que derrubam a aprovação: variável
 * no começo ou no fim, mais de 1.024 caracteres, linha em branco em excesso.
 */
export function conferirTexto(texto: string): ProblemaDoTexto {
  const t = String(texto || "").trim();
  if (t.length < 15) return "Escreva a mensagem (pelo menos 15 caracteres).";
  if (t.length > 900) return "A mensagem passa de 900 caracteres — a Meta corta em 1.024 contando o resto.";
  if (/\{\{|\}\}/.test(t)) return "Use {nome} para o nome do cliente, sem chaves duplas.";
  const semNome = t.replace(/\{nome\}/gi, "");
  if (/\{[^}]*\}/.test(semNome)) return "A única variável é {nome}.";
  if (/^\{nome\}/i.test(t) || /\{nome\}[\s.!?]*$/i.test(t)) return "A Meta não aceita o {nome} no começo nem no fim da mensagem — ponha um \"Oi\" antes e um texto depois.";
  if (/\n{3,}/.test(t)) return "Tire as linhas em branco repetidas.";
  return null;
}

/** "Oi {nome}, ..." → "Oi {{1}}, ..." e quantas vezes o nome aparece. */
export function corpoParaMeta(texto: string): { corpo: string; usaNome: boolean } {
  const t = String(texto || "").trim();
  const usaNome = /\{nome\}/i.test(t);
  return { corpo: t.replace(/\{nome\}/gi, "{{1}}"), usaNome };
}

/** O que a Meta recebe para criar o modelo. */
export function modeloParaMeta(args: { nome: string; texto: string; botaoPedir: boolean; nomeDaLoja: string }) {
  const { corpo, usaNome } = corpoParaMeta(args.texto);
  const botoes: any[] = [];
  if (args.botaoPedir) botoes.push({ type: "QUICK_REPLY", text: TEXTO_DO_BOTAO_PEDIR });
  botoes.push({ type: "QUICK_REPLY", text: TEXTO_DO_BOTAO_PARAR });
  const rodape = `${String(args.nomeDaLoja || "").trim().slice(0, 40) || "Nossa loja"} · toque em Parar para não receber`;
  return {
    name: args.nome,
    language: "pt_BR",
    category: "MARKETING",
    components: [
      {
        type: "BODY",
        text: corpo,
        ...(usaNome ? { example: { body_text: [["Maria"]] } } : {}),
      },
      { type: "FOOTER", text: rodape.slice(0, 60) },
      { type: "BUTTONS", buttons: botoes },
    ],
  };
}

/** O texto que a tela mostra como prévia, com um nome de exemplo. */
export function previaDoTexto(texto: string, nome = "Maria"): string {
  return String(texto || "").replace(/\{nome\}/gi, nome);
}

/**
 * Status do modelo na Meta → o nosso; null = não muda nada. FLAGGED (a Meta
 * avisa que a qualidade caiu) e IN_APPEAL deixam o modelo como está: o
 * FLAGGED continua aprovado e enviável, e tratá-lo como pendente cancelava a
 * campanha no meio.
 */
export function statusDoModelo(metaStatus: unknown): string | null {
  const s = String(metaStatus || "").toUpperCase();
  if (s === "APPROVED" || s === "REINSTATED") return "APROVADO";
  if (s === "REJECTED") return "REJEITADO";
  if (s === "PAUSED") return "PAUSADO";
  if (s === "DISABLED" || s === "DELETED" || s === "ARCHIVED" || s === "PENDING_DELETION") return "DESATIVADO";
  if (s === "PENDING") return "PENDENTE";
  return null;
}

// ── PÚBLICO ─────────────────────────────────────────────────────────────────

/** TESTE = um número só (o celular do dono), para ver a promoção antes de mandar para todo mundo. */
export type Publico = { tipo: "TODOS" | "SUMIDOS" | "RECENTES"; dias?: number } | { tipo: "TESTE"; telefone: string };

export function lerPublico(bruto: any): Publico {
  if (bruto?.tipo === "TESTE") return { tipo: "TESTE", telefone: telefoneDaMeta(bruto?.telefone) || "" };
  const tipo = bruto?.tipo === "SUMIDOS" || bruto?.tipo === "RECENTES" ? bruto.tipo : "TODOS";
  const dias = Math.min(365, Math.max(1, Math.round(Number(bruto?.dias) || 30)));
  return tipo === "TODOS" ? { tipo } : { tipo, dias };
}

export type ClienteDaLoja = { telefone: string; nome: string | null; ultimoPedido: Date };

/**
 * Quem recebe: um por telefone (o nome mais recente), só celular, sem quem
 * pediu para parar. SUMIDOS = não pede há N dias; RECENTES = pediu nos
 * últimos N dias.
 */
export function escolherPublico(
  pedidos: { customerPhone: string | null; customerName: string | null; createdAt: Date }[],
  publico: Publico,
  descadastrados: Set<string>,
  agora = Date.now()
): ClienteDaLoja[] {
  if (publico.tipo === "TESTE") {
    return publico.telefone && !descadastrados.has(publico.telefone) ? [{ telefone: publico.telefone, nome: null, ultimoPedido: new Date(agora) }] : [];
  }
  const porTelefone = new Map<string, ClienteDaLoja>();
  for (const p of pedidos) {
    const tel = telefoneDaMeta(p.customerPhone);
    if (!tel || descadastrados.has(tel)) continue;
    const quando = new Date(p.createdAt);
    const atual = porTelefone.get(tel);
    if (!atual || quando > atual.ultimoPedido) {
      porTelefone.set(tel, { telefone: tel, nome: p.customerName || atual?.nome || null, ultimoPedido: quando });
    }
  }
  const lista = [...porTelefone.values()];
  if (publico.tipo === "TODOS") return lista;
  const corte = agora - ((publico as { dias?: number }).dias || 30) * 24 * 60 * 60 * 1000;
  return publico.tipo === "SUMIDOS"
    ? lista.filter((c) => c.ultimoPedido.getTime() < corte)
    : lista.filter((c) => c.ultimoPedido.getTime() >= corte);
}

// ── WEBHOOK DA META ─────────────────────────────────────────────────────────

export type AvisoDeStatus = {
  wamid: string;
  status: string;
  quando: Date;
  /** pricing.billable === false: a Meta não cobrou. */
  gratis: boolean;
  erroCodigo?: number;
  erroTitulo?: string;
};

export type RespostaDoCliente = {
  phoneNumberId: string;
  telefone: string;
  /** Tocou em "Parar promoções" (botão do modelo ou o texto igual). */
  parar: boolean;
  quando: Date;
};

export type AvisoDeModelo = { metaTemplateId: string; nome?: string; status: string; motivo?: string };
export type AvisoDoNumero = { wabaId?: string; numero?: string; qualidade?: string; limite?: string; evento?: string };

const quandoDe = (ts: unknown) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

/**
 * A confirmação do "Parar promoções". Quem manda é o ROBÔ, pelo gateway
 * (api/webhook/whatsapp): enviada pela API, ela voltava ao gateway como
 * mensagem da loja e o robô entendia "atendente assumiu" e se calava.
 */
export const MENSAGEM_DE_DESCADASTRO = "Pronto! Você não vai mais receber nossas promoções por aqui. Para pedir, é só mandar mensagem normalmente. 😉";

/** O cliente tocou em "Parar promoções" (o botão do modelo, ou digitou igual). */
export const ehPararPromocoes = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "") === "parar promocoes";

/** Lê o corpo do webhook da Meta (objeto whatsapp_business_account). */
export function lerWebhook(body: any): {
  status: AvisoDeStatus[];
  respostas: RespostaDoCliente[];
  modelos: AvisoDeModelo[];
  numeros: AvisoDoNumero[];
} {
  const status: AvisoDeStatus[] = [];
  const respostas: RespostaDoCliente[] = [];
  const modelos: AvisoDeModelo[] = [];
  const numeros: AvisoDoNumero[] = [];
  if (!body || body.object !== "whatsapp_business_account") return { status, respostas, modelos, numeros };

  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = change?.value || {};
      const campo = change?.field;
      if (campo === "messages") {
        const phoneNumberId = String(v?.metadata?.phone_number_id || "");
        for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
          if (!s?.id || !s?.status) continue;
          const erro = Array.isArray(s.errors) ? s.errors[0] : null;
          status.push({
            wamid: String(s.id),
            status: String(s.status),
            quando: quandoDe(s.timestamp),
            gratis: s?.pricing?.billable === false,
            ...(erro ? { erroCodigo: Number(erro.code), erroTitulo: String(erro.title || erro.message || "") } : {}),
          });
        }
        for (const m of Array.isArray(v.messages) ? v.messages : []) {
          const tel = telefoneDaMeta(m?.from);
          if (!tel) continue;
          const textoDoBotao = m?.button?.text ?? m?.button?.payload ?? m?.interactive?.button_reply?.title;
          respostas.push({ phoneNumberId, telefone: tel, parar: ehPararPromocoes(textoDoBotao) || ehPararPromocoes(m?.text?.body), quando: quandoDe(m.timestamp) });
        }
      } else if (campo === "message_template_status_update") {
        if (v?.message_template_id && statusDoModelo(v.event)) {
          modelos.push({
            metaTemplateId: String(v.message_template_id),
            nome: v.message_template_name ? String(v.message_template_name) : undefined,
            status: statusDoModelo(v.event) as string,
            motivo: v.reason && v.reason !== "NONE" ? String(v.reason) : undefined,
          });
        }
      } else if (campo === "phone_number_quality_update") {
        numeros.push({
          wabaId: entry?.id ? String(entry.id) : undefined,
          numero: v?.display_phone_number ? String(v.display_phone_number).replace(/\D/g, "") : undefined,
          qualidade: v?.event ? String(v.event) : undefined,
          limite: v?.current_limit ? String(v.current_limit) : undefined,
        });
      } else if (campo === "account_update") {
        numeros.push({ wabaId: entry?.id ? String(entry.id) : undefined, evento: v?.event ? String(v.event) : undefined });
      }
    }
  }
  return { status, respostas, modelos, numeros };
}

/** O carimbo X-Hub-Signature-256 confere com o corpo cru? */
export function assinaturaConfere(corpoCru: string, assinatura: string | null, segredo: string, hmac: (segredo: string, corpo: string) => string): boolean {
  if (!assinatura || !segredo) return false;
  const esperado = "sha256=" + hmac(segredo, corpoCru);
  if (esperado.length !== assinatura.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ assinatura.charCodeAt(i);
  return dif === 0;
}

// ── QUEM PODE USAR ──────────────────────────────────────────────────────────

/**
 * DISPARO_OFICIAL_LOJAS: "todas" libera para todo mundo; senão, ids de loja
 * separados por vírgula. Vazio = ninguém. É o que permite testar na Hakim
 * antes de abrir para os clientes.
 */
export function lojaLiberada(franchiseeId: string, lista: string | undefined = process.env.DISPARO_OFICIAL_LOJAS): boolean {
  const l = String(lista || "").trim();
  if (!l) return false;
  if (l.toLowerCase() === "todas") return true;
  return l.split(/[\s,;]+/).filter(Boolean).includes(franchiseeId);
}

// ── RECUPERAÇÃO AUTOMÁTICA (REMARKETING 7, 15 E 30 DIAS) ────────────────────
//
// Refeita pela API oficial em 13/10/2026 (a antiga, api/cron/recuperacao-
// clientes, saía pelo QR e foi desligada). Todo dia, uma vez, a partir das
// 10h no fuso da loja: quem fez o ÚLTIMO pedido exatamente há 7, 15 ou 30 dias
// (pelo calendário da loja) recebe a mensagem aprovada daquele marco. Um dia
// do calendário por rodada = cada cliente cai em cada marco uma vez só.

export const MARCOS_DA_RECUPERACAO = [7, 15, 30] as const;
export type Marco = (typeof MARCOS_DA_RECUPERACAO)[number];
export const HORA_DA_RECUPERACAO = { de: 10, ate: 20 };
/** Quem recebeu uma automática nestes dias não recebe outra (7 e 15 não colam). */
export const RESPIRO_ENTRE_AUTOMATICAS_DIAS = 6;

export type Automacao = {
  marcos: Record<string, { ligado: boolean; modeloId: string | null }>;
  ultimoDia: string | null;
  ultimoResultado: Record<string, { enviados: number; foraPorSaldo: number; motivo?: string }> | null;
};

export function lerAutomacao(bruto: unknown): Automacao {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as any;
  const marcos: Automacao["marcos"] = {};
  for (const m of MARCOS_DA_RECUPERACAO) {
    const x = b?.marcos?.[String(m)] || {};
    marcos[String(m)] = { ligado: x.ligado === true, modeloId: typeof x.modeloId === "string" && x.modeloId ? x.modeloId : null };
  }
  return {
    marcos,
    ultimoDia: typeof b.ultimoDia === "string" ? b.ultimoDia : null,
    ultimoResultado: b.ultimoResultado && typeof b.ultimoResultado === "object" ? b.ultimoResultado : null,
  };
}

/** "2026-10-13" menos N dias, no calendário (sem fuso: é só data). */
export function diasAntes(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d) - n * 24 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

/**
 * Quem faz o marco hoje: o ÚLTIMO pedido do telefone caiu exatamente em
 * `hoje − dias` (data da loja). Quem pediu depois não está aqui (o último
 * pedido é mais novo); quem pediu para parar e quem recebeu uma automática há
 * pouco também não.
 */
export function sumidosDoMarco(
  pedidos: { customerPhone: string | null; customerName: string | null; createdAt: Date }[],
  dias: number,
  hoje: string,
  dataLocal: (d: Date) => string,
  fora: Set<string>
): ClienteDaLoja[] {
  const alvo = diasAntes(hoje, dias);
  const ultimo = new Map<string, ClienteDaLoja>();
  for (const p of pedidos) {
    const tel = telefoneDaMeta(p.customerPhone);
    if (!tel) continue;
    const quando = new Date(p.createdAt);
    const atual = ultimo.get(tel);
    if (!atual || quando > atual.ultimoPedido) ultimo.set(tel, { telefone: tel, nome: p.customerName || atual?.nome || null, ultimoPedido: quando });
  }
  return [...ultimo.values()].filter((c) => !fora.has(c.telefone) && dataLocal(c.ultimoPedido) === alvo);
}

/** Textos prontos por marco — a loja ajusta e manda para aprovação. */
export const TEXTO_SUGERIDO_DO_MARCO: Record<string, { titulo: string; texto: string }> = {
  "7": { titulo: "Volta em 7 dias", texto: "Oi {nome}! Faz uma semaninha que você não pede com a gente. Que tal matar a saudade hoje? Toque em Quero pedir que a gente te atende rapidinho! 😋" },
  "15": { titulo: "Volta em 15 dias", texto: "Oi {nome}, sentimos sua falta! 🧡 Preparamos tudo com carinho para o seu próximo pedido. Toque em Quero pedir e veja o cardápio de hoje." },
  "30": { titulo: "Volta em 30 dias", texto: "Oi {nome}! Já faz um mês do seu último pedido e queremos você de volta. Toque em Quero pedir que tem coisa boa esperando por você! 🎁" },
};
