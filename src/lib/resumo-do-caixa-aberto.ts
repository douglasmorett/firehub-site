/**
 * O RESUMO DO CAIXA ABERTO — o topo do "Movimentar caixa".
 *
 * Pedido do Allan (Delícia de Casa), aprovado pelo Douglas em 17/10/2026: quem
 * não fica no delivery o tempo inteiro chega, abre o menu do caixa e só via
 * "Entrou R$ 0,00 / Saiu R$ 0,00" — as sangrias e os reforços, nada mais. Para
 * conferir a gaveta ele precisava saber QUEM abriu, com QUANTO de troco, quanto
 * entrou de venda (e quanto disso em dinheiro) e quanto deveria ter na gaveta.
 *
 * NENHUMA CONTA NOVA. Todo número daqui sai de `calcularEsperadoDoTurno`
 * (lib/esperado-do-turno.ts) — a mesma varredura que o fechamento confere e
 * que o papel imprime. Uma tela que somasse os pedidos de novo, por conta
 * própria, diria um número no meio do turno e outro no fechamento, e o lojista
 * passaria a desconfiar dos dois. Aqui só se REARRANJA o que o fechamento já
 * calculou, na ordem em que o dinheiro entra na gaveta:
 *
 *   dinheiro esperado = troco inicial + vendas em dinheiro + entradas − saídas
 *
 * que é exatamente como `expected.cash` é montado lá (e como o Histórico lê de
 * trás para a frente em `composicaoDoDinheiroEsperado`).
 *
 * Puro, sem banco: o teste prova que o resumo bate com o esperado do
 * fechamento (scripts/teste-resumo-do-caixa-aberto.ts). A gravação e a leitura
 * de quem abriu moram em lib/quem-abriu-o-caixa.ts.
 */

const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** De que lado da loja veio quem abriu o caixa. */
export type PapelDeQuemAbriu = "DONO" | "FUNCIONARIO" | "SUPORTE";

/**
 * Quem abriu o caixa, como fica gravado em `CashSession.abertoPor`.
 *
 * O NOME de quem estava logado, e não só o e-mail: o e-mail é o login do
 * painel e o lojista não reconhece "atendimento2@..." como a Maria do balcão.
 * O e-mail fica junto para o caso de duas pessoas com o mesmo nome.
 */
export type QuemAbriu = {
  nome: string;
  email: string | null;
  papel: PapelDeQuemAbriu;
};

/** O que a sessão diz sobre quem está logado — o `User` da sessão do painel. */
export type UsuarioDaSessao = {
  name?: string | null;
  email?: string | null;
  /** Preenchido = é da equipe de uma loja (funcionário); vazio = é a própria loja. */
  ownerId?: string | null;
};

/**
 * Quem está abrindo o caixa agora.
 *
 * `suporte` é o atendente do FireHub entrando como a loja (o "Entrar como" do
 * admin, `impersonatedBy` na sessão): a sessão tem o login da LOJA, e gravar
 * "dono" ali diria ao Allan que foi ele quem abriu — mesma regra da correção
 * do caixa fechado (api/cash-session/editar).
 */
export function quemEstaAbrindo(usuario: UsuarioDaSessao, suporte?: { name?: string | null } | null): QuemAbriu {
  const email = String(usuario.email || "").trim() || null;
  if (suporte) {
    const nomeDoSuporte = String(suporte.name || "").trim();
    return { nome: nomeDoSuporte ? `Suporte FireHub (${nomeDoSuporte})` : "Suporte FireHub", email, papel: "SUPORTE" };
  }
  const nome = String(usuario.name || "").trim() || email || "Sem nome";
  return { nome, email, papel: usuario.ownerId ? "FUNCIONARIO" : "DONO" };
}

/**
 * Lê o que está gravado em `CashSession.abertoPor`. `null` = não se sabe: o
 * caixa foi aberto antes de 17/10/2026 (a coluna não existia) ou a gravação
 * falhou. A tela mostra "—" e nunca adivinha — dizer "o dono abriu" sem ter
 * gravado seria mentir justamente para quem está conferindo.
 */
export function lerQuemAbriu(bruto: unknown): QuemAbriu | null {
  let v: any = bruto;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  const nome = String(v.nome || "").trim();
  if (!nome) return null;
  const papel: PapelDeQuemAbriu = v.papel === "FUNCIONARIO" || v.papel === "SUPORTE" ? v.papel : "DONO";
  return { nome, email: String(v.email || "").trim() || null, papel };
}

/** Como o papel aparece ao lado do nome. */
export function rotuloDoPapel(papel: PapelDeQuemAbriu): string {
  if (papel === "FUNCIONARIO") return "equipe";
  if (papel === "SUPORTE") return "suporte";
  return "dono";
}

/**
 * O que a apuração do fechamento devolve e o resumo usa — o recorte do retorno
 * de `calcularEsperadoDoTurno`, para o resumo não depender do banco.
 */
export type TurnoApurado = {
  expected: { cash: number };
  movimentacaoEntradas: number;
  movimentacaoSaidas: number;
  detalhe: {
    /** O faturado do turno pela régua única (o "TOTAL FATURADO" do papel). */
    vendas: { qtd: number; valor: number };
    /** As vendas em dinheiro, antes do troco e das movimentações. */
    gaveta: { vendasEmDinheiro: number };
  };
};

export type ResumoDoCaixaAberto = {
  abertoEm: string;
  /** `null` = caixa antigo, sem o registro de quem abriu: a tela mostra "—". */
  abertoPor: QuemAbriu | null;
  /** O troco de abertura — o que estava na gaveta quando o caixa abriu. */
  trocoInicial: number;
  /** Todas as vendas do turno, em todas as formas (o faturado do fechamento). */
  vendas: { qtd: number; valor: number };
  /** A parte das vendas que entrou em DINHEIRO (é a que vai para a gaveta). */
  vendasEmDinheiro: number;
  /** Reforço/suprimento lançado no "Informar entrada". */
  entradas: number;
  /** Sangria lançada no "Informar saída". */
  saidas: number;
  /** O dinheiro que deveria estar na gaveta agora — o `expected.cash` do fechamento. */
  dinheiroNaGaveta: number;
};

/**
 * Monta o resumo a partir do turno JÁ APURADO pelo fechamento.
 *
 * `dinheiroNaGaveta` é o `expected.cash` como veio, e não a soma das parcelas
 * refeita aqui: se um dia o fechamento passar a descontar mais alguma coisa da
 * gaveta, o topo do menu acompanha sozinho em vez de discordar do fechamento.
 */
export function resumoDoCaixaAberto(
  caixa: { openedAt: Date | string; openingAmount: number | null | undefined; abertoPor?: unknown },
  turno: TurnoApurado,
): ResumoDoCaixaAberto {
  return {
    abertoEm: new Date(caixa.openedAt).toISOString(),
    abertoPor: lerQuemAbriu(caixa.abertoPor),
    trocoInicial: c2(caixa.openingAmount || 0),
    vendas: { qtd: Number(turno.detalhe.vendas.qtd) || 0, valor: c2(turno.detalhe.vendas.valor) },
    vendasEmDinheiro: c2(turno.detalhe.gaveta.vendasEmDinheiro),
    entradas: c2(turno.movimentacaoEntradas),
    saidas: c2(turno.movimentacaoSaidas),
    dinheiroNaGaveta: c2(turno.expected.cash),
  };
}
