/**
 * src/lib/acrescimo-no-banco.ts — o pedido de acréscimo que o robô registra e
 * a loja aceita ou recusa pelo pop-up do painel. A regra e os textos moram em
 * lib/acrescimo-do-pedido.ts.
 *
 * ── A tabela `AcrescimoDoPedido` ────────────────────────────────────────────
 *
 * Fora do schema.prisma de propósito, como a CashbackAjuste
 * (lib/cashback-no-banco.ts): SQL cru, o boot cria, e sem a tabela o robô
 * segue com o caminho antigo (chama atendente) em vez de dar 500.
 *
 * Uma linha por pedido de acréscimo: PENDENTE até a loja responder; ACEITO e
 * RECUSADO guardam quem respondeu e o texto; EXPIRADO é o que ninguém respondeu
 * antes de o pedido sair (o cliente é avisado).
 *
 * ── Por que a resposta é atômica ────────────────────────────────────────────
 *
 * O pop-up aparece em todo computador com o painel de pedidos aberto. Dois
 * cliques ao mesmo tempo ("aceitar" no caixa, "recusar" no balcão) não podem
 * virar dois acréscimos nem uma mensagem dizendo as duas coisas: só o UPDATE
 * que ainda encontra a linha PENDENTE ganha.
 */

import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { registerBotReply } from "./loop-guard";
import { sendEvolutionMessage } from "./whatsapp-evolution";
import { registrarMensagemDaLoja } from "./memoria-da-conversa-no-banco";
import { empilharEdicao, type RegistroDeEdicao } from "./edicao-de-pedido";
import { telefoneDeVerdade, paraEnvioWhatsApp } from "./telefone";
import { CANAIS_DA_LOJA, funilDoCliente, pedidoEhDoCliente } from "./pedido-do-cliente";
import {
  itensEmTexto,
  mensagemDaResposta,
  situacaoDoPedido,
  valorDosItens,
  type ItemDoAcrescimo,
} from "./acrescimo-do-pedido";

// ── A tabela ────────────────────────────────────────────────────────────────

let tabelaOk = false;

