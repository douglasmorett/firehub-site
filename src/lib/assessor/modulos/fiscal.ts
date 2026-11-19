/**
 * BILL NO FISCAL E NOS APPS — "emite a nota do pedido 42", "fecha o iFood",
 * "abre o iFood de novo", "o iFood está aberto?".
 *
 *   reemitir_nota_fiscal → a emissão do botão 🧾 "Emitir NFC-e" do painel
 *                          (POST api/store/fiscal/emitir), pela mesma lib
 *                          (lib/fiscal-emitir-pelo-painel.ts). Só diz
 *                          "autorizada" com chave da SEFAZ na resposta;
 *                          nota emitida não se desfaz (só cancelando na tela).
 *   loja_no_ifood        → o botão do iFood no topo do painel (StoreTopNav →
 *                          api/ifood/interruptions, lib/ifood-interrupcoes.ts):
 *                          fechar = uma interrupção; abrir = apagar todas. Só
 *                          diz "fechou/abriu" se o iFood respondeu ok.
 *
 * A 99 fica de fora: o painel não tem botão para fechar a loja na 99 (lá só
 * há a religação automática de lib/food99-abertura.ts) — fecha pelo app dela.
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { emitirNotaPeloPainel } from "@/lib/fiscal-emitir-pelo-painel";
import { contextoDoPedido, ErroIfood, type ContextoIfood } from "@/lib/ifood-token";
import { mensagemDeErro } from "@/lib/ifood-http";
import { criarInterrupcao, interrupcoesDaResposta, listarInterrupcoes, removerInterrupcao } from "@/lib/ifood-interrupcoes";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { hojeNaLoja } from "@/lib/relatorios/base";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, type ModuloDoBill, type Resultado } from "../modulo";
import { fusoDaLoja } from "./equipe";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Fechar "até mandar abrir" é a interrupção de 1 ano, como o botão do topo. */
const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

// ── reemitir_nota_fiscal ──────────────────────────────────────────────────

/** "#42", "42" = número do dia; o resto é o id do pedido. */
export function lerPedido(texto: unknown): { numero: number } | { id: string } | null {
  const t = String(texto ?? "").trim().replace(/^(pedido\s*)?(n[ºo°.]\s*)?#?\s*/i, "");
  if (!t) return null;
  if (/^\d{1,6}$/.test(t)) return { numero: Number(t) };
  return /^[\w-]{8,}$/.test(t) ? { id: t } : null;
}

const SELECT_DO_PEDIDO = { id: true, dailyOrderNumber: true, status: true, totalAmount: true, customerName: true, fiscalStatus: true, fiscalInfo: true, createdAt: true } as const;

async function notasComFalha(ctx: ContextoDoAssessor, tz: string): Promise<Resultado> {
  const hoje = hojeNaLoja(tz);
  const { inicio, fim } = janelaDoPeriodo(hoje, hoje, tz);
  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId: ctx.franchiseeId, createdAt: { gte: inicio, lt: fim }, fiscalStatus: "FAILED" },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: SELECT_DO_PEDIDO,
  });
  return {
    ok: true,
    resumo: pedidos.length ? `${pedidos.length} pedido(s) de hoje com a NFC-e com falha.` : "Nenhum pedido de hoje com a NFC-e com falha.",
    comFalha: pedidos.map((p) => ({ pedido: p.dailyOrderNumber ? `#${p.dailyOrderNumber}` : p.id, cliente: p.customerName || undefined, valor: reais(p.totalAmount), motivo: String((p.fiscalInfo as any)?.erro || (p.fiscalInfo as any)?.mensagem || "").slice(0, 160) || undefined })),
  };
}

