/**
 * /src/lib/cancelamento-parcial.ts
 *
 * Cancelamento PARCIAL feito pelo aplicativo (iFood, 99Food): o pedido
 * continua, só uma parte dele sai — e quem tirou foi o app, não a loja.
 *
 * ── O caso (Lucas, Frangoso - Trindade, 04/10/2026) ─────────────────────────
 *
 * A loja esqueceu o adicional que a cliente pediu, o iFood devolveu o valor
 * dele, e o FireHub jogou o pedido INTEIRO na aba Cancelado: a venda sumiu do
 * caixa e do relatório. O caminho: o poll do painel gravava a disputa sem saber
 * que era parcial (só o cron sabia, desde 10/09) e o modal oferecia "Aceitar
 * cancelamento" — aceito, o pedido virava CANCELADO aqui enquanto no iFood só
 * a parte contestada saía. Aceitar um REEMBOLSO de item fazia o mesmo.
 *
 * ── A regra (dono, 08/10/2026) ──────────────────────────────────────────────
 *
 *   • parcial NUNCA vai para Cancelado: o status não muda;
 *   • o total do pedido cai o que o app tirou, e dentro do pedido os itens
 *     cancelados aparecem riscados, dizendo que foi o aplicativo;
 *   • a loja recebe um aviso — "Foi feito um cancelamento parcial no seu
 *     iFood" — com o botão "Ciente" (lib/avisos-do-dia.ts).
 *
 * ── Onde fica ───────────────────────────────────────────────────────────────
 *
 * Em `CustomerOrder.cancelamentoParcial`, uma LISTA de registros (o mesmo
 * pedido pode levar dois cortes). Fora de `cancelDispute` de propósito: ali
 * mora a negociação em aberto, e a próxima disputa do pedido a sobrescreve —
 * o corte já feito não pode sumir junto. Cada registro tem um `id` (o
 * disputeId do iFood; no 99, o carimbo da releitura) e gravar o mesmo id duas
 * vezes não corta o total duas vezes: o aceite no painel e o desfecho que o
 * iFood manda depois chegam ao mesmo registro.
 *
 * Os itens do pedido (CustomerOrderItem) não são mexidos no iFood: o que saiu
 * costuma ser um adicional dentro do item, e o item foi entregue. No 99 o
 * `order/detail` já devolve o pedido sem o que saiu e os itens são refeitos
 * (food99-status.ts → aplicarPedidoAlterado99); o registro guarda o que havia.
 *
 * As regras são puras (sem banco) e provadas por
 * scripts/teste-cancelamento-parcial.ts; a gravação mora em
 * lib/cancelamento-parcial-no-banco.ts (este arquivo também vai ao navegador).
 */

export type ItemCancelado = {
  nome: string;
  quantidade: number;
  /** Quanto este item tirou do total (R$), quando se sabe. */
  valor: number | null;
  motivo?: string | null;
};

export type RegistroDeCancelamentoParcial = {
  /** disputeId do iFood; no 99, "99:<carimbo>". Não repete no mesmo pedido. */
  id: string;
  /** "iFood", "99Food"... — quem tirou. */
  canal: string;
  quando: string;
  itens: ItemCancelado[];
  /** Quanto saiu do total do pedido (R$). */
  valor: number;
  totalAntes: number;
  totalDepois: number;
  motivo?: string | null;
  /**
   * Os itens do pedido JÁ estão sem o que saiu (99: refeitos do order/detail).
   * No iFood não: o item fica e o corte aparece como desconto na conta.
   */
  itensJaSairam?: boolean;
  /** O "Ciente" do aviso: vale para todas as telas da loja. */
  cienteEm?: string | null;
  cientePor?: string | null;
};

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** A lista gravada no pedido, tolerante ao que vier do banco. */
export function lerCancelamentosParciais(json: unknown): RegistroDeCancelamentoParcial[] {
  const lista = Array.isArray(json) ? json : json && typeof json === "object" ? [json] : [];
  return lista.filter(
    (r: any): r is RegistroDeCancelamentoParcial =>
      r && typeof r === "object" && typeof r.id === "string" && Number.isFinite(Number(r.valor))
  );
}

