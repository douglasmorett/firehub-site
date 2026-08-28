import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumberTx } from "@/lib/order-number";
import { precoUnitarioDoItem, precoMinimoDoProduto } from "@/lib/preco-combo";
import { aplicarPrecoDoCanal } from "@/lib/preco-por-canal";
import { autenticarTotem } from "@/lib/totem-auth";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelHoje } from "@/lib/cardapio-interno";

export const dynamic = "force-dynamic";

/**
 * ── A CHAVE DE IDEMPOTÊNCIA QUE A TELA MANDA DESDE SEMPRE ───────────────────
 *
 * A tela envia `idempotencyKey` no corpo (uma chave por sessão + carrinho) e
 * esta rota jogava fora: cada POST gravava um CustomerOrder novo. O caso que
 * quebra não é o toque duplo — a tela troca de tela antes disso — é a resposta
 * que NÃO CHEGA. A rede da loja engasga além dos 25s do totem, o servidor já
 * gravou o pedido #42, a tela mostra "não sabemos se o pedido chegou a ser
 * registrado" e o segundo toque grava o #43 com o mesmo carrinho: o #43 é
 * cobrado, o #42 fica pendurado em AGUARDANDO_PAGAMENTO queimando uma senha
 * que a cozinha nunca vê (o KDS exclui esse status) e inflando o esperado em
 * dinheiro do fechamento. Se o atendente confirmar o órfão pelo painel, sai a
 * segunda comanda, a segunda baixa de estoque e a venda contada duas vezes.
 *
 * O dedup é o mesmo da casa (iFood/Open Delivery: coluna única + procurar
 * antes de criar), com uma diferença de ordem: a coluna NÃO entra no
 * schema.prisma neste commit. É a regra escrita em src/lib/garantir-colunas.ts
 * desde o MenuProduct.sortOrder — campo no schema com coluna ausente no banco
 * é 500 mudo em produção. Primeiro a coluna existe (ALTER aditivo e
 * idempotente, acesso por SQL cru), o campo no schema vem depois, quando todo
 * ambiente já tiver rodado esta revisão.
 */
const SQL_CHAVE_DE_IDEMPOTENCIA = [
  `ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "totemIdempotencyKey" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrder_totemIdempotencyKey_key" ON "CustomerOrder"("totemIdempotencyKey")`,
];

/**
 * Só marca DEPOIS de conseguir, como a garantia da Brendi: se o banco estiver
 * num soluço na primeira requisição, é a próxima que conserta — em vez de o
 * processo ficar marcado como "já tentou" e vender o resto do dia sem dedup.
 */
let chaveDeIdempotenciaOk = false;

async function garantirChaveDeIdempotencia(): Promise<boolean> {
  if (chaveDeIdempotenciaOk) return true;
  try {
    for (const sql of SQL_CHAVE_DE_IDEMPOTENCIA) {
      await prisma.$executeRawUnsafe(sql);
    }
    chaveDeIdempotenciaOk = true;
    return true;
  } catch (err: any) {
    // NUNCA lança: sem a coluna perde-se a deduplicação, não a venda. O totem
    // continua gravando pedido como antes e o log diz o que rodar à mão.
    console.error(
      `[Totem Order] Não consegui garantir a coluna totemIdempotencyKey (${err?.message}). ` +
        `Reenvio depois de timeout pode duplicar pedido até isso ser resolvido.`
    );
    return false;
  }
}

