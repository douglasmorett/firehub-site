/**
 * O relatório "Cancelamentos e cortesias" — o controle anti-fraude do caixa:
 * o que a LOJA tirou de venda (pedido inteiro, rodada da mesa, item tirado ou
 * quantidade diminuída) e o que deu de graça, com QUEM fez, QUANDO, o MOTIVO e
 * o VALOR.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O Alex (Hambúrgueria Avenida, salão, ~1.236 vendas/mês) veio do SWFast, e o
 * relatório mais grosso dele lá era o de cancelamentos: 29 páginas em out/2026,
 * cupom × item cancelado, por operador e motivo. É assim que o dono acha a
 * mão leve do caixa: a conta impressa, o cliente paga, o item sai da mesa e a
 * diferença some na gaveta. O FireHub já gravava quase tudo no rastro do
 * pedido (`CustomerOrder.editHistory`, RegistroDeEdicao em
 * lib/edicao-de-pedido.ts) — faltava juntar e apontar o que é estranho.
 *
 * ── De onde sai cada linha ──────────────────────────────────────────────────
 *
 *   • ITEM: registro REMOVEU/MUDOU_QTD com `itensRetirados` (desde 09/10/2026,
 *     lib/motivo-do-cancelamento.ts) — painel, quadro e mesa. Uma linha por
 *     edição. Registro antigo sem `itensRetirados` não entra: não diz o valor.
 *   • PEDIDO: pedido (ou rodada de mesa) com status cancelado. Quem: o último
 *     CANCELOU do rastro; o valor é o `totalAntes` dele (o que valia na hora),
 *     senão o `totalAmount`; os itens são os `itensRetirados` do CANCELOU (a
 *     rodada da mesa grava), senão os itens do pedido.
 *   • É DA LOJA quando o rastro tem o CANCELOU ou `cancelledBy` é LOJA. O resto
 *     (cliente no site, iFood, 99, Pix vencido, robô parado) é "por fora": vai
 *     num bloco à parte, sem operador e sem alerta — não é a mão do caixa.
 *   • CORTESIA: registro CORTESIA (lib/cortesia.ts), com `itensCortesia`.
 *
 * Tudo entra pela HORA EM QUE ACONTECEU (o `quando` do rastro, o `cancelledAt`
 * do pedido), não pela hora do pedido: a rodada lançada às 23h50 e cancelada
 * às 00h10 é cancelamento do dia em que foi cancelada. A rota busca pedidos
 * de alguns dias antes do período para isso (CANCELAMENTOS_OLHAM_PARA_TRAS_DIAS).
 *
 * ── O operador ──────────────────────────────────────────────────────────────
 *
 * O rastro grava `quem` (o nome, com "(dono)"/"(funcionário)") desde 15/09 e
 * `quemId` (o id de quem estava logado; o garçom pelo link é `garcom:<id>`)
 * desde 07/11/2026. Agrupa-se pelo id; o nome antigo sem id cai no mesmo
 * grupo quando o mesmo nome já apareceu com id. Pedido cancelado pela loja sem
 * CANCELOU no rastro (anterior ao rastro, ou caminho que não gravava) sai como
 * "Operador não registrado" — nunca é empurrado para alguém.
 *
 * ── Os alertas ──────────────────────────────────────────────────────────────
 *
 *   • DEPOIS DA CONTA: item/rodada tirado de mesa cuja conta JÁ TINHA SIDO
 *     IMPRESSA (PrintRequest CONTA_DA_MESA). É o golpe clássico.
 *   • DEPOIS DE PRONTO: a cozinha já tinha dado o pedido por pronto (ou ele
 *     já tinha saído): a comida foi feita.
 *   • DEPOIS DA COZINHA: a comanda já tinha saído (impressa ou no KDS).
 *   • OPERADOR FORA DA CURVA: com 2 operadores ou mais, quem tem 3 ou mais
 *     cancelamentos e cancelou pelo menos o DOBRO (em R$) da média dos outros.
 *     O FireHub não grava quem LANÇOU cada venda, então não dá "% das vendas
 *     dele": a comparação é entre eles, e a tela diz isso.
 *
 * Puro: sem banco. A rota (api/store/relatorios/cancelamentos) busca; aqui
 * decide. Testado em scripts/teste-cancelamentos.ts.
 */