export async function garantirTabelaDeAcrescimos(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(String(process.env.DATABASE_URL || ""))) return false;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AcrescimoDoPedido" (
        "id" TEXT PRIMARY KEY,
        "franchiseeId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "numero" TEXT,
        "remoteJid" TEXT,
        "telefone" TEXT,
        "itens" JSONB NOT NULL,
        "valor" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'PENDENTE',
        "resposta" TEXT,
        "respondidoPor" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        "respondidoEm" TIMESTAMP(3)
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AcrescimoDoPedido_loja_status" ON "AcrescimoDoPedido" ("franchiseeId", "status")`
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Acréscimo] não consegui criar a tabela: ${err?.message}`);
    return false;
  }
}

type Linha = {
  id: string;
  franchiseeId: string;
  orderId: string;
  numero: string | null;
  remoteJid: string | null;
  telefone: string | null;
  itens: ItemDoAcrescimo[];
  valor: number;
  status: string;
  resposta: string | null;
  createdAt: Date;
};

// ── O pedido de hoje deste cliente ──────────────────────────────────────────

/** Quanto tempo para trás o robô procura o pedido do cliente: o turno de hoje. */
const JANELA_DO_PEDIDO_ATIVO_MS = 12 * 60 * 60 * 1000;

const STATUS_FORA = ["CRIANDO_IA", "ENTREGUE", "CANCELADO", "CANCELED", "RECUSADO", "REJEITADO", "ENCERRADO", "CONCLUIDO", "FINALIZADO", "AGUARDANDO_PAGAMENTO"];

/**
 * O pedido mais recente DESTE CLIENTE nesta loja, ainda não entregue, feito
 * pelo robô, pelo site ou no balcão (os canais da loja; o de iFood/99 não se
 * altera daqui) nas últimas 12 h — com o acréscimo que estiver esperando a loja.
 *
 * Quem decide se o pedido é do cliente é `pedidoEhDoCliente`
 * (lib/pedido-do-cliente.ts): mesmo telefone, ou telefone com um dígito errado
 * e o mesmo primeiro nome — o cliente que digitou o número errado no site
 * também é reconhecido. `nomes` = o nome do WhatsApp e o do cadastro.
 */
export async function pedidoAtivoDoTelefone(
  franchiseeId: string,
  telefone: string,
  nomes: Array<string | null | undefined> = []
) {
  const { final4, primeirosNomes } = funilDoCliente({ telefone, nomes });
  if (!final4) return null;
  const desde = new Date(Date.now() - JANELA_DO_PEDIDO_ATIVO_MS);
  // Funil no banco: o telefone fica gravado com máscara (a comparação é só
  // pelos dígitos, o mesmo cuidado de lib/cashback-no-banco.ts), e o nome sem
  // acento. Quem decide é `pedidoEhDoCliente`, logo abaixo.
  const nomesLike = primeirosNomes.map((n) => n + "%");
  const candidatos = await prisma.$queryRaw<{ id: string; customerPhone: string | null; customerName: string | null }[]>`
    SELECT "id", "customerPhone", "customerName" FROM "CustomerOrder"
    WHERE "franchiseeId" = ${franchiseeId}
      AND "createdAt" >= ${desde}
      AND (
        regexp_replace(COALESCE("customerPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final4}
        OR lower(translate(COALESCE("customerName", ''),
             'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
             'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')) LIKE ANY (${nomesLike}::text[])
      )
    ORDER BY "createdAt" DESC
    LIMIT 30`;
  const comoReconheceu = new Map<string, "telefone" | "parecido">();
  for (const c of candidatos) {
    const como = pedidoEhDoCliente(c, { telefone, nomes });
    if (como) comoReconheceu.set(c.id, como);
  }
  if (!comoReconheceu.size) return null;
  const pedidos = await prisma.customerOrder.findMany({
    where: {
      id: { in: Array.from(comoReconheceu.keys()) },
      status: { notIn: STATUS_FORA },
      source: { in: CANAIS_DA_LOJA },
      ifoodOrderId: null,
      openDeliveryOrderId: null,
      tableSessionId: null,
    },
    orderBy: { createdAt: "desc" },
    take: 1,
    include: { items: { select: { productName: true, quantity: true, comboSelections: true } } },
  });
  const pedido = pedidos[0];
  if (!pedido) return null;
  const pendente = await acrescimoPendenteDoPedido(pedido.id);
  return { pedido, pendente, comoReconheceu: comoReconheceu.get(pedido.id)! };
}

async function acrescimoPendenteDoPedido(orderId: string): Promise<Linha | null> {
  if (!(await garantirTabelaDeAcrescimos())) return null;
  const linhas = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "AcrescimoDoPedido" WHERE "orderId" = ${orderId} AND "status" = 'PENDENTE'
    ORDER BY "createdAt" DESC LIMIT 1`;
  return linhas[0] || null;
}

// ── O robô registra ─────────────────────────────────────────────────────────

export type ResultadoDoRegistro =
  | { ok: true; repetido: boolean; numero: string | number | null }
  | { ok: false; motivo: string; situacao?: string };

/**
 * Registra o pedido de acréscimo que o robô combinou com o cliente. O pedido
 * alvo é conferido aqui (deste telefone, desta loja, na cozinha): o número
 * vem do modelo e não pode apontar o pedido do vizinho.
 */
export async function registrarAcrescimo(o: {
  franchiseeId: string;
  telefone: string;
  remoteJid?: string | null;
  numeroDoPedido: unknown;
  itens: ItemDoAcrescimo[];
  /** O nome do WhatsApp e o do cadastro: os mesmos com que o robô achou o pedido. */
  nomes?: Array<string | null | undefined>;
}): Promise<ResultadoDoRegistro> {
  if (!o.itens.length) return { ok: false, motivo: "nenhum item do acréscimo existe no cardápio" };
  if (!(await garantirTabelaDeAcrescimos())) return { ok: false, motivo: "tabela de acréscimos indisponível" };

  const ativo = await pedidoAtivoDoTelefone(o.franchiseeId, o.telefone, o.nomes || []);
  if (!ativo) return { ok: false, motivo: "o cliente não tem pedido em andamento hoje" };
  const { pedido, pendente } = ativo;
  const numeroPedido = String(o.numeroDoPedido ?? "").replace(/\D/g, "");
  const numeroGravado = String(pedido.dailyOrderNumber ?? "").replace(/\D/g, "");
  if (numeroPedido && numeroGravado && numeroPedido !== numeroGravado) {
    return { ok: false, motivo: `o pedido nº ${numeroPedido} não é o pedido em andamento deste cliente (nº ${numeroGravado})` };
  }

  const situacao = situacaoDoPedido(pedido.status);
  if (situacao === "SAIU" || situacao === "ENCERRADO") {
    return { ok: false, motivo: "o pedido já saiu para entrega", situacao };
  }

  // O modelo repete a tag (no "obrigado", no "e aí?"): o mesmo acréscimo
  // esperando a loja não vira dois pop-ups.
  if (pendente && itensEmTexto(pendente.itens) === itensEmTexto(o.itens)) {
    return { ok: true, repetido: true, numero: pedido.dailyOrderNumber ?? null };
  }

  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "AcrescimoDoPedido" ("id","franchiseeId","orderId","numero","remoteJid","telefone","itens","valor","status")
    VALUES (${id}, ${o.franchiseeId}, ${pedido.id}, ${pedido.dailyOrderNumber != null ? String(pedido.dailyOrderNumber) : null},
            ${o.remoteJid || null}, ${String(o.telefone).replace(/\D/g, "")}, ${JSON.stringify(o.itens)}::jsonb,
            ${valorDosItens(o.itens)}, 'PENDENTE')`;
  console.log(`[Acréscimo] ➕ Pedido nº ${pedido.dailyOrderNumber ?? "—"} (${pedido.id}): cliente pede ${itensEmTexto(o.itens)} · loja ${o.franchiseeId}`);
  return { ok: true, repetido: false, numero: pedido.dailyOrderNumber ?? null };
}

// ── A loja vê e responde ────────────────────────────────────────────────────

export type AcrescimoParaATela = {
  id: string;
  orderId: string;
  numero: string | null;
  cliente: string | null;
  statusDoPedido: string;
  itens: ItemDoAcrescimo[];
  itensEmTexto: string;
  valor: number;
  totalAtual: number;
  novoTotal: number;
  criadoEm: string;
};

/**
 * Os acréscimos esperando resposta. O que ficou para trás porque o pedido saiu
 * (ou foi cancelado) antes de alguém responder vira EXPIRADO aqui, e o cliente
 * fica sabendo — não fica esperando uma resposta que não vem.
 */
export async function acrescimosPendentes(lojaIds: string[]): Promise<AcrescimoParaATela[]> {
  if (!lojaIds.length || !(await garantirTabelaDeAcrescimos())) return [];
  const linhas = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "AcrescimoDoPedido"
    WHERE "franchiseeId" = ANY(${lojaIds}) AND "status" = 'PENDENTE'
    ORDER BY "createdAt" ASC LIMIT 20`;
  if (!linhas.length) return [];
  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: linhas.map((l) => l.orderId) } },
    select: { id: true, status: true, customerName: true, totalAmount: true, dailyOrderNumber: true },
  });
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  const lista: AcrescimoParaATela[] = [];
  for (const l of linhas) {
    const p = porId.get(l.orderId);
    const situacao = p ? situacaoDoPedido(p.status) : "ENCERRADO";
    if (situacao === "SAIU" || situacao === "ENCERRADO") {
      await expirar(l, p?.status || null);
      continue;
    }
    const totalAtual = Number(p!.totalAmount) || 0;
    lista.push({
      id: l.id,
      orderId: l.orderId,
      numero: l.numero ?? (p!.dailyOrderNumber != null ? String(p!.dailyOrderNumber) : null),
      cliente: p!.customerName,
      statusDoPedido: p!.status,
      itens: l.itens,
      itensEmTexto: itensEmTexto(l.itens),
      valor: Number(l.valor) || 0,
      totalAtual,
      novoTotal: Math.round((totalAtual + (Number(l.valor) || 0)) * 100) / 100,
      criadoEm: new Date(l.createdAt).toISOString(),
    });
  }
  return lista;
}

