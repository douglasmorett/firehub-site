/**
 * /api/ifood/request-driver — "Chamar entregador iFood" no card do pedido do
 * canal próprio (site, robô, balcão). Módulo SHIPPING, homologado no app
 * distribuído em 12/11/2026; o fluxo é o da aba Shipping (lib/ifood-shipping.ts).
 *
 *   GET    ?orderId=   cotação: custo, tempo e o endereço que vai para o iFood
 *   POST   {orderId, quoteId, endereco}   registra o pedido no iFood e liga ao da loja
 *   DELETE ?orderId=   cancela a corrida
 *
 * Sempre pelo app distribuído (exigirDistribuido): é nele que o Shipping foi
 * aprovado — o centralizado só tem Order e Events.
 *
 * Antes daqui, esta rota cotava e pedia por endereços que não existem na API
 * (/delivery/v1.0/deliveries) e, para pedido do iFood, chamava /dispatch — que
 * despacha o pedido em vez de pedir entregador. Nenhum botão a chamava.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comContextoIfood } from "@/lib/ifood-rota";
import type { ContextoIfood } from "@/lib/ifood-token";
import { mensagemDeErro } from "@/lib/ifood-http";
import {
  consultarDisponibilidade, registrarPedido, gravarPedidoShipping, garantirTabelaDoShipping,
  motivosDeCancelamento, cancelarPedido, type Endereco,
} from "@/lib/ifood-shipping";
import { motivoParaNaoChamar, pagamentoParaIfood, entradaDoPedido, telefoneParaIfood } from "@/lib/entregador-ifood-no-pedido";
import { enderecoImpresso } from "@/lib/endereco-impresso";
import { cepDoEndereco, buscarCep } from "@/lib/cep";

const SELECT_PEDIDO = {
  id: true, franchiseeId: true, status: true, deliveryType: true, source: true, ifoodOrderId: true,
  openDeliveryChannel: true, motoboyId: true, ifoodDriverStatus: true, deliveryBy: true,
  customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
  totalAmount: true, deliveryFee: true, paymentMethod: true, changeAmount: true, dailyOrderNumber: true,
  franchisee: { select: { city: true } },
} as const;

/** O pedido, só se for da loja da sessão. */
async function pedidoDaLoja(email: string, orderId: string) {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!u || !orderId) return null;
  const pedido = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: SELECT_PEDIDO as any });
  return pedido && (pedido as any).franchiseeId === (u.ownerId || u.id) ? (pedido as any) : null;
}

