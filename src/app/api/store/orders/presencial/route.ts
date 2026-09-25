import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { telefoneDeVerdade } from "@/lib/telefone";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { conferirEstoque } from "@/lib/estoque-restante";
import { lerPager } from "@/lib/pager";
import { validarDivisao, type ParteDoPagamento } from "@/lib/pagamento-dividido";
import { normalizarDocumento, problemaDoDocumento, lerDocumentoDoCliente } from "@/lib/documento-do-cliente";
import { problemaDoPagerObrigatorio } from "@/lib/balcao-config";
import { MENSAGEM_CAIXA_FECHADO, ERRO_CAIXA_FECHADO } from "@/lib/caixa-aberto";
import { caixaEstaAberto } from "@/lib/caixa-aberto-servidor";
import { avaliarEntrega, modoDaArea, type VeredictoDeEntrega } from "@/lib/area-de-entrega";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { comPrazo } from "@/lib/com-prazo";
import {
  camposDaEntrega,
  coordenadaDoCorpo,
  cotacaoDoPedido,
  entregaDaCotacao,
  entregaDoVeredicto,
  notasDaEntrega,
  type EntregaDoPedido,
} from "@/lib/entrega-do-pedido";

/**
 * Quanto o balcão espera o mapa quando o PDV não mandou a cotação. O atendente
 * está com o cliente na linha: passado isto a venda sai sem a distância (o
 * cron de distâncias pendentes mede depois) e com a etiqueta de conferência.
 */
