/**
 * O RELATÓRIO DE MESAS e o RELATÓRIO DO GARÇOM (módulo Garçons) — as contas,
 * puras, sem banco. As rotas api/store/mesas/relatorio e
 * api/store/waiters/[id]/report buscam no banco e entregam aqui; a tela só
 * desenha. Travado em scripts/teste-relatorio-de-mesas.ts.
 *
 * ── Por que saiu das rotas (auditoria de 11/10/2026) ────────────────────────
 *
 * 1. O TROCO ENTRAVA COMO CONSUMO. O consumo da mesa era pago − taxa −
 *    gorjeta, e o pago (TableSession.totalPaid) é a NOTA que o cliente
 *    entregou (ver pago-da-mesa-inclui-troco). Delicias da Maria, 11/09 a
 *    10/10/2026: R$ 10.279,50 de "consumo" contra R$ 8.192,00 lançados nas
 *    mesmas 396 contas (+25%; a mesa de R$ 7 paga com nota de R$ 100 aparecia
 *    como R$ 100). Na Ragnar Burger, ao contrário: R$ 72.028,88 contra
 *    R$ 79.277,51 — 188 contas fechadas com desconto (R$ 8.019,46) saíam do
 *    consumo aqui e de nenhum outro relatório. O relatório do garçom mostrava
 *    o pago cru como "Total da conta".
 *
 *    Agora é a régua única (lib/relatorios/regua-da-venda.ts): o consumo é a
 *    soma dos pedidos da conta (`totalAmount`, só os que são venda); taxa de
 *    serviço, gorjeta e desconto no fechamento saem de `servicoDasMesas` e
 *    `descontoNoFechamento` — o desconto À PARTE, nunca abatido do consumo.
 *    O total da conta é consumo − desconto + taxa + gorjeta: o que o
 *    fechamento cobrou ("A conta é de R$ …", api/store/table-sessions/[id]/close),
 *    sem o troco.
 *
 * 2. "PEDIDOS" DA LINHA MESA CONTAVA RODADAS. O valor da linha vinha das mesas
 *    fechadas e a contagem, dos lançamentos pela hora do pedido: Ragnar,
 *    11/09–10/10, "Mesa: 1.230 pedidos" para 668 mesas fechadas. Agora o
 *    "Vendas por origem" é a régua inteira, pela hora do PEDIDO: valor = Σ
 *    `totalAmount`, vendas = atendimentos (`atendimentosDaVenda`: a mesa conta
 *    UMA vez, por mais rodadas que tenha) — o mesmo valor e as mesmas vendas
 *    do relatório Vendas por período, linha a linha. As rodadas ficam como
 *    detalhe (`lancamentos`).
 *
 *    Por isso a tela tem dois números de mesa, cada um com o seu nome: o
 *    "Consumo nas mesas" é das contas FECHADAS no período (a conta inteira,
 *    mesmo a rodada lançada antes — é sobre ela que se cobra a taxa e se paga
 *    o garçom); a linha "Mesa" das vendas é o LANÇADO no período, inclusive em
 *    mesa ainda aberta. Num mês fechado diferem só nas bordas (Ragnar:
 *    R$ 79.277,51 × 79.451,71); no "Hoje" com o salão cheio, pela mesa aberta.
 *
 * 3. O PERÍODO. O relatório do garçom montava a janela no navegador:
 *    `new Date("2026-10-10")` é meia-noite UTC, e o `setHours` local a levava
 *    para 09/10 — o "Período" de um dia consultava o dia anterior; "Hoje" e
 *    "Ontem" viravam à meia-noite do navegador (na Ragnar, 15% das mesas fecham
 *    entre 0h e 5h). O Relatório de Mesas pedia o dia do calendário, e entre 0h
 *    e 5h o "Hoje" era um dia que ainda não tinha começado. Agora as duas telas
 *    mandam "YYYY-MM-DD" (ou o atalho: hoje, ontem) e o SERVIDOR resolve no dia
 *    operacional da loja (vira às 5h, no fuso do dono) — `periodoDaConsulta`
 *    aqui e `janelaDoPeriodo` de lib/relatorios/servidor.ts, a mesma de todo
 *    relatório.
 */
