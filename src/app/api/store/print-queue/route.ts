import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { destinosDoPedido } from "@/lib/roteamento-de-impressao";
import { impressoraAtendeModulo } from "@/lib/modulo-do-pedido";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { camposDeEntregaParaImpressao } from "@/lib/entrega-parceira";
import { comboParaImpressao } from "@/lib/parse-combo";

export function pushJobToPrintQueue(targetId: string, order: any, storeName?: string, paperWidth?: string) {
  // A fila agora é lida diretamente do banco de dados no endpoint GET.
  // Esta função foi mantida para não quebrar chamadores existentes.
  console.log(`[PrintQueue] 🖨️ Auto-print acionado (NO-OP). O endpoint GET fará a consulta no BD.`);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const { franchiseeId, order, storeName, paperWidth } = body;

    let targetId = franchiseeId;
    if (!targetId && session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true }
      });
      targetId = u?.ownerId || u?.id;
    }

    if (!targetId) {
      return NextResponse.json({ error: "Franchisee ID obrigatorio" }, { status: 400 });
    }

    pushJobToPrintQueue(targetId, order, storeName, paperWidth);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const franchiseeId = searchParams.get("franchiseeId");
    const sinceParam = searchParams.get("since");

    // Sem loja identificada nao ha fila: este endpoint e consumido pelo
    // assistente local e nunca deve devolver pedido de outra loja.
    if (!franchiseeId) {
      return NextResponse.json({ jobs: [] });
    }

    // Padrão: 2 horas atrás
    let sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (sinceParam) {
      const parsedSince = new Date(sinceParam);
      if (!isNaN(parsedSince.getTime())) {
        sinceDate = parsedSince;
      }
    }

    const where: any = {
      createdAt: { gt: sinceDate },
      status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] },
      franchiseeId,
    };

    const recentOrders = await prisma.customerOrder.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        franchisee: {
          select: { storeName: true, name: true }
        },
        items: {
          include: {
            menuProduct: true,
          }
        }
      }
    });

    // Uma unica leitura da config da loja (nao repete o JSON por pedido)
    const owner = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { printerConfig: true, storeName: true, name: true },
    });
    const pc: any = (owner?.printerConfig as any) || null;
    const printers: any[] = Array.isArray(pc?.printers) ? pc.printers : [];

    const jobs = recentOrders.map(pedidoDoBanco => {
      // O Assistente só sabe ler `comboSelections` em array, e o combo do
      // cardápio online é gravado como `{ grupoId: { nome: qtd } }`: o objeto
      // era descartado em silêncio e a comanda saía com o nome do combo e mais
      // nada — sem os sabores, sem a bebida. Normalizar aqui conserta a
      // impressão sem depender de a loja atualizar o Assistente, e vale para o
      // pedido inteiro e para cada destino (o roteamento parte deste mesmo
      // objeto).
      const order = {
        ...pedidoDoBanco,
        items: (pedidoDoBanco.items || []).map((i: any) => ({
          ...i,
          comboSelections: comboParaImpressao(i.comboSelections),
        })),
      };
      return {
      id: "job_" + order.id,
      // ── QUEM ENTREGA ESTE PEDIDO ────────────────────────────────────
      //
      // O pedido do banco ia inteiro para o Assistente, e ele decide sozinho
      // se é entrega parceira — pela regra antiga, em que a existência de um
      // código de coleta bastava para concluir que sim. Como o iFood emite
      // código também em entrega própria, a comanda saía mandando NÃO usar o
      // motoboy da loja num pedido que era da loja. O painel já acertava; só
      // o papel errava.
      //
      // Aqui o servidor decide (lib/entrega-parceira.ts) e o código de coleta
      // só viaja quando a entrega é mesmo do parceiro. Assim a regra antiga,
      // instalada nas lojas hoje, não tem mais como concluir errado.
      order: { ...order, ...camposDeEntregaParaImpressao(order) },
      storeName: (order as any).franchisee?.storeName || (order as any).franchisee?.name || "FIREHUB",
      // Escalar compativel com o assistente ja instalado. Vale para instalacao
      // de UMA impressora; com varias, quem resolve e o printerConfig abaixo.
      paperWidth: printers[0]?.paperWidth || pc?.defaultPaperWidth || "80mm",
      columns: printers[0]?.columns,
      escposProfile: printers[0]?.escposProfile,
      // Fonte da verdade do assistente novo: resolve largura POR IMPRESSORA.
      // Campo aditivo — assistente antigo ignora sem erro.
      printerConfig: {
        autoprint: pc?.autoprint !== false,
        autoBeverageTag: pc?.autoBeverageTag !== false,
        customBeverageKeywords: pc?.customBeverageKeywords || "",
        defaultPaperWidth: pc?.defaultPaperWidth || "80mm",
        printers,
      },
      // ── PARA QUEM ESTE PEDIDO VAI ──────────────────────────────────
      //
      // A mesa e o balcão imprimem por ESTA fila, não pelo navegador: o
      // pedido nasce no servidor e o Assistente puxa sozinho. E o Assistente
      // mandava tudo para `currentConfig.printer`, a impressora antiga —
      // ignorando lista de impressoras, categoria, módulo e 'só bebida'. Era
      // por isso que a comanda de mesa saía inteira na impressora do bar.
      //
      // Agora quem decide é o servidor, com as MESMAS regras do navegador
      // (src/lib/roteamento-de-impressao.ts). O Assistente só imprime o que
      // mandarem.
      //
      // Campo ADITIVO: Assistente antigo não conhece `destinos`, ignora, e
      // continua imprimindo como sempre imprimiu. Nada regride para quem
      // ainda não atualizou.
      destinos: destinosDoPedido(printers, order as any).map(d => ({
        printer: d.impressora.name,
        copies: Number(d.impressora.copies) > 0 ? Number(d.impressora.copies) : 1,
        paperWidth: d.impressora.paperWidth || pc?.defaultPaperWidth || "80mm",
        columns: d.impressora.columns ?? undefined,
        escposProfile: d.impressora.escposProfile ?? undefined,
        somenteBebidas: d.impressora.somenteBebidas === true,
        items: d.itens,
      })),
      createdAt: order.createdAt.toISOString(),
      };
    });

    // ── IMPRESSÕES AVULSAS (conta da mesa) ───────────────────────────
    //
    // Não nascem de pedido: ficam em PrintRequest, já no formato de cupom
    // (src/lib/conta-da-mesa.ts). Vão para as impressoras do SALÃO que tiram
    // a comanda inteira — nem a só-de-bebida, nem a que filtra por categoria
    // (a da cozinha): conta é papel do caixa. Sem impressora assim, todas as
    // do salão; sem nenhuma cadastrada, `destinos` vazio e o Assistente usa
    // a padrão, como sempre fez.
    const avulsas = await prisma.printRequest.findMany({
      where: { franchiseeId, createdAt: { gt: sinceDate } },
      orderBy: { createdAt: "asc" },
    });

    const doSalao = printers.filter(
      (p) => p && p.name && impressoraAtendeModulo(p.modulos, "salao") && p.somenteBebidas !== true
    );
    const doCaixa = doSalao.filter((p) => !(Array.isArray(p.categories) && p.categories.length > 0));
    const paraConta = doCaixa.length > 0 ? doCaixa : doSalao;

    const jobsAvulsos = avulsas.map((pedido) => {
      const order: any = pedido.payload;
      return {
        id: "job_" + pedido.id,
        order,
        storeName: owner?.storeName || owner?.name || "FIREHUB",
        paperWidth: printers[0]?.paperWidth || pc?.defaultPaperWidth || "80mm",
        columns: printers[0]?.columns,
        escposProfile: printers[0]?.escposProfile,
        printerConfig: {
          autoprint: pc?.autoprint !== false,
          autoBeverageTag: pc?.autoBeverageTag !== false,
          customBeverageKeywords: pc?.customBeverageKeywords || "",
          defaultPaperWidth: pc?.defaultPaperWidth || "80mm",
          printers,
        },
        destinos: paraConta.map((d) => ({
          printer: d.name,
          copies: Number(d.copies) > 0 ? Number(d.copies) : 1,
          paperWidth: d.paperWidth || pc?.defaultPaperWidth || "80mm",
          columns: d.columns ?? undefined,
          escposProfile: d.escposProfile ?? undefined,
          somenteBebidas: false,
          items: Array.isArray(order?.items) ? order.items : [],
        })),
        createdAt: pedido.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ jobs: [...jobs, ...jobsAvulsos] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