async function reemitirNotaFiscal(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const qual = lerPedido(args?.pedido);
  if (!qual && String(args?.pedido ?? "").trim()) return { ok: false, erro: "Diga o número do pedido (o do dia, como #42) ou o id dele." };
  if (!qual) return notasComFalha(ctx, tz);

  let pedido;
  if ("numero" in qual) {
    const dia = DIA_RE.test(String(args?.dia || "")) ? String(args.dia) : hojeNaLoja(tz);
    const { inicio, fim } = janelaDoPeriodo(dia, dia, tz);
    const achados = await prisma.customerOrder.findMany({
      where: { franchiseeId: ctx.franchiseeId, dailyOrderNumber: qual.numero, createdAt: { gte: inicio, lt: fim } },
      select: SELECT_DO_PEDIDO,
    });
    if (!achados.length) return { ok: false, erro: `Não achei o pedido #${qual.numero} de ${dia.split("-").reverse().join("/")}. Se for de outro dia, mande o dia.` };
    if (achados.length > 1) return { ok: false, erro: `Há ${achados.length} pedidos #${qual.numero} nesse dia: pergunte qual.`, opcoes: achados.map((p) => ({ id: p.id, cliente: p.customerName, valor: reais(p.totalAmount) })) };
    pedido = achados[0];
  } else {
    pedido = await prisma.customerOrder.findFirst({ where: { id: qual.id, franchiseeId: ctx.franchiseeId }, select: SELECT_DO_PEDIDO });
    if (!pedido) return { ok: false, erro: "Pedido não encontrado nesta loja." };
  }

  const rotulo = `pedido ${pedido.dailyOrderNumber ? `#${pedido.dailyOrderNumber}` : pedido.id}${pedido.customerName ? ` (${pedido.customerName}, ${reais(pedido.totalAmount)})` : ` (${reais(pedido.totalAmount)})`}`;
  const chave = (pedido.fiscalInfo as any)?.nfceKey;
  // Antes da pergunta: não faz sentido o dono confirmar o que a emissão vai recusar.
  if (pedido.fiscalStatus === "EMITTED" && chave) return { ok: false, erro: `O ${rotulo} já tem NFC-e autorizada (chave ${chave}). Não se emite de novo.` };
  if (String(pedido.status || "").toUpperCase().startsWith("CANCEL")) return { ok: false, erro: `O ${rotulo} foi cancelado: venda cancelada não tem nota.` };

  const pergunta = pedirConfirmacao(args, `Vou emitir a NFC-e do ${rotulo} na SEFAZ. É nota fiscal de verdade: depois, só cancelando dentro do prazo.`);
  if (pergunta) return pergunta;

  const { status, corpo } = await emitirNotaPeloPainel(ctx.franchiseeId, pedido.id, args?.cpfCnpj ? String(args.cpfCnpj) : undefined);

  // Só é "autorizada" com chave da SEFAZ na resposta.
  if (status === 200 && corpo?.success === true && corpo.chaveDeAcesso) {
    const homologacao = corpo.ambiente === 2;
    const situacao = corpo.contingencia ? "emitida em CONTINGÊNCIA (vale para o cliente; a SEFAZ ainda vai receber)" : homologacao ? "autorizada em HOMOLOGAÇÃO (teste, sem valor fiscal)" : "autorizada pela SEFAZ";
    const resumo = `NFC-e do ${rotulo} ${situacao}${corpo.numero ? `, nº ${corpo.numero}` : ""}`;
    await registrarNoBill(ctx, "FISCAL_NOTA", resumo, { orderId: pedido.id, chave: corpo.chaveDeAcesso });
    return {
      ok: true,
      resumo,
      chaveDeAcesso: corpo.chaveDeAcesso,
      danfe: corpo.urlDoDanfe || undefined,
      notaDaConta: corpo.notaDaConta || undefined,
      aviso: corpo.aviso || undefined,
      observacao: corpo.contingencia ? "Em contingência o DANFE precisa ser impresso. A consulta automática acompanha até a SEFAZ efetivar." : undefined,
    };
  }
  if (status === 202) {
    return { ok: false, emProcessamento: true, erro: `A SEFAZ recebeu a nota do ${rotulo} e ainda não respondeu: NÃO está autorizada ainda. Em alguns minutos, confira em Fiscal › Consultar situação (não emita de novo).` };
  }
  return {
    ok: false,
    erro: `A NFC-e do ${rotulo} NÃO foi emitida: ${corpo?.mensagem || corpo?.error || `erro ${status}`}`,
    pendencias: Array.isArray(corpo?.pendencias) && corpo.pendencias.length ? corpo.pendencias : undefined,
    detalhe: corpo?.detalhe || undefined,
  };
}