import { ATALHOS, lerFiltros, periodoDoAtalho, type AtalhoDePeriodo } from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, cent, descontoNoFechamento, entraNaVenda, reais, servicoDasMesas, situacaoDoPedido, temValorImpossivel,
  type MesaFechada, type PedidoDaRegua,
} from "@/lib/relatorios/regua-da-venda";
import { canalDentroDoDelivery, origemDaVenda, type OrigemDaVenda, type PedidoParaOrigem } from "@/lib/origem-da-venda";

// ── O PERÍODO ───────────────────────────────────────────────────────────────

/**
 * O período pedido na URL, em dias operacionais "YYYY-MM-DD":
 * `atalho=hoje|ontem|7d|…` (resolvido a partir do `hoje` da loja), senão
 * `de`/`ate`, senão hoje. A janela em instantes sai de `janelaDoPeriodo`
 * (lib/relatorios/servidor.ts), com o fuso do dono.
 *
 * O atalho existe para o "Hoje" ser o da LOJA, não o do navegador: o PC que
 * abre o relatório pode estar noutro fuso, e o dia operacional (que vira às
 * 5h) só o servidor sabe com certeza.
 */
export function periodoDaConsulta(sp: URLSearchParams, hoje: string): { de: string; ate: string } {
  const atalho = sp.get("atalho");
  if (atalho && ATALHOS.some((a) => a.chave === atalho)) return periodoDoAtalho(atalho as AtalhoDePeriodo, hoje);
  const { de, ate } = lerFiltros(sp, hoje);
  return { de, ate };
}

/**
 * O fuso deste navegador — o PC da loja costuma estar no dela. Só para as
 * datas INICIAIS do "Período" nas telas (`hojeNaLoja(fusoDoNavegador())`, o
 * dia operacional); o "Hoje" e o "Ontem" quem resolve é o servidor.
 */
export function fusoDoNavegador(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}

// ── A CONTA DE UMA MESA FECHADA ─────────────────────────────────────────────

type PedidoDaConta = NonNullable<MesaFechada["pedidos"]>[number];

/** O consumo lançado na conta: Σ `totalAmount` dos pedidos que são venda (cancelado não entra). */
export function consumoDaConta(pedidos: PedidoDaConta[] | null | undefined): number {
  let c = 0;
  for (const o of pedidos || []) {
    if (situacaoDoPedido(o.status) !== "venda" || temValorImpossivel(o)) continue;
    c += cent(o.totalAmount);
  }
  return reais(c);
}

export type ContaDaMesa = {
  /** O lançado na conta (régua única): Σ `totalAmount` dos pedidos que são venda. */
  consumo: number;
  /** Taxa de serviço cobrada, ao centavo. A negativa (conta antiga) é desconto, não taxa. */
  taxa: number;
  gorjeta: number;
  /** Desconto dado no fechamento (`descontoNoFechamento`): à parte, e um piso — troco esconde parte dele. */
  desconto: number;
  /** consumo − desconto + taxa + gorjeta: o que a conta cobrou, SEM o troco. */
  totalDaConta: number;
};

/**
 * A conta de uma mesa fechada, pela régua única. Caso real (Delicias da Maria,
 * 08/10/2026): consumo R$ 7,00, pago com nota de R$ 100 — consumo 7, total
 * da conta 7; os R$ 93 de troco não são venda de ninguém.
 */
export function contaDaMesa(m: MesaFechada): ContaDaMesa {
  const consumo = consumoDaConta(m.pedidos);
  const taxa = Math.max(0, cent(m.serviceFee));
  const gorjeta = Math.max(0, cent(m.waiterTip));
  const desconto = descontoNoFechamento(m);
  return {
    consumo,
    taxa: reais(taxa),
    gorjeta: reais(gorjeta),
    desconto,
    totalDaConta: reais(cent(consumo) - cent(desconto) + taxa + gorjeta),
  };
}

// ── AS MESAS FECHADAS NO PERÍODO (o topo e a tabela por garçom) ─────────────

