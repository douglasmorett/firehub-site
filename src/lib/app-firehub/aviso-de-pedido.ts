/**
 * "🔔 Pedido #47 · iFood" no celular da loja, com o app fechado.
 *
 * Quem chama é o gatilho do prisma.ts: pedido nasce (ou deixa de ser rascunho
 * do robô / Pix esperando pagamento) em uma dúzia de lugares — site, robô,
 * iFood, 99, Brendi, Wabiz, Keeta, totem —, então a decisão mora num lugar só,
 * como a da Foody e a do estoque.
 *
 * Regras:
 *  - O pedido tem de ser PEDIDO: rascunho do robô (CRIANDO_IA), Pix esperando
 *    pagamento e cancelado não avisam. Quando o rascunho vira pedido, a
 *    gravação do status chama de novo e aí avisa.
 *  - Venda que a própria loja lançou (balcão, garçom, lanche da equipe) não
 *    avisa: quem lançou está com o pedido na mão. O pedido de mesa feito pelo
 *    CLIENTE (QR da mesa, tablet da mesa) avisa pela rota dele, com
 *    `avisarPedidoDaMesa`.
 *  - Um aviso por pedido, mesmo com dois servidores atrás do balanceador e o
 *    status mudando várias vezes: a marca é uma linha em "LojaAvisoDePedido"
 *    (INSERT … ON CONFLICT DO NOTHING) — só quem a grava manda.
 *  - Pedido com mais de 30 min não avisa (status mexido em pedido velho).
 *  - Loja sem celular com o app não paga nem a consulta da marca: a lista de
 *    lojas com aparelho fica 60 s em memória.
 */
import { prisma } from "@/lib/prisma";
import { avisarLoja, garantirTabelaDeAparelhosDaLoja } from "@/lib/app-firehub/aparelhos";
import { chaveDoCanal, nomeDoCanal } from "@/lib/canal-do-pedido";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";

const IDADE_MAXIMA_MS = 30 * 60 * 1000;
const NAO_E_PEDIDO_AINDA = new Set(["CRIANDO_IA", "AGUARDANDO_PAGAMENTO", ...STATUS_CANCELADOS]);

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

let lojasComAparelho: { ids: Set<string>; em: number } | null = null;

async function lojaTemAparelho(lojaId: string): Promise<boolean> {
  if (!lojasComAparelho || Date.now() - lojasComAparelho.em > 60_000) {
    if (!(await garantirTabelaDeAparelhosDaLoja())) return false;
    const linhas = await prisma.$queryRaw<{ lojaId: string }[]>`SELECT DISTINCT "lojaId" FROM "LojaAparelho"`;
    lojasComAparelho = { ids: new Set(linhas.map((l) => l.lojaId)), em: Date.now() };
  }
  return lojasComAparelho.ids.has(lojaId);
}

/** O celular acabou de ser registrado: a loja passa a contar já, sem esperar o minuto. */
export function lojaGanhouAparelho(lojaId: string): void {
  lojasComAparelho?.ids.add(lojaId);
}

let marcaOk = false;