// ── loja_no_ifood ─────────────────────────────────────────────────────────

/** "2026-11-19T21:30:00" no relógio da loja — o formato que o botão do topo manda (hora local, sem fuso). */
export function horaLocalSemFuso(d: Date, tz: string): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Com fuso ("Z", "-03:00") é um instante; sem fuso já é a hora da loja (como o botão manda). */
const temFuso = (s: string) => /(z|[+-]\d{2}:?\d{2})$/i.test(s);
const naHoraDaLoja = (iso: unknown, tz: string) => {
  const s = String(iso || "");
  return temFuso(s) && !Number.isNaN(Date.parse(s)) ? horaLocalSemFuso(new Date(s), tz) : s;
};

/** A pausa ainda vale? */
export function aindaNaoAcabou(fim: unknown, agora: Date, tz: string): boolean {
  const s = naHoraDaLoja(fim, tz);
  return !s || s.slice(0, 19) > horaLocalSemFuso(agora, tz);
}

/** "19/11 21:30" no relógio da loja. */
export function quando(iso: unknown, tz: string): string {
  const s = naHoraDaLoja(iso, tz);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : s;
}

/** As lojas do iFood da conta: a mesma leitura do cron loja-sem-conexao (integração ativa ou o merchant antigo do User). */
async function lojasNoIfood(franchiseeId: string): Promise<string[]> {
  const [u, integracoes] = await Promise.all([
    prisma.user.findUnique({ where: { id: franchiseeId }, select: { ifoodConnected: true, ifoodMerchantId: true } }),
    prisma.ifoodIntegration.findMany({ where: { userId: franchiseeId, active: true }, orderBy: { createdAt: "asc" }, select: { merchantId: true } }),
  ]);
  return Array.from(new Set([...integracoes.map((i) => i.merchantId), ...(u?.ifoodConnected && u.ifoodMerchantId ? [u.ifoodMerchantId] : [])].filter(Boolean)));
}

type NaLoja = { merchantId: string; loja?: string; ok: boolean; erro?: string; criada?: string; removidas?: { description?: string; start?: string; end?: string }[]; pausas?: { motivo?: string; ate: string }[] };

async function ctxDaLoja(franchiseeId: string, merchantId: string): Promise<ContextoIfood> {
  return contextoDoPedido({ franchiseeId, ifoodStoreMerchant: merchantId });
}

