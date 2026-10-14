/**
 * O QUE O BILL, SEU ASSESSOR SABE FAZER — cada ferramenta grava pelo MESMO caminho
 * da tela do painel, nunca por um atalho próprio:
 *
 *   registrar_compra        → lib/cmv/lancar-compra.ts (estoque com custo +
 *                              conta paga ou a prazo, numa transação só — o
 *                              "comprei 10 Coca lata por 45" do Douglas)
 *   registrar_saida         → o movimento da aba Movimentações do Estoque
 *   registrar_despesa       → DespesaLancada (o "Lançar despesa" do DRE)
 *   registrar_conta_a_pagar → Payable PENDING (Contas a Pagar)
 *   marcar_conta_paga       → o "Paguei" das Contas a Pagar
 *   consultar_*             → só leitura
 *   desfazer_ultimo_registro→ o desfazer de cada tela (compra desfeita com
 *                              estorno, despesa apagada, conta reaberta…)
 *
 * Tudo filtrado pela loja do contexto (`franchiseeId`), que o webhook tira da
 * instância do WhatsApp e o painel tira da sessão — nunca do que a IA mandou.
 * Cada gravação vira um AssessorRegistro: é o que o dono vê no painel e o que
 * "desfaz" desfaz.
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { lancarCompra, desfazerCompra, CompraRecusadaError, type ItemDaCompra, type PagamentoDaCompra } from "@/lib/cmv/lancar-compra";
import { converter, normalizarUnidade } from "@/lib/unidades";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { garantirEstruturaDeDespesas } from "@/lib/garantir-colunas";
import { buscarNoCardapio, pausarOuReativar, listarPausados, abrirOuFecharSite, desfazerNoCardapio } from "./cardapio";

export type ContextoDoAssessor = {
  franchiseeId: string;
  /** Quem grava (o dono): vai em criadoPor/userId das telas. */
  usuarioId: string;
  timezone?: string | null;
  canal: "WHATSAPP" | "PAINEL";
  telefone?: string | null;
  /** Foto que veio na mensagem, já salva (vai para a compra). */
  imagemUrl?: string | null;
  /** A mensagem trouxe foto (a compra entra como "nota com foto"). */
  comFoto?: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "").replace(".", ","));
const dataDoDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`);

function diaValido(dia: unknown, ctx: ContextoDoAssessor): string {
  const d = String(dia ?? "").trim();
  return DIA_RE.test(d) ? d : hojeNaLoja(ctx.timezone);
}

async function registrar(ctx: ContextoDoAssessor, tipo: string, resumo: string, refs: Record<string, unknown>) {
  try {
    await prisma.assessorRegistro.create({
      data: { franchiseeId: ctx.franchiseeId, tipo, resumo: resumo.slice(0, 500), refs: refs as any, canal: ctx.canal, telefone: ctx.telefone || null },
    });
  } catch (err: any) {
    // O lançamento já está gravado; perder a linha do histórico não pode
    // fazer o dono achar que nada aconteceu.
    console.error("[Assessor] Não gravou o registro:", err?.message);
  }
}

// ── Declarações para o Gemini ─────────────────────────────────────────────

export const DECLARACOES_DO_ASSESSOR = [
  {
    name: "registrar_compra",
    description:
      "Mercadoria que ENTRA no estoque (insumo, bebida, embalagem) — com ou sem nota. Lança a quantidade no estoque E o valor no financeiro de uma vez. Use para 'comprei', 'chegou', 'recebi do fornecedor', foto de nota/cupom de compra.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        itens: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              insumoId: { type: Type.STRING, description: "id do insumo da lista ESTOQUE DA LOJA. Omita se não existir lá (será criado)." },
              nome: { type: Type.STRING, description: "nome do item, limpo (ex.: 'Coca-Cola lata 350ml')" },
              quantidade: { type: Type.NUMBER, description: "quantidade NA UNIDADE informada em 'unidade'" },
              unidade: { type: Type.STRING, description: "un, kg, g, l, ml — prefira a unidade do insumo cadastrado" },
              valorTotal: { type: Type.NUMBER, description: "valor TOTAL pago por esta linha em reais (não o unitário). Omita se não informado." },
              foraDoEstoque: { type: Type.BOOLEAN, description: "true para o que veio na nota mas não é controlado no estoque (detergente, papel higiênico, material de escritório): entra no valor pago, não no estoque" },
            },
            required: ["nome", "quantidade", "unidade"],
          },
        },
        valorTotalDaCompra: { type: Type.NUMBER, description: "o total pago pela compra inteira quando ele não disse o valor de cada item — o sistema reparte pelo último custo de cada um" },
        fornecedor: { type: Type.STRING, description: "onde comprou (Atacadão, distribuidora...), se dito" },
        pagamento: { type: Type.STRING, enum: ["PAGO", "A_PRAZO", "SEM_VALOR"], description: "PAGO = já pagou; A_PRAZO = boleto/fiado com vencimento; SEM_VALOR = o dono não sabe/não quer lançar o valor" },
        meio: { type: Type.STRING, enum: ["DINHEIRO", "PIX", "CARTAO", "BOLETO"], description: "como pagou, se dito" },
        vencimento: { type: Type.STRING, description: "YYYY-MM-DD, obrigatório quando A_PRAZO" },
        numeroNota: { type: Type.STRING },
        dia: { type: Type.STRING, description: "YYYY-MM-DD em que a mercadoria chegou; omita = hoje" },
      },
      required: ["itens", "pagamento"],
    },
  },
  {
    name: "registrar_saida",
    description: "Tira do estoque sem venda: perda, vencido, quebrou, jogou fora, consumo da equipe, levou para outra loja.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        insumoId: { type: Type.STRING, description: "id do insumo da lista ESTOQUE DA LOJA" },
        quantidade: { type: Type.NUMBER },
        unidade: { type: Type.STRING, description: "unidade da quantidade dita (un, kg, g, l, ml)" },
        motivo: { type: Type.STRING, enum: ["PERDA", "USO", "OUTRO"], description: "PERDA = estragou/venceu/quebrou; USO = consumo interno/equipe; OUTRO" },
        observacao: { type: Type.STRING },
      },
      required: ["insumoId", "quantidade", "motivo"],
    },
  },
  {
    name: "registrar_despesa",
    description: "Gasto que JÁ FOI PAGO e não é mercadoria de estoque: gás, conserto, diária, motoboy extra, anúncio, material de limpeza, aluguel pago agora.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoria: { type: Type.STRING, description: "curta, reaproveite as CATEGORIAS JÁ USADAS quando couber (ex.: Gás, Manutenção, Pessoal, Marketing)" },
        descricao: { type: Type.STRING },
        valor: { type: Type.NUMBER },
        dia: { type: Type.STRING, description: "YYYY-MM-DD; omita = hoje" },
      },
      required: ["categoria", "valor"],
    },
  },
  {
    name: "registrar_conta_a_pagar",
    description: "Conta que AINDA VAI SER PAGA, com vencimento: boleto que chegou, conta de luz/água, parcela, fornecedor a prazo sem mercadoria.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        fornecedor: { type: Type.STRING, description: "a quem paga (Enel, Águas, fornecedor...)" },
        valor: { type: Type.NUMBER },
        vencimento: { type: Type.STRING, description: "YYYY-MM-DD" },
        codigoDeBarras: { type: Type.STRING, description: "linha digitável, só números, se aparecer na foto" },
      },
      required: ["fornecedor", "valor", "vencimento"],
    },
  },
  {
    name: "consultar_contas_a_pagar",
    description: "Lista as contas em aberto (para responder ou para achar o id antes de marcar como paga).",
    parameters: { type: Type.OBJECT, properties: { busca: { type: Type.STRING, description: "parte do nome; vazio = todas" } } },
  },
  {
    name: "marcar_conta_paga",
    description: "Muda o status de uma conta em aberto para PAGA ('paguei o boleto da Enel'). Pegue o id em consultar_contas_a_pagar.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        contaId: { type: Type.STRING },
        meio: { type: Type.STRING, enum: ["DINHEIRO", "PIX", "CARTAO", "BOLETO"] },
        pagoEm: { type: Type.STRING, description: "YYYY-MM-DD; omita = hoje" },
      },
      required: ["contaId"],
    },
  },
  {
    name: "consultar_estoque",
    description: "Quantidade atual de um ou mais itens, ou o que está abaixo do mínimo.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        busca: { type: Type.STRING, description: "parte do nome; vazio = tudo" },
        soAbaixoDoMinimo: { type: Type.BOOLEAN },
      },
    },
  },
  {
    name: "buscar_no_cardapio",
    description: "Acha itens do cardápio da loja pelo nome (com id e se está à venda ou pausado). Use antes de pausar/reativar.",
    parameters: { type: Type.OBJECT, properties: { busca: { type: Type.STRING, description: "palavras do nome: 'esfirra frango', 'coca 2l'" } }, required: ["busca"] },
  },
  {
    name: "pausar_ou_reativar_itens",
    description: "Pausa (acabou, tira do cardápio) ou reativa (voltou, abre de novo) itens do cardápio — some/volta no site, robô, balcão, totem e dentro dos combos.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        produtoIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "ids vindos de buscar_no_cardapio" },
        ativo: { type: Type.BOOLEAN, description: "false = pausar; true = reativar" },
      },
      required: ["produtoIds", "ativo"],
    },
  },
  {
    name: "listar_itens_pausados",
    description: "Lista o que está pausado no cardápio, por categoria.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "abrir_ou_fechar_site",
    description: "Abre ou fecha o site/robô da loja para pedidos ('fecha a loja', 'tô sem motoboy, fecha', 'pode abrir').",
    parameters: { type: Type.OBJECT, properties: { aberto: { type: Type.BOOLEAN } }, required: ["aberto"] },
  },
  {
    name: "desfazer_ultimo_registro",
    description: "Desfaz o último lançamento feito pelo assessor ('desfaz', 'errei', 'cancela isso').",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

/** Ferramentas que gravam: a resposta da IA sem nenhuma delas não pode dizer "lancei". */
export const FERRAMENTAS_QUE_GRAVAM = new Set([
  "registrar_compra", "registrar_saida", "registrar_despesa", "registrar_conta_a_pagar", "marcar_conta_paga", "desfazer_ultimo_registro",
  "pausar_ou_reativar_itens", "abrir_ou_fechar_site",
]);

// ── Execução ──────────────────────────────────────────────────────────────

export async function executarFerramentaDoAssessor(nome: string, args: any, ctx: ContextoDoAssessor): Promise<Record<string, unknown>> {
  try {
    switch (nome) {
      case "registrar_compra": return await registrarCompra(args, ctx);
      case "registrar_saida": return await registrarSaida(args, ctx);
      case "registrar_despesa": return await registrarDespesa(args, ctx);
      case "registrar_conta_a_pagar": return await registrarContaAPagar(args, ctx);
      case "consultar_contas_a_pagar": return await consultarContas(args, ctx);
      case "marcar_conta_paga": return await marcarContaPaga(args, ctx);
      case "consultar_estoque": return await consultarEstoque(args, ctx);
      case "desfazer_ultimo_registro": return await desfazerUltimo(ctx);
      case "buscar_no_cardapio": return await buscarNoCardapio(args, ctx);
      case "pausar_ou_reativar_itens": return await pausarOuReativar(args, ctx);
      case "listar_itens_pausados": return await listarPausados(args, ctx);
      case "abrir_ou_fechar_site": return await abrirOuFecharSite(args, ctx);
      default: return { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
    }
  } catch (err: any) {
    if (err instanceof CompraRecusadaError) return { ok: false, erro: err.message };
    console.error(`[Assessor] ${nome} falhou:`, err);
    return { ok: false, erro: "Erro ao gravar. Nada foi lançado." };
  }
}

async function registrarCompra(args: any, ctx: ContextoDoAssessor) {
  const itensIa: any[] = Array.isArray(args?.itens) ? args.itens : [];
  if (!itensIa.length) return { ok: false, erro: "Nenhum item na compra." };

  // O id que a IA mandou só vale se for desta loja; senão o item entra pelo nome.
  const ids = itensIa.map((i) => String(i?.insumoId || "")).filter(Boolean);
  const daLoja = new Set(
    (await prisma.stockItem.findMany({ where: { id: { in: ids }, franchiseeId: ctx.franchiseeId }, select: { id: true } })).map((x) => x.id),
  );

  const itens: ItemDaCompra[] = itensIa.map((i) => {
    const id = String(i?.insumoId || "");
    const valorTotal = lerNumeroBr(i?.valorTotal);
    return {
      stockItemId: i?.foraDoEstoque === true ? "IGNORAR" : id && daLoja.has(id) ? id : "NEW",
      nome: String(i?.nome || "").trim(),
      newItemName: String(i?.nome || "").trim(),
      newItemUnit: normalizarUnidade(i?.unidade) || "un",
      quantidade: lerNumeroBr(i?.quantidade),
      unidade: normalizarUnidade(i?.unidade) || undefined,
      ...(Number.isFinite(valorTotal) && valorTotal > 0 ? { valorTotal: r2(valorTotal) } : {}),
    };
  });

  // Um total só para vários itens ("deu 230 tudo"): reparte pelo último custo
  // de cada insumo, que é o que o dono faria de cabeça. Item sem custo
  // conhecido só entra se for o único sem valor (fica com a sobra).
  const totalDaCompra = lerNumeroBr(args?.valorTotalDaCompra);
  const semValor = itens.filter((i) => !(Number(i.valorTotal) > 0));
  if (Number.isFinite(totalDaCompra) && totalDaCompra > 0 && semValor.length > 0) {
    const jaComValor = r2(itens.reduce((s, i) => s + (Number(i.valorTotal) || 0), 0));
    const sobra = r2(totalDaCompra - jaComValor);
    if (sobra <= 0) return { ok: false, erro: "Os valores dos itens já passam do total da compra. Pergunte o valor de cada item." };
    const custos = new Map(
      (await prisma.stockItem.findMany({ where: { id: { in: semValor.map((i) => i.stockItemId).filter((id) => id !== "NEW") }, franchiseeId: ctx.franchiseeId }, select: { id: true, unit: true, unitCost: true } }))
        .map((x) => [x.id, x]),
    );
    const pesos = semValor.map((i) => {
      const c = custos.get(i.stockItemId);
      if (!c?.unitCost) return null;
      const q = converter(Number(i.quantidade), i.unidade || c.unit, normalizarUnidade(c.unit) || c.unit);
      return q === null ? null : q * c.unitCost;
    });
    if (semValor.length === 1) semValor[0].valorTotal = sobra;
    else if (pesos.some((p) => p === null)) {
      const sem = semValor.filter((_, k) => pesos[k] === null).map((i) => i.nome).join(", ");
      return { ok: false, erro: `Não dá para repartir o total: ${sem} ainda não tem custo no sistema. Pergunte o valor desse(s) item(ns).` };
    } else {
      const soma = (pesos as number[]).reduce((a, b) => a + b, 0);
      let distribuido = 0;
      semValor.forEach((i, k) => {
        const v = k === semValor.length - 1 ? r2(sobra - distribuido) : r2((sobra * (pesos[k] as number)) / soma);
        i.valorTotal = v;
        distribuido = r2(distribuido + v);
      });
    }
  }

  const total = r2(itens.reduce((s, i) => s + (Number(i.valorTotal) || 0), 0));
  const forma = String(args?.pagamento || "PAGO");
  const meio = args?.meio ? String(args.meio) : undefined;
  let pagamento: PagamentoDaCompra;
  if (forma === "SEM_VALOR" || total <= 0) pagamento = { forma: "NAO_LANCAR" };
  else if (forma === "A_PRAZO") {
    const venc = String(args?.vencimento || "");
    if (!DIA_RE.test(venc)) return { ok: false, erro: "Compra a prazo sem vencimento: pergunte a data do vencimento." };
    pagamento = { forma: "A_PRAZO", meio: meio || "BOLETO", parcelas: [{ vencimento: venc, valor: total }] };
  } else pagamento = { forma: "PAGO", meio };

  const dia = diaValido(args?.dia, ctx);
  const r = await prisma.$transaction((tx) =>
    lancarCompra(tx, {
      franchiseeId: ctx.franchiseeId,
      usuarioId: ctx.usuarioId,
      dia,
      origem: ctx.imagemUrl || ctx.comFoto ? "NFE" : "SEM_NOTA",
      fornecedor: args?.fornecedor ? String(args.fornecedor) : null,
      numero: args?.numeroNota ? String(args.numeroNota) : null,
      imageUrl: ctx.imagemUrl || null,
      itens,
      pagamento,
    }),
  );

  // O saldo de cada item depois da entrada, para a resposta ao dono.
  const movs = await prisma.stockTransaction.findMany({
    where: { stockInvoiceId: r.invoiceId, type: "INPUT" },
    select: { quantity: true, stockItem: { select: { name: true, unit: true, quantity: true } } },
  });
  const linhas = movs.map((m) => `${m.stockItem.name}: +${qtd(m.quantity)} ${m.stockItem.unit} (agora ${qtd(m.stockItem.quantity)} ${m.stockItem.unit})`);
  const financeiro =
    pagamento.forma === "PAGO" ? `${reais(r.valorDaCompra)} lançado como pago`
    : pagamento.forma === "A_PRAZO" ? `${reais(r.valorDaCompra)} em contas a pagar, vence ${pagamento.parcelas[0].vencimento.split("-").reverse().join("/")}`
    : "sem valor no financeiro";
  const resumo = `Compra${args?.fornecedor ? ` (${args.fornecedor})` : ""}: ${movs.map((m) => `${qtd(m.quantity)} ${m.stockItem.unit} ${m.stockItem.name}`).join(", ")} — ${financeiro}`;
  await registrar(ctx, "COMPRA", resumo, { invoiceId: r.invoiceId });
  return { ok: true, estoque: linhas, financeiro, insumosNovosCriados: r.insumosCriados, dia };
}

async function acharInsumo(id: unknown, ctx: ContextoDoAssessor) {
  return prisma.stockItem.findFirst({
    where: { id: String(id || ""), franchiseeId: ctx.franchiseeId, active: true },
    select: { id: true, name: true, unit: true, quantity: true, unitCost: true },
  });
}

async function registrarSaida(args: any, ctx: ContextoDoAssessor) {
  const insumo = await acharInsumo(args?.insumoId, ctx);
  if (!insumo) return { ok: false, erro: "Item não encontrado no estoque da loja. Confira o nome com consultar_estoque." };
  const q = lerNumeroBr(args?.quantidade);
  if (!Number.isFinite(q) || q <= 0) return { ok: false, erro: "Quantidade inválida." };
  const unidadeDoInsumo = normalizarUnidade(insumo.unit) || "un";
  const unidadeDita = normalizarUnidade(args?.unidade) || unidadeDoInsumo;
  const convertida = converter(q, unidadeDita, unidadeDoInsumo);
  if (convertida === null) return { ok: false, erro: `"${insumo.name}" é controlado em ${unidadeDoInsumo}; pergunte a quantidade nessa unidade.` };

  const motivo = String(args?.motivo || "OUTRO");
  const type = motivo === "PERDA" ? "WASTE" : "OUTPUT";
  const rotulo = motivo === "PERDA" ? "Perda" : motivo === "USO" ? "Consumo interno" : "Saída";
  const notes = `${rotulo} pelo ${ctx.canal === "PAINEL" ? "painel" : "WhatsApp"} (Bill)${args?.observacao ? ` — ${String(args.observacao).slice(0, 150)}` : ""}`;

  const { mov, item } = await prisma.$transaction(async (tx) => {
    const mov = await tx.stockTransaction.create({
      data: { stockItemId: insumo.id, franchiseeId: ctx.franchiseeId, userId: ctx.usuarioId, quantity: -convertida, type, notes, unitCost: insumo.unitCost ?? null },
    });
    const item = await tx.stockItem.update({ where: { id: insumo.id, franchiseeId: ctx.franchiseeId }, data: { quantity: { decrement: convertida } } });
    return { mov, item };
  });
  const resumo = `${rotulo}: ${qtd(convertida)} ${unidadeDoInsumo} de ${insumo.name}`;
  await registrar(ctx, "SAIDA", resumo, { transacaoId: mov.id, stockItemId: insumo.id, quantidade: convertida, type });
  return { ok: true, item: insumo.name, saiu: `${qtd(convertida)} ${unidadeDoInsumo}`, agora: `${qtd(item.quantity)} ${unidadeDoInsumo}`, valorPerdido: insumo.unitCost ? reais(insumo.unitCost * convertida) : null };
}

async function registrarDespesa(args: any, ctx: ContextoDoAssessor) {
  if (!(await garantirEstruturaDeDespesas())) return { ok: false, erro: "Lançamento de despesas indisponível agora." };
  const valor = lerNumeroBr(args?.valor);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 1_000_000) return { ok: false, erro: "Valor inválido: pergunte o valor." };
  const categoria = String(args?.categoria || "").trim().slice(0, 60);
  if (!categoria) return { ok: false, erro: "Sem categoria." };
  const dia = diaValido(args?.dia, ctx);
  const bruta = String(args?.descricao || "").trim().slice(0, 200);
  // "Gás (Gás)" não diz nada: descrição igual à categoria fica vazia.
  const descricao = bruta && bruta.toLowerCase() !== categoria.toLowerCase() ? bruta : null;
  const d = await prisma.despesaLancada.create({
    data: { franchiseeId: ctx.franchiseeId, dia, categoria, descricao, valor: r2(valor), criadoPor: `Bill (${ctx.canal === "PAINEL" ? "painel" : "WhatsApp"})` },
  });
  const resumo = `Despesa ${categoria}${descricao ? ` (${descricao})` : ""}: ${reais(r2(valor))}`;
  await registrar(ctx, "DESPESA", resumo, { despesaId: d.id });
  return { ok: true, lancado: resumo, dia };
}

async function registrarContaAPagar(args: any, ctx: ContextoDoAssessor) {
  const valor = lerNumeroBr(args?.valor);
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: "Valor inválido." };
  const venc = String(args?.vencimento || "");
  if (!DIA_RE.test(venc)) return { ok: false, erro: "Sem vencimento: pergunte a data." };
  const fornecedor = String(args?.fornecedor || "").trim().slice(0, 120) || "Conta";
  const hoje = hojeNaLoja(ctx.timezone);
  const p = await prisma.payable.create({
    data: {
      franchiseeId: ctx.franchiseeId,
      supplierName: fornecedor,
      barcode: args?.codigoDeBarras ? String(args.codigoDeBarras).replace(/\D/g, "").slice(0, 60) || null : null,
      receivedDate: dataDoDia(hoje),
      dueDate: dataDoDia(venc),
      value: r2(valor),
      status: "PENDING",
      paymentType: "BOLETO",
    },
  });
  const resumo = `Conta a pagar ${fornecedor}: ${reais(r2(valor))}, vence ${venc.split("-").reverse().join("/")}`;
  await registrar(ctx, "CONTA", resumo, { payableId: p.id });
  return { ok: true, lancado: resumo };
}

async function consultarContas(args: any, ctx: ContextoDoAssessor) {
  const busca = String(args?.busca || "").trim();
  const contas = await prisma.payable.findMany({
    where: { franchiseeId: ctx.franchiseeId, status: { not: "PAID" }, ...(busca ? { supplierName: { contains: busca, mode: "insensitive" } } : {}) },
    orderBy: { dueDate: "asc" },
    take: 30,
    select: { id: true, supplierName: true, value: true, dueDate: true },
  });
  return {
    ok: true,
    contas: contas.map((c) => ({ id: c.id, nome: c.supplierName, valor: reais(c.value), vencimento: c.dueDate.toISOString().slice(0, 10) })),
  };
}

async function marcarContaPaga(args: any, ctx: ContextoDoAssessor) {
  const conta = await prisma.payable.findFirst({ where: { id: String(args?.contaId || ""), franchiseeId: ctx.franchiseeId } });
  if (!conta) return { ok: false, erro: "Conta não encontrada. Use consultar_contas_a_pagar." };
  if (conta.status === "PAID") return { ok: false, erro: "Essa conta já estava paga." };
  const dia = diaValido(args?.pagoEm, ctx);
  await prisma.payable.update({
    where: { id: conta.id },
    data: { status: "PAID", paidDate: dataDoDia(dia), ...(args?.meio ? { paymentType: String(args.meio) } : {}) },
  });
  const resumo = `Conta paga: ${conta.supplierName} ${reais(conta.value)}`;
  await registrar(ctx, "CONTA_PAGA", resumo, { payableId: conta.id, statusAnterior: conta.status, paymentTypeAnterior: conta.paymentType });
  return { ok: true, lancado: resumo };
}

async function consultarEstoque(args: any, ctx: ContextoDoAssessor) {
  const busca = String(args?.busca || "").trim();
  const itens = await prisma.stockItem.findMany({
    where: { franchiseeId: ctx.franchiseeId, active: true, ...(busca ? { name: { contains: busca, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    take: 200,
    select: { name: true, unit: true, quantity: true, minQuantity: true, unitCost: true },
  });
  const lista = itens
    .filter((i) => !args?.soAbaixoDoMinimo || (i.minQuantity != null && i.quantity <= i.minQuantity))
    .map((i) => ({
      item: i.name,
      tem: `${qtd(i.quantity)} ${i.unit}`,
      minimo: i.minQuantity != null ? `${qtd(i.minQuantity)} ${i.unit}` : null,
      abaixoDoMinimo: i.minQuantity != null && i.quantity <= i.minQuantity,
      valorEmEstoque: i.unitCost ? reais(Math.max(0, i.quantity) * i.unitCost) : null,
    }));
  return { ok: true, itens: lista, observacao: lista.length ? undefined : "Nada encontrado com esse nome." };
}

async function desfazerUltimo(ctx: ContextoDoAssessor) {
  const ultimo = await prisma.assessorRegistro.findFirst({
    where: { franchiseeId: ctx.franchiseeId, desfeitoEm: null },
    orderBy: { criadoEm: "desc" },
  });
  if (!ultimo) return { ok: false, erro: "Não há lançamento do assessor para desfazer." };
  const refs = (ultimo.refs || {}) as any;

  if (ultimo.tipo === "COMPRA") {
    await prisma.$transaction((tx) => desfazerCompra(tx, { franchiseeId: ctx.franchiseeId, usuarioId: ctx.usuarioId, invoiceId: refs.invoiceId }));
  } else if (ultimo.tipo === "DESPESA") {
    await prisma.despesaLancada.deleteMany({ where: { id: refs.despesaId, franchiseeId: ctx.franchiseeId } });
  } else if (ultimo.tipo === "CONTA") {
    const apagadas = await prisma.payable.deleteMany({ where: { id: refs.payableId, franchiseeId: ctx.franchiseeId, status: { not: "PAID" } } });
    if (apagadas.count === 0) return { ok: false, erro: "Essa conta já foi paga; desfaça pelo painel em Contas a Pagar." };
  } else if (ultimo.tipo === "CONTA_PAGA") {
    await prisma.payable.updateMany({
      where: { id: refs.payableId, franchiseeId: ctx.franchiseeId },
      data: { status: refs.statusAnterior || "PENDING", paidDate: null, paymentType: refs.paymentTypeAnterior ?? undefined },
    });
  } else if (ultimo.tipo === "SAIDA") {
    // Movimento contrário do MESMO tipo: a soma por tipo (perdas do mês) zera,
    // e o histórico continua mostrando o que aconteceu.
    await prisma.$transaction(async (tx) => {
      await tx.stockTransaction.create({
        data: { stockItemId: refs.stockItemId, franchiseeId: ctx.franchiseeId, userId: ctx.usuarioId, quantity: refs.quantidade, type: refs.type, notes: "Saída desfeita (Bill)" },
      });
      await tx.stockItem.updateMany({ where: { id: refs.stockItemId, franchiseeId: ctx.franchiseeId }, data: { quantity: { increment: refs.quantidade } } });
    });
  } else if (ultimo.tipo === "PAUSADO" || ultimo.tipo === "REATIVADO" || ultimo.tipo === "SITE") {
    await desfazerNoCardapio(ultimo.tipo, refs, ctx);
  } else {
    return { ok: false, erro: "Esse lançamento não se desfaz por aqui." };
  }
  await prisma.assessorRegistro.update({ where: { id: ultimo.id }, data: { desfeitoEm: new Date() } });
  return { ok: true, desfeito: ultimo.resumo };
}
