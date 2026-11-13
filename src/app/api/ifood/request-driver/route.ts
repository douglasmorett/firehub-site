/**
 * /api/ifood/request-driver — "Chamar entregador" no card do pedido que a loja
 * entregaria com motoboy próprio. Cota em todos os apps que atendem o pedido e
 * a loja escolhe:
 *
 *   - iFood Sob Demanda (módulo SHIPPING, homologado no app distribuído em
 *     12/11/2026; fluxo de lib/ifood-shipping.ts): pedido do site, robô,
 *     balcão — e também pedido da 99 com entrega da loja.
 *   - 99 Entrega (lib/food99-api.ts): só pedido DA 99, pago online, com
 *     entrega da loja (a 99 exige o id do pedido dela).
 *
 *   GET    ?orderId=                       opções com custo, tempo e endereço
 *   POST   {orderId, app, endereco}        chama o entregador do app escolhido
 *   DELETE ?orderId=                       cancela a corrida
 *
 * Antes daqui, esta rota cotava e pedia por endereços que não existem na API
 * (/delivery/v1.0/deliveries) e, para pedido do iFood, chamava /dispatch — que
 * despacha o pedido em vez de pedir entregador. Nenhum botão a chamava.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { contextoIfood, type ContextoIfood } from "@/lib/ifood-token";
import { mensagemDeErro } from "@/lib/ifood-http";
import {
  consultarDisponibilidade, registrarPedido, gravarPedidoShipping, garantirTabelaDoShipping,
  motivosDeCancelamento, cancelarPedido, rastreioDoPedido, distanciaEmMetros, type Endereco,
} from "@/lib/ifood-shipping";
import {
  motivoParaNaoChamar, pagamentoParaIfood, entradaDoPedido, telefoneParaIfood, ehDa99ComEntregaDaLoja,
  motivoDaCobrancaRecusada,
} from "@/lib/entregador-ifood-no-pedido";
import { enderecoImpresso } from "@/lib/endereco-impresso";
import { cepDoEndereco, buscarCep } from "@/lib/cep";
import { cobrancaNaEntrega } from "@/lib/pagamento-na-entrega";
import { tokensParaOPedido } from "@/lib/food99-status";
import {
  ativar99Entrega, cotar99Entrega, pedir99Entrega, cancelar99Entrega, detalhe99Entrega, type EnderecoEntrega99,
} from "@/lib/food99-api";

const SELECT_PEDIDO = {
  id: true, franchiseeId: true, status: true, deliveryType: true, source: true, ifoodOrderId: true,
  openDeliveryChannel: true, openDeliveryOrderId: true, motoboyId: true, ifoodDriverStatus: true, deliveryBy: true,
  ifoodDriverName: true, ifoodDriverPhone: true, ifoodDriverVehicle: true, ifoodDriverPhotoUrl: true,
  customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
  totalAmount: true, deliveryFee: true, paymentMethod: true, changeAmount: true, dailyOrderNumber: true,
  franchisee: { select: { city: true, storeName: true, storePhone: true, storeAddress: true, storeLatLng: true } },
} as const;

type Opcao =
  | { app: "IFOOD" | "99"; ok: true; price: number; raise?: number; minutosMin: number; minutosMax: number; distancia: number | null; cobranca?: any }
  | { app: "IFOOD" | "99"; ok: false; erro: string };

async function emailDaSessao(): Promise<string | null> {
  const s = await getServerSession(authOptions);
  return s?.user?.email ?? null;
}

/** O pedido, só se for da loja da sessão. */
async function pedidoDaLoja(email: string, orderId: string) {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!u || !orderId) return null;
  const pedido = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: SELECT_PEDIDO as any });
  return pedido && (pedido as any).franchiseeId === (u.ownerId || u.id) ? (pedido as any) : null;
}

/** Só o app distribuído: é nele que o Shipping foi aprovado. null = loja sem iFood utilizável. */
async function ctxDoIfood(email: string): Promise<ContextoIfood | null> {
  return contextoIfood({ email, permitirCentral: false }).catch(() => null);
}