/** true só para quem gravou a marca do pedido agora: esse manda o aviso. */
async function primeiroAAvisar(pedidoId: string): Promise<boolean> {
  if (!marcaOk) {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "LojaAvisoDePedido" (
      "pedidoId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "LojaAvisoDePedido_pkey" PRIMARY KEY ("pedidoId")
    )`);
    marcaOk = true;
  }
  const gravadas = await prisma.$executeRaw`
    INSERT INTO "LojaAvisoDePedido" ("pedidoId", "createdAt")
    VALUES (${pedidoId}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pedidoId") DO NOTHING
  `;
  return gravadas === 1;
}

/** O texto do aviso. Puro, para o teste. */
export function textoDoAviso(p: {
  dailyOrderNumber?: number | null;
  customerName?: string | null;
  totalAmount?: number | null;
  deliveryType?: string | null;
  agendado?: boolean | null;
  canal: string;
}): { titulo: string; corpo: string } {
  const numero = p.dailyOrderNumber ? `#${p.dailyOrderNumber}` : "";
  const titulo = `🔔 Pedido novo ${numero} · ${p.canal}`.replace(/\s+/g, " ").trim();
  const tipo = String(p.deliveryType || "").toUpperCase();
  const comoSai = tipo === "DELIVERY" ? "Entrega" : tipo === "RETIRADA" || tipo === "PICKUP" || tipo === "TAKEOUT" ? "Retirada" : tipo === "MESA" ? "Mesa" : "";
  const partes = [
    String(p.customerName || "").trim().slice(0, 40),
    p.totalAmount ? brl(p.totalAmount) : "",
    comoSai,
    p.agendado ? "agendado" : "",
  ].filter(Boolean);
  return { titulo, corpo: partes.join(" · ") || "Abra o FireHub para ver." };
}

export async function avisarPedidoNovo(pedidoId: string): Promise<void> {
  try {
    const p = await prisma.customerOrder.findUnique({
      where: { id: pedidoId },
      select: {
        id: true, franchiseeId: true, status: true, source: true, createdAt: true,
        dailyOrderNumber: true, customerName: true, totalAmount: true, deliveryType: true, agendado: true,
        openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true,
      },
    });
    if (!p) return; // transação desfeita
    if (NAO_E_PEDIDO_AINDA.has(String(p.status || "").toUpperCase())) return;
    if (Date.now() - new Date(p.createdAt).getTime() > IDADE_MAXIMA_MS) return;
    if (chaveDoCanal(p as any) === "PDV") return;
    if (!(await lojaTemAparelho(p.franchiseeId))) return;
    if (!(await primeiroAAvisar(p.id))) return;

    const { titulo, corpo } = textoDoAviso({ ...p, canal: nomeDoCanal(p as any) });
    await avisarLoja(p.franchiseeId, { titulo, corpo, dados: { tipo: "pedido", pedidoId: p.id } });
  } catch (err: any) {
    console.warn(`[App FireHub] aviso do pedido ${pedidoId} falhou: ${err?.message}`);
  }
}

/**
 * Pedido de mesa feito pelo CLIENTE (QR da mesa ou tablet da mesa): a loja
 * precisa saber, porque ninguém da equipe lançou. Chamado pela rota, depois
 * de gravar.
 */
export async function avisarPedidoDaMesa(lojaId: string, a: { pedidoId: string; mesa: string | number; totalAmount?: number | null; origem: "QR" | "TABLET" }): Promise<void> {
  try {
    if (!(await lojaTemAparelho(lojaId))) return;
    if (!(await primeiroAAvisar(a.pedidoId))) return;
    await avisarLoja(lojaId, {
      titulo: `🍽️ Mesa ${a.mesa} fez um pedido`,
      corpo: [a.origem === "TABLET" ? "Pelo tablet da mesa" : "Pelo QR da mesa", a.totalAmount ? brl(a.totalAmount) : ""].filter(Boolean).join(" · "),
      dados: { tipo: "pedido", pedidoId: a.pedidoId },
    });
  } catch (err: any) {
    console.warn(`[App FireHub] aviso da mesa ${a.mesa} falhou: ${err?.message}`);
  }
}

/** "Mesa 5 chamou o garçom" / "Mesa 5 pediu a conta" — do tablet da mesa. */
export async function avisarChamadoDaMesa(lojaId: string, mesa: string | number, motivo: "GARCOM" | "CONTA"): Promise<void> {
  try {
    if (!(await lojaTemAparelho(lojaId))) return;
    await avisarLoja(lojaId, {
      titulo: motivo === "CONTA" ? `🧾 Mesa ${mesa} pediu a conta` : `🙋 Mesa ${mesa} chamou o garçom`,
      corpo: "Pelo tablet da mesa",
      dados: { tipo: "chamado", mesa: String(mesa), motivo },
    });
  } catch (err: any) {
    console.warn(`[App FireHub] chamado da mesa ${mesa} falhou: ${err?.message}`);
  }
}