/**
 * A disputa do iFood é de PARTE do pedido? Cancelamento parcial e reembolso de
 * item são: aceitar não cancela o pedido. Também vale para a disputa gravada
 * antes desta correção pelo poll do painel, que não marcava `parcial`.
 */
export function ehDisputaParcial(disputa: unknown): boolean {
  const d = (disputa ?? {}) as Record<string, any>;
  if (d.parcial === true) return true;
  const tipo = String(d.type || "").toUpperCase();
  if (tipo === "PARTIAL_CANCELLATION" || tipo === "REFUND_ITEMS") return true;
  const acao = String(d.metadata?.action || d.handshakeType || "").toUpperCase();
  return acao.includes("PARTIAL") || acao.includes("REFUND");
}

/**
 * Quanto a disputa tira do pedido, em reais. O reembolso proposto pela loja
 * (alternativa REFUND aceita pelo cliente) vale no lugar da soma dos itens.
 */
export function valorDaDisputaParcial(disputa: unknown, opcoes: { usarProposta?: boolean } = {}): number {
  const d = (disputa ?? {}) as Record<string, any>;
  const proposto = Number(d.valorReembolsoProposto);
  if (opcoes.usarProposta && proposto > 0) return centavos(proposto);
  const soma = (Array.isArray(d.itens) ? d.itens : []).reduce((s: number, i: any) => s + (Number(i?.valor) || 0), 0);
  if (soma > 0) return centavos(soma);
  const reembolso = Number(d.valorReembolso);
  return reembolso > 0 ? centavos(reembolso) : 0;
}

/** Os itens da disputa no formato do registro. */
export function itensDaDisputa(disputa: unknown): ItemCancelado[] {
  const d = (disputa ?? {}) as Record<string, any>;
  return (Array.isArray(d.itens) ? d.itens : []).map((i: any) => ({
    nome: String(i?.nome || "Item"),
    quantidade: Number(i?.quantidade) || 1,
    valor: Number.isFinite(Number(i?.valor)) && Number(i?.valor) > 0 ? centavos(Number(i.valor)) : null,
    motivo: i?.motivo ? String(i.motivo) : null,
  }));
}

/**
 * O registro novo e o total do pedido depois dele.
 *
 * `totalDepois` explícito (99: o total que o app devolveu) vence a conta; sem
 * ele, o total cai `valor`, nunca abaixo de zero. Mesmo `id` já gravado:
 * nada muda (o aceite e o desfecho do iFood chegam ao mesmo corte).
 */
export function registrarCorte(
  registros: RegistroDeCancelamentoParcial[],
  totalAtual: number,
  corte: { id: string; canal: string; itens: ItemCancelado[]; valor: number; totalDepois?: number | null; motivo?: string | null; itensJaSairam?: boolean },
  agora: Date = new Date()
): { registros: RegistroDeCancelamentoParcial[]; totalDepois: number; novo: RegistroDeCancelamentoParcial | null } {
  const antes = centavos(totalAtual);
  if (registros.some((r) => r.id === corte.id)) {
    return { registros, totalDepois: antes, novo: null };
  }
  const depois =
    corte.totalDepois != null && Number.isFinite(Number(corte.totalDepois))
      ? centavos(Math.max(0, Number(corte.totalDepois)))
      : centavos(Math.max(0, antes - Math.max(0, Number(corte.valor) || 0)));
  const novo: RegistroDeCancelamentoParcial = {
    id: corte.id,
    canal: corte.canal,
    quando: agora.toISOString(),
    itens: corte.itens,
    valor: centavos(antes - depois > 0 ? antes - depois : Math.max(0, Number(corte.valor) || 0)),
    totalAntes: antes,
    totalDepois: depois,
    motivo: corte.motivo ?? null,
    ...(corte.itensJaSairam ? { itensJaSairam: true } : {}),
    cienteEm: null,
    cientePor: null,
  };
  return { registros: [...registros, novo], totalDepois: depois, novo };
}

type ItemComparavel = { nome: string; quantidade: number; precoUnitario: number; complementos: { nome: string; quantidade: number; preco: number }[] };