function pontoDoPedido(p: any): { latitude: number; longitude: number } | null {
  const lat = Number(p?.customerLatLng?.lat), lng = Number(p?.customerLatLng?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { latitude: lat, longitude: lng } : null;
}

const simples = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Texto de endereço → partes (rua, número, bairro…) + cidade/UF pelo CEP. */
async function separarEndereco(texto: string | null, cidadePadrao: string | null) {
  const e = enderecoImpresso({ customerAddress: texto, deliveryType: "DELIVERY" }, { cidadeDaLoja: cidadePadrao });
  const linha = (r: string) => e.linhas.find((l) => l.rotulo === r)?.valor ?? "";
  const cep = cepDoEndereco(texto) ?? "";
  const doCep = cep ? await buscarCep(cep) : null;
  const viaCep = doCep && doCep.ok ? doCep.endereco : null;
  const bairro = linha("Bairro") || e.bairro || viaCep?.bairro || "";
  const cidade = viaCep?.cidade || linha("Cidade") || cidadePadrao || "";
  // O separador às vezes devolve "bairro, cidade" como complemento: repetido, não vai.
  const compl = linha("Complemento");
  const complRepetido = !!compl && [bairro, cidade].some((x) => x && simples(compl).includes(simples(x)));
  return {
    postalCode: cep,
    streetName: linha("Rua") || viaCep?.rua || "",
    streetNumber: linha("Número"),
    complement: complRepetido ? "" : compl,
    reference: linha("Referência"),
    neighborhood: bairro,
    city: cidade,
    state: viaCep?.uf || "",
  };
}

function faltandoNo(end: { postalCode?: string; streetName: string; streetNumber?: string; neighborhood: string; city: string; state: string }) {
  return [
    !end.postalCode && "CEP", !end.streetName && "rua", !end.streetNumber && "número",
    !end.neighborhood && "bairro", !end.city && "cidade", !end.state && "UF",
  ].filter(Boolean) as string[];
}

async function enderecoDoCliente(p: any): Promise<Endereco & { faltando: string[] }> {
  const ponto = pontoDoPedido(p);
  const end = { ...(await separarEndereco(p.customerAddress, p.franchisee?.city)), latitude: ponto?.latitude ?? 0, longitude: ponto?.longitude ?? 0 };
  return { ...end, faltando: faltandoNo(end) };
}

function para99(e: Endereco): EnderecoEntrega99 {
  return {
    rua: e.streetName, numero: e.streetNumber, complemento: e.complement, bairro: e.neighborhood,
    cidade: e.city, uf: e.state, cep: String(e.postalCode || "").replace(/\D/g, ""), lat: e.latitude, lng: e.longitude,
  };
}

/** Endereço da LOJA (coleta do 99 Entrega), do cadastro. null = incompleto. */
async function enderecoDaLoja(p: any): Promise<EnderecoEntrega99 | null> {
  const f = p.franchisee || {};
  const s = await separarEndereco(f.storeAddress ?? null, f.city ?? null);
  if (faltandoNo(s).length) return null;
  const lat = Number(f.storeLatLng?.lat), lng = Number(f.storeLatLng?.lng);
  return { ...para99({ ...s, latitude: lat, longitude: lng } as Endereco), lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null };
}

/** O endereço que a tela mandou (corrigido pelo lojista), com o ponto do pedido. */
function enderecoDoCorpo(e: any, ponto: { latitude: number; longitude: number }): Endereco {
  return {
    postalCode: String(e?.postalCode ?? ""), streetName: String(e?.streetName ?? ""), streetNumber: String(e?.streetNumber ?? ""),
    complement: String(e?.complement ?? ""), reference: String(e?.reference ?? ""), neighborhood: String(e?.neighborhood ?? ""),
    city: String(e?.city ?? ""), state: String(e?.state ?? ""), country: "BR",
    latitude: ponto.latitude, longitude: ponto.longitude,
  };
}

// ── as cotações ────────────────────────────────────────────────────────────

async function cotarIfood(ctx: ContextoIfood | null, pedido: any, ponto: { latitude: number; longitude: number }): Promise<Opcao> {
  if (!ctx) return { app: "IFOOD", ok: false, erro: "iFood não conectado pelo app novo. Reconecte o iFood em Integrações." };
  if (!telefoneParaIfood(pedido.customerPhone)) {
    return { app: "IFOOD", ok: false, erro: "Telefone do cliente sem DDD: o iFood exige para o código de entrega." };
  }
  const r = await consultarDisponibilidade(ctx, ponto.latitude, ponto.longitude);
  if (!r.ok || !r.data?.id) return { app: "IFOOD", ok: false, erro: r.ok ? "Sem entregador do iFood para este endereço agora." : mensagemDeErro(r) };
  const c: any = r.data;
  // O entregador só leva se puder receber o que o cliente deve na porta.
  const cobranca = pagamentoParaIfood(pedido, c);
  const recusa = motivoDaCobrancaRecusada(cobranca, c);
  if (recusa) return { app: "IFOOD", ok: false, erro: recusa };
  return {
    app: "IFOOD", ok: true,
    price: Number(c.quote?.netValue ?? 0), raise: Number(c.quote?.raise ?? 0) || 0,
    minutosMin: Math.round((c.deliveryTime?.min ?? 0) / 60), minutosMax: Math.round((c.deliveryTime?.max ?? 0) / 60),
    distancia: c.distance ?? null, cobranca,
  };
}

/** A 99 só cota pedido dela, pago online e com entrega da loja. */
async function cotar99(pedido: any, cliente: Endereco): Promise<{ opcao: Opcao; token?: string; estimateId?: string } | null> {
  if (!ehDa99ComEntregaDaLoja(pedido) || !pedido.openDeliveryOrderId) return null;
  if (cobrancaNaEntrega(pedido).cobrar) return { opcao: { app: "99", ok: false, erro: "O 99 Entrega só aceita pedido pago online." } };
  const loja = await enderecoDaLoja(pedido);
  if (!loja) return { opcao: { app: "99", ok: false, erro: "Complete o endereço da loja (com CEP) em Configurações para usar o 99 Entrega." } };
  if (faltandoNo(cliente).length) return { opcao: { app: "99", ok: false, erro: "Complete o endereço do cliente abaixo e cote de novo." } };
  const tokens = await tokensParaOPedido(pedido.franchiseeId);
  let erro = "Loja sem autorização válida na 99.";
  for (const t of tokens) {
    await ativar99Entrega(t).catch(() => null); // já ativo = erro inofensivo
    const r = await cotar99Entrega(t, loja, para99(cliente));
    if (r.errno === 0 && r.data?.id) {
      return {
        token: t, estimateId: r.data.id,
        opcao: {
          app: "99", ok: true, price: Number(r.data.fee || 0) / 100,
          minutosMin: Number(r.data.delivery_duration || 0), minutosMax: Number(r.data.delivery_duration || 0),
          distancia: r.data.delivery_distance ?? null,
        },
      };
    }
    erro = r.errmsg || erro;
  }
  return { opcao: { app: "99", ok: false, erro: `99 Entrega: ${erro}` } };
}

export async function GET(req: NextRequest) {
  const email = await emailDaSessao();
  if (!email) return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  const pedido = await pedidoDaLoja(email, req.nextUrl.searchParams.get("orderId") ?? "");
  if (!pedido) return NextResponse.json({ available: false, error: "Pedido não encontrado nesta loja." }, { status: 404 });
  if (req.nextUrl.searchParams.get("acao") === "acompanhar") return NextResponse.json(await acompanhar(email, pedido));
  const motivo = motivoParaNaoChamar(pedido);
  if (motivo) return NextResponse.json({ available: false, error: motivo });
  const ponto = pontoDoPedido(pedido);
  if (!ponto) {
    return NextResponse.json({
      available: false,
      error: "Este pedido não tem a localização do cliente no mapa, e os apps cotam pela localização. Confira o endereço no mapa do pedido.",
    });
  }
  const endereco = await enderecoDoCliente(pedido);
  const [ifood, noventaENove] = await Promise.all([
    cotarIfood(await ctxDoIfood(email), pedido, ponto),
    cotar99(pedido, endereco),
  ]);
  const opcoes = [ifood, ...(noventaENove ? [noventaENove.opcao] : [])];
  if (!opcoes.some((o) => o.ok)) {
    return NextResponse.json({ available: false, error: opcoes.map((o) => (o as any).erro).join(" · "), opcoes });
  }
  return NextResponse.json({ available: true, opcoes, endereco, totalDoPedido: pedido.totalAmount });
}

export async function POST(req: NextRequest) {
  const email = await emailDaSessao();
  if (!email) return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  const pedido = await pedidoDaLoja(email, corpo?.orderId ?? "");
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });
  const motivo = motivoParaNaoChamar(pedido);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 409 });
  const ponto = pontoDoPedido(pedido);
  if (!ponto) return NextResponse.json({ error: "Pedido sem localização do cliente." }, { status: 400 });
  const endereco = enderecoDoCorpo(corpo?.endereco, ponto);

  if (corpo?.app === "99") {
    // Cota de novo com o endereço confirmado: a 99 exige o MESMO endereço da
    // estimativa no pedido, e cada estimativa vale um pedido só.
    const c = await cotar99(pedido, endereco);
    if (!c || !c.opcao.ok || !c.token || !c.estimateId) {
      return NextResponse.json({ error: (c?.opcao as any)?.erro || "O 99 Entrega não atende este pedido." }, { status: 409 });
    }
    const loja = (await enderecoDaLoja(pedido))!;
    const r = await pedir99Entrega(c.token, {
      orderId: pedido.openDeliveryOrderId, estimateId: c.estimateId, coleta: loja, entrega: para99(endereco),
      loja: { nome: pedido.franchisee?.storeName || "Loja", telefone: pedido.franchisee?.storePhone || "" },
      cliente: { nome: pedido.customerName || "Cliente" },
    });
    if (r.errno !== 0) return NextResponse.json({ error: `99 Entrega: ${r.errmsg}` }, { status: 502 });
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: { ifoodDriverStatus: "REQUESTED", ifoodDriverRequestedAt: new Date(), deliveryBy: "99FOOD" } as any,
    });
    return NextResponse.json({ success: true, status: "REQUESTED", app: "99" });
  }

  const ctx = await ctxDoIfood(email);
  if (!ctx) return NextResponse.json({ error: "iFood não conectado pelo app novo. Reconecte o iFood em Integrações." }, { status: 409 });
  // A cotação de novo: a bandeira aceita para cartão vem dela, e confere que
  // o quoteId ainda vale (ele expira e o valor pode mudar).
  const cot = await consultarDisponibilidade(ctx, ponto.latitude, ponto.longitude);
  if (!cot.ok || !cot.data?.id) return NextResponse.json({ error: cot.ok ? "Sem entregador do iFood agora." : mensagemDeErro(cot) }, { status: 409 });
  const pagamento = pagamentoParaIfood(pedido, cot.data);
  const recusa = motivoDaCobrancaRecusada(pagamento, cot.data);
  if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });
  const entrada = entradaDoPedido(pedido, endereco, pagamento, String(cot.data.id));
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
  return NextResponse.json({ success: true, status: "REQUESTED", app: "IFOOD", ifoodOrderId: r.data.id, trackingUrl: r.data.trackingUrl ?? null });
}

