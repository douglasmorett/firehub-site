/**
 * BILL NOS PEDIDOS — "aceita o 23", "o 15 saiu", "cancela o 40, cliente
 * desistiu", "põe o João no 31".
 *
 * Douglas, 18/11/2026: "ele tem que conseguir buscar no sistema, ativar e usar
 * qualquer coisa pro dono de restaurante". A busca de pedido é de outro módulo;
 * aqui ficam as AÇÕES, todas pelo caminho do painel de pedidos
 * (StoreOrdersDashboard):
 *
 *   mudar_status_do_pedido → lib/mudar-status-do-pedido.ts (o PUT de
 *                            api/customer-order/status): avisa iFood/99/…, o
 *                            cliente no WhatsApp, estoque, NFC-e, faturamento
 *   cancelar_pedido        → o mesmo, com o motivo escrito e o código da
 *                            plataforma (lib/motivos-do-cancelamento-do-pedido.ts,
 *                            a lista da janela "Cancelar pedido")
 *   atribuir_motoboy       → lib/atribuir-motoboy-ao-pedido.ts (o PATCH de
 *                            api/customer-order/assign-motoboy)
 *
 * Só as passagens que os botões do card fazem: aceitar o NOVO; "Saiu" na
 * entrega e "Pronto" na retirada; "Entregue". Pronto de pedido de ENTREGA é o
 * selo da cozinha (KDS), não um status — fica no painel. Pedido cancelado ou
 * entregue não reabre por aqui (a tela pergunta antes), nem rascunho do robô
 * ou pedido esperando pagamento.
 *
 * Pedido de app (iFood, 99…): a resposta diz o que a PLATAFORMA respondeu —
 * "o iFood acompanhou" só quando a rota voltou sem aviso dele.
 *
 * "#23" é o número do dia de OPERAÇÃO de hoje (vira às 5h, fuso da loja), a
 * não ser que o dono diga a data. O número zera no fechamento do caixa, então
 * pode repetir no mesmo dia: aí a resposta lista os dois para o dono escolher.
 *
 * Teste: scripts/teste-bill-pedidos-e-marketing.ts
 */