async function lojaNoIfood(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const acao = String(args?.acao || "VER").toUpperCase();
  const merchants = await lojasNoIfood(ctx.franchiseeId);
  if (!merchants.length) return { ok: false, erro: "A loja não tem iFood conectado." };
  const tz = await fusoDaLoja(ctx);
  const agora = new Date();

  if (acao === "FECHAR" || acao === "ABRIR") {
    const minutos = Number(args?.minutos);
    const ate = acao === "FECHAR" && Number.isFinite(minutos) && minutos > 0 ? new Date(agora.getTime() + minutos * 60_000) : null;
    const pergunta = pedirConfirmacao(
      args,
      acao === "FECHAR"
        ? `Vou fechar a loja no iFood ${ate ? `até ${quando(horaLocalSemFuso(ate, tz), tz)}` : "até você mandar abrir"}: o iFood para de receber pedidos.`
        : "Vou abrir a loja no iFood (tiro as pausas de lá): volta a receber pedidos no horário de funcionamento.",
    );
    if (pergunta) return pergunta;
  }

  const porLoja: NaLoja[] = [];
  for (const merchantId of merchants) {
    const r: NaLoja = { merchantId, ok: false };
    try {
      const c = await ctxDaLoja(ctx.franchiseeId, merchantId);
      r.loja = c.label;
      if (acao === "FECHAR") {
        const minutos = Number(args?.minutos);
        const fim = new Date(agora.getTime() + (Number.isFinite(minutos) && minutos > 0 ? minutos * 60_000 : UM_ANO_MS));
        const s = await criarInterrupcao(c, { description: String(args?.motivo || "").trim().slice(0, 100) || "Loja fechada manualmente", start: horaLocalSemFuso(agora, tz), end: horaLocalSemFuso(fim, tz) });
        if (s.ok) { r.ok = true; r.criada = (s.data as any)?.id; }
        else r.erro = s.status === 409 ? "Já existe uma pausa nesse horário no iFood." : mensagemDeErro(s);
      } else {
        const l = await listarInterrupcoes(c);
        if (!l.ok) { r.erro = mensagemDeErro(l); porLoja.push(r); continue; }
        const lista = interrupcoesDaResposta(l.data);
        if (acao === "ABRIR") {
          r.removidas = [];
          const erros: string[] = [];
          for (const it of lista) {
            if (!it?.id) continue;
            const d = await removerInterrupcao(c, String(it.id));
            if (d.ok) r.removidas.push({ description: it.description, start: it.start, end: it.end });
            else erros.push(mensagemDeErro(d));
          }
          r.ok = erros.length === 0;
          if (erros.length) r.erro = erros.join("; ");
        } else {
          r.ok = true;
          r.pausas = lista.filter((it) => aindaNaoAcabou(it?.end, agora, tz)).map((it) => ({ motivo: it.description || undefined, ate: quando(it.end, tz) }));
        }
      }
    } catch (e: any) {
      r.erro = e instanceof ErroIfood ? e.message : e?.message || "Não deu para falar com o iFood.";
    }
    porLoja.push(r);
  }

  const varias = porLoja.length > 1;
  const nome = (r: NaLoja) => (varias ? `iFood${r.loja ? ` (${r.loja})` : ""}` : "iFood");
  const deram = porLoja.filter((r) => r.ok);
  const falhas = porLoja.filter((r) => !r.ok).map((r) => `${nome(r)}: ${r.erro}`);

  if (acao === "VER") {
    return {
      ok: deram.length > 0,
      resumo: deram.map((r) => (r.pausas?.length ? `${nome(r)} FECHADO (pausa até ${r.pausas.map((p) => p.ate).join(", ")})` : `${nome(r)} sem pausa (abre no horário de funcionamento)`)).join(" · ") || undefined,
      porLoja: deram.map((r) => ({ loja: r.loja, pausas: r.pausas })),
      erros: falhas.length ? falhas : undefined,
    };
  }

  if (deram.length) {
    const resumo = `${acao === "FECHAR" ? "Loja fechada" : "Loja aberta"} no ${deram.map(nome).join(", ")}`;
    await registrarNoBill(ctx, "APP_IFOOD", resumo, { acao, porLoja: deram.map((r) => ({ merchantId: r.merchantId, criada: r.criada, removidas: r.removidas })) });
    return {
      ok: true,
      resumo,
      erros: falhas.length ? falhas : undefined,
      observacao: acao === "ABRIR" ? "Sem pausa, o iFood recebe pedido dentro do horário de funcionamento cadastrado lá. A 99 não muda por aqui." : "A 99 não fecha por aqui: pelo app da 99. O site/robô fecha com abrir_ou_fechar_site.",
    };
  }
  return { ok: false, erro: `O iFood não confirmou: ${falhas.join(" · ")}. Nada mudou.` };
}