/** Uma sessão fechada no período, com o garçom e TODOS os pedidos da conta. */
export type SessaoFechada = MesaFechada & { waiterId?: string | null; garcom?: string | null };

export type LinhaDoGarcom = {
  waiterId: string | null;
  nome: string;
  mesas: number;
  /** O lançado nas contas dele (sem taxa, gorjeta e troco; o desconto fica em `desconto`). */
  consumo: number;
  taxaServico: number;
  gorjetas: number;
  desconto: number;
  mesasComDesconto: number;
};

export type MesasFechadas = {
  fechadas: number;
  consumo: number;
  taxaServico: number;
  gorjetas: number;
  /** Desconto dado no fechamento das contas, à parte (NÃO sai do consumo). */
  descontoNoFechamento: number;
  mesasComDesconto: number;
  porGarcom: LinhaDoGarcom[];
};

/** Consumo, serviço, gorjeta e desconto de um grupo de mesas — a mesma conta para a loja e para cada garçom. */
function somaDasMesas(mesas: MesaFechada[]) {
  const servico = servicoDasMesas(mesas);
  const consumo = mesas.reduce((c, m) => c + cent(consumoDaConta(m.pedidos)), 0);
  return { consumo: reais(consumo), ...servico };
}

/**
 * As mesas FECHADAS no período (pelo `closedAt`): o topo do Relatório de
 * Mesas e a tabela por garçom. Mesa sem garçom vinculado vai para uma linha
 * própria, nunca some (na Pastel da Paulista eram 157 de 552 mesas em 30 dias).
 */
export function mesasFechadasDoRelatorio(sessoes: SessaoFechada[]): MesasFechadas {
  const total = somaDasMesas(sessoes);
  const grupos = new Map<string, { waiterId: string | null; nome: string; mesas: SessaoFechada[] }>();
  for (const s of sessoes) {
    const chave = s.waiterId || "__sem__";
    const g = grupos.get(chave) ?? { waiterId: s.waiterId || null, nome: s.garcom?.trim() || "Sem garçom", mesas: [] };
    g.mesas.push(s);
    grupos.set(chave, g);
  }
  const porGarcom: LinhaDoGarcom[] = [...grupos.values()].map((g) => {
    const t = somaDasMesas(g.mesas);
    return {
      waiterId: g.waiterId, nome: g.nome, mesas: g.mesas.length, consumo: t.consumo,
      taxaServico: t.taxa, gorjetas: t.gorjeta, desconto: t.descontoNaMesa, mesasComDesconto: t.mesasComDesconto,
    };
  });
  // Quem mais arrecadou de taxa primeiro; na loja que não cobra taxa, quem mais vendeu.
  porGarcom.sort((a, b) => b.taxaServico - a.taxaServico || b.consumo - a.consumo || b.mesas - a.mesas);
  return {
    fechadas: sessoes.length,
    consumo: total.consumo,
    taxaServico: total.taxa,
    gorjetas: total.gorjeta,
    descontoNoFechamento: total.descontoNaMesa,
    mesasComDesconto: total.mesasComDesconto,
    porGarcom,
  };
}

// ── VENDAS POR ORIGEM (pela hora do pedido — a régua do Vendas por período) ─

export type PedidoDoRelatorio = PedidoDaRegua & PedidoParaOrigem;

export type LinhaDeOrigem = {
  valor: number;
  /** Vendas (atendimentos): o pedido comum é uma; a mesa é UMA, por mais rodadas que tenha. */
  vendas: number;
  /** Lançamentos: cada pedido (cada rodada de mesa é um). */
  lancamentos: number;
  /** O mesmo que `lancamentos` — o nome antigo, para a tela aberta antes da atualização. */
  pedidos: number;
};

export type VendasPorOrigem = {
  total: number;
  vendas: number;
  lancamentos: number;
  porOrigem: Record<OrigemDaVenda, LinhaDeOrigem>;
  deliveryPorCanal: (LinhaDeOrigem & { canal: string })[];
};