import { Type } from "@google/genai";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hojeNaLoja, fmtDia, naLoja } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { limparMotivo, motivoValido, MENSAGEM_SEM_MOTIVO } from "@/lib/motivo-do-cancelamento";
import { travaDaNotaFiscal } from "@/lib/edicao-de-pedido";
import { conferirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { CAMPOS_DO_PEDIDO, mudarStatusDoPedido } from "@/lib/mudar-status-do-pedido";
import { motivosDoCancelamento } from "@/lib/motivos-do-cancelamento-do-pedido";
import { atribuirMotoboyAoPedido, CAMPOS_DO_PEDIDO_ALVO } from "@/lib/atribuir-motoboy-ao-pedido";
import type { ContextoDoAssessor } from "../ferramentas";
import { pedirConfirmacao, PARAMETRO_CONFIRMADO, reais, registrarNoBill, semAcento, type ModuloDoBill, type Resultado } from "../modulo";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const DESFAZ_NO_PAINEL = "Mudança de status de pedido não se desfaz pelo Bill: desfaça pelo painel de pedidos.";
const SENHA_NO_PAINEL = "Esta loja pede a senha do gerente para cancelar pedido: cancele pelo painel de pedidos.";

/** As passagens dos botões do card (StoreOrdersDashboard, `pedido-acoes-status`) e do arrastar. */
export const STATUS_DO_BILL = {
  ACEITO: { nome: "aceito", de: ["NOVO"] },
  PREPARANDO: { nome: "em preparo", de: ["ACEITO"] },
  PRONTO: { nome: "pronto para retirar", de: ["ACEITO", "PREPARANDO"] },
  SAIU_ENTREGA: { nome: "saiu para entrega", de: ["ACEITO", "PREPARANDO", "PRONTO"] },
  ENTREGUE: { nome: "entregue", de: ["ACEITO", "PREPARANDO", "PRONTO", "SAIU_ENTREGA"] },
} as const;
export type StatusDoBill = keyof typeof STATUS_DO_BILL;

const NOME_DO_STATUS: Record<string, string> = {
  NOVO: "novo (esperando aceite)", ACEITO: "aceito", PREPARANDO: "em preparo", PRONTO: "pronto", SAIU_ENTREGA: "saiu para entrega",
  ENTREGUE: "entregue", CANCELADO: "cancelado", CRIANDO_IA: "rascunho do robô", AGUARDANDO_PAGAMENTO: "esperando pagamento",
};
const nomeDoStatus = (s: string | null | undefined) => NOME_DO_STATUS[String(s || "")] || String(s || "").toLowerCase();

const ehEntrega = (p: { deliveryType?: string | null }) => String(p.deliveryType || "").toUpperCase() === "DELIVERY";

/**
 * A passagem pode ser feita pelo Bill? Devolve o porquê de não, ou null.
 * Pura: o teste prova cada caso.
 */
export function recusaDoStatus(p: { status: string; deliveryType?: string | null }, alvo: string): string | null {
  const regra = (STATUS_DO_BILL as Record<string, { nome: string; de: readonly string[] }>)[alvo];
  if (!regra) return "Status que o Bill muda: aceito, em preparo, pronto (retirada), saiu para entrega e entregue. Cancelar é com cancelar_pedido.";
  const atual = String(p.status || "");
  if (atual === alvo) return null; // a rota responde "sem mudança"
  if (atual === "CANCELADO" || atual === "ENTREGUE") return `O pedido está ${nomeDoStatus(atual)}: para reabrir, use o painel de pedidos (ele pergunta antes).`;
  if (atual === "CRIANDO_IA") return "É o rascunho do robô, ainda não é pedido: finalize ou recuse pelo painel de pedidos.";
  if (atual === "AGUARDANDO_PAGAMENTO") return "O pedido está esperando pagamento: confirme o pagamento pelo painel de pedidos (\"Recebi o pagamento\").";
  if (alvo === "PREPARANDO" && atual === "NOVO") return "O pedido ainda não foi aceito: aceitar já põe em produção.";
  if (alvo === "PRONTO" && ehEntrega(p)) return "Em pedido de entrega o pronto é o selo da cozinha (KDS ou painel); quando sair, diga \"saiu para entrega\".";
  if (alvo === "SAIU_ENTREGA" && !ehEntrega(p)) return "Esse pedido não é de entrega: para retirada/balcão, diga \"pronto\" ou \"entregue\".";
  if (!regra.de.includes(atual)) return `O pedido está ${nomeDoStatus(atual)}: não dá para marcar como ${regra.nome} por aqui.`;
  return null;
}

/** O aviso que a rota devolve por canal (null = a rota não devolve confirmação dele). */
const AVISO_DO_CANAL: Record<string, string> = {
  IFOOD: "avisoIfood", "99FOOD": "aviso99Food", BRENDI: "avisoBrendi", KEETA: "avisoKeeta",
  CARDAPIOWEB: "avisoCardapioWeb", ANOTAAI: "avisoAnotaAi", AIQFOME: "avisoAiqfome",
};

/** O que a plataforma respondeu, em uma frase. Só afirma "acompanhou" com a resposta sem aviso. Pura. */
export function respostaDaPlataforma(canal: { chave: string; nome: string; ehMarketplace: boolean }, corpo: Record<string, any>): { acompanhou: boolean | null; frase: string } | null {
  if (!canal.ehMarketplace) return null;
  const campo = AVISO_DO_CANAL[canal.chave];
  if (!campo) return { acompanhou: null, frase: `O FireHub avisou o ${canal.nome}, mas ele não devolve confirmação por aqui: confira no app do ${canal.nome}.` };
  const aviso = corpo?.[campo];
  if (aviso) return { acompanhou: false, frase: `O ${canal.nome} NÃO acompanhou: ${aviso}. Faça também no app/portal do ${canal.nome}.` };
  return { acompanhou: true, frase: `O ${canal.nome} respondeu ok.` };
}

// ── Achar o pedido ──────────────────────────────────────────────────────────

const CAMPOS_DO_BILL = {
  ...CAMPOS_DO_PEDIDO,
  customerName: true, createdAt: true, ifoodReference: true,
  ifoodDriverName: true, ifoodDriverStatus: true, motoboy: { select: { name: true } },
} as const;

async function fusoDaLoja(ctx: ContextoDoAssessor): Promise<string | null> {
  if (ctx.timezone) return ctx.timezone;
  const u = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeTimezone: true } });
  return u?.storeTimezone || null;
}

