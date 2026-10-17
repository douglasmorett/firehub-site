/**
 * O motoboy no mapa do cliente, e o "seu pedido está chegando".
 *
 * ── De onde vem a posição ───────────────────────────────────────────────────
 *
 * O app do entregador já manda o GPS a cada ~12 s para /api/motoboys/location
 * (Motoboy.lastLat/lastLng). Nada novo é coletado: a página de acompanhamento
 * do pedido passa a MOSTRAR essa posição ao cliente daquele pedido — e só
 * enquanto ele está na rua com o entregador dele.
 *
 * ── Quem vê ────────────────────────────────────────────────────────────────
 *
 * Quem tem o link do pedido (/loja/<slug>/pedido/<id>): o id é o segredo de
 * quem pediu, o mesmo que liga o app da loja ao pedido
 * (lib/app-da-loja/aparelhos.ts). Fora do "saiu para entrega", sem entregador
 * atribuído, ou com o GPS parado há mais de POSICAO_VALE_MS, não sai posição
 * nenhuma — nem a última conhecida: posição velha de entregador é a casa dele.
 *
 * ── O aviso de chegando ────────────────────────────────────────────────────
 *
 * A cada posição recebida, os pedidos na rua com ESSE entregador são medidos
 * contra o ponto do cliente. Quando faltam uns MINUTOS_DE_CHEGANDO (5) sai o
 * aviso (push do app da loja + WhatsApp da loja) — o Douglas (16/10/2026): "o
 * cliente já sai para fora para receber". Uma vez por pedido: a tabela PedidoChegando
 * (SQL cru, como PedidoAparelho) é a trava — o INSERT que entra é o que avisa,
 * então dois GPS seguidos ou dois servidores não mandam duas vezes. Ponto de
 * centro de bairro não conta: a 500 m da praça não é "chegando".
 */
import { prisma } from "@/lib/prisma";
import { pontoNoMapa } from "@/lib/app-motoboy/pedido-no-app";

/** GPS mais velho que isto não vai para o cliente (o app manda a cada ~12 s). */
export const POSICAO_VALE_MS = 3 * 60 * 1000;
/** "Seu pedido está chegando" sai quando a estimativa cai para isto. */
export const MINUTOS_DE_CHEGANDO = 5;
/** Recém-saído não ganha "chegando" no mesmo minuto do "saiu para entrega". */
const SAIU_HA_POUCO_MS = 60 * 1000;

/**
 * Minutos de moto até o cliente, pela linha reta: rua não é reta (×1,4) e moto
 * na cidade anda uns 22 km/h contando sinal e quebra-molas. É estimativa para
 * o aviso e para o "chega em ~X min" do mapa, não promessa — nunca menos de 1.
 */
export function minutosAte(kmEmLinhaReta: number): number {
  return Math.max(1, Math.round(((kmEmLinhaReta * 1.4) / 22) * 60));
}

const NA_RUA = ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA"];

export function kmEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export type EntregaAoVivo = {
  entregador: { nome: string | null; lat: number; lng: number; atualizadoEm: string } | null;
  destino: { lat: number; lng: number; aproximado: boolean } | null;
  distanciaKm: number | null;
  /** Estimativa de minutos até o cliente (minutosAte). */
  minutos: number | null;
};

/** O que a página do pedido mostra no mapa. Nulo = não há mapa a mostrar. */
export function entregaAoVivo(pedido: {
  status: string;
  deliveryType: string | null;
  customerLatLng: unknown;
  motoboy: { name: string | null; lastLat: number | null; lastLng: number | null; lastLocationUpdate: Date | null } | null;
}): EntregaAoVivo | null {
  if (!NA_RUA.includes(String(pedido.status || "").toUpperCase())) return null;
  if (String(pedido.deliveryType || "").toUpperCase() !== "DELIVERY") return null;
  const m = pedido.motoboy;
  const fresca =
    m && m.lastLat != null && m.lastLng != null && m.lastLocationUpdate &&
    Date.now() - m.lastLocationUpdate.getTime() <= POSICAO_VALE_MS;
  const entregador = fresca
    ? {
        // Só o primeiro nome: é o que o cliente precisa para reconhecer quem chega.
        nome: String(m!.name || "").trim().split(/\s+/)[0] || null,
        lat: m!.lastLat!,
        lng: m!.lastLng!,
        atualizadoEm: m!.lastLocationUpdate!.toISOString(),
      }
    : null;
  const destino = pontoNoMapa(pedido.customerLatLng);
  if (!entregador && !destino) return null;
  const distanciaKm = entregador && destino && !destino.aproximado ? kmEntre(entregador, destino) : null;
  return { entregador, destino, distanciaKm, minutos: distanciaKm == null ? null : minutosAte(distanciaKm) };
}

let tabelaOk = false;
async function garantirTabela(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PedidoChegando" (
      "pedidoId" TEXT NOT NULL PRIMARY KEY,
      "distanciaM" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL
    )`);
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Entrega ao vivo] 🛑 Tabela PedidoChegando falhou: ${err?.message}`);
    return false;
  }
}

/**
 * Chamado a cada posição do entregador. NUNCA lança e não atrasa a resposta
 * ao app (quem chama não espera): o GPS gravado é o que importa ali.
 */
export async function avisarSeEstaChegando(motoboyId: string, lat: number, lng: number): Promise<void> {
  try {
    const pedidos = await prisma.customerOrder.findMany({
      where: {
        motoboyId,
        status: { in: NA_RUA },
        deliveryType: "DELIVERY",
        // Pedido esquecido "na rua" desde ontem não avisa ninguém.
        updatedAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) },
      },
      select: { id: true, customerLatLng: true, dispatchedAt: true, motoboyPuxadoEm: true },
      take: 10,
    });
    if (pedidos.length === 0) return;

    for (const p of pedidos) {
      const destino = pontoNoMapa(p.customerLatLng);
      if (!destino || destino.aproximado) continue;
      const saiuEm = p.dispatchedAt ?? p.motoboyPuxadoEm;
      if (saiuEm && Date.now() - saiuEm.getTime() < SAIU_HA_POUCO_MS) continue;
      const km = kmEntre({ lat, lng }, destino);
      const minutos = minutosAte(km);
      if (minutos > MINUTOS_DE_CHEGANDO) continue;
      if (!(await garantirTabela())) return;
      const entrou = await prisma.$executeRaw`
        INSERT INTO "PedidoChegando" ("pedidoId", "distanciaM", "createdAt")
        VALUES (${p.id}, ${Math.round(km * 1000)}, (now() AT TIME ZONE 'UTC'))
        ON CONFLICT ("pedidoId") DO NOTHING
      `;
      if (entrou !== 1) continue;
      const { sendOrderNotification } = await import("@/lib/order-notifications");
      await sendOrderNotification(p.id, "CHEGANDO", { minutos });
    }
  } catch (err: any) {
    console.warn(`[Entrega ao vivo] conferência de chegada do entregador ${motoboyId} falhou: ${err?.message}`);
  }
}
