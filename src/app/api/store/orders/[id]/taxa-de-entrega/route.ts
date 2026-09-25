import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { avaliarEdicao, empilharEdicao, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { ehPagoOnline } from "@/lib/pagamento-na-entrega";
import { lerPartes, resumoDividido, validarDivisao } from "@/lib/pagamento-dividido";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { STATUS_FINALIZADOS } from "@/lib/status-pedido";
import {
  ajusteDaTaxa,
  avisoDaDiferencaDeTotal,
  distanciaParaGravar,
  faixaDaDistancia,
  faixasDaLoja,
} from "@/lib/entrega-do-pedido";

/**
 * /api/store/orders/[id]/taxa-de-entrega — a loja CORRIGE a taxa de entrega
 * de um pedido já feito.
 *
 *   GET   → a taxa, o total, o repasse e a distância gravados, a tabela de
 *           faixas da loja e a SUGESTÃO (a faixa da distância gravada).
 *   PATCH { taxa, motivo, distanciaKm?, repassePelaTaxa?, paymentMethods? }
 *         → grava a taxa nova, o total corrigido pela diferença, o repasse
 *           refeito se seguia a tabela, e o rastro (quem, quando, por quê).
 *           `repassePelaTaxa: true` = "a medida gravada estava errada": o
 *           repasse acompanha a faixa da taxa nova (sem isso, com distância
 *           gravada, vale a faixa da distância — cortesia não muda o que o
 *           motoboy rodou). `paymentMethods` = a divisão nova, obrigatória
 *           quando o pedido foi pago dividido e o total muda.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 25/09/2026 a Divinos Burger cobrou R$ 12 (a faixa mais cara) de quatro
 * clientes a 0,5–0,9 km, porque o mapa não achou o endereço na hora do
 * pedido. A mensagem da cotação dizia "a loja confirma a entrega" — mas não
 * existia como a loja confirmar nada: a edição de itens mantém a taxa, e o
 * relatório e o acerto do motoboy ficavam com o valor errado para sempre.
 *
 * ── As regras ───────────────────────────────────────────────────────────────
 *
 * Quem pode e quando: as MESMAS da edição de itens (`avaliarEdicao`,
 * lib/edicao-de-pedido.ts) — dono sempre, funcionário com a permissão
 * "editar pedidos"; qualquer status menos cancelado e pedido que ainda não é
 * pedido (aguardando pagamento).
 *
 * Marketplace NÃO: a taxa de um pedido do iFood/99Food é dinheiro do app, e o
 * total tem que continuar batendo com o repasse dele.
 *
 * O motivo é OBRIGATÓRIO: é o contrapeso de deixar mexer em dinheiro de
 * pedido fechado. Vai no rastro (`editHistory`) e na observação do pedido,
 * que é o que a loja vê no painel.
 *
 * A conta (total, repasse, distância) é `ajusteDaTaxa`, pura e testada
 * (scripts/teste-entrega-do-pedido.ts).
 */

/** O mesmo teto da rota de pedido do site: R$ 300 de entrega não existe em delivery de bairro. */
const TETO_DA_TAXA = 300;
const RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA"];

const CAMPOS = {
  id: true, franchiseeId: true, status: true, source: true, deliveryType: true, tableSessionId: true,
  totalAmount: true, deliveryFee: true, motoboyFee: true, deliveryDistance: true, notes: true,
  editHistory: true, entregaGratis: true, dailyOrderNumber: true,
  // O que decide canal (marketplace) e se o dinheiro já entrou (lib/pagamento-na-entrega.ts).
  paymentMethod: true, gatewayPaymentId: true, paymentMethods: true, paymentPaidAt: true,
  ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
} as const;

const reais = (n: number) => `R$ ${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")}`;
const km = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Quem aparece no rastro — o mesmo formato da edição de itens. */
function nomeDoOperador(op: { name?: string | null; email?: string | null; role?: string | null }) {
  const papel = (op.role || "").toUpperCase() === "STAFF" ? "funcionário" : "dono";
  return `${op.name || op.email || "?"} (${papel})`;
}

async function contexto(params: Promise<{ id: string }>) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  const operador = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true, role: true, permissions: true, ownerId: true },
  });
  if (!operador) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };

  const lojaId = operador.ownerId || operador.id;
  const { id } = await params;
  const order = await prisma.customerOrder.findFirst({ where: { id, franchiseeId: lojaId }, select: CAMPOS });
  if (!order) return { erro: NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 }) };

  if (RETIRADA.includes(String(order.deliveryType || "").trim().toUpperCase())) {
    return { erro: NextResponse.json({ error: "Este pedido não é de entrega." }, { status: 400 }) };
  }

  const avaliacao = avaliarEdicao(order as any, operador);
  if (avaliacao.modo === "BLOQUEADO") {
    return { erro: NextResponse.json({ error: avaliacao.motivo }, { status: 403 }) };
  }
  if (avaliacao.modo === "MARKETPLACE") {
    return {
      erro: NextResponse.json(
        {
          error: `A taxa de entrega de um pedido do ${avaliacao.canal} é do ${avaliacao.canal}: ela tem que continuar batendo com o repasse do app. Se o cliente foi cobrado errado, quem acerta é o ${avaliacao.canal}.`,
        },
        { status: 403 },
      ),
    };
  }

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { deliveryConfig: true, deliveryZones: true },
  });
  return { lojaId, operador, order, loja };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, loja } = ctx;
    const regra = lerRegraDeRepasse(loja?.deliveryConfig);
    const sugestao = faixaDaDistancia(loja?.deliveryZones, order.deliveryDistance);
    return NextResponse.json({
      deliveryFee: order.deliveryFee,
      totalAmount: order.totalAmount,
      motoboyFee: order.motoboyFee,
      deliveryDistance: order.deliveryDistance,
      separaRepasse: regra.separado,
      faixas: faixasDaLoja(loja?.deliveryZones),
      // Pago dividido: a tela tem de pedir a divisão nova junto com a taxa.
      pagamentoDividido: lerPartes(order.paymentMethods),
      // A faixa que a distância GRAVADA paga. Nula sem distância, sem faixas
      // de km ou acima da última faixa.
      sugestao,
    });
  } catch (error: any) {
    console.error("[Taxa de entrega GET]", error);
    return NextResponse.json({ error: "Erro ao ler a taxa do pedido" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await contexto(params);
    if ("erro" in ctx) return ctx.erro;
    const { order, loja, operador, lojaId } = ctx;

    const corpo = await req.json().catch(() => ({} as any));

    const taxaBruta = typeof corpo?.taxa === "string" ? corpo.taxa.replace(",", ".").trim() : corpo?.taxa;
    const taxa = taxaBruta === "" || taxaBruta === null || taxaBruta === undefined ? NaN : Number(taxaBruta);
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > TETO_DA_TAXA) {
      return NextResponse.json({ error: `Informe a taxa de entrega em reais, de R$ 0,00 a ${reais(TETO_DA_TAXA)}.` }, { status: 400 });
    }

    const motivo = String(corpo?.motivo ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (motivo.length < 3) {
      return NextResponse.json({ error: "Escreva o motivo da correção (ex.: \"cliente mora a 800 m, faixa de R$ 5\")." }, { status: 400 });
    }

    const veioDistancia = corpo?.distanciaKm !== undefined && corpo?.distanciaKm !== null && corpo?.distanciaKm !== "";
    const distanciaNova = veioDistancia
      ? distanciaParaGravar(typeof corpo.distanciaKm === "string" ? corpo.distanciaKm.replace(",", ".") : corpo.distanciaKm)
      : null;
    if (veioDistancia && distanciaNova == null) {
      return NextResponse.json({ error: "Distância inválida: informe os km de 0 a 60." }, { status: 400 });
    }

    const conta = ajusteDaTaxa({
      totalAntes: order.totalAmount,
      taxaAntes: order.deliveryFee,
      taxaNova: taxa,
      motoboyFeeAntes: order.motoboyFee,
      distanciaAntes: order.deliveryDistance,
      distanciaNova,
      repassePelaTaxa: corpo?.repassePelaTaxa === true || corpo?.repassePelaTaxa === "true",
      regra: lerRegraDeRepasse(loja?.deliveryConfig),
      zonas: loja?.deliveryZones,
    });
    if (!conta.mudou) {
      return NextResponse.json({
        success: true, semMudanca: true,
        deliveryFee: order.deliveryFee, totalAmount: order.totalAmount, motoboyFee: order.motoboyFee, deliveryDistance: order.deliveryDistance,
      });
    }

    // ── PAGAMENTO DIVIDIDO: AS PARTES TÊM DE FECHAR COM O TOTAL NOVO ──────
    //
    // Venda de balcão de R$ 42 paga em Pix 20 + Dinheiro 22: corrigir a taxa
    // de 12 para 5 deixava o total em 35 e as partes somando 42. O fechamento
    // de caixa (lib/esperado-do-turno.ts) soma o total no esperado e as partes
    // em cada forma — sobra fantasma de R$ 7. Gravar partes que não fecham é a
    // diferença de caixa que ninguém acha depois (lib/pagamento-dividido.ts):
    // a correção pede a divisão nova, com a MESMA conferência do balcão.
    const partesGravadas = lerPartes(order.paymentMethods);
    const totalMuda = Math.round(conta.totalDepois * 100) !== Math.round((order.totalAmount || 0) * 100);
    let divisaoNova: { partes: ReturnType<typeof lerPartes>; resumo: string } | null = null;
    if (partesGravadas.length > 0 && totalMuda) {
      const veioDivisao = Array.isArray(corpo?.paymentMethods) && corpo.paymentMethods.length > 0;
      if (!veioDivisao) {
        return NextResponse.json(
          {
            error: `Este pedido foi pago dividido (${resumoDividido(partesGravadas)}). Com a taxa nova o total fica ${reais(conta.totalDepois)}: informe como fica a divisão.`,
            precisaDividir: true,
            totalDepois: conta.totalDepois,
            pagamentoDividido: partesGravadas,
          },
          { status: 409 },
        );
      }
      const r = validarDivisao(corpo.paymentMethods, conta.totalDepois);
      if (!r.ok) return NextResponse.json({ error: r.erro, precisaDividir: true, totalDepois: conta.totalDepois }, { status: 400 });
      divisaoNova = { partes: r.partes, resumo: r.resumo };
    }

    const taxaAntes = Math.round((order.deliveryFee || 0) * 100) / 100;
    const partes = [`Taxa de entrega ${reais(taxaAntes)} → ${reais(conta.taxaDepois)}`];
    if (conta.deliveryDistanceDepois !== (order.deliveryDistance ?? null) && conta.deliveryDistanceDepois != null) {
      partes.push(`distância ${order.deliveryDistance != null ? `${km(order.deliveryDistance)} km` : "não medida"} → ${km(conta.deliveryDistanceDepois)} km`);
    }
    if (conta.motoboyFeeDepois !== (order.motoboyFee ?? null)) {
      const r = (v: number | null) => (v == null ? "acordo do entregador" : reais(v));
      partes.push(`repasse ${r(order.motoboyFee ?? null)} → ${r(conta.motoboyFeeDepois)}`);
    }
    if (divisaoNova) partes.push(`pagamento ${resumoDividido(partesGravadas)} → ${divisaoNova.resumo}`);
    const descricao = `${partes.join("; ")} — motivo: ${motivo}`;

    // O rastro. `acao` própria (TAXA_DE_ENTREGA em lib/edicao-de-pedido.ts):
    // não é item nem pagamento, e quem lê o histórico tem que distinguir. Os
    // campos a mais (motivo, taxa e repasse antes/depois) ficam no JSON.
    const registro = {
      quando: new Date().toISOString(),
      quem: nomeDoOperador(operador),
      acao: "TAXA_DE_ENTREGA" as const,
      descricao,
      totalAntes: order.totalAmount || 0,
      totalDepois: conta.totalDepois,
      motivo,
      taxaAntes,
      taxaDepois: conta.taxaDepois,
      repasseAntes: order.motoboyFee ?? null,
      repasseDepois: conta.motoboyFeeDepois,
      repasseRecalculado: conta.repasse,
    };

    const etiqueta = `[Taxa de entrega corrigida: ${reais(taxaAntes)} → ${reais(conta.taxaDepois)} — ${motivo}]`;
    const notas = `${String(order.notes || "").trim()} ${etiqueta}`.trim();

    // ── CONCORRÊNCIA ─────────────────────────────────────────────────────
    //
    // Dois atendentes corrigindo o mesmo pedido (ou a edição de itens no meio)
    // fariam a segunda correção partir de um total velho. O UPDATE só passa
    // se taxa e total ainda são os que esta conta leu.
    const gravados = await prisma.customerOrder.updateMany({
      where: { id: order.id, franchiseeId: lojaId, deliveryFee: order.deliveryFee, totalAmount: order.totalAmount },
      data: {
        deliveryFee: conta.taxaDepois,
        totalAmount: conta.totalDepois,
        motoboyFee: conta.motoboyFeeDepois,
        deliveryDistance: conta.deliveryDistanceDepois,
        notes: notas,
        ...(divisaoNova ? { paymentMethods: divisaoNova.partes as any, paymentMethod: divisaoNova.resumo } : {}),
        editHistory: empilharEdicao(order.editHistory, registro as unknown as RegistroDeEdicao) as any,
        // A entrega que passou a ser cobrada deixou de ser grátis: a nota não
        // pode mostrar "entrega grátis" ao lado de uma taxa.
        ...(conta.taxaDepois > 0 && order.entregaGratis != null ? { entregaGratis: Prisma.DbNull } : {}),
      },
    });
    if (gravados.count !== 1) {
      return NextResponse.json(
        { error: "O pedido mudou enquanto você corrigia a taxa. Abra o pedido de novo e confira." },
        { status: 409 },
      );
    }

    // O sistema não estorna nem cobra a diferença sozinho: quem já pagou —
    // online, em dinheiro ao motoboy (pedido entregue), no balcão ou dividido
    // — é avisado do que fazer (lib/entrega-do-pedido.ts, avisoDaDiferencaDeTotal).
    const diferenca = Math.round((conta.totalDepois - (order.totalAmount || 0)) * 100) / 100;
    const aviso = avisoDaDiferencaDeTotal(diferenca, conta.totalDepois, {
      pagoOnline: ehPagoOnline(order as any),
      finalizado: (STATUS_FINALIZADOS as readonly string[]).includes(String(order.status || "").toUpperCase()),
      pagamentoConfirmado: order.paymentPaidAt != null,
      balcao: String(order.source || "").toUpperCase() === "PRESENCIAL",
      dividido: partesGravadas.length > 0,
    });

    console.log(
      `[Taxa de entrega] pedido ${order.id}: ${reais(taxaAntes)} → ${reais(conta.taxaDepois)}, ` +
      `total ${order.totalAmount} → ${conta.totalDepois}, repasse ${order.motoboyFee ?? "—"} → ${conta.motoboyFeeDepois ?? "—"} (${conta.repasse}), ` +
      `por ${registro.quem}: ${motivo}`,
    );

    return NextResponse.json({
      success: true,
      deliveryFee: conta.taxaDepois,
      totalAmount: conta.totalDepois,
      motoboyFee: conta.motoboyFeeDepois,
      deliveryDistance: conta.deliveryDistanceDepois,
      repasseRecalculado: conta.repasse,
      ...(divisaoNova ? { paymentMethods: divisaoNova.partes, paymentMethod: divisaoNova.resumo } : {}),
      registro,
      ...(aviso ? { aviso } : {}),
    });
  } catch (error: any) {
    console.error("[Taxa de entrega PATCH]", error);
    return NextResponse.json({ error: "Erro ao corrigir a taxa do pedido" }, { status: 500 });
  }
}