/**
 * Quanto a loja vendeu por origem (balcão, mesa, delivery, retirada) — pelos
 * pedidos criados no período, a régua única: só o que é venda
 * (`entraNaVenda`), valor = Σ `totalAmount`, vendas = `atendimentosDaVenda`.
 * O totem fica dentro do balcão (é a `origemDaVenda`); o Vendas por período o
 * separa, e Balcão + Totem de lá = Balcão daqui.
 */
export function vendasPorOrigem(pedidos: PedidoDoRelatorio[]): VendasPorOrigem {
  const at = atendimentosDaVenda(pedidos);
  const nova = () => ({ c: 0, vendas: 0, lancamentos: 0 });
  const porOrigem: Record<OrigemDaVenda, ReturnType<typeof nova>> = { MESA: nova(), BALCAO: nova(), DELIVERY: nova(), RETIRADA: nova() };
  const porCanal = new Map<string, ReturnType<typeof nova>>();
  const somar = (alvo: ReturnType<typeof nova>, c: number, abre: number) => { alvo.c += c; alvo.lancamentos++; alvo.vendas += abre; };
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    const o = origemDaVenda(p);
    const c = cent(p.totalAmount);
    const abre = at.abre.has(p.id) ? 1 : 0;
    somar(porOrigem[o], c, abre);
    if (o === "DELIVERY") {
      const canal = canalDentroDoDelivery(p);
      const linha = porCanal.get(canal) ?? nova();
      somar(linha, c, abre);
      porCanal.set(canal, linha);
    }
  }
  const linha = (x: ReturnType<typeof nova>): LinhaDeOrigem => ({ valor: reais(x.c), vendas: x.vendas, lancamentos: x.lancamentos, pedidos: x.lancamentos });
  const todas = Object.values(porOrigem);
  return {
    total: reais(todas.reduce((s, x) => s + x.c, 0)),
    vendas: at.vendas,
    lancamentos: at.lancamentos,
    porOrigem: { MESA: linha(porOrigem.MESA), BALCAO: linha(porOrigem.BALCAO), DELIVERY: linha(porOrigem.DELIVERY), RETIRADA: linha(porOrigem.RETIRADA) },
    deliveryPorCanal: [...porCanal.entries()]
      .map(([canal, x]) => ({ canal, ...linha(x) }))
      .sort((a, b) => b.valor - a.valor || b.vendas - a.vendas),
  };
}

// ── O RELATÓRIO DO GARÇOM ───────────────────────────────────────────────────

/** Uma mesa do relatório do garçom, como a rota devolve (a conta já pela régua). */
export type MesaDoGarcom = ContaDaMesa & { serviceFee: number; waiterTip: number; waiterCommission: number };

export type TotaisDoGarcom = {
  mesas: number;
  /** Σ total da conta (consumo − desconto + taxa + gorjeta): o que as mesas dele cobraram, sem troco. */
  totalDasContas: number;
  consumo: number;
  desconto: number;
  mesasComDesconto: number;
  /** Soma crua da taxa gravada (6,359), arredondada no fim — a régua de `servicoDasMesas`. */
  taxaServico: number;
  gorjetas: number;
  comissao: number;
};

/** Os cartões do relatório do garçom: a soma das linhas da tabela, no centavo. */
export function totaisDoGarcom(mesas: MesaDoGarcom[]): TotaisDoGarcom {
  let total = 0, consumo = 0, desconto = 0, comDesconto = 0, taxa = 0, gorjeta = 0, comissao = 0;
  for (const m of mesas) {
    total += cent(m.totalDaConta);
    consumo += cent(m.consumo);
    desconto += cent(m.desconto);
    if (cent(m.desconto) > 0) comDesconto++;
    if ((Number(m.serviceFee) || 0) > 0) taxa += Number(m.serviceFee);
    gorjeta += Math.max(0, Number(m.waiterTip) || 0);
    comissao += Number(m.waiterCommission) || 0;
  }
  return {
    mesas: mesas.length,
    totalDasContas: reais(total),
    consumo: reais(consumo),
    desconto: reais(desconto),
    mesasComDesconto: comDesconto,
    taxaServico: reais(cent(taxa)),
    gorjetas: reais(cent(gorjeta)),
    comissao: reais(cent(comissao)),
  };
}
