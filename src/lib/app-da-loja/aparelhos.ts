/**
 * O celular do CLIENTE com o app próprio da loja instalado (apps/loja), e o
 * aviso que chega nele com o app fechado: "Seu pedido saiu para entrega".
 *
 * ── O aparelho se liga ao PEDIDO, não ao telefone ───────────────────────────
 *
 * O cliente da página da loja não tem sessão de verdade (o login só guarda o
 * telefone no localStorage), e o pedido é feito sem conta. Ligar o aparelho a
 * um telefone digitado deixaria qualquer um receber, no próprio celular, o
 * status dos pedidos de outra pessoa. O id do pedido, ao contrário, é segredo
 * de quem fez o pedido — é o mesmo que abre a página de acompanhamento
 * (/loja/<slug>/pedido/<id>). O app registra o aparelho em cada pedido feito
 * por ele, e o aviso sai só para os aparelhos daquele pedido.
 *
 * ── A tabela não está no schema.prisma de propósito ─────────────────────────
 *
 * Como MotoboyAparelho (lib/app-motoboy/aparelhos.ts): SQL cru, a tabela se
 * cria na primeira chamada, e se ela faltar o aviso simplesmente não sai — o
 * pedido e o WhatsApp de status nunca dependem disto.
 */
import { prisma } from "@/lib/prisma";
import { tokenDeNotificacaoValido } from "@/lib/app-motoboy/aparelhos";

export { tokenDeNotificacaoValido };

const URL_DO_EXPO = "https://exp.host/--/api/v2/push/send";

let tabelaOk = false;

export async function garantirTabelaDoAppDaLoja(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PedidoAparelho" (
      "pedidoId" TEXT NOT NULL,
      "pushToken" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "plataforma" TEXT,
      "versaoDoApp" TEXT,
      "app" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PedidoAparelho_pkey" PRIMARY KEY ("pedidoId", "pushToken")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "PedidoAparelho_pushToken_idx" ON "PedidoAparelho"("pushToken")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[App da Loja] 🛑 Tabela PedidoAparelho falhou: ${err?.message}`);
    return false;
  }
}

/** Liga o aparelho ao pedido. Devolve false se não deu para gravar. */
export async function registrarAparelhoNoPedido(a: {
  pedidoId: string;
  lojaId: string;
  pushToken: string;
  plataforma?: string | null;
  versaoDoApp?: string | null;
  app?: string | null;
}): Promise<boolean> {
  if (!(await garantirTabelaDoAppDaLoja())) return false;
  const plataforma = String(a.plataforma || "").slice(0, 20) || null;
  const versao = String(a.versaoDoApp || "").slice(0, 40) || null;
  const app = String(a.app || "").slice(0, 120) || null;
  await prisma.$executeRaw`
    INSERT INTO "PedidoAparelho" ("pedidoId", "pushToken", "lojaId", "plataforma", "versaoDoApp", "app", "createdAt")
    VALUES (${a.pedidoId}, ${a.pushToken.trim()}, ${a.lojaId}, ${plataforma}, ${versao}, ${app}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pedidoId", "pushToken") DO NOTHING
  `;
  return true;
}

/** O cliente desligou os avisos no app: o aparelho sai de todos os pedidos. */
export async function esquecerAparelhoDoCliente(pushToken: string): Promise<void> {
  if (!(await garantirTabelaDoAppDaLoja())) return;
  await prisma.$executeRaw`DELETE FROM "PedidoAparelho" WHERE "pushToken" = ${pushToken.trim()}`;
}

export type StatusAvisado = "EM_PREPARO" | "SAIU_ENTREGA" | "PRONTO_RETIRADA" | "ENTREGUE" | "CANCELADO";