// ── O módulo ──────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "FISCAL_NOTA") {
    return { ok: false, erro: "Nota fiscal autorizada não se desfaz pelo Bill: para anular, cancele a NFC-e na tela Fiscal (dentro do prazo legal)." };
  }
  if (tipo === "APP_IFOOD") {
    const tz = await fusoDaLoja(ctx);
    const agora = new Date();
    const falhas: string[] = [];
    for (const l of refs.porLoja || []) {
      try {
        const c = await ctxDaLoja(ctx.franchiseeId, String(l.merchantId));
        if (refs.acao === "FECHAR") {
          if (!l.criada) { falhas.push("a pausa criada não veio com id: abra pelo painel"); continue; }
          const d = await removerInterrupcao(c, String(l.criada));
          if (!d.ok && d.status !== 404) falhas.push(mensagemDeErro(d));
        } else {
          // Abriu: volta as pausas que ainda não tinham acabado.
          for (const p of l.removidas || []) {
            if (!p.end || !aindaNaoAcabou(p.end, agora, tz)) continue;
            const s = await criarInterrupcao(c, { description: p.description, start: horaLocalSemFuso(agora, tz), end: naHoraDaLoja(p.end, tz).slice(0, 19) });
            if (!s.ok) falhas.push(mensagemDeErro(s));
          }
        }
      } catch (e: any) {
        falhas.push(e?.message || "Não deu para falar com o iFood.");
      }
    }
    return falhas.length ? { ok: false, erro: `O iFood não confirmou o desfazer: ${falhas.join("; ")}` } : { ok: true };
  }
  return null;
}

export const MODULO_FISCAL: ModuloDoBill = {
  nome: "fiscal",
  declaracoes: [
    {
      name: "reemitir_nota_fiscal",
      description: "Emite a NFC-e de um pedido que ficou sem nota ou com falha (o botão 🧾 Emitir NFC-e do painel). Sem 'pedido', lista os pedidos de hoje com a nota com falha. Pede confirmação.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          pedido: { type: Type.STRING, description: "número do dia ('42' ou '#42') ou o id do pedido; vazio = listar as falhas de hoje" },
          dia: { type: Type.STRING, description: "AAAA-MM-DD do pedido, quando não é de hoje" },
          cpfCnpj: { type: Type.STRING, description: "CPF/CNPJ para a nota, só se o dono pediu" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
      },
    },
    {
      name: "loja_no_ifood",
      description: "A loja NO iFood: VER se está fechada (pausa), FECHAR (para de receber pedido; 'minutos' para fechar por um tempo) ou ABRIR (tira as pausas). Fechar/abrir pedem confirmação. Não mexe na 99 nem no site.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["VER", "FECHAR", "ABRIR"] },
          minutos: { type: Type.NUMBER, description: "só FECHAR: por quantos minutos; omita = até mandar abrir" },
          motivo: { type: Type.STRING, description: "só FECHAR, se ele disse (aparece no iFood)" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
  ],
  gravam: ["reemitir_nota_fiscal", "loja_no_ifood"],
  regras: [
    "Nota fiscal: reemitir_nota_fiscal pede confirmação; só diga 'nota autorizada' quando vier ok com chaveDeAcesso. emProcessamento ou erro = NÃO emitida (diga o motivo).",
    "Nota emitida não se desfaz pelo Bill: só cancelando na tela Fiscal.",
    "'Fecha/abre o iFood' = loja_no_ifood (com confirmação); só diga que fechou/abriu se voltar ok. 'Fecha o site/robô' continua sendo abrir_ou_fechar_site.",
    "A 99 não abre nem fecha pelo Bill: oriente pelo app da 99.",
  ].join("\n"),
  executar: async (nome, args, ctx) => {
    if (nome === "reemitir_nota_fiscal") return reemitirNotaFiscal(args, ctx);
    if (nome === "loja_no_ifood") return lojaNoIfood(args, ctx);
    return null;
  },
  tipos: ["FISCAL_NOTA", "APP_IFOOD"],
  desfazer,
};