async function corridaDoPedido(orderId: string): Promise<string | null> {
  if (!(await garantirTabelaDoShipping(prisma))) return null;
  const l: any[] = await prisma.$queryRaw`
    SELECT "ifoodOrderId" FROM "IfoodShippingPedido" WHERE "pedidoDoFireHub" = ${orderId} ORDER BY "createdAt" DESC LIMIT 1`;
  return l[0]?.ifoodOrderId ?? null;
}

async function cancelarCorridaIfood(ctx: ContextoIfood, ifoodOrderId: string) {
  // A lista de motivos muda por pedido ("não faça hardcoding" — doc do iFood).
  const m = await motivosDeCancelamento(ctx, ifoodOrderId);
  const primeiro = Array.isArray(m.data) ? m.data[0] : null;
  if (!primeiro) return { ok: false, erro: m.ok ? "O iFood não deixa mais cancelar esta corrida." : mensagemDeErro(m) };
  const r = await cancelarPedido(ctx, ifoodOrderId, primeiro.cancelCodeId, "Cancelado pela loja no FireHub");
  return r.ok ? { ok: true } : { ok: false, erro: mensagemDeErro(r) };
}

export async function DELETE(req: NextRequest) {
  const email = await emailDaSessao();
  if (!email) return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  const pedido = await pedidoDaLoja(email, req.nextUrl.searchParams.get("orderId") ?? "");
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado nesta loja." }, { status: 404 });

  if (String(pedido.deliveryBy || "").toUpperCase() === "99FOOD" && pedido.openDeliveryOrderId) {
    let erro = "Loja sem autorização válida na 99.";
    let ok = false;
    for (const t of await tokensParaOPedido(pedido.franchiseeId)) {
      const r = await cancelar99Entrega(t, pedido.openDeliveryOrderId);
      if (r.errno === 0) { ok = true; break; }
      erro = r.errmsg || erro;
    }
    if (!ok) return NextResponse.json({ error: `99 Entrega: ${erro}` }, { status: 409 });
  } else {
    // Sem a corrida não há o que cancelar no iFood: limpar o card aqui faria
    // a loja achar que cancelou enquanto o entregador continua vindo.
    const corrida = await corridaDoPedido(pedido.id);
    if (!corrida) return NextResponse.json({ error: "Não achei a corrida deste pedido no iFood. Cancele pelo Gestor do iFood." }, { status: 409 });
    const ctx = await ctxDoIfood(email);
    if (!ctx) return NextResponse.json({ error: "iFood não conectado pelo app novo." }, { status: 409 });
    const c = await cancelarCorridaIfood(ctx, corrida);
    if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 409 });
  }
  // Volta a ser entrega da loja (no pedido da 99, "MERCHANT" como veio).
  await prisma.customerOrder.update({
    where: { id: pedido.id },
    data: {
      ifoodDriverStatus: null, ifoodDriverName: null, ifoodDriverPhone: null, ifoodDriverVehicle: null,
      ifoodDriverPhotoUrl: null, ifoodDriverRequestedAt: null, ifoodDeliveryEta: null,
      deliveryBy: pedido.openDeliveryOrderId && String(pedido.openDeliveryChannel || pedido.source || "").toUpperCase() === "99FOOD" ? "MERCHANT" : null,
    } as any,
  });
  return NextResponse.json({ success: true });
}