function pontoDoPedido(p: any): { latitude: number; longitude: number } | null {
  const lat = Number(p?.customerLatLng?.lat), lng = Number(p?.customerLatLng?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { latitude: lat, longitude: lng } : null;
}

/** O endereço separado (rua, número, bairro…) + cidade/UF pelo CEP. A tela deixa corrigir. */
async function enderecoDoPedido(p: any): Promise<Endereco & { faltando: string[] }> {
  const e = enderecoImpresso(p, { cidadeDaLoja: p.franchisee?.city });
  const linha = (r: string) => e.linhas.find((l) => l.rotulo === r)?.valor ?? "";
  const cep = cepDoEndereco(p.customerAddress) ?? "";
  const doCep = cep ? await buscarCep(cep) : null;
  const viaCep = doCep && doCep.ok ? doCep.endereco : null;
  const ponto = pontoDoPedido(p);
  // O separador às vezes devolve "bairro, cidade" como complemento: repetido, não vai.
  const simples = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const bairro = linha("Bairro") || e.bairro || viaCep?.bairro || "";
  const cidade = viaCep?.cidade || linha("Cidade") || p.franchisee?.city || "";
  const compl = linha("Complemento");
  const complRepetido = !!compl && [bairro, cidade].some((x) => x && simples(compl).includes(simples(x)));
  const end = {
    postalCode: cep,
    streetName: linha("Rua") || viaCep?.rua || "",
    streetNumber: linha("Número"),
    complement: complRepetido ? "" : compl,
    reference: linha("Referência"),
    neighborhood: bairro,
    city: cidade,
    state: viaCep?.uf || "",
    latitude: ponto?.latitude ?? 0,
    longitude: ponto?.longitude ?? 0,
  };
  const faltando = [
    !end.postalCode && "CEP", !end.streetName && "rua", !end.streetNumber && "número",
    !end.neighborhood && "bairro", !end.city && "cidade", !end.state && "UF",
  ].filter(Boolean) as string[];
  return { ...end, faltando };
}

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, email, params }) => {
    const pedido = await pedidoDaLoja(email, params.get("orderId") ?? "");
    if (!pedido) return NextResponse.json({ available: false, error: "Pedido não encontrado nesta loja." }, { status: 404 });
    const motivo = motivoParaNaoChamar(pedido);
    if (motivo) return NextResponse.json({ available: false, error: motivo });
    const ponto = pontoDoPedido(pedido);
    if (!ponto) {
      return NextResponse.json({
        available: false,
        error: "Este pedido não tem a localização do cliente no mapa, e o iFood cota pela localização. Confira o endereço no mapa do pedido.",
      });
    }
    if (!telefoneParaIfood(pedido.customerPhone)) {
      return NextResponse.json({ available: false, error: "O telefone do cliente está incompleto (precisa de DDD): o iFood exige para o código de entrega." });
    }

    const r = await consultarDisponibilidade(ctx, ponto.latitude, ponto.longitude);
    if (!r.ok || !r.data?.id) {
      return NextResponse.json({ available: false, error: r.ok ? "O iFood não tem entregador para este endereço agora." : mensagemDeErro(r) });
    }
    const c: any = r.data;
    return NextResponse.json({
      available: true,
      quoteId: c.id,
      price: Number(c.quote?.netValue ?? 0),
      raise: Number(c.quote?.raise ?? 0) || 0,
      minutosMin: Math.round((c.deliveryTime?.min ?? 0) / 60),
      minutosMax: Math.round((c.deliveryTime?.max ?? 0) / 60),
      distancia: c.distance ?? null,
      validoAte: c.expirationAt ?? null,
      cobranca: pagamentoParaIfood(pedido, c),
      endereco: await enderecoDoPedido(pedido),
      totalDoPedido: pedido.totalAmount,
    });
  }, { exigirDistribuido: true });
}

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, email, corpo }) => {
    const pedido = await pedidoDaLoja(email, corpo?.orderId ?? "");
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });
    const motivo = motivoParaNaoChamar(pedido);
    if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
    const ponto = pontoDoPedido(pedido);
    if (!ponto) return NextResponse.json({ error: "Pedido sem localização do cliente." }, { status: 400 });

    // A cotação de novo: a bandeira aceita para cartão vem dela, e confere que
    // o quoteId ainda vale (ele expira e o valor pode mudar).
    const cot = await consultarDisponibilidade(ctx, ponto.latitude, ponto.longitude);
    const quoteId = String(cot.data?.id || corpo?.quoteId || "");
    const e = corpo?.endereco ?? {};
    const endereco: Endereco = {
      postalCode: String(e.postalCode ?? ""), streetName: String(e.streetName ?? ""), streetNumber: String(e.streetNumber ?? ""),
      complement: String(e.complement ?? ""), reference: String(e.reference ?? ""), neighborhood: String(e.neighborhood ?? ""),
      city: String(e.city ?? ""), state: String(e.state ?? ""), country: "BR",
      latitude: ponto.latitude, longitude: ponto.longitude,
    };
    const entrada = entradaDoPedido(pedido, endereco, pagamentoParaIfood(pedido, cot.data), quoteId);
    const r = await registrarPedido(ctx, entrada);
    if (!r.ok || !r.data?.id) return NextResponse.json({ error: mensagemDeErro(r) }, { status: r.status || 502 });

    await gravarPedidoShipping(prisma, {
      ifoodOrderId: r.data.id, franchiseeId: pedido.franchiseeId, merchantId: ctx.merchantId,
      trackingUrl: r.data.trackingUrl ?? null, clienteNome: entrada.cliente.nome, total: r.total,
      enderecoOriginal: endereco, pedidoEnviado: r.corpo,
    });
    // Ligado ao pedido da loja ANTES do polling ver o pedido POS: assim ele
    // não entra de novo no painel (lib/ifood-sob-demanda.ts → sobDemandaJaVinculado).
    await prisma.$executeRaw`UPDATE "IfoodShippingPedido" SET "pedidoDoFireHub" = ${pedido.id} WHERE "ifoodOrderId" = ${r.data.id}`;
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: { ifoodDriverStatus: "REQUESTED", ifoodDriverRequestedAt: new Date(), deliveryBy: "IFOOD" } as any,
    });
    return NextResponse.json({ success: true, status: "REQUESTED", ifoodOrderId: r.data.id, trackingUrl: r.data.trackingUrl ?? null });
  }, { exigirDistribuido: true });
}

async function corridaDoPedido(orderId: string): Promise<string | null> {
  if (!(await garantirTabelaDoShipping(prisma))) return null;
  const l: any[] = await prisma.$queryRaw`
    SELECT "ifoodOrderId" FROM "IfoodShippingPedido" WHERE "pedidoDoFireHub" = ${orderId} ORDER BY "createdAt" DESC LIMIT 1`;
  return l[0]?.ifoodOrderId ?? null;
}

async function cancelarCorrida(ctx: ContextoIfood, ifoodOrderId: string) {
  // A lista de motivos muda por pedido ("não faça hardcoding" — doc do iFood).
  const m = await motivosDeCancelamento(ctx, ifoodOrderId);
  const primeiro = Array.isArray(m.data) ? m.data[0] : null;
  if (!primeiro) return { ok: false, erro: m.ok ? "O iFood não deixa mais cancelar esta corrida." : mensagemDeErro(m) };
  const r = await cancelarPedido(ctx, ifoodOrderId, primeiro.cancelCodeId, "Cancelado pela loja no FireHub");
  return r.ok ? { ok: true } : { ok: false, erro: mensagemDeErro(r) };
}

export async function DELETE(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, email, params }) => {
    const pedido = await pedidoDaLoja(email, params.get("orderId") ?? "");
    if (!pedido) return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });
    const corrida = await corridaDoPedido(pedido.id);
    if (corrida) {
      const c = await cancelarCorrida(ctx, corrida);
      if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 409 });
    }
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        ifoodDriverStatus: null, ifoodDriverName: null, ifoodDriverPhone: null, ifoodDriverVehicle: null,
        ifoodDriverPhotoUrl: null, ifoodDriverRequestedAt: null, ifoodDeliveryEta: null, deliveryBy: null,
      } as any,
    });
    return NextResponse.json({ success: true });
  }, { exigirDistribuido: true });
}