import type { RegistroDeEdicao } from "@/lib/edicao-de-pedido";
import { canalDoRelatorio, c2, ehCancelado, naLoja, tipoDeVenda, ROTULO_DO_TIPO, type TipoDeVenda } from "@/lib/relatorios/base";
import { entraNaVenda, temValorImpossivel } from "@/lib/relatorios/regua-da-venda";
import { quemCancelou } from "@/lib/relatorios/vendas";
import { canaisConhecidos } from "@/lib/canal-do-pedido";

/** Quantos dias antes do período a rota busca pedidos: a rodada lançada ontem e cancelada hoje. */
export const CANCELAMENTOS_OLHAM_PARA_TRAS_DIAS = 3;

export const OPERADOR_NAO_REGISTRADO = "Operador não registrado";

const NOME_DO_CANAL = new Map<string, string>(canaisConhecidos().map((c) => [c.chave as string, c.nome]));

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type PedidoParaCancelamentos = {
  id: string;
  createdAt: Date | string;
  status?: string | null;
  totalAmount?: number | null;
  deliveryType?: string | null;
  source?: string | null;
  tableSessionId?: string | null;
  totemLicenseId?: string | null;
  ifoodOrderId?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  dailyOrderNumber?: number | null;
  customerName?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  cancelledAt?: Date | string | null;
  editHistory?: unknown;
  /** Comanda confirmada pelo Assistente / entrou em produção no KDS / pronto / saiu. */
  printedAt?: Date | string | null;
  kdsProductionAt?: Date | string | null;
  readyAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  items?: { productName?: string | null; quantity?: number | null; price?: number | null }[] | null;
  /** "Mesa 4" (a rota resolve o nome da mesa). */
  mesa?: string | null;
  reposicao?: unknown;
};