/**
 * O que o 99Food tirou: os itens de antes contra os que o `order/detail`
 * devolveu. Item a menos sai com a quantidade e o preço; item que ficou mas
 * perdeu um adicional sai como "sem <adicional>". É o que a tela mostra
 * riscado — o VALOR do corte é a diferença dos totais, não esta soma.
 */
export function itensQueSairam(antes: ItemComparavel[], depois: ItemComparavel[]): ItemCancelado[] {
  const chave = (s: string) => String(s || "").trim().toLowerCase();
  const porNome = (lista: ItemComparavel[]) => {
    const m = new Map<string, { nome: string; quantidade: number; preco: number; complementos: Map<string, { nome: string; quantidade: number; preco: number }> }>();
    for (const i of lista) {
      const k = chave(i.nome);
      const atual = m.get(k) || { nome: i.nome, quantidade: 0, preco: Number(i.precoUnitario) || 0, complementos: new Map() };
      atual.quantidade += Number(i.quantidade) || 0;
      for (const c of i.complementos || []) {
        const kc = chave(c.nome);
        if (!kc || kc.startsWith("obs:")) continue;
        const ac = atual.complementos.get(kc) || { nome: c.nome, quantidade: 0, preco: Number(c.preco) || 0 };
        ac.quantidade += (Number(c.quantidade) || 1) * (Number(i.quantidade) || 1);
        atual.complementos.set(kc, ac);
      }
      m.set(k, atual);
    }
    return m;
  };
  const a = porNome(antes);
  const d = porNome(depois);
  const saiu: ItemCancelado[] = [];
  for (const [k, item] of a) {
    const ficou = d.get(k);
    const qtdQueSaiu = item.quantidade - (ficou?.quantidade || 0);
    if (qtdQueSaiu > 0) {
      saiu.push({ nome: item.nome, quantidade: qtdQueSaiu, valor: item.preco > 0 ? centavos(item.preco * qtdQueSaiu) : null });
      continue;
    }
    if (!ficou) continue;
    for (const [kc, c] of item.complementos) {
      const restou = ficou.complementos.get(kc)?.quantidade || 0;
      const q = c.quantidade - restou;
      if (q > 0) saiu.push({ nome: `${item.nome} — sem ${c.nome}`, quantidade: q, valor: c.preco > 0 ? centavos(c.preco * q) : null });
    }
  }
  return saiu;
}

/** Os complementos gravados em `comboSelections` (texto JSON ou lista). */
export function complementosGravados(comboSelections: unknown): { nome: string; quantidade: number; preco: number }[] {
  let bruto: unknown = comboSelections;
  if (typeof bruto === "string") {
    try { bruto = JSON.parse(bruto); } catch { return []; }
  }
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((c: any) => c && typeof c === "object" && (c.name || c.nome))
    .map((c: any) => ({ nome: String(c.name ?? c.nome), quantidade: Number(c.quantity ?? c.quantidade) || 1, preco: Number(c.price ?? c.preco) || 0 }));
}

/** Os registros que ainda esperam o "Ciente". */
export function semCiente(registros: RegistroDeCancelamentoParcial[]): RegistroDeCancelamentoParcial[] {
  return registros.filter((r) => !r.cienteEm);
}

/** Marca o "Ciente" nos registros pedidos (todos, sem `ids`). */
export function marcarCienteNosRegistros(
  registros: RegistroDeCancelamentoParcial[],
  quem: string,
  ids?: string[] | null,
  agora: Date = new Date()
): { registros: RegistroDeCancelamentoParcial[]; marcados: number } {
  let marcados = 0;
  const lista = registros.map((r) => {
    if (r.cienteEm || (ids && ids.length > 0 && !ids.includes(r.id))) return r;
    marcados++;
    return { ...r, cienteEm: agora.toISOString(), cientePor: quem.slice(0, 120) || null };
  });
  return { registros: lista, marcados };
}

// A gravação no banco mora em lib/cancelamento-parcial-no-banco.ts: este
// arquivo é lido também pelo painel (navegador), que não pode puxar o Prisma.