// ── acompanhar a corrida (o card mostra quem vem e quando chega) ───────────

/** 99 Entrega → o mesmo carimbo de status que o card já entende. */
const STATUS_DA_99: Record<string, string> = {
  finding: "REQUESTED", waiting: "GOING_TO_ORIGIN", delivering: "DISPATCHED",
  completed: "DELIVERED", sendback: "DISPATCHED", sendbackCompleted: "DELIVERED",
};

/** Minutos até a loja pela distância em linha reta (moto a ~25 km/h, mínimo 1). */
function minutosAte(de: { lat: number; lng: number } | null, para: { lat: number; lng: number } | null): number | null {
  if (!de || !para || ![de.lat, de.lng, para.lat, para.lng].every((n) => Number.isFinite(Number(n)))) return null;
  const m = distanciaEmMetros({ latitude: Number(de.lat), longitude: Number(de.lng) }, { latitude: Number(para.lat), longitude: Number(para.lng) });
  return Math.max(1, Math.round((m * 1.3) / (25000 / 60)));
}

/**
 * Quem está vindo e quanto falta — direto do app, para a loja não abrir a
 * tela do iFood/99. Só reflete o que o app respondeu: corrida que o app
 * cancelou/fechou volta para a entrega da loja, e nada é inventado.
 */