async function marcar(id: string, status: string, resposta: string | null, quem: string | null): Promise<Linha | null> {
  const linhas = await prisma.$queryRaw<Linha[]>`
    UPDATE "AcrescimoDoPedido"
    SET "status" = ${status}, "resposta" = ${resposta}, "respondidoPor" = ${quem}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" = ${id} AND "status" = 'PENDENTE'
    RETURNING *`;
  return linhas[0] || null;
}

async function expirar(l: Linha, statusDoPedido: string | null) {
  const marcada = await marcar(l.id, "EXPIRADO", null, "sistema").catch(() => null);
  if (!marcada) return;
  const saiu = situacaoDoPedido(statusDoPedido) === "SAIU";
  await avisarCliente(
    l,
    saiu
      ? `😕 Seu pedido nº ${l.numero ?? "—"} já saiu para entrega antes de a cozinha conseguir incluir ${itensEmTexto(l.itens)}. Se quiser, posso fazer um pedido separado para você.`
      : `😕 Não deu para incluir ${itensEmTexto(l.itens)} no seu pedido nº ${l.numero ?? "—"}. Se quiser, posso fazer um pedido separado para você.`
  );
}

/**
 * A mensagem ao cliente sai como resposta DO ROBÔ: registrada antes de enviar
 * (senão o eco do WhatsApp é lido como "um humano assumiu" e o robô se cala),
 * e guardada no histórico da conversa — o mesmo que o webhook faz.
 */
