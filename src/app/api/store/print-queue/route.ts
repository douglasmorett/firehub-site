import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { destinosDoPedido } from "@/lib/roteamento-de-impressao";
import { impressorasDaContaDaMesa } from "@/lib/impressao-da-conta";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { camposDeEntregaParaImpressao } from "@/lib/entrega-parceira";
import { comboParaImpressao } from "@/lib/parse-combo";
import { camposDoQrPuxar, qrLigadoNaImpressora } from "@/lib/qr-puxar";

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

    // Padrão: 2 horas atrás. Piso de 6 horas: este endpoint não tem
    // autenticação (só o id da loja, que está no HTML do cardápio), e sem o
    // piso um `since=2000-01-01` devolvia todos os pedidos da loja desde
    // sempre. O Assistente descarta o que passa de 6 h de qualquer jeito.
    const pisoDoSince = new Date(Date.now() - 6 * 60 * 60 * 1000);
    let sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    if (sinceParam) {
      const parsedSince = new Date(sinceParam);
      if (!isNaN(parsedSince.getTime())) {
        sinceDate = parsedSince < pisoDoSince ? pisoDoSince : parsedSince;
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

    // Uma unica leitura da config da loja (nao repete o JSON por pedido).
    //
    // TOLERANTE ao banco atrasado: este GET é chamado por todo Assistente de
    // toda loja a cada 3 s. Se o código subir antes do `prisma db push`
    // (passo manual em produção), a coluna `printQueuePolledAt` e a tabela
    // PrintRequest ainda não existem — e um erro aqui pararia a impressão de
    // mesa e balcão de TODAS as lojas de uma vez. Então as partes novas
    // falham sozinhas e as comandas continuam saindo.
    type DonoDaFila = {
      printerConfig: unknown;
      storeName: string | null;
      name: string | null;
      slug: string | null;
      printQueuePolledAt?: Date | null;
    };
    let owner: DonoDaFila | null = null;
    try {
      owner = await prisma.user.findUnique({
        where: { id: franchiseeId },
        select: { printerConfig: true, storeName: true, name: true, slug: true, printQueuePolledAt: true },
      });
    } catch (err) {
      console.error("[PrintQueue] printQueuePolledAt ausente? (falta db push)", (err as any)?.code || err);
      owner = await prisma.user.findUnique({
        where: { id: franchiseeId },
        select: { printerConfig: true, storeName: true, name: true, slug: true },
      });
    }
    const pc: any = (owner?.printerConfig as any) || null;

    // Carimba a consulta — no máximo uma vez por minuto (o Assistente bate a
    // cada 3 s). É o que deixa o painel avisar "a impressão parou" antes de a
    // loja descobrir pela comanda que não saiu. Na mesma passada, apaga as
    // impressões avulsas com mais de um dia: a fila só lê 2 h, e a tabela não
    // precisa virar histórico eterno de contas com nome de gente.
    if (owner && "printQueuePolledAt" in owner && Date.now() - (owner.printQueuePolledAt?.getTime() ?? 0) > 60_000) {
      prisma.user
        .update({ where: { id: franchiseeId }, data: { printQueuePolledAt: new Date() } })
        .catch((err) => console.error("[PrintQueue] carimbo do poll:", err));
      prisma.printRequest
        .deleteMany({ where: { franchiseeId, createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
        .catch(() => { /* tabela ainda não existe: nada a apagar */ });
    }
    const printers: any[] = Array.isArray(pc?.printers) ? pc.printers : [];
    const slugDaLoja = owner?.slug || "";

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
      const destinos = destinosDoPedido(printers, order as any);
      // ── QR "PUXAR PEDIDO" ──────────────────────────────────────────
      //
      // Esta fila imprime o delivery quando o painel não está aberto num
      // navegador (pedido do site, do robô, do iFood) — e até aqui o QR do
      // motoboy só saía pelo navegador. Mesma regra dos dois trilhos
      // (lib/qr-puxar.ts): só entrega da própria loja, e só na impressora
      // marcada para isso.
      //
      // Dois lugares, de propósito. Cada `destino` leva o SEU QR (o Assistente
      // 1.2.4 lê dali, impressora a impressora). No `order` inteiro o QR só vai
      // quando TODAS as impressoras o querem: o Assistente antigo imprime o que
      // vier no `order` em todas, e assim a loja que desligou o QR na cozinha
      // não o vê lá — fica sem QR até o auto-update, em vez de com QR onde não
      // pediu. Loja sem impressora cadastrada cai na impressora única: vai.
      const qr = camposDoQrPuxar(order as any, slugDaLoja);
      const qrEmTodas = destinos.length === 0 || destinos.every(d => qrLigadoNaImpressora(d.impressora, pc));
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
      order: { ...order, ...camposDeEntregaParaImpressao(order), ...(qrEmTodas ? qr : {}) },
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
      destinos: destinos.map(d => ({
        printer: d.impressora.name,
        copies: Number(d.impressora.copies) > 0 ? Number(d.impressora.copies) : 1,
        paperWidth: d.impressora.paperWidth || pc?.defaultPaperWidth || "80mm",
        columns: d.impressora.columns ?? undefined,
        escposProfile: d.impressora.escposProfile ?? undefined,
        somenteBebidas: d.impressora.somenteBebidas === true,
        items: d.itens,
        // O QR desta impressora (vazio = esta não imprime QR).
        ...(qrLigadoNaImpressora(d.impressora, pc) ? qr : {}),
      })),
      createdAt: order.createdAt.toISOString(),
      };
    });

    // ── IMPRESSÕES AVULSAS (conta da mesa) ───────────────────────────
    //
    // Não nascem de pedido: ficam em PrintRequest, já no formato de cupom
    // (src/lib/conta-da-mesa.ts). Vão para as impressoras que a loja marcou
    // na tela de Impressoras — e, enquanto ela não marcar nenhuma, para o
    // palpite de sempre (a do salão que tira a comanda inteira: conta é papel
    // do caixa). A regra mora em src/lib/impressao-da-conta.ts, porque a tela
    // de mesas decide o mesmo para a impressora local.
    let avulsas: { id: string; payload: unknown; createdAt: Date }[] = [];
    try {
      avulsas = await prisma.printRequest.findMany({
        where: { franchiseeId, createdAt: { gt: sinceDate } },
        orderBy: { createdAt: "asc" },
        select: { id: true, payload: true, createdAt: true },
      });
    } catch (err) {
      console.error("[PrintQueue] PrintRequest indisponível (falta db push?)", (err as any)?.code || err);
    }

    // `null` = a loja desmarcou a conta em TODAS as impressoras: a fila não
    // entrega o cupom nenhum. Mandar com `destinos` vazio faria o Assistente
    // cair na impressora padrão dele — exatamente o papel que a loja disse não
    // querer. O PrintRequest fica no banco e some sozinho em 24 h.
    const paraConta = impressorasDaContaDaMesa(printers);
    const destinosDaConta = paraConta || [];

    const jobsAvulsos = (paraConta === null ? [] : avulsas).map((pedido) => {
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
        destinos: destinosDaConta.map((d) => ({
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
    // Sem autenticação neste GET: a mensagem crua do Prisma (com caminho de
    // arquivo do servidor e nome de coluna) não pode sair para quem chamar.
    console.error("[PrintQueue GET]", err);
    return NextResponse.json({ error: "fila indisponível" }, { status: 500 });
  }
}