async function acompanhar(email: string, pedido: any) {
  const app = String(pedido.deliveryBy || "").toUpperCase() === "99FOOD" ? "99" : "IFOOD";
  const base = {
    app, status: pedido.ifoodDriverStatus as string | null, nome: pedido.ifoodDriverName as string | null,
    telefone: pedido.ifoodDriverPhone as string | null, veiculo: pedido.ifoodDriverVehicle as string | null,
    foto: pedido.ifoodDriverPhotoUrl as string | null, chegaNaLojaMin: null as number | null,
    chegaNoClienteMin: null as number | null, rastreio: null as string | null,
    podeCancelar: false, porqueNaoCancela: null as string | null,
  };
  const jaComOPedido = ["DISPATCHED", "ARRIVED_AT_DESTINATION", "DELIVERED"].includes(String(pedido.ifoodDriverStatus));
  if (!pedido.ifoodDriverStatus) return base;

  if (app === "99") {
    for (const t of await tokensParaOPedido(pedido.franchiseeId)) {
      const r = await detalhe99Entrega(t, pedido.openDeliveryOrderId);
      if (r.errno !== 0 || !r.data) continue;
      const d: any = r.data;
      const status = STATUS_DA_99[String(d.status)] ?? null;
      if (!status) {
        // canceled / closed (ninguém aceitou ou o suporte fechou): é a 99 dizendo que não vem.
        await prisma.customerOrder.update({
          where: { id: pedido.id },
          data: { ifoodDriverStatus: null, ifoodDriverName: null, ifoodDriverPhone: null, ifoodDriverRequestedAt: null, deliveryBy: "MERCHANT" } as any,
        });
        return { ...base, status: null, encerrado: d.status === "closed" ? "A 99 fechou a corrida (nenhum entregador aceitou)." : "A 99 cancelou a corrida." };
      }
      const drv = d.driver_info || {};
      const veiculo = drv.vehicle_info ? [drv.vehicle_info.color, drv.vehicle_info.plate_no].filter(Boolean).join(" ") : null;
      await prisma.customerOrder.update({
        where: { id: pedido.id },
        data: { ifoodDriverStatus: status, ...(drv.name ? { ifoodDriverName: drv.name } : {}), ...(drv.phone ? { ifoodDriverPhone: drv.phone } : {}), ...(veiculo ? { ifoodDriverVehicle: veiculo } : {}), ...(drv.avatar ? { ifoodDriverPhotoUrl: drv.avatar } : {}) } as any,
      });
      const loja = pedido.franchisee?.storeLatLng ?? null;
      const cliente = pedido.customerLatLng ?? null;
      return {
        ...base, status, nome: drv.name ?? base.nome, telefone: drv.phone ?? base.telefone, veiculo: veiculo ?? base.veiculo,
        foto: drv.avatar ?? base.foto, rastreio: d.tracking_link || null,
        podeCancelar: status === "REQUESTED" || status === "GOING_TO_ORIGIN",
        porqueNaoCancela: status === "REQUESTED" || status === "GOING_TO_ORIGIN" ? null : "O entregador da 99 já está com o pedido.",
        chegaNaLojaMin: status === "GOING_TO_ORIGIN" ? minutosAte(drv.location, loja) : null,
        chegaNoClienteMin: status === "DISPATCHED" ? minutosAte(drv.location, cliente) : null,
      };
    }
    return base;
  }

  const corrida = await corridaDoPedido(pedido.id);
  const ctx = corrida ? await ctxDoIfood(email) : null;
  if (!corrida || !ctx) return base;
  const linha: any[] = await prisma.$queryRaw`SELECT "trackingUrl" FROM "IfoodShippingPedido" WHERE "ifoodOrderId" = ${corrida} LIMIT 1`;
  const r = await rastreioDoPedido(ctx, corrida);
  const t: any = r.ok ? r.data ?? {} : {};
  const seg = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.ceil(Number(v) / 60) : null);
  // Quem diz se ainda dá para cancelar é o iFood: a lista de motivos dele
  // para esta corrida. Vazia ou recusada = não dá, com o motivo que ele deu.
  let podeCancelar = false;
  let porqueNaoCancela: string | null = "O entregador do iFood já está com o pedido.";
  if (!jaComOPedido) {
    const m = await motivosDeCancelamento(ctx, corrida);
    podeCancelar = m.ok && Array.isArray(m.data) && m.data.length > 0;
    porqueNaoCancela = podeCancelar ? null : m.ok ? "O iFood não oferece mais cancelamento nesta etapa da corrida." : `O iFood recusou o cancelamento: ${mensagemDeErro(m)}`;
  }
  return {
    ...base, rastreio: linha[0]?.trackingUrl ?? null, podeCancelar, porqueNaoCancela,
    chegaNaLojaMin: ["ASSIGNED", "GOING_TO_ORIGIN"].includes(String(base.status)) ? seg(t.pickupEtaStart) : null,
    chegaNoClienteMin: ["DISPATCHED"].includes(String(base.status)) ? seg(t.deliveryEtaEnd) : null,
  };
}