export type ConfigDosCancelamentos = {
  tz: string;
  /** A janela [inicio, fim) do período (lib/relatorios/janela.ts). */
  inicio: Date;
  fim: Date;
  /** A primeira impressão da conta de cada mesa (TableSession.id → instante). */
  contasImpressas?: Map<string, Date | string>;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type AlertaDoCancelamento = "DEPOIS_DA_CONTA" | "DEPOIS_DE_PRONTO" | "DEPOIS_DA_COZINHA";

export const ROTULO_DO_ALERTA: Record<AlertaDoCancelamento, string> = {
  DEPOIS_DA_CONTA: "Depois da conta impressa",
  DEPOIS_DE_PRONTO: "Depois de pronto",
  DEPOIS_DA_COZINHA: "Depois de ir para a cozinha",
};

export const EXPLICACAO_DO_ALERTA: Record<AlertaDoCancelamento, string> = {
  DEPOIS_DA_CONTA: "Tirado de uma mesa cuja conta já tinha sido impressa para o cliente — confira se o cliente pagou o valor cheio.",
  DEPOIS_DE_PRONTO: "A cozinha já tinha feito (pedido pronto ou já saído): a comida foi produzida e saiu da venda.",
  DEPOIS_DA_COZINHA: "A comanda já tinha ido para a cozinha (impressa ou no KDS).",
};

export type ProdutoDoEvento = { nome: string; quantidade: number; valor: number };

export type CancelamentoDaLista = {
  id: string;
  pedidoId: string;
  /** PEDIDO = pedido/rodada cancelado inteiro; ITEM = item tirado ou quantidade diminuída. */
  tipo: "PEDIDO" | "ITEM";
  instante: string;
  dia: string;
  hora: string;
  /** "#12" ou "". */
  numero: string;
  /** "Mesa 4", "Delivery", "Balcão"… */
  onde: string;
  canalNome: string;
  /** A chave do operador (para filtrar a lista pela linha da tabela). */
  operador: string;
  quem: string;
  registrado: boolean;
  itens: string;
  produtos: ProdutoDoEvento[];
  valor: number;
  motivo: string | null;
  alertas: AlertaDoCancelamento[];
};

export type CortesiaDaLista = {
  id: string;
  pedidoId: string;
  instante: string;
  dia: string;
  hora: string;
  numero: string;
  onde: string;
  cliente: string;
  operador: string;
  quem: string;
  itens: string;
  produtos: ProdutoDoEvento[];
  valor: number;
  motivo: string | null;
};

export type LinhaDoOperador = {
  chave: string;
  nome: string;
  registrado: boolean;
  cancelamentos: number;
  pedidos: number;
  itens: number;
  valor: number;
  /** % do valor cancelado pela loja no período. */
  pct: number;
  comAlerta: number;
  cortesias: number;
  valorCortesias: number;
  foraDaCurva: boolean;
};

export type ResultadoDosCancelamentos = {
  resumo: {
    /** Da loja: pedidos cancelados + itens tirados. */
    cancelamentos: number;
    valor: number;
    pedidos: number;
    valorPedidos: number;
    itens: number;
    valorItens: number;
    unidades: number;
    comAlerta: number;
    valorComAlerta: number;
    semOperador: number;
    cortesias: number;
    valorCortesias: number;
    /** Valor vendido do período (a régua única), a base do %. */
    valorVendido: number;
    /** Cancelado pela loja ÷ valor vendido, em %. null sem venda. */
    pctDoValorVendido: number | null;
    /** Cortesias ÷ valor vendido, em %. */
    pctCortesias: number | null;
    foraDaLoja: number;
    valorForaDaLoja: number;
  };
  porOperador: LinhaDoOperador[];
  porMotivo: { motivo: string; cancelamentos: number; valor: number; pct: number }[];
  porProduto: { nome: string; vezes: number; quantidade: number; valor: number }[];
  alertas: { alerta: AlertaDoCancelamento; rotulo: string; explicacao: string; cancelamentos: number; valor: number }[];
  /** Os operadores marcados como fora da curva (nome). */
  foraDaCurva: string[];
  lista: CancelamentoDaLista[];
  cortesias: CortesiaDaLista[];
  cortesiasPorMotivo: { motivo: string; vezes: number; valor: number }[];
  /** Cancelamentos que não são da loja (cliente, plataforma, sistema), por quem cancelou. */
  porFora: { quem: string; pedidos: number; valor: number }[];
};

// ── AJUDANTES ───────────────────────────────────────────────────────────────

function registros(editHistory: unknown): RegistroDeEdicao[] {
  return Array.isArray(editHistory) ? (editHistory as RegistroDeEdicao[]).filter((r) => r && typeof r === "object") : [];
}

const ms = (d: Date | string | null | undefined): number => (d == null ? NaN : new Date(d).getTime());

/** O nome no rastro sem o papel: "Ana (funcionário)" → "Ana". */
export function nomeDoOperadorDoRastro(quem: unknown): string {
  return String(quem || "").replace(/\s*\((dono|funcionário|funcionario|admin)\)\s*$/i, "").trim();
}

/**
 * A chave que agrupa o operador: o id quando há; o nome antigo sem id cai no
 * id que o mesmo nome já teve. `nomeParaId` é montado por quem chama com
 * todos os registros do período.
 */
export function chaveDoOperador(quem: unknown, quemId: unknown, nomeParaId: Map<string, string>): { chave: string; nome: string; registrado: boolean } {
  const nome = nomeDoOperadorDoRastro(quem);
  const id = String(quemId || "").trim();
  if (id) return { chave: `id:${id}`, nome: nome || OPERADOR_NAO_REGISTRADO, registrado: true };
  if (!nome) return { chave: "sem-operador", nome: OPERADOR_NAO_REGISTRADO, registrado: false };
  const doNome = nomeParaId.get(nome.toLowerCase());
  return { chave: doNome ? `id:${doNome}` : `nome:${nome.toLowerCase()}`, nome, registrado: true };
}

/** Os nomes que já apareceram com id no rastro (para o registro antigo, só com nome, cair no mesmo grupo). */
export function mapaDeNomesParaId(listas: unknown[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of listas) {
    for (const r of registros(h)) {
      const id = String((r as any).quemId || "").trim();
      const nome = nomeDoOperadorDoRastro(r.quem).toLowerCase();
      if (id && nome && !m.has(nome)) m.set(nome, id);
    }
  }
  return m;
}

const LOJA = new Set(["LOJA", "RESTAURANT", "MERCHANT"]);

function ondeFoi(p: PedidoParaCancelamentos): string {
  if (p.mesa) return p.mesa;
  const t = tipoDeVenda(p as any) as TipoDeVenda;
  return ROTULO_DO_TIPO[t] || t;
}

function textoDosProdutos(lista: ProdutoDoEvento[]): string {
  return lista.map((i) => `${i.quantidade}x ${i.nome}`).join(", ");
}

function produtosDe(lista: unknown): ProdutoDoEvento[] {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((i) => i && typeof i === "object")
    .map((i: any) => ({
      nome: String(i.nome || "item").trim() || "item",
      quantidade: Math.max(1, Math.round(Number(i.quantidade) || 1)),
      valor: c2(Number(i.valor) || 0),
    }));
}

/** Os alertas de um cancelamento da loja, pela hora em que aconteceu. */
export function alertasDoCancelamento(p: PedidoParaCancelamentos, instante: number, contasImpressas?: Map<string, Date | string>): AlertaDoCancelamento[] {
  const saida: AlertaDoCancelamento[] = [];
  const antes = (d: Date | string | null | undefined) => { const t = ms(d); return Number.isFinite(t) && t <= instante; };
  const conta = p.tableSessionId ? contasImpressas?.get(p.tableSessionId) : undefined;
  if (conta && antes(conta)) saida.push("DEPOIS_DA_CONTA");
  if (antes(p.readyAt) || antes(p.dispatchedAt)) saida.push("DEPOIS_DE_PRONTO");
  else if (antes(p.printedAt) || antes(p.kdsProductionAt)) saida.push("DEPOIS_DA_COZINHA");
  return saida;
}

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100000) / 1000 : 0);