async function avisarCliente(l: Linha, texto: string): Promise<boolean> {
  const telefone = telefoneDeVerdade(l.telefone || "") ? paraEnvioWhatsApp(l.telefone || "") : null;
  const destino = l.remoteJid || telefone;
  if (!destino) return false;
  try {
    if (l.remoteJid) await registerBotReply(l.franchiseeId, l.remoteJid, texto);
    let enviou = await sendEvolutionMessage(l.franchiseeId, destino, texto);
    if (!enviou && telefone && destino !== telefone) enviou = await sendEvolutionMessage(l.franchiseeId, telefone, texto);
    if (enviou && l.remoteJid) void registrarMensagemDaLoja(l.franchiseeId, l.remoteJid, texto, "robo");
    if (!enviou) console.error(`[Acréscimo] o WhatsApp recusou o aviso ao cliente (acréscimo ${l.id}).`);
    return enviou;
  } catch (err: any) {
    console.error(`[Acréscimo] falha ao avisar o cliente (acréscimo ${l.id}): ${err?.message}`);
    return false;
  }
}

export type ResultadoDaResposta =
  | { ok: true; avisouCliente: boolean; novoTotal?: number }
  | { ok: false; erro: string; status?: number };

/**
 * A loja responde. Aceitar põe os itens no pedido (total, histórico, KDS e um
 * papel na cozinha SÓ com o acréscimo); recusar só avisa o cliente, com o texto
 * que a loja escreveu.
 */
