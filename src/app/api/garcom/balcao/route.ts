/**
 * POST /api/garcom/balcao
 *
 * O pedido de BALCÃO lançado pelo garçom no celular, pelo link dele.
 *
 * Pedido do Allan (Delicias de Casa), decidido pelo Douglas em 17/10/2026: o
 * garçom tira o pedido de quem está na fila do balcão para adiantar, em vez
 * de só lançar em mesa. Vem DESLIGADO para todo garçom — o dono liga em
 * Garçons › editar › "Pode fazer pedido de balcão" (Waiter.podeFazerBalcao).
 *
 * ── A trava é AQUI, não no botão ────────────────────────────────────────────
 *
 * A tela só mostra "Balcão" para quem pode, mas quem decide é esta rota, a
 * cada pedido, lendo o banco (autenticarGarcom relê o garçom em toda
 * requisição): o dono que desmarca a caixinha corta o próximo pedido daquele
 * celular, mesmo com a tela aberta desde antes.
 *
 * ── O pedido é o do balcão do PDV ───────────────────────────────────────────
 *
 * Quem grava é lib/venda-presencial.ts, a MESMA regra de
 * api/store/orders/presencial: source PRESENCIAL, RETIRADA, status ACEITO,
 * caixa aberto, mensalidade, pager obrigatório, estoque, comanda na fila de
 * impressão, forma de pagamento no fechamento do caixa. Esta rota só monta um
 * corpo RESTRITO do que o garçom pode fazer:
 *
 *   - só balcão (nada de delivery nem mesa por aqui — mesa é add-order);
 *   - preço do SALÃO recalculado no servidor (lib/itens-do-salao.ts), nunca
 *     o do corpo; o total é a soma desses preços;
 *   - forma de pagamento da lista do balcão, sem "Conta Funcionário", sem
 *     pagamento dividido, sem desconto e sem taxa;
 *   - o nome do garçom vai na observação, que sai na comanda e no pedido —
 *     é como o caixa sabe quem tirou.
 *
 * Só a sessão do GARÇOM serve (cookie do link). O painel tem o PDV.
 */
import { NextResponse } from "next/server";
import { autenticarGarcom } from "@/lib/garcom-auth";
import { validarItensDoSalao, type ItemParaLancar } from "@/lib/itens-do-salao";
import { registrarVendaPresencial } from "@/lib/venda-presencial";
import { FORMAS_DE_PAGAMENTO_DO_BALCAO } from "@/lib/balcao-config";

export const dynamic = "force-dynamic";

/** Recusa de quem não tem a caixinha marcada. A tela lê o `codigo`. */
const BALCAO_NAO_LIBERADO = "BALCAO_NAO_LIBERADO";

/** Um pedido de balcão de verdade cabe com folga; acima disto é requisição montada. */
const MAXIMO_DE_LINHAS = 80;

export async function POST(req: Request) {
  const auth = await autenticarGarcom();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.erro, codigo: auth.codigo }, { status: auth.status });
  }
  const garcom = auth.garcom;

  if (!garcom.podeFazerBalcao) {
    return NextResponse.json(
      {
        error: "Pedido de balcão não está liberado para o seu acesso. Peça ao gerente para marcar \"Pode fazer pedido de balcão\" no seu cadastro de garçom.",
        codigo: BALCAO_NAO_LIBERADO,
      },
      { status: 403 },
    );
  }

  let data: any;
  try {
    data = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const formaDePagamento = String(data?.paymentMethod ?? "").trim();
  if (!FORMAS_DE_PAGAMENTO_DO_BALCAO.includes(formaDePagamento)) {
    return NextResponse.json({ error: "Escolha a forma de pagamento do pedido de balcão." }, { status: 400 });
  }

  const itensDoCorpo: unknown[] = Array.isArray(data?.items) ? data.items : [];
  if (itensDoCorpo.length === 0) {
    return NextResponse.json({ error: "Nenhum item no pedido." }, { status: 400 });
  }
  if (itensDoCorpo.length > MAXIMO_DE_LINHAS) {
    return NextResponse.json({ error: `Pedido grande demais (mais de ${MAXIMO_DE_LINHAS} linhas). Divida em dois.` }, { status: 400 });
  }

  // Produto, dia/horário e PREÇO conferidos como na mesa. Pessoa da mesa
  // (tableGuestId) não existe no balcão: nem passa adiante.
  const conferidos = await validarItensDoSalao({
    franchiseeId: garcom.franchiseeId,
    items: itensDoCorpo.map((i: any): ItemParaLancar => ({
      menuProductId: i?.menuProductId,
      quantity: i?.quantity,
      comboSelections: i?.comboSelections,
      notes: i?.notes,
    })),
    comoTentarDeNovo: "Atualize a tela e lance de novo.",
    ondeVende: "do balcão",
  });
  if (!conferidos.ok) {
    return NextResponse.json({ error: conferidos.error }, { status: conferidos.status });
  }

  const totalAmount = Math.round(conferidos.itens.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  const nomeDoCliente = String(data?.customerName ?? "").trim().slice(0, 80);
  const observacao = String(data?.notes ?? "").trim().slice(0, 300);

  const r = await registrarVendaPresencial({
    franchiseeId: garcom.franchiseeId,
    // O mesmo rótulo que a mesa usa para o garçom (add-order); a fila antiga
    // só o carrega.
    origemDaImpressao: "HAKIM RIO DAS OSTRAS",
    // Garçom nunca é ADMIN: loja bloqueada não lança, nem pelo celular.
    passaPeloBloqueio: false,
    data: {
      // Sem nome, a regra do balcão grava "Balcão" — igual ao PDV.
      customerName: nomeDoCliente,
      customerAddress: "Balcão",
      deliveryType: "RETIRADA",
      paymentMethod: formaDePagamento,
      pagerNumber: data?.pagerNumber,
      notes: [`Garçom: ${garcom.name}.`, observacao].filter(Boolean).join(" "),
      totalAmount,
      deliveryFee: 0,
      items: conferidos.itens.map((i) => ({
        menuProductId: i.menuProductId,
        quantity: i.quantity,
        price: i.price,
        comboSelections: i.comboSelections ?? null,
        notes: i.notes,
      })),
    },
  });

  return NextResponse.json(r.corpo, { status: r.status });
}