// ── O RELATÓRIO ─────────────────────────────────────────────────────────────

export function cancelamentosDoPeriodo(pedidos: PedidoParaCancelamentos[], cfg: ConfigDosCancelamentos): ResultadoDosCancelamentos {
  const de = cfg.inicio.getTime();
  const ate = cfg.fim.getTime();
  const noPeriodo = (t: number) => Number.isFinite(t) && t >= de && t < ate;
  const nomeParaId = mapaDeNomesParaId(pedidos.map((p) => p.editHistory));
  const lista: CancelamentoDaLista[] = [];
  const cortesias: CortesiaDaLista[] = [];
  const porFora = new Map<string, { quem: string; pedidos: number; valor: number }>();
  let cVendido = 0;

  for (const p of pedidos) {
    if (temValorImpossivel(p as any)) continue;
    if (entraNaVenda(p as any) && noPeriodo(ms(p.createdAt))) cVendido += Math.round((Number(p.totalAmount) || 0) * 100);

    const regs = registros(p.editHistory);
    const numero = p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : "";
    const onde = ondeFoi(p);
    const canalNome = NOME_DO_CANAL.get(canalDoRelatorio(p as any)) || "";
    const quando = (t: number) => {
      const l = naLoja(new Date(t), cfg.tz);
      return { instante: new Date(t).toISOString(), dia: l.dia, hora: `${String(Math.floor(l.minutos / 60)).padStart(2, "0")}:${String(l.minutos % 60).padStart(2, "0")}` };
    };

    regs.forEach((r, idx) => {
      const t = ms(r.quando);
      if (!noPeriodo(t)) return;
      if ((r.acao === "REMOVEU" || r.acao === "MUDOU_QTD") && Array.isArray(r.itensRetirados) && r.itensRetirados.length > 0) {
        const produtos = produtosDe(r.itensRetirados);
        const op = chaveDoOperador(r.quem, (r as any).quemId, nomeParaId);
        lista.push({
          id: `${p.id}:${idx}`, pedidoId: p.id, tipo: "ITEM", ...quando(t), numero, onde, canalNome,
          operador: op.chave, quem: op.nome, registrado: op.registrado,
          itens: textoDosProdutos(produtos), produtos,
          valor: c2(produtos.reduce((s, i) => s + i.valor, 0)),
          motivo: typeof r.motivo === "string" && r.motivo.trim() ? r.motivo.trim() : null,
          alertas: alertasDoCancelamento(p, t, cfg.contasImpressas),
        });
      }
      if (r.acao === "CORTESIA") {
        const produtos = produtosDe((r as any).itensCortesia);
        const op = chaveDoOperador(r.quem, (r as any).quemId, nomeParaId);
        cortesias.push({
          id: `${p.id}:${idx}`, pedidoId: p.id, ...quando(t), numero, onde,
          cliente: String(p.customerName || "").trim(),
          operador: op.chave, quem: op.nome, itens: textoDosProdutos(produtos), produtos,
          valor: c2(produtos.reduce((s, i) => s + i.valor, 0)),
          motivo: typeof r.motivo === "string" && r.motivo.trim() ? r.motivo.trim() : null,
        });
      }
    });

    if (!ehCancelado(p.status)) continue;
    const canc = [...regs].reverse().find((r) => r.acao === "CANCELOU");
    const t = Number.isFinite(ms(p.cancelledAt)) ? ms(p.cancelledAt) : Number.isFinite(ms(canc?.quando)) ? ms(canc!.quando) : ms(p.createdAt);
    if (!noPeriodo(t)) continue;
    const valor = c2(canc && Number.isFinite(Number(canc.totalAntes)) ? Number(canc.totalAntes) : Number(p.totalAmount) || 0);
    const daLoja = Boolean(canc) || LOJA.has(String(p.cancelledBy || "").toUpperCase());
    if (!daLoja) {
      const quem = quemCancelou(p.cancelledBy) || "sem registro de quem";
      const l = porFora.get(quem) || { quem, pedidos: 0, valor: 0 };
      l.pedidos++; l.valor = c2(l.valor + valor);
      porFora.set(quem, l);
      continue;
    }
    const produtos = canc?.itensRetirados?.length
      ? produtosDe(canc.itensRetirados)
      : (p.items || []).filter((i) => (Number(i.quantity) || 0) > 0).map((i) => ({
          nome: String(i.productName || "item").trim() || "item",
          quantidade: Number(i.quantity) || 1,
          valor: c2((Number(i.price) || 0) * (Number(i.quantity) || 0)),
        }));
    const op = canc ? chaveDoOperador(canc.quem, (canc as any).quemId, nomeParaId) : { chave: "sem-operador", nome: OPERADOR_NAO_REGISTRADO, registrado: false };
    const motivo = (typeof canc?.motivo === "string" && canc.motivo.trim()) || String(p.cancelReason || "").trim() || null;
    lista.push({
      id: `${p.id}:cancelado`, pedidoId: p.id, tipo: "PEDIDO", ...quando(t), numero, onde, canalNome,
      operador: op.chave, quem: op.nome, registrado: op.registrado,
      itens: textoDosProdutos(produtos), produtos, valor, motivo,
      alertas: alertasDoCancelamento(p, t, cfg.contasImpressas),
    });
  }

  lista.sort((a, b) => b.instante.localeCompare(a.instante));
  cortesias.sort((a, b) => b.instante.localeCompare(a.instante));

  // ── Totais ──
  const valor = c2(lista.reduce((s, l) => s + l.valor, 0));
  const pedidosC = lista.filter((l) => l.tipo === "PEDIDO");
  const itensC = lista.filter((l) => l.tipo === "ITEM");
  const comAlerta = lista.filter((l) => l.alertas.length > 0);
  const valorCortesias = c2(cortesias.reduce((s, c) => s + c.valor, 0));
  const valorVendido = Math.round(cVendido) / 100;

  // ── Por operador ──
  const ops = new Map<string, LinhaDoOperador>();
  const linhaDe = (chave: string, nome: string, registrado: boolean) => {
    let l = ops.get(chave);
    if (!l) {
      l = { chave, nome, registrado, cancelamentos: 0, pedidos: 0, itens: 0, valor: 0, pct: 0, comAlerta: 0, cortesias: 0, valorCortesias: 0, foraDaCurva: false };
      ops.set(chave, l);
    }
    return l;
  };
  for (const e of lista) {
    const l = linhaDe(e.operador, e.quem, e.registrado);
    l.cancelamentos++;
    if (e.tipo === "PEDIDO") l.pedidos++; else l.itens++;
    l.valor = c2(l.valor + e.valor);
    if (e.alertas.length) l.comAlerta++;
  }
  for (const c of cortesias) {
    const l = linhaDe(c.operador, c.quem, true);
    l.cortesias++;
    l.valorCortesias = c2(l.valorCortesias + c.valor);
  }
  const comNome = [...ops.values()].filter((l) => l.registrado && l.cancelamentos > 0);
  const foraDaCurva: string[] = [];
  if (comNome.length >= 2) {
    const soma = comNome.reduce((s, l) => s + l.valor, 0);
    for (const l of comNome) {
      const mediaDosOutros = (soma - l.valor) / (comNome.length - 1);
      if (l.cancelamentos >= 3 && l.valor > 0 && l.valor >= 2 * mediaDosOutros) {
        l.foraDaCurva = true;
        foraDaCurva.push(l.nome);
      }
    }
  }
  const porOperador = [...ops.values()]
    .map((l) => ({ ...l, pct: pct(l.valor, valor) }))
    .sort((a, b) => b.valor - a.valor || b.valorCortesias - a.valorCortesias || a.nome.localeCompare(b.nome));

  // ── Por motivo ──
  const motivos = new Map<string, { motivo: string; cancelamentos: number; valor: number; pct: number }>();
  for (const e of lista) {
    const texto = e.motivo || "Sem motivo (registro antigo)";
    const chave = texto.toLowerCase();
    const m = motivos.get(chave) || { motivo: texto, cancelamentos: 0, valor: 0, pct: 0 };
    m.cancelamentos++; m.valor = c2(m.valor + e.valor);
    motivos.set(chave, m);
  }
  const porMotivo = [...motivos.values()].map((m) => ({ ...m, pct: pct(m.valor, valor) })).sort((a, b) => b.valor - a.valor);

  // ── Por produto ──
  const prods = new Map<string, { nome: string; vezes: number; quantidade: number; valor: number }>();
  for (const e of lista) {
    for (const i of e.produtos) {
      const chave = i.nome.toLowerCase();
      const pr = prods.get(chave) || { nome: i.nome, vezes: 0, quantidade: 0, valor: 0 };
      pr.vezes++; pr.quantidade += i.quantidade; pr.valor = c2(pr.valor + i.valor);
      prods.set(chave, pr);
    }
  }
  const porProduto = [...prods.values()].sort((a, b) => b.valor - a.valor || b.quantidade - a.quantidade);

  // ── Alertas ──
  const alertas = (Object.keys(ROTULO_DO_ALERTA) as AlertaDoCancelamento[]).map((a) => {
    const com = lista.filter((l) => l.alertas.includes(a));
    return { alerta: a, rotulo: ROTULO_DO_ALERTA[a], explicacao: EXPLICACAO_DO_ALERTA[a], cancelamentos: com.length, valor: c2(com.reduce((s, l) => s + l.valor, 0)) };
  });

  // ── Cortesias por motivo ──
  const cm = new Map<string, { motivo: string; vezes: number; valor: number }>();
  for (const c of cortesias) {
    const texto = c.motivo || "Sem motivo";
    const m = cm.get(texto.toLowerCase()) || { motivo: texto, vezes: 0, valor: 0 };
    m.vezes++; m.valor = c2(m.valor + c.valor);
    cm.set(texto.toLowerCase(), m);
  }

  const fora = [...porFora.values()].sort((a, b) => b.valor - a.valor);
  return {
    resumo: {
      cancelamentos: lista.length,
      valor,
      pedidos: pedidosC.length,
      valorPedidos: c2(pedidosC.reduce((s, l) => s + l.valor, 0)),
      itens: itensC.length,
      valorItens: c2(itensC.reduce((s, l) => s + l.valor, 0)),
      unidades: itensC.reduce((s, l) => s + l.produtos.reduce((t, i) => t + i.quantidade, 0), 0),
      comAlerta: comAlerta.length,
      valorComAlerta: c2(comAlerta.reduce((s, l) => s + l.valor, 0)),
      semOperador: lista.filter((l) => !l.registrado).length,
      cortesias: cortesias.length,
      valorCortesias,
      valorVendido,
      pctDoValorVendido: valorVendido > 0 ? pct(valor, valorVendido) : null,
      pctCortesias: valorVendido > 0 ? pct(valorCortesias, valorVendido) : null,
      foraDaLoja: fora.reduce((s, f) => s + f.pedidos, 0),
      valorForaDaLoja: c2(fora.reduce((s, f) => s + f.valor, 0)),
    },
    porOperador,
    porMotivo,
    porProduto,
    alertas,
    foraDaCurva,
    lista,
    cortesias,
    cortesiasPorMotivo: [...cm.values()].sort((a, b) => b.valor - a.valor),
    porFora: fora,
  };
}
