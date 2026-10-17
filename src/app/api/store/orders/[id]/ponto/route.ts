/**
 * POST /api/store/orders/[id]/ponto — a loja POSICIONA o pedido no mapa.
 *
 *   corpo:    { lat, lng }
 *   resposta: { ok, ponto, aprendido, distanciaKm, foraDaArea }
 *
 * Grava `customerLatLng = { lat, lng, origem: "manual" }` — a fonte mais forte
 * (lib/ponto-do-pedido.ts): a roteirização desenha ali, o app do motoboy navega
 * até ali (lib/app-motoboy/pedido-no-app.ts, `pontoExato`) e o cron mede dali.
 * E ensina o endereço (lib/ponto-aprendido.ts): o próximo pedido com o mesmo
 * endereço nesta loja já nasce no lugar certo, sem ninguém arrastar de novo.
 *
 * ── Por que existe (NIK Esfihas, 16/10/2026) ───────────────────────────────
 *
 * Endereço de Brasília com CEP que os Correios não conhecem não tem
 * geocodificação que resolva; o pedido aparecia na Asa Sul, a 20 km, e o
 * operador não tinha como dizer onde era. Agora o pedido sem ponto confiável
 * fica na lista "localização incerta" e quem conhece a rua clica no mapa.
 *
 * ── A distância ────────────────────────────────────────────────────────────
 *
 * `deliveryDistance` é dinheiro do motoboy (faixa de km). Ela é refeita a
 * partir do ponto novo quando o pedido não tinha distância ou é de até 12 h
 * atrás — o km medido do ponto errado pagaria a faixa errada. Pedido mais
 * velho fica com a distância que tinha: o acerto dele pode já ter sido pago.
 * O repasse gravado (`motoboyFee`) não muda aqui.
 *
 * Quem pode: o dono e o funcionário que abre a roteirização (caixinhas
 * "Motoboys" ou "Pedidos"), nas lojas que a sessão vê.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { aprenderPonto } from "@/lib/ponto-aprendido";
import { areaDaLoja, distanciaKm, pontoPlausivel, RAIO_MAXIMO_KM } from "@/lib/ponto-do-pedido";
import { distanciaDaEntregaKm, lerPonto } from "@/lib/distancia-da-entrega";
import { canalDoPedido } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

const RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA", "PRESENCIAL", "IN_STORE"];
/** Até quando a distância acompanha o ponto novo (ver o topo do arquivo). */
const REFAZ_DISTANCIA_ATE_HORAS = 12;

function podeUsarARoteirizacao(op: { role?: string | null; permissions?: string | null }): boolean {
  const papel = String(op.role || "").toUpperCase();
  if (papel === "ADMIN" || papel === "FRANCHISEE") return true;
  const caixinhas = String(op.permissions || "").split(",").map((p) => p.trim());
  return caixinhas.includes("motoboys") || caixinhas.includes("orders");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (!podeUsarARoteirizacao(operador)) {
    return NextResponse.json({ error: "Seu usuário não tem acesso à roteirização." }, { status: 403 });
  }

  const corpo = await req.json().catch(() => ({} as any));
  const lat = Number(corpo?.lat);
  const lng = Number(corpo?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return NextResponse.json({ error: "Ponto inválido." }, { status: 400 });
  }
  // ~11 cm: mais casas que isso é ruído do clique.
  const ponto = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };

  const cookieStore = await cookies();
  const { lojaIds } = await lojasDaVisao(operador, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({
    lojaIds: [operador.ownerId || operador.id],
  }));
  const { id } = await params;
  const pedido = await prisma.customerOrder.findFirst({
    where: { id, franchiseeId: { in: lojaIds } },
    select: {
      id: true, franchiseeId: true, customerAddress: true, deliveryType: true, deliveryDistance: true, createdAt: true,
      source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true,
    },
  });
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (RETIRADA.includes(String(pedido.deliveryType || "").trim().toUpperCase())) {
    return NextResponse.json({ error: "Este pedido não é de entrega." }, { status: 400 });
  }

  const loja = await prisma.user.findUnique({
    where: { id: pedido.franchiseeId },
    select: { storeLatLng: true, deliveryZoneType: true, deliveryZones: true, deliveryConfig: true },
  });
  const centro = lerPonto(loja?.storeLatLng);
  if (centro) {
    const km = distanciaKm(centro, ponto);
    if (km > RAIO_MAXIMO_KM) {
      return NextResponse.json(
        { error: `Esse ponto fica a ${Math.round(km)} km da loja. Confira se clicou no lugar certo do mapa.` },
        { status: 400 },
      );
    }
  }
  const area = centro ? areaDaLoja(loja, centro) : null;
  const ehMarketplace = canalDoPedido(pedido).ehMarketplace;

  // A distância acompanha o ponto novo no pedido recente (ver o topo).
  const idadeH = (Date.now() - new Date(pedido.createdAt).getTime()) / 3_600_000;
  const refazDistancia = pedido.deliveryDistance == null || idadeH <= REFAZ_DISTANCIA_ATE_HORAS;
  const distancia = refazDistancia
    ? await distanciaDaEntregaKm(pedido.franchiseeId, ponto, { estimarSeORoteadorCair: true }).catch(() => null)
    : pedido.deliveryDistance;

  await prisma.customerOrder.update({
    where: { id: pedido.id },
    data: {
      customerLatLng: { ...ponto, origem: "manual" },
      // Sem medida agora (roteador fora): nulo, e o cron mede do ponto novo.
      ...(refazDistancia ? { deliveryDistance: distancia } : {}),
    },
  });

  const aprendidas = pedido.customerAddress
    ? await aprenderPonto({
        franchiseeId: pedido.franchiseeId,
        endereco: pedido.customerAddress,
        ponto,
        pedidoId: pedido.id,
        autor: operador.email,
      }).catch(() => 0)
    : 0;

  return NextResponse.json({
    ok: true,
    ponto,
    aprendido: aprendidas > 0,
    distanciaKm: distancia ?? null,
    // Ponto do operador fora da área cadastrada: vale (ele conhece a rua), só avisa.
    foraDaArea: area ? !pontoPlausivel(ponto, area, ehMarketplace) : false,
  });
}
