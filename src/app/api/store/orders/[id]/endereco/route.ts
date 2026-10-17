/**
 * PATCH /api/store/orders/[id]/endereco — a loja CORRIGE o endereço de um
 * pedido já feito.
 *
 *   corpo:    { endereco }
 *   resposta: { ok, semMudanca?, customerAddress, achouNoMapa, distanciaKm, distanciaRefeita }
 *
 * A regra (quem pode, quais pedidos) é lib/correcao-de-endereco.ts — a mesma
 * que decide se o botão aparece. Nasceu do Flavio (Showrrascão, 17/10/2026):
 * o cliente errou o endereço e a loja não tinha onde acertar — nem no pedido,
 * nem na ficha (que só muda o endereço dos PRÓXIMOS pedidos).
 *
 * ── O ponto e a distância ───────────────────────────────────────────────────
 *
 * O ponto gravado (`customerLatLng`) era do endereço errado: a roteirização
 * desenharia o pedido lá e o app do motoboy navegaria para lá. Ele é apagado
 * junto com o texto, e o endereço novo é procurado no mapa na hora, com a
 * mesma resolução do cron de distância (lib/geocodificacao-servidor.ts: a
 * posição que a loja ensinou primeiro, nada fora da área). Se o mapa não
 * achar a tempo, o pedido fica sem ponto e sem distância — e o cron
 * (api/cron/distancia-pendente) tenta de novo, como em pedido novo sem ponto.
 *
 * A distância (dinheiro do motoboy) segue a régua do "Posicionar no mapa":
 * refeita só no pedido de até 12 h ou sem distância; o acerto do pedido mais
 * velho pode já ter sido pago. A TAXA não muda — tem botão próprio.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { empilharEdicao, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import {
  enderecoParaGravar,
  mesmoEndereco,
  motivoParaNaoCorrigir,
  problemaDoEndereco,
  refazADistancia,
} from "@/lib/correcao-de-endereco";
import { geocodificarNoServidor } from "@/lib/geocodificacao-servidor";
import { geocodificacaoAchou, origemDaGeocodificacao } from "@/lib/entrega-do-pedido";
import { distanciaDaEntregaKm, lerPonto } from "@/lib/distancia-da-entrega";
import { areaDaLoja } from "@/lib/ponto-do-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";

export const dynamic = "force-dynamic";

/** Quanto a tela espera o mapa. Depois disso o cron termina o serviço. */
const ESPERA_DO_MAPA_MS = 8_000;

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, deliveryType: true, tableSessionId: true,
  totalAmount: true, deliveryDistance: true, createdAt: true, customerAddress: true, editHistory: true,
  // O que decide canal (marketplace) e se o dinheiro já entrou — o que `avaliarEdicao` lê.
  paymentMethod: true, gatewayPaymentId: true, paymentMethods: true, paymentPaidAt: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
  fiscalStatus: true, fiscalInfo: true,
} as const;

function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const operador = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
    });
    if (!operador) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const corpo = await req.json().catch(() => ({} as any));
    const endereco = enderecoParaGravar(corpo?.endereco);
    const problema = problemaDoEndereco(endereco);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });

    const cookieStore = await cookies();
    const { lojaIds } = await lojasDaVisao(operador, cookieStore.get(COOKIE_DA_LOJA_ATIVA)?.value).catch(() => ({
      lojaIds: [operador.ownerId || operador.id],
    }));
    const { id } = await params;
    const pedido = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: { in: lojaIds } }, select: CAMPOS });
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });

    const naoPode = motivoParaNaoCorrigir(pedido, operador);
    if (naoPode) return NextResponse.json({ error: naoPode }, { status: 403 });

    if (mesmoEndereco(endereco, pedido.customerAddress)) {
      return NextResponse.json({ ok: true, semMudanca: true, customerAddress: pedido.customerAddress });
    }

    const refaz = refazADistancia(pedido);
    const registro = {
      quando: new Date().toISOString(),
      quem: nomeDoOperador(operador),
      acao: "ENDERECO" as const,
      descricao: `Endereço "${pedido.customerAddress || "(vazio)"}" → "${endereco}"`,
      totalAntes: pedido.totalAmount || 0,
      totalDepois: pedido.totalAmount || 0,
    };

    // Grava só se ninguém mudou o endereço no meio (outra aba, o app do motoboy).
    const gravados = await prisma.customerOrder.updateMany({
      where: { id: pedido.id, customerAddress: pedido.customerAddress },
      data: {
        customerAddress: endereco,
        customerLatLng: Prisma.DbNull,
        ...(refaz ? { deliveryDistance: null } : {}),
        editHistory: empilharEdicao(pedido.editHistory, registro as unknown as RegistroDeEdicao) as any,
      },
    });
    if (gravados.count !== 1) {
      return NextResponse.json(
        { error: "O endereço deste pedido mudou enquanto você corrigia. Abra o pedido de novo e confira." },
        { status: 409 },
      );
    }

    // O ponto do endereço novo — com prazo: a fila do mapa é de 1 busca por
    // segundo para o servidor inteiro, e no pico a tela não pode ficar presa.
    let achouNoMapa = false;
    let distanciaKm: number | null = refaz ? null : pedido.deliveryDistance ?? null;
    try {
      const loja = await prisma.user.findUnique({
        where: { id: pedido.franchiseeId },
        select: { storeLatLng: true, city: true, storeAddress: true, deliveryZoneType: true, deliveryZones: true, deliveryConfig: true },
      });
      const centro = lerPonto(loja?.storeLatLng);
      if (centro) {
        const busca = geocodificarNoServidor(
          [{ id: pedido.id, endereco, ehMarketplace: canalDoPedido(pedido).ehMarketplace }],
          { cidade: loja?.city || "", endereco: loja?.storeAddress, centro, area: areaDaLoja(loja, centro), franchiseeId: pedido.franchiseeId },
        ).catch(() => []);
        const achados = await Promise.race([
          busca,
          new Promise<[]>((ok) => setTimeout(() => ok([]), ESPERA_DO_MAPA_MS)),
        ]);
        const a = achados[0];
        if (a && geocodificacaoAchou(a.origem)) {
          const ponto = { lat: a.lat, lng: a.lng };
          const km = refaz ? await distanciaDaEntregaKm(pedido.franchiseeId, ponto, { estimarSeORoteadorCair: true }).catch(() => null) : null;
          const r = await prisma.customerOrder.updateMany({
            // O endereço ainda é o que esta busca procurou.
            where: { id: pedido.id, customerAddress: endereco },
            data: {
              customerLatLng: { ...ponto, origem: a.fonte === "aprendido" ? "aprendido" : origemDaGeocodificacao(a.origem) },
              ...(refaz && km != null ? { deliveryDistance: km } : {}),
            },
          });
          achouNoMapa = r.count === 1;
          if (achouNoMapa && refaz) distanciaKm = km;
        }
      }
    } catch (e: any) {
      // O endereço já está gravado; o ponto o cron acha depois.
      console.warn(`[Corrigir endereço] pedido ${pedido.id}: busca no mapa falhou: ${e?.message}`);
    }

    return NextResponse.json({
      ok: true,
      customerAddress: endereco,
      achouNoMapa,
      distanciaKm,
      distanciaRefeita: refaz,
      descricao: registro.descricao,
    });
  } catch (error: any) {
    console.error("[Corrigir endereço PATCH]", error);
    return NextResponse.json({ error: "Erro ao corrigir o endereço do pedido" }, { status: 500 });
  }
}