const PRAZO_DO_MAPA_NO_BALCAO_MS = 10_000;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const { customerName, customerPhone, customerAddress, deliveryType, notes, totalAmount, deliveryFee, items, employeeId, employeeName, changeAmount, change, discountTotal, discountMerchant } = data;
  // Número do pager entregue a quem espera no balcão (lib/pager.ts). Opcional.
  const pagerNumber = lerPager(data.pagerNumber);
  // ── "CPF NA NOTA" ────────────────────────────────────────────────────────
  //
  // Opcional: campo vazio segue a venda normalmente. Mas o que vier tem que
  // ser um documento de verdade — esta coluna é o destinatário da NFC-e
  // (lib/fiscal-automatico.ts), e número inválido só aparece lá na frente,
  // como rejeição da SEFAZ, com a fila esperando o cupom. A tela já barra;
  // aqui é a trava que vale para qualquer cliente desta rota.
  if (normalizarDocumento(data.customerCpfCnpj)) {
    const problema = problemaDoDocumento(data.customerCpfCnpj);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
  }
  const customerCpfCnpj = lerDocumentoDoCliente(data.customerCpfCnpj);
  let paymentMethod: string = data.paymentMethod;

  // ── PAGAMENTO DIVIDIDO ──────────────────────────────────────────────────
  //
  // O balcão pode receber metade no Pix e metade em dinheiro. As partes vêm
  // em `paymentMethods` ([{ method, amount }], o formato da mesa) e têm que
  // fechar com o total: gravar partes que não somam o pedido é criar uma
  // diferença de caixa que ninguém vai achar. O `paymentMethod` (texto) vira o
  // resumo "Dividido: Pix R$ 20,00 + Dinheiro R$ 15,00" — é o que a comanda e
  // o painel mostram; o caixa lê as partes.
  // A conferência mora em lib/pagamento-dividido.ts, junto com a da troca de
  // pagamento do painel: duas telas que aceitassem divisões diferentes
  // gravariam pedidos que o fechamento de caixa lê de jeitos diferentes.
  let paymentMethods: ParteDoPagamento[] | null = null;
  if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) {
    const r = validarDivisao(data.paymentMethods, Number(totalAmount) || 0);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    paymentMethods = r.partes;
    paymentMethod = r.resumo;
  }

  if (!items || items.length === 0) return NextResponse.json({ error: "Nenhum item informado" }, { status: 400 });

  const dbUser = await prisma.user.findUnique({ where: { email: session.user.email! }, select: { id: true, ownerId: true } });
  if (!dbUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = dbUser.ownerId || dbUser.id;

  // ── SEM CAIXA ABERTO NÃO SE LANÇA VENDA PRESENCIAL ───────────────────────
  //
  // Vale para as TRÊS abas do PDV — balcão, mesa e delivery lançado aqui —,
  // porque todas são dinheiro que entra pela mão do atendente e precisa de
  // uma sessão de caixa para ser registrado. Só o que o lojista digita: o
  // pedido do site, do WhatsApp e das integrações continua entrando, que é o
  // certo (ver lib/caixa-aberto.ts).
  //
  // Vem ANTES de tudo o que grava: nada de número de pedido queimado nem de
  // baixa de estoque por uma venda que não vai existir.
  if (!(await caixaEstaAberto(targetFranchiseeId))) {
    return NextResponse.json(
      { error: MENSAGEM_CAIXA_FECHADO, codigo: ERRO_CAIXA_FECHADO },
      { status: 409 },
    );
  }

  // ── PAGER OBRIGATÓRIO, SE A LOJA MARCOU ──────────────────────────────────
  //
  // A trava mora AQUI, não na tela: o PDV pode estar com uma aba velha aberta
  // desde antes de o dono marcar a caixinha, e é por esta rota que todo
  // lançamento presencial passa. A tela faz a mesma conferência só para o
  // atendente ver antes de montar o carrinho.
  //
  // A aba do PDV chega traduzida em `deliveryType`: Balcão vira RETIRADA (é o
  // que vai para o banco), Mesa e Delivery vêm com o próprio nome. Aqui a
  // tradução é desfeita, porque o que a loja marcou foi a ABA. Falha ao ler a
  // config não trava venda: `lerBalcaoConfig` cai no padrão, nada obrigatório.
  const tipoDeLancamento = deliveryType === "MESA" ? "MESA"
    : deliveryType === "DELIVERY" ? "DELIVERY"
    : "BALCAO";
  const configDaLoja = await prisma.user
    .findUnique({ where: { id: targetFranchiseeId }, select: { balcaoConfig: true } as any })
    .catch(() => null);
  const problemaNoPager = problemaDoPagerObrigatorio((configDaLoja as any)?.balcaoConfig, tipoDeLancamento, pagerNumber);
  if (problemaNoPager) return NextResponse.json({ error: problemaNoPager }, { status: 400 });

  // ISOLAMENTO ENTRE LOJAS: so aceita produto DESTA loja.
  // O corpo vinha cru — um menuProductId de outra loja entrava no pedido e a
  // baixa de estoque seguia a ficha tecnica dela, drenando insumo alheio.
  const idsInformados = (items || []).map((i: any) => i.menuProductId).filter(Boolean);
  // O nome sai da MESMA consulta que já confere a dona do produto: é o nome do
  // cardápio, não o que o navegador mandou, e não custa uma ida a mais ao banco.
  const nomeDoProduto = new Map<string, string>();
  if (idsInformados.length > 0) {
    const daLoja = await prisma.menuProduct.findMany({
      where: { id: { in: idsInformados }, franchiseeId: targetFranchiseeId },
      select: { id: true, name: true },
    });
    for (const p of daLoja) nomeDoProduto.set(p.id, p.name);
    const permitidos = new Set(daLoja.map((p) => p.id));
    const invasores = idsInformados.filter((id: string) => !permitidos.has(id));
    if (invasores.length > 0) {
      console.error(`[PDV] Produtos de outra loja recusados na loja ${targetFranchiseeId}:`, invasores);
      return NextResponse.json(
        { error: "Um dos itens não pertence ao cardápio desta loja." },
        { status: 400 }
      );
    }
  }

  // ── A ENTREGA LANÇADA NO BALCÃO ──────────────────────────────────────────
  //
  // O balcão gravava só a taxa: nem distância, nem ponto, nem repasse. Com o
  // entregador pago por faixa de km, o acerto dessas entregas dava R$ 0,00
  // "sem distância" (lib/ganho-do-entregador.ts), e a roteirização
  // geocodificava o endereço de novo.
  //
  // Agora o PDV manda de volta a cotação assinada que recebeu de
  // /api/delivery-fee (`cotacao`) e o pedido grava o que ela mediu — sem mapa
  // de novo. Sem cotação válida, o mapa é consultado aqui, com prazo.
  //
  // O que NÃO muda: a taxa cobrada é a do atendente. O balcão é onde se
  // combina "hoje sai de graça" e "é longe, cobra 12"; fora da área e
  // endereço não localizado não barram a venda (R2) — ficam escritos no
  // pedido para a loja conferir, junto com a taxa que a tabela daria.
  const taxaCobrada = Math.max(0, Math.round((Number(deliveryFee) || 0) * 100) / 100);
  let camposDeEntrega: ReturnType<typeof camposDaEntrega> | null = null;
  let notasDeEntrega: string[] = [];
  if (tipoDeLancamento === "DELIVERY") {
    try {
      const loja = await prisma.user.findUnique({
        where: { id: targetFranchiseeId },
        select: { deliveryZones: true, deliveryZoneType: true, deliveryConfig: true, storeLatLng: true, storeAddress: true, city: true },
      });
      const endereco = String(customerAddress || "").trim();
      const coords = coordenadaDoCorpo(data.customerCoords, data.customerCoordsOrigem);
      if (loja && (endereco.length >= 4 || coords)) {
        const partes = {
          street: typeof data.customerStreet === "string" ? data.customerStreet : undefined,
          number: typeof data.customerNumber === "string" ? data.customerNumber : undefined,
          neighborhood: typeof data.customerNeighborhood === "string" ? data.customerNeighborhood : undefined,
          city: loja.city || undefined,
        };
        const modo = modoDaArea(loja);
        const cotacao = cotacaoDoPedido(data.cotacao, {
          loja: targetFranchiseeId,
          endereco: { ...partes, address: endereco },
          coords,
        });
        let entrega: EntregaDoPedido;
        if (cotacao) {
          entrega = entregaDaCotacao(cotacao, modo, coords);
        } else {
          const avaliacao = await comPrazo<VeredictoDeEntrega>(
            avaliarEntrega(loja, {
              endereco,
              coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
              ...(coords ? { origemDasCoords: coords.origem === "pino" ? ("pino" as const) : ("gps" as const) } : {}),
              bairro: partes.neighborhood,
              partes: partes.street || partes.number || partes.neighborhood ? partes : undefined,
            }),
            PRAZO_DO_MAPA_NO_BALCAO_MS,
          ).catch((e: any) => {
            console.warn(`[Presencial] avaliarEntrega falhou na loja ${targetFranchiseeId}: ${e?.message || e}`);
            return null;
          });
          if (avaliacao && !avaliacao.noPrazo) {
            console.warn(`[Presencial] mapa não respondeu em ${PRAZO_DO_MAPA_NO_BALCAO_MS} ms na loja ${targetFranchiseeId} — venda segue sem distância`);
          }
          entrega = entregaDoVeredicto(avaliacao?.noPrazo ? avaliacao.valor : null, coords, modo);
        }
        camposDeEntrega = camposDaEntrega(entrega, lerRegraDeRepasse(loja.deliveryConfig), loja.deliveryZones);
        notasDeEntrega = notasDaEntrega(entrega, { canal: "balcao", taxaCobrada });
      }
    } catch (e: any) {
      // Medida da entrega é informação, não trava: a venda do balcão sai.
      console.error(`[Presencial] entrega da loja ${targetFranchiseeId} sem medida:`, e?.message || e);
    }
  }

  // Estoque disponível: o balcão também vende o que a loja disse ter.
  //
  // DEPOIS da medida da entrega, e não antes: sem a cotação do PDV, a medida
  // espera o mapa até 10 s. Com o estoque conferido antes, a janela entre
  // conferir e baixar passava de milissegundos para 10 s — o atendente B
  // vendia a última unidade no meio, os dois passavam e o estoque ia a −1,
  // com dois pedidos na cozinha para uma unidade.
  const estoque = await conferirEstoque(targetFranchiseeId, items || []);
  if (!estoque.ok) {
    return NextResponse.json({ error: `${estoque.mensagem} Ajuste a venda.` }, { status: 409 });
  }

  const notasDoPedido = [String(notes || "").trim(), ...notasDeEntrega].filter(Boolean).join(" ");

  const dailyOrderNumber = await generateDailyOrderNumber(targetFranchiseeId);

  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: targetFranchiseeId,
      dailyOrderNumber,
      customerName: customerName || (employeeName ? `Func. ${employeeName}` : "Balcão"),
      // O carimbo continua para o banco (a coluna é obrigatória), mas quem
      // decide se dá para mandar mensagem é lib/telefone.ts — e ele recusa
      // este número. Ver a notificação no fim desta rota.
      customerPhone: customerPhone || "00000000000",
      customerAddress: customerAddress || "",
      deliveryType: deliveryType || "RETIRADA",
      paymentMethod: paymentMethod || "Dinheiro",
      ...(paymentMethods ? { paymentMethods } : {}),
      changeAmount: changeAmount ? Number(changeAmount) : (change ? Number(change) : null),
      employeeId: employeeId || null,
      employeeName: employeeName || null,
      notes: notasDoPedido,
      // O pager fica em campo PRÓPRIO, não embutido no nome: é assim que o
      // painel consegue mostrá-lo com destaque no card e que, amanhã, o
      // Assistente pode passar a imprimi-lo como linha dedicada. Quem junta os
      // dois é só a montagem da comanda (lib/pager.ts).
      ...(pagerNumber ? { pagerNumber } : {}),
      // O documento fica em campo PRÓPRIO, limpo, sem máscara: é dele que a
      // emissão fiscal lê o destinatário. Quem junta documento e nome é só a
      // montagem da comanda (lib/documento-do-cliente.ts).
      ...(customerCpfCnpj ? { customerCpfCnpj } : {}),
      totalAmount: totalAmount || 0,
      // ── DESCONTO DADO NO BALCÃO/MESA ─────────────────────────────────
      //
      // Fica REGISTRADO, não só abatido do total: a mensalidade é sobre o
      // bruto do pedido (lib/billing.ts, faturamentoBruto = totalAmount +
      // discountTotal) e, sem gravar, o desconto sumia do total e encolhia a
      // base de cobrança junto. O motivo vai na observação, que sai impressa.
      ...(Number(discountTotal) > 0
        ? {
            discountTotal: Math.round(Number(discountTotal) * 100) / 100,
            discountMerchant: Math.round(Number(discountMerchant ?? discountTotal) * 100) / 100,
          }
        : {}),
      // A taxa vem do PDV, que a cota em /api/delivery-fee (mesma regra do
      // cardápio) e deixa o atendente ajustar. Aqui só o piso: entrega
      // negativa não existe, e o campo alimenta o repasse do entregador.
      deliveryFee: taxaCobrada,
      // Distância, o ponto que decidiu a taxa e o repasse da faixa (quando a
      // loja separa) — os mesmos campos do pedido do site (R7).
      ...(camposDeEntrega?.deliveryDistance != null ? { deliveryDistance: camposDeEntrega.deliveryDistance } : {}),
      ...(camposDeEntrega?.customerLatLng ? { customerLatLng: camposDeEntrega.customerLatLng } : {}),
      ...(camposDeEntrega?.motoboyFee != null ? { motoboyFee: camposDeEntrega.motoboyFee } : {}),
      status: "ACEITO",
      source: "PRESENCIAL",
      items: {
        create: items.map((item: any) => ({
          menuProductId: item.menuProductId,
          quantity: item.quantity,
          // O NOME NO MOMENTO DA VENDA. Sem ele, quem lê `productName` sem cair
          // na relação mostra "item" no lugar do nome — foi o que apareceu na
          // tela de editar itens. E é o que guarda a venda de um produto que
          // for renomeado ou apagado do cardápio depois.
          productName: nomeDoProduto.get(item.menuProductId) || item.productName || item.name || null,
          price: item.price,
          comboSelections: item.comboSelections ? (typeof item.comboSelections === "string" ? item.comboSelections : JSON.stringify(item.comboSelections)) : null,
          // Observação do item ("tirar o milho"): a coluna existia, a cozinha
          // e a comanda já a imprimem, mas o balcão nunca a gravava.
          notes: item.notes ? String(item.notes).trim().slice(0, 200) || null : null,
        })),
      },
    },
  });

  // Realiza a baixa imediata no estoque do pedido presencial
  const { deductStockForOrder } = await import("@/lib/stock");
  deductStockForOrder(order.id).catch(err =>
    console.error("[Stock] Erro ao deduzir estoque de pedido presencial:", err)
  );

  // Enfileira impressão automática da Via de Retirada/Comanda na impressora térmica
  try {
    const fullOrder = await prisma.customerOrder.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            menuProduct: { select: { id: true, name: true, isBeverage: true } }
          }
        }
      }
    });

    if (fullOrder) {
      const { pushJobToPrintQueue } = await import("@/app/api/store/print-queue/route");
      pushJobToPrintQueue(targetFranchiseeId, fullOrder, dbUser.ownerId ? "FIREHUB" : "HAKIM RIO DAS OSTRAS");
    }
  } catch (printErr) {
    console.error("[Presencial] Erro ao enfileirar impressão automática:", printErr);
  }

  // ── O CLIENTE DO BALCÃO TAMBÉM RECEBE AS MENSAGENS ────────────────────
  //
  // O campo de telefone no balcão é opcional e existia só para a busca e
  // para a campanha de recuperação: quem dava o número não recebia nada — nem
  // "pedido recebido", nem "em preparo", nem "pronto". O atendente pedia o
  // telefone e o cliente não via retorno nenhum, o que é a melhor forma de
  // ensinar a equipe a parar de pedir.
  //
  // Só quando o número é de verdade: `telefoneDeVerdade` recusa o carimbo
  // "00000000000" que esta rota grava quando o campo vem vazio. E não bloqueia
  // a resposta — venda de balcão não pode esperar WhatsApp.
  if (telefoneDeVerdade(customerPhone)) {
    import("@/lib/order-notifications")
      .then(({ sendOrderNotification }) => sendOrderNotification(order.id, "CREATED"))
      .catch((err) => console.warn("[Presencial] notificação CREATED:", err?.message || err));
  }

  // `avisosDeEntrega`: as mesmas etiquetas que foram para a observação
  // (fora da área, não localizado, aproximado, taxa diferente da tabela), para
  // o PDV poder mostrar ao atendente sem abrir o pedido.
  return NextResponse.json({ success: true, orderId: order.id, avisosDeEntrega: notasDeEntrega });
}