export async function responderAcrescimo(o: {
  id: string;
  lojaIds: string[];
  aceitar: boolean;
  texto?: string | null;
  quem: string;
}): Promise<ResultadoDaResposta> {
  if (!(await garantirTabelaDeAcrescimos())) return { ok: false, erro: "tabela de acréscimos indisponível", status: 503 };
  const achadas = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "AcrescimoDoPedido" WHERE "id" = ${o.id} AND "franchiseeId" = ANY(${o.lojaIds}) LIMIT 1`;
  const linha = achadas[0];
  if (!linha) return { ok: false, erro: "Pedido de acréscimo não encontrado.", status: 404 };
  if (linha.status !== "PENDENTE") return { ok: false, erro: "Este acréscimo já foi respondido.", status: 409 };
  const texto = String(o.texto || "").trim().slice(0, 500) || null;

  if (!o.aceitar) {
    const marcada = await marcar(linha.id, "RECUSADO", texto, o.quem);
    if (!marcada) return { ok: false, erro: "Este acréscimo já foi respondido.", status: 409 };
    const avisou = await avisarCliente(marcada, mensagemDaResposta({ aceito: false, numero: marcada.numero, itens: marcada.itens, textoDaLoja: texto }));
    return { ok: true, avisouCliente: avisou };
  }

  const pedido = await prisma.customerOrder.findUnique({
    where: { id: linha.orderId },
    select: { id: true, status: true, totalAmount: true, editHistory: true, kdsStage: true, dailyOrderNumber: true },
  });
  if (!pedido) return { ok: false, erro: "O pedido não existe mais.", status: 404 };
  const situacao = situacaoDoPedido(pedido.status);
  if (situacao === "SAIU" || situacao === "ENCERRADO") {
    await expirar(linha, pedido.status);
    return { ok: false, erro: "O pedido já saiu ou foi encerrado: o cliente foi avisado de que não deu para incluir.", status: 409 };
  }

  // Ganhar a corrida ANTES de mexer no pedido: quem chegou depois não acrescenta.
  const marcada = await marcar(linha.id, "ACEITO", texto, o.quem);
  if (!marcada) return { ok: false, erro: "Este acréscimo já foi respondido.", status: 409 };

  const itens = marcada.itens;
  const valor = valorDosItens(itens);
  const totalAntes = Number(pedido.totalAmount) || 0;
  const novoTotal = Math.round((totalAntes + valor) * 100) / 100;
  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: o.quem,
    acao: "ACRESCENTOU",
    descricao: `Pedido do cliente pelo WhatsApp: ${itens.map((i) => `+${i.quantity}x ${i.productName}`).join(", ")}`,
    totalAntes,
    totalDepois: novoTotal,
  };

  // O pedido que a cozinha já tinha dado por pronto volta a ter o que fazer:
  // o KDS mostra na produção só os itens sem "pronto" (os novos), e o painel
  // não deixa o motoboy levar um pedido "Pronto" que ainda espera o acréscimo.
  const estagio = String(pedido.kdsStage || "").toUpperCase();
  const reabrirKds = estagio === "FINISHED";
  const voltarParaPreparo = String(pedido.status).toUpperCase() === "PRONTO";

  const criados: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const i of itens) {
      const novo = await tx.customerOrderItem.create({
        data: {
          orderId: pedido.id,
          productName: i.productName,
          quantity: Math.max(1, Number(i.quantity) || 1),
          price: Number(i.price) || 0,
          ...(i.notes ? { notes: i.notes } : {}),
          ...(i.comboSelections ? { comboSelections: i.comboSelections as any } : {}),
          ...(i.menuProductId ? { menuProductId: i.menuProductId } : {}),
        },
        select: { id: true },
      });
      criados.push(novo.id);
    }
    await tx.customerOrder.update({
      where: { id: pedido.id },
      data: {
        totalAmount: novoTotal,
        editHistory: empilharEdicao(pedido.editHistory, registro) as any,
        ...(reabrirKds ? { kdsStage: "FINISHING", kdsFinishedAt: null, readyAt: null, kdsTelasProntas: [] as any } : {}),
        ...(voltarParaPreparo ? { status: "PREPARANDO", readyAt: null } : {}),
      },
    });
  });

  await imprimirAcrescimo(marcada.franchiseeId, pedido.id, criados, marcada.numero, o.quem).catch((err) =>
    console.error(`[Acréscimo] não consegui mandar o acréscimo para a impressora: ${err?.message}`)
  );

  const avisou = await avisarCliente(
    marcada,
    mensagemDaResposta({ aceito: true, numero: marcada.numero, itens, novoTotal, textoDaLoja: texto })
  );
  console.log(`[Acréscimo] ✅ Aceito no pedido nº ${marcada.numero ?? "—"} (${pedido.id}) por ${o.quem}: +R$ ${valor.toFixed(2)}, total R$ ${novoTotal.toFixed(2)}.`);
  return { ok: true, avisouCliente: avisou, novoTotal };
}

/**
 * Um papel só com o acréscimo, pela mesma fila da reimpressão
 * (print-queue, kind REIMPRESSAO): roteado pela categoria de cada item para a
 * impressora certa, com a marca de ACRÉSCIMO no lugar da observação.
 */
async function imprimirAcrescimo(lojaId: string, orderId: string, itemIds: string[], numero: string | null, quem: string) {
  if (!itemIds.length) return;
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      items: {
        where: { id: { in: itemIds } },
        include: { menuProduct: { select: { name: true, category: true, isBeverage: true } } },
      },
    },
  });
  if (!pedido) return;
  const payload = JSON.parse(JSON.stringify({
    ...pedido,
    notes: `➕ ACRÉSCIMO DO PEDIDO Nº ${numero ?? pedido.dailyOrderNumber ?? "—"} (pedido pelo cliente no WhatsApp). Juntar ao pedido que já está na cozinha.`,
    acrescimo: true,
  }));
  await prisma.printRequest.create({
    data: { franchiseeId: lojaId, kind: "REIMPRESSAO", payload, requestedBy: `acréscimo · ${quem}` },
  });
}