/** O texto do aviso. O "pedido recebido" não vira aviso: o cliente acabou de vê-lo na tela. */
export function textoDoAviso(
  tipo: string,
  p: { numero?: number | null; loja?: string | null; entregador?: string | null; motivo?: string | null },
): { titulo: string; corpo: string } | null {
  const n = p.numero ? ` #${p.numero}` : "";
  const loja = (p.loja || "").trim() || "A loja";
  switch (tipo) {
    case "EM_PREPARO":
      return { titulo: `✅ Pedido${n} aceito`, corpo: `${loja} já está preparando o seu pedido.` };
    case "SAIU_ENTREGA":
      return {
        titulo: `🛵 Seu pedido${n} saiu para entrega`,
        corpo: p.entregador ? `${p.entregador} está a caminho.` : "Já está a caminho.",
      };
    case "PRONTO_RETIRADA":
      return { titulo: `🛍️ Pedido${n} pronto`, corpo: `Pode vir buscar na ${loja}.` };
    case "ENTREGUE":
      return { titulo: `😋 Pedido${n} entregue`, corpo: "Bom apetite! Conta pra gente como foi." };
    case "CANCELADO":
      return {
        titulo: `Pedido${n} cancelado`,
        corpo: p.motivo ? `Motivo: ${String(p.motivo).slice(0, 120)}` : `Fale com a ${loja} se tiver dúvida.`,
      };
    default:
      return null;
  }
}

/**
 * Manda o aviso de status aos aparelhos do pedido. NUNCA lança: é chamado de
 * dentro de sendOrderNotification, antes de qualquer regra do WhatsApp —
 * a loja sem WhatsApp conectado também avisa quem pediu pelo app.
 */
export async function avisarAparelhosDoPedido(
  pedido: {
    id: string;
    dailyOrderNumber?: number | null;
    loja?: string | null;
    slug?: string | null;
    entregador?: string | null;
  },
  tipo: string,
  motivo?: string | null,
): Promise<void> {
  try {
    const texto = textoDoAviso(tipo, { numero: pedido.dailyOrderNumber, loja: pedido.loja, entregador: pedido.entregador, motivo });
    if (!texto) return;
    if (!(await garantirTabelaDoAppDaLoja())) return;
    const linhas = await prisma.$queryRaw<{ pushToken: string }[]>`
      SELECT "pushToken" FROM "PedidoAparelho" WHERE "pedidoId" = ${pedido.id}
    `;
    if (linhas.length === 0) return;

    const mensagens = linhas.map((l) => ({
      to: l.pushToken,
      title: texto.titulo,
      body: texto.corpo,
      // O app abre o acompanhamento do pedido ao tocar no aviso.
      data: { tipo: "STATUS_DO_PEDIDO", pedidoId: pedido.id, slug: pedido.slug || null, status: tipo },
      sound: "default",
      priority: "high",
      channelId: "pedidos",
      // "Saiu para entrega" de duas horas atrás só confunde.
      ttl: 60 * 60,
    }));

    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    const res = await fetch(URL_DO_EXPO, {
      method: "POST",
      headers,
      body: JSON.stringify(mensagens),
      signal: AbortSignal.timeout(8000),
    });
    const corpo = await res.json().catch(() => null as any);
    if (!res.ok) {
      console.warn(`[App da Loja] aviso do pedido ${pedido.id} recusado pelo Expo: ${res.status} ${JSON.stringify(corpo).slice(0, 200)}`);
      return;
    }
    const tickets: any[] = Array.isArray(corpo?.data) ? corpo.data : [];
    const mortos = tickets
      .map((t, i) => (t?.status === "error" && t?.details?.error === "DeviceNotRegistered" ? mensagens[i]?.to : null))
      .filter((t): t is string => Boolean(t));
    for (const token of mortos) {
      await prisma.$executeRaw`DELETE FROM "PedidoAparelho" WHERE "pushToken" = ${token}`.catch(() => {});
    }
  } catch (err: any) {
    console.warn(`[App da Loja] aviso do pedido ${pedido.id} falhou: ${err?.message}`);
  }
}
