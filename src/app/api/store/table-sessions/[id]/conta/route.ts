/**
 * GET /api/store/table-sessions/[id]/conta
 *
 * A conta da mesa, já dividida por pessoa. É o que o garçom abre na hora de
 * fechar: quanto é o total, quanto cada um consumiu, e quanto falta receber.
 *
 * Como o rateio funciona:
 *   - item com dono  → vai inteiro para a conta daquela pessoa;
 *   - item sem dono  → é da mesa (couvert, entrada para dividir) e é rateado
 *                      igualmente entre as pessoas cadastradas;
 *   - taxa e gorjeta → rateadas na proporção do que cada um consumiu, porque
 *                      cobrar 10% igual de quem tomou água e de quem tomou
 *                      vinho é o tipo de coisa que gera discussão na mesa.
 *
 * O resto em centavos da divisão é jogado na primeira pessoa. Sem isso, três
 * pessoas dividindo R$ 100 dariam R$ 33,33 cada e a mesa fecharia devendo um
 * centavo para sempre.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const emCentavos = (v: number) => Math.round((Number(v) || 0) * 100);
const emReais = (c: number) => Math.round(c) / 100;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getServerSession(authOptions);
  if (!auth?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { email: auth.user.email },
    select: { id: true, ownerId: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaId = usuario.ownerId || usuario.id;

  const { id } = await params;

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: {
      table: { select: { number: true, label: true } },
      orders: {
        select: {
          status: true,
          totalAmount: true,
          dailyOrderNumber: true,
          items: {
            select: {
              id: true, quantity: true, price: true, productName: true,
              tableGuestId: true,
              menuProduct: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!mesa || mesa.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }

  const pessoas = await prisma.tableGuest.findMany({
    where: { tableSessionId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  // Consumo individual e o que é da mesa
  const porPessoa = new Map<string, { nome: string; centavos: number; itens: any[] }>();
  pessoas.forEach((p: any) => porPessoa.set(p.id, { nome: p.name, centavos: 0, itens: [] }));

  let daMesaCentavos = 0;
  const itensDaMesa: any[] = [];

  for (const pedido of mesa.orders) {
    // Pedido cancelado não entra na conta de ninguém.
    if (pedido.status === "CANCELADO") continue;

    let somaDosItens = 0;

    for (const item of pedido.items) {
      const valor = emCentavos((item.price || 0) * (item.quantity || 1));
      somaDosItens += valor;

      const linha = {
        nome: item.productName || item.menuProduct?.name || "Item",
        quantidade: item.quantity,
        valor: emReais(valor),
      };

      const dono = item.tableGuestId ? porPessoa.get(item.tableGuestId) : null;
      if (dono) {
        dono.centavos += valor;
        dono.itens.push(linha);
      } else {
        daMesaCentavos += valor;
        itensDaMesa.push(linha);
      }
    }

    // O fechamento valida contra `order.totalAmount`; esta tela soma item a
    // item. Normalmente dá no mesmo, mas um desconto no pedido, uma taxa ou
    // um arredondamento fazem os dois divergirem — e aí o garçom recebe
    // exatamente o que a tela pediu e o sistema recusa fechar por diferença
    // de centavos. A diferença entra como ajuste da mesa para os dois números
    // serem sempre o mesmo.
    const diferenca = emCentavos(pedido.totalAmount || 0) - somaDosItens;
    if (diferenca !== 0) {
      daMesaCentavos += diferenca;
      itensDaMesa.push({
        nome: `Ajuste do pedido #${pedido.dailyOrderNumber ?? "—"}`,
        quantidade: 1,
        valor: emReais(diferenca),
      });
    }
  }

  const consumoTotal = [...porPessoa.values()].reduce((s, p) => s + p.centavos, 0) + daMesaCentavos;

  // A tela de fechamento manda a taxa e a gorjeta que o garçom escolheu na
  // hora. Sem isso, o rateio usaria os valores salvos na sessão e a soma das
  // partes não bateria com o total que o fechamento vai exigir — a mesa
  // mostraria uma conta e recusaria fechar por outra.
  const taxaParam = req.nextUrl.searchParams.get("taxa");
  const gorjetaParam = req.nextUrl.searchParams.get("gorjeta");

  // O fallback é 0, não `mesa.serviceFee`: o fechamento grava ali o VALOR em
  // reais da taxa, não o percentual. Ler aquele campo como "%" transformaria
  // uma taxa de R$ 24 em 24% e inflaria a conta inteira.
  const taxaPct = taxaParam !== null && taxaParam !== ""
    ? Math.max(0, Math.min(100, Number(taxaParam) || 0))
    : 0;

  const taxaCentavos = taxaPct > 0 ? Math.round((consumoTotal * taxaPct) / 100) : 0;

  const gorjetaCentavos = gorjetaParam !== null && gorjetaParam !== ""
    ? Math.max(0, emCentavos(Number(gorjetaParam) || 0))
    : emCentavos(mesa.waiterTip || 0);
  const totalCentavos = consumoTotal + taxaCentavos + gorjetaCentavos;

  // Rateio do que é da mesa e dos acréscimos
  const quantas = pessoas.length;
  const divisao = pessoas.map((p: any, indice: number) => {
    const dados = porPessoa.get(p.id)!;

    // Parte igual do que é da mesa
    const parteDaMesa = quantas > 0 ? Math.floor(daMesaCentavos / quantas) : 0;

    // Taxa e gorjeta proporcionais ao consumo próprio
    const base = consumoTotal > 0 ? dados.centavos / consumoTotal : 0;
    const parteExtra = Math.floor((taxaCentavos + gorjetaCentavos) * base);

    return {
      id: p.id,
      nome: dados.nome,
      consumo: emReais(dados.centavos),
      parteDaMesa: emReais(parteDaMesa),
      taxaEGorjeta: emReais(parteExtra),
      totalCentavos: dados.centavos + parteDaMesa + parteExtra,
      itens: dados.itens,
      _indice: indice,
    };
  });

  // O que sobrou do arredondamento vai para a primeira pessoa, senão a soma das
  // partes nunca fecha com o total e a mesa não fecha.
  const somaDasPartes = divisao.reduce((s: number, d: any) => s + d.totalCentavos, 0);
  const sobra = totalCentavos - somaDasPartes;
  if (divisao.length > 0 && sobra !== 0) divisao[0].totalCentavos += sobra;

  return NextResponse.json({
    mesa: { numero: mesa.table.number, nome: mesa.table.label },
    consumo: emReais(consumoTotal),
    taxaServico: { percentual: taxaPct, valor: emReais(taxaCentavos) },
    gorjeta: emReais(gorjetaCentavos),
    total: emReais(totalCentavos),
    itensDaMesa: { valor: emReais(daMesaCentavos), itens: itensDaMesa },
    pessoas: divisao.map((d: any) => ({
      id: d.id,
      nome: d.nome,
      consumo: d.consumo,
      parteDaMesa: d.parteDaMesa,
      taxaEGorjeta: d.taxaEGorjeta,
      aPagar: emReais(d.totalCentavos),
      itens: d.itens,
    })),
    // Divisão por igual, para quando a mesa prefere rachar sem separar consumo.
    porIgual: quantas > 0 ? emReais(Math.floor(totalCentavos / quantas)) : emReais(totalCentavos),
  });
}