type Achado<T> = { ok: true; pedido: T } | { ok: false; erro: string; [k: string]: unknown };

export async function acharPedido(args: any, ctx: ContextoDoAssessor): Promise<Achado<any>> {
  const id = String(args?.pedidoId || "").trim();
  if (id) {
    const p = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: ctx.franchiseeId }, select: CAMPOS_DO_BILL });
    return p ? { ok: true, pedido: p } : { ok: false, erro: "Esse pedido não é desta loja." };
  }
  const numero = Math.floor(Number(String(args?.numero ?? "").replace(/\D/g, "")));
  if (!numero) return { ok: false, erro: "Diga o número do pedido (ex.: 23)." };
  const tz = await fusoDaLoja(ctx);
  const dia = DIA_RE.test(String(args?.dia || "")) ? String(args.dia) : hojeNaLoja(tz);
  const { inicio, fim } = janelaDoPeriodo(dia, dia, tz);
  const achados = await prisma.customerOrder.findMany({
    where: { franchiseeId: ctx.franchiseeId, dailyOrderNumber: numero, createdAt: { gte: inicio, lt: fim } },
    select: CAMPOS_DO_BILL,
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  if (!achados.length) return { ok: false, erro: `Não achei o pedido #${numero} de ${fmtDia(dia)}. Se for de outro dia, diga a data.` };
  if (achados.length > 1) {
    // O número zera no fechamento do caixa: dois turnos no mesmo dia repetem.
    return {
      ok: false,
      erro: `Tem ${achados.length} pedidos #${numero} em ${fmtDia(dia)} (o número zera quando o caixa fecha). Pergunte qual e chame de novo com o pedidoId.`,
      pedidos: achados.map((p) => descrever(p, tz)),
    };
  }
  return { ok: true, pedido: achados[0] };
}

function descrever(p: any, tz?: string | null) {
  const canal = canalDoPedido(p);
  const l = p.createdAt ? naLoja(p.createdAt, tz) : null;
  return {
    pedidoId: p.id,
    numero: p.dailyOrderNumber ? `#${p.dailyOrderNumber}` : null,
    cliente: p.customerName || null,
    valor: reais(p.totalAmount),
    canal: canal.referencia ? `${canal.nome} #${canal.referencia}` : canal.nome,
    status: nomeDoStatus(p.status),
    hora: l ? `${String(l.hora).padStart(2, "0")}:${String(l.minutos % 60).padStart(2, "0")}` : null,
    entrega: ehEntrega(p) ? "entrega" : "retirada/balcão",
    motoboy: p.motoboy?.name || undefined,
  };
}

const rotulo = (p: any) => `#${p.dailyOrderNumber ?? p.id.slice(-4).toUpperCase()}${p.customerName ? ` (${p.customerName})` : ""}`;

/** Quem mexe: o dono (o editHistory diz que foi pelo Bill). */
async function quemMexe(ctx: ContextoDoAssessor) {
  const u = await prisma.user.findUnique({ where: { id: ctx.usuarioId }, select: { id: true, name: true, email: true, role: true } });
  const nome = (ctx.autor || u?.name || "").trim() || "Dono";
  return { id: ctx.usuarioId, name: `${nome} pelo Bill`, email: u?.email || null, role: u?.role || null };
}

/** A senha do gerente para cancelar vale para o Bill também: aqui não tem onde digitar. */
async function travaDaSenha(franchiseeId: string): Promise<string | null> {
  try {
    const r = await conferirSenhaDoGerente(franchiseeId, "cancelarPedido", null);
    return r.ok ? null : SENHA_NO_PAINEL;
  } catch {
    return "Não deu para conferir a senha do gerente agora. Tente de novo ou cancele pelo painel.";
  }
}

/** Passa pelo mesmo PUT do painel e lê a resposta como a tela lê. */
async function aplicarStatus(p: any, status: string, ctx: ContextoDoAssessor, extra: { cancelReason?: string; cancellationCode?: string } = {}) {
  const quem = await quemMexe(ctx);
  const res = await mudarStatusDoPedido({
    order: p, status, role: quem.role || undefined, currentUser: { id: quem.id, name: quem.name, role: quem.role },
    cancelReason: extra.cancelReason, cancellationCode: extra.cancellationCode,
    quemFinaliza: quem.name,
    conferirSenhaDoGerente: async () => {
      const trava = await travaDaSenha(p.franchiseeId);
      return trava ? NextResponse.json({ error: trava }, { status: 403 }) : null;
    },
  });
  const corpo = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { ok: res.ok, corpo };
}

/** Os avisos de dinheiro que a tela mostra depois do cancelamento. */
function avisosDoEstorno(corpo: Record<string, any>): string[] {
  const avisos: string[] = [];
  if (corpo.avisoEstorno) avisos.push(`Estorno do Pix: ${corpo.avisoEstorno}`);
  const e = corpo.estornoNaMaquininha;
  if (e) avisos.push(e.situacao === "RECUSADO" ? `Estorno na maquininha não saiu (${e.motivo || "recusado"}): estorne na maquininha.` : "Estorno mandado para a maquininha que cobrou.");
  return avisos;
}

// ── As ferramentas ──────────────────────────────────────────────────────────

async function mudarStatus(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const status = String(args?.status || "").toUpperCase();
  const achado = await acharPedido(args, ctx);
  if (!achado.ok) return achado;
  const p = achado.pedido;
  const recusa = recusaDoStatus(p, status);
  if (recusa) return { ok: false, erro: recusa, pedido: descrever(p) };

  const antes = p.status;
  const { ok, corpo } = await aplicarStatus(p, status, ctx);
  if (!ok) return { ok: false, erro: corpo.error || "O painel recusou a mudança.", pedido: descrever(p) };
  const nome = STATUS_DO_BILL[status as StatusDoBill].nome;
  if (corpo.semMudanca) return { ok: true, resumo: `O pedido ${rotulo(p)} já estava ${nome}.` };

  const plataforma = respostaDaPlataforma(canalDoPedido(p), corpo);
  const resumo = `Pedido ${rotulo(p)}: ${nomeDoStatus(antes)} → ${nome}`;
  await registrarNoBill(ctx, "PEDIDO_STATUS", resumo, { pedidoId: p.id, de: antes, para: status });
  return {
    ok: true,
    resumo,
    plataforma: plataforma?.frase,
    observacao: "O cliente recebe o aviso no WhatsApp como pelo painel. Status de pedido não se desfaz pelo Bill.",
  };
}

async function cancelarPedido(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const achado = await acharPedido(args, ctx);
  if (!achado.ok) return achado;
  const p = achado.pedido;
  if (p.status === "CANCELADO") return { ok: true, resumo: `O pedido ${rotulo(p)} já estava cancelado.` };
  if (p.status === "CRIANDO_IA") return { ok: false, erro: "É o rascunho do robô: recuse pelo painel de pedidos." };
  const motivo = limparMotivo(args?.motivo);
  if (!motivoValido(motivo)) return { ok: false, erro: `${MENSAGEM_SEM_MOTIVO} Pergunte ao dono o motivo.` };

  // As travas da rota, antes de perguntar: não adianta o dono dizer sim para o que vai ser recusado.
  const nota = travaDaNotaFiscal(p, "cancelar o pedido");
  if (nota) return { ok: false, erro: nota };
  const senha = await travaDaSenha(ctx.franchiseeId);
  if (senha) return { ok: false, erro: senha };

  const canal = canalDoPedido(p);
  const codigo = String(args?.codigoDoMotivo || "").trim();
  // Os códigos que a janela "Cancelar pedido" oferece (do iFood, ou a lista padrão).
  const motivos = canal.ehMarketplace ? await motivosDoCancelamento(p) : [];
  if (canal.ehMarketplace && !motivos.some((m) => m.cancelCodeId === codigo)) {
    return {
      ok: false,
      precisaDoCodigo: true,
      erro: `Pedido do ${canal.nome}: escolha com o dono o motivo da plataforma e chame de novo com codigoDoMotivo.`,
      motivosDaPlataforma: motivos.map((m) => ({ codigo: m.cancelCodeId, motivo: m.description })),
    };
  }

  const escolhido = motivos.find((m) => m.cancelCodeId === codigo);
  const pedido = descrever(p);
  const pergunta = pedirConfirmacao(
    args,
    `Cancelar o pedido ${pedido.numero || ""} de ${pedido.cliente || "cliente sem nome"}, ${pedido.valor}, ${pedido.canal}` +
      ` — motivo: "${motivo}"${escolhido ? ` (${canal.nome}: ${escolhido.description})` : ""}?` +
      `${p.status === "ENTREGUE" ? " ATENÇÃO: o pedido já foi ENTREGUE." : ""}` +
      `${p.paymentPaidAt ? " Foi pago: o estorno sai como no painel." : ""}` +
      " O cliente recebe o aviso no WhatsApp.",
  );
  if (pergunta) return { ...pergunta, pedido };

  const { ok, corpo } = await aplicarStatus(p, "CANCELADO", ctx, { cancelReason: motivo, cancellationCode: escolhido?.cancelCodeId });
  if (!ok) return { ok: false, erro: corpo.error || "O painel recusou o cancelamento.", pedido };

  const plataforma = respostaDaPlataforma(canal, corpo);
  const resumo = `Pedido ${rotulo(p)} cancelado no FireHub — ${motivo}`;
  await registrarNoBill(ctx, "PEDIDO_CANCELADO", resumo, { pedidoId: p.id, de: p.status, motivo, codigo: escolhido?.cancelCodeId ?? null });
  const avisos = avisosDoEstorno(corpo);
  return {
    ok: true,
    resumo,
    plataforma: plataforma?.frase,
    avisos: avisos.length ? avisos : undefined,
    observacao: canal.ehMarketplace
      ? `Diga ao dono exatamente o que o ${canal.nome} respondeu (campo plataforma). Nunca diga que cancelou no app se ele não respondeu ok.`
      : "Cancelamento não se desfaz pelo Bill.",
  };
}

async function atribuirMotoboy(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const achado = await acharPedido(args, ctx);
  if (!achado.ok) return achado;
  const p = achado.pedido;
  const pedido = descrever(p);
  if (p.status === "CANCELADO") return { ok: false, erro: "O pedido está cancelado.", pedido };
  // O seletor do card só aparece em pedido que vai por entregador da loja.
  if (!ehEntrega(p)) return { ok: false, erro: "Esse pedido não é de entrega: não leva motoboy.", pedido };
  const parceira = infoDaEntrega(p);
  if (parceira.parceira) return { ok: false, erro: `Quem entrega esse pedido é o entregador do ${canalDoPedido(p).nome}: não vai motoboy da loja.`, pedido };

  const tirar = args?.tirar === true;
  let novo: { id: string; name: string } | null = null;
  if (!tirar) {
    const busca = semAcento(String(args?.motoboy || "")).trim();
    if (!busca) return { ok: false, erro: "Diga o nome do motoboy (ou tirar=true para deixar sem)." };
    const todos = await prisma.motoboy.findMany({ where: { franchiseeId: ctx.franchiseeId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const iguais = todos.filter((m) => semAcento(m.name).trim() === busca);
    const parecidos = iguais.length ? iguais : todos.filter((m) => semAcento(m.name).includes(busca));
    if (parecidos.length !== 1) {
      return {
        ok: false,
        erro: parecidos.length ? `Mais de um motoboy com "${args.motoboy}": pergunte qual.` : `Não achei motoboy ativo com "${args.motoboy}".`,
        motoboys: (parecidos.length ? parecidos : todos).map((m) => m.name),
      };
    }
    novo = parecidos[0];
  }
  if ((p.motoboyId || null) === (novo?.id || null)) return { ok: true, resumo: `O pedido ${rotulo(p)} já estava ${novo ? `com ${novo.name}` : "sem motoboy"}.` };

  const r = await trocarMotoboy(p.id, novo?.id || null, p.dailyOrderNumber, ctx);
  if (!r.ok) return { ok: false, erro: r.erro, pedido };
  const resumo = novo ? `Pedido ${rotulo(p)} com o motoboy ${novo.name}` : `Pedido ${rotulo(p)} sem motoboy`;
  await registrarNoBill(ctx, "PEDIDO_MOTOBOY", resumo, { pedidoId: p.id, motoboyAnterior: p.motoboyId || null, motoboyNovo: novo?.id || null });
  return {
    ok: true,
    resumo,
    anterior: p.motoboy?.name || undefined,
    observacao: novo ? "O motoboy recebe o pedido no app e no WhatsApp, como pelo painel." : undefined,
  };
}

async function trocarMotoboy(pedidoId: string, motoboyId: string | null, numero: number | null, ctx: ContextoDoAssessor): Promise<{ ok: true } | { ok: false; erro: string }> {
  const pedidoAlvo = await prisma.customerOrder.findFirst({ where: { id: pedidoId, franchiseeId: ctx.franchiseeId }, select: CAMPOS_DO_PEDIDO_ALVO });
  if (!pedidoAlvo) return { ok: false, erro: "Esse pedido não é desta loja." };
  const quem = await quemMexe(ctx);
  const res = await atribuirMotoboyAoPedido({ orderId: pedidoId, motoboyId, firehubOrderNumber: numero ?? undefined, pedidoAlvo, usuario: { name: quem.name, email: quem.email } });
  if (res.ok) return { ok: true };
  const corpo = (await res.json().catch(() => ({}))) as any;
  return { ok: false, erro: corpo.error || "Não consegui trocar o motoboy." };
}

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "PEDIDO_STATUS" || tipo === "PEDIDO_CANCELADO") return { ok: false, erro: DESFAZ_NO_PAINEL };
  if (tipo !== "PEDIDO_MOTOBOY") return null;
  const atual = await prisma.customerOrder.findFirst({ where: { id: refs.pedidoId, franchiseeId: ctx.franchiseeId }, select: { motoboyId: true, dailyOrderNumber: true } });
  if (!atual) return { ok: false, erro: "O pedido não existe mais." };
  // Trocado de novo depois do Bill (pelo painel ou pelo app): o desfazer não passa por cima.
  if ((atual.motoboyId || null) !== (refs.motoboyNovo || null)) return { ok: false, erro: "O motoboy desse pedido mudou depois: troque pelo painel de pedidos." };
  const r = await trocarMotoboy(refs.pedidoId, refs.motoboyAnterior || null, atual.dailyOrderNumber, ctx);
  return r.ok ? { ok: true } : r;
}

// ── O módulo ────────────────────────────────────────────────────────────────

const QUAL_PEDIDO = {
  numero: { type: Type.NUMBER, description: "o número do pedido que o dono disse (\"o 23\" = 23), do dia de operação de hoje" },
  pedidoId: { type: Type.STRING, description: "id do pedido, quando já se sabe (resposta de busca ou da lista de repetidos)" },
  dia: { type: Type.STRING, description: "YYYY-MM-DD, só se o dono disse que o pedido é de outro dia" },
};

export const MODULO_PEDIDOS: ModuloDoBill = {
  nome: "pedidos",
  declaracoes: [
    {
      name: "mudar_status_do_pedido",
      description: "Muda o status de um pedido pelo mesmo caminho do painel de pedidos (avisa iFood/99 e o cliente no WhatsApp): aceitar, em preparo, pronto (retirada), saiu para entrega, entregue.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          ...QUAL_PEDIDO,
          status: { type: Type.STRING, enum: Object.keys(STATUS_DO_BILL), description: "ACEITO = aceitar; PREPARANDO = em preparo; PRONTO = pronto para retirar (só retirada/balcão); SAIU_ENTREGA = saiu para entrega; ENTREGUE = entregue" },
        },
        required: ["status"],
      },
    },
    {
      name: "cancelar_pedido",
      description: "Cancela um pedido pelo mesmo caminho do painel (avisa a plataforma, o cliente e faz o estorno). Sempre pede confirmação; pedido de app pede o código do motivo da plataforma.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          ...QUAL_PEDIDO,
          motivo: { type: Type.STRING, description: "o motivo com as palavras do dono (vai para o fechamento do caixa)" },
          codigoDoMotivo: { type: Type.STRING, description: "pedido de iFood/99/app: o código escolhido da lista motivosDaPlataforma" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["motivo"],
      },
    },
    {
      name: "atribuir_motoboy",
      description: "Põe (ou tira) o motoboy da loja num pedido de entrega, como o seletor do card: o motoboy recebe no app e no WhatsApp.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          ...QUAL_PEDIDO,
          motoboy: { type: Type.STRING, description: "nome do motoboy" },
          tirar: { type: Type.BOOLEAN, description: "true para deixar o pedido sem motoboy" },
        },
      },
    },
  ],
  gravam: ["mudar_status_do_pedido", "cancelar_pedido", "atribuir_motoboy"],
  regras: [
    "Pedido \"#23\" é o número do dia de operação de hoje; só mande `dia` se o dono disse outra data. Se vierem vários pedidos com o mesmo número, pergunte qual e use o pedidoId.",
    "mudar_status_do_pedido e atribuir_motoboy fazem na hora; cancelar_pedido SEMPRE pergunta antes (número, cliente, valor, canal) e só com o sim vai com confirmado=true.",
    "Cancelar precisa do motivo nas palavras do dono; pedido de iFood/99/app precisa também do código da plataforma: mostre motivosDaPlataforma e pergunte.",
    "Pedido de app: repita o campo `plataforma` como veio. Nunca diga \"cancelado/aceito no iFood\" se ele não disser que o app respondeu ok.",
    "Status e cancelamento não se desfazem pelo Bill (só a troca de motoboy); para reabrir pedido, mande o dono ao painel de pedidos.",
  ].join("\n"),
  tipos: ["PEDIDO_STATUS", "PEDIDO_CANCELADO", "PEDIDO_MOTOBOY"],
  executar: async (nome, args, ctx) => {
    if (nome === "mudar_status_do_pedido") return mudarStatus(args, ctx);
    if (nome === "cancelar_pedido") return cancelarPedido(args, ctx);
    if (nome === "atribuir_motoboy") return atribuirMotoboy(args, ctx);
    return null;
  },
  desfazer,
};