/** O pedido já gravado com esta chave, se existir. */
async function pedidoDaChave(chave: string) {
  const linhas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "CustomerOrder" WHERE "totemIdempotencyKey" = ${chave} LIMIT 1
  `;
  const id = linhas[0]?.id;
  if (!id) return null;
  return prisma.customerOrder.findUnique({ where: { id }, include: { items: true } });
}

/**
 * ── FORMA DE PAGAMENTO É DECISÃO DO SERVIDOR, NÃO TEXTO DO CLIENTE ──────────
 *
 * `paymentMethod` vinha do corpo e ia cru para o banco, sem lista fechada — e o
 * token do totem fica à vista na URL do quiosque. Um POST com "PIX Online"
 * fazia a comanda sair como "(Online) - Pago via Online (NÃO COBRAR)" para um
 * pedido que ninguém pagou. Qualquer outro texto inventado também não casa com
 * nenhum balde do fechamento de caixa e cai no `else` que soma DINHEIRO
 * esperado na gaveta.
 *
 * O totem tem exatamente dois caminhos, e quem decide qual deles é este lado.
 * Texto desconhecido não vira rótulo novo: cai no padrão da maquininha, que é
 * o mesmo que a rota já usava quando o campo vinha vazio.
 */
const FORMA_MAQUININHA = "Cartão (Maquininha)";
const FORMA_NO_CAIXA = "Pagar no caixa";

function formaDePagamentoDoTotem(valor: unknown): string {
  const texto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  if (texto.includes("caixa") || texto.includes("balcao") || texto.includes("balcão")) {
    return FORMA_NO_CAIXA;
  }
  return FORMA_MAQUININHA;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, customerName, items, notes, paymentMethod, idempotencyKey } = body;

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const licenca = auth.licenca;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Carrinho vazio" }, { status: 400 });
    }

    // A chave vai gravada com o id da loja na frente: o índice é único no
    // sistema inteiro, e sem o prefixo duas lojas com sessões coincidentes
    // brigariam por uma chave que não é de nenhuma das duas.
    const chaveCrua = typeof idempotencyKey === "string" ? idempotencyKey.trim() : "";
    const chaveDaTela =
      chaveCrua.length >= 8 && chaveCrua.length <= 120
        ? `${licenca.franchiseeId}:${chaveCrua}`
        : "";
    // Sem a coluna no banco não há onde carimbar: `chave` fica vazia e a rota
    // volta a se comportar como antes. Tentar gravar assim mesmo derrubaria a
    // transação inteira e o cliente ficaria sem pedido nenhum.
    const chave = chaveDaTela && (await garantirChaveDeIdempotencia()) ? chaveDaTela : "";

    // Resposta idêntica para pedido novo e pedido reaproveitado: a tela lê
    // `order` nos dois casos e segue para o pagamento do MESMO pedido.
    const respostaDoPedido = (
      order: { id: string; dailyOrderNumber: number | null; status: string; totalAmount: number; customerName: string; createdAt: Date; items: unknown[] },
      reaproveitado: boolean
    ) =>
      NextResponse.json({
        success: true,
        reaproveitado,
        order: {
          id: order.id,
          numero: order.dailyOrderNumber,
          status: order.status,
          totalAmount: order.totalAmount,
          customerName: order.customerName,
          itemCount: order.items.length,
          createdAt: order.createdAt.toISOString(),
        },
      });

    // Antes de qualquer coisa que grave: este POST já foi atendido? Vem antes
    // até da trava de caixa — o pedido já existe, e devolvê-lo é o que impede
    // o segundo pedido de nascer.
    if (chave) {
      const jaGravado = await pedidoDaChave(chave);
      if (jaGravado) return respostaDoPedido(jaGravado, true);
    }

    // ── CAIXA FECHADO É A ÚNICA TRAVA DE VENDA DO TOTEM ─────────────────────
    //
    // O totem não fecha com o horário do delivery (ver /api/totem/heartbeat):
    // enquanto ele estiver ligado, o cliente monta o pedido normalmente. Mas
    // pedido pago no balcão sem caixa aberto é dinheiro que entra sem lugar
    // para ser registrado — o fechamento do dia não fecha e a diferença
    // aparece como falta no relatório.
    //
    // Então recusa-se AQUI, no fim, com uma mensagem que o cliente entende e
    // que resolve a situação dele: chamar um atendente. A tela não some, o
    // carrinho não se perde — assim que a loja abre o caixa, ele conclui.
    const caixaAberto = await prisma.cashSession.findFirst({
      where: { franchiseeId: licenca.franchiseeId, status: "OPEN" },
      select: { id: true },
    });

    if (!caixaAberto) {
      return NextResponse.json(
        {
          error: "caixa_fechado",
          mensagem:
            "O caixa da loja está fechado agora, então não dá para concluir o pedido por aqui. " +
            "Chame um atendente no balcão — ele finaliza para você sem perder o que você escolheu.",
        },
        { status: 409 }
      );
    }

    // O produto precisa ser da loja, estar ativo E estar liberado para o totem.
    // Antes bastava ser da loja: quem montasse a requisição na mão comprava um
    // item que o totem nem oferece — inclusive o espelho do catálogo do iFood.
    const productIds = [...new Set(items.map((i: any) => i?.menuProductId).filter(Boolean))];
    const dbProducts = await prisma.menuProduct.findMany({
      where: {
        id: { in: productIds },
        franchiseeId: licenca.franchiseeId,
        active: true,
        activeTotem: true,
        ...SEM_PRODUTO_DE_INTEGRACAO,
      },
      include: { comboGroups: { include: { items: { include: { menuProduct: true } } } } },
    });

    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    let totalAmount = 0;
    const orderItems: Array<{ menuProductId: string; quantity: number; price: number; comboSelections: any }> = [];
    const recusados: string[] = [];

    for (const item of items) {
      const product = productMap.get(item.menuProductId);
      if (!product) {
        recusados.push(String(item?.menuProductId ?? "?"));
        continue;
      }

      // Produto de dia específico não pode ser vendido fora do dia. O cardápio
      // já esconde, mas a tela pode estar aberta desde ontem.
      if (!disponivelHoje(product.availableDays)) {
        recusados.push(product.name);
        continue;
      }

      // Mesma conta do cardápio, do modal e do robô — src/lib/preco-combo.ts.
      // Canal TOTEM: cobra o mesmo preço que /api/totem/menu anunciou na tela.
      const produtoNoCanal = aplicarPrecoDoCanal(product as any, "totem");
      let itemPrice = precoUnitarioDoItem(produtoNoCanal as any, item.comboSelections);

      // Piso de segurança: produto cujo valor mora nas opções (o "Nugget" da
      // Hakim, base R$ 0,00) sairia por R$ 0,00 se a escolha não viesse ou não
      // casasse. Melhor cobrar o mínimo possível do que entregar de graça.
      const minimo = precoMinimoDoProduto(produtoNoCanal as any);
      if (itemPrice < minimo) {
        console.warn(
          `[Totem] "${product.name}" sairia por R$ ${itemPrice} sem escolha válida; aplicando o mínimo R$ ${minimo}.`
        );
        itemPrice = minimo;
      }

      const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));
      totalAmount += itemPrice * quantity;

      orderItems.push({
        menuProductId: product.id,
        quantity,
        price: itemPrice,
        comboSelections: item.comboSelections || null,
      });
    }

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: "Nenhum produto válido no carrinho. Atualize o cardápio e tente de novo." },
        { status: 400 }
      );
    }

    // Recusar item silenciosamente é pior do que recusar o pedido: o cliente
    // paga na maquininha o valor da tela e recebe menos comida.
    if (recusados.length > 0) {
      return NextResponse.json(
        {
          error: "carrinho_desatualizado",
          mensagem: `Estes itens saíram do cardápio: ${recusados.join(", ")}. Refaça o pedido.`,
          itensRecusados: recusados,
        },
        { status: 409 }
      );
    }

    // ── O PEDIDO DO TOTEM NASCE ESPERANDO PAGAMENTO ──────────────────────────
    // Ele nascia com o status normal da loja e `kdsStage: "PRODUCTION"`: ia
    // direto para a cozinha e para a impressora no instante em que o cliente
    // tocava em "confirmar", antes de qualquer cartão. Quem desistisse na tela
    // de pagamento — ou visse a cobrança recusada — já tinha o lanche sendo
    // feito. No totem não há atendente para perceber isso.
    //
    // Agora quem promove o pedido é `confirmOrderPayment`, chamada quando o
    // pagamento é confirmado de verdade: é ela que carimba `paymentPaidAt`,
    // aplica o status da loja, gera a senha e despacha para o KDS e a
    // impressora. A mesma função que o webhook do Mercado Pago usa.
    const AGUARDANDO = "AGUARDANDO_PAGAMENTO";

    // Numeração DENTRO da transação que grava o pedido. Fora dela, o número é
    // consumido antes do insert e evapora se o insert falhar — foi o que abriu
    // buracos na sequência (os pedidos 92, 95 e 97 que sumiram).
    const gravarPedido = () =>
      prisma.$transaction(async (tx) => {
        const dailyOrderNumber = await generateDailyOrderNumberTx(tx, licenca.franchiseeId);

        const criado = await tx.customerOrder.create({
          data: {
            franchiseeId: licenca.franchiseeId,
            dailyOrderNumber,
            customerName: customerName || `Totem ${licenca.label}`,
            customerPhone: "totem",
            deliveryType: "TAKEOUT", // Totem é sempre retirada no balcão
            paymentMethod: formaDePagamentoDoTotem(paymentMethod),
            totalAmount,
            deliveryFee: 0,
            status: AGUARDANDO,
            source: "TOTEM",
            notes: notes || null,
            // Sem kdsStage: a comanda não existe para a cozinha até pagar.
            totemLicenseId: licenca.id,
            items: { create: orderItems },
          },
          include: { items: true },
        });

        // Carimba a chave DENTRO da mesma transação. É o que fecha a corrida:
        // se o gêmeo chegar junto, o índice único derruba a transação inteira e
        // o número do dia volta atrás com ela — fora da transação o contador é
        // incremento atômico sem devolução e a senha ficaria queimada.
        if (chave) {
          await tx.$executeRaw`
            UPDATE "CustomerOrder" SET "totemIdempotencyKey" = ${chave} WHERE "id" = ${criado.id}
          `;
        }

        return criado;
      });

    let order: Awaited<ReturnType<typeof gravarPedido>>;
    try {
      order = await gravarPedido();
    } catch (err: any) {
      // Chave repetida (P2002 do Prisma ou 23505 cru do índice): o pedido desta
      // chave já existe. Devolver ele é a resposta certa — foi para isso que a
      // transação caiu.
      const chaveRepetida =
        !!chave &&
        (err?.code === "P2002" ||
          err?.meta?.code === "23505" ||
          /23505|totemIdempotencyKey/i.test(String(err?.message ?? "")));
      if (chaveRepetida) {
        const jaGravado = await pedidoDaChave(chave);
        if (jaGravado) return respostaDoPedido(jaGravado, true);
      }
      throw err;
    }

    // ── NADA DE CONSEQUÊNCIA ANTES DE PAGAR ──────────────────────────────────
    // Aqui havia baixa de estoque, contagem de faturamento e envio para a fila
    // de impressão, disparados no ato da criação. Junto com o `kdsStage`, era o
    // pedido inteiro acontecendo antes do cartão: a comanda saía na impressora
    // da cozinha, o insumo era debitado e a venda entrava no faturamento de um
    // pedido que talvez nunca fosse pago.
    //
    // Os três passaram para `confirmOrderPayment`, que roda quando o pagamento
    // é confirmado — pelo webhook do Mercado Pago, pelo app da maquininha ou
    // pela confirmação do atendente no painel. Um caminho só, para os três não
    // divergirem.

    return respostaDoPedido(order, false);
  } catch (err) {
    console.error("[Totem Order] Erro:", err);
    return NextResponse.json({ error: "Erro ao criar pedido" }, { status: 500 });
  }
}
