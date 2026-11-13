/**
 * CAIXA POR USUÁRIO — as regras puras (sem banco), para o servidor, a tela e
 * o teste (scripts/teste-caixa-por-usuario.ts) lerem a MESMA coisa.
 *
 * Pedido da Garagem Burger (Thalyta), aprovado pelo Douglas em 13/11/2026: a
 * loja tinha UM caixa para todos os logins (dono + equipe). Quem trabalha com
 * duas pessoas no caixa ao mesmo tempo não conseguia saber de quem era a
 * falta — o dinheiro das duas gavetas caía no mesmo turno. Com a chave
 * "Cada usuário tem o seu próprio caixa" ligada (Minha Loja › Balcão, Pager &
 * Caixa; `balcaoConfig.caixaPorUsuario`), cada login abre, movimenta e fecha
 * o SEU caixa, e as vendas que ele lança caem nele.
 *
 * ── COMO UM CAIXA SABE QUE É DE ALGUÉM ─────────────────────────────────────
 *
 * Sem coluna nova: o `CashSession.abertoPor` (JSON de quem abriu, desde
 * 17/10/2026) ganha `usuarioId` e `porUsuario: true` quando o caixa nasce com a
 * chave ligada. A marca é DO CAIXA, não da loja: desligar a chave depois não
 * muda como um caixa antigo se apura (a 2ª via continua batendo com o que foi
 * fechado), e o caixa compartilhado de antes continua compartilhado.
 *
 * ── DE QUAL CAIXA É CADA VENDA ─────────────────────────────────────────────
 *
 * A venda lançada por um login (balcão do PDV, conta de mesa fechada pelo
 * painel) fica VINCULADA ao caixa aberto dele no momento — tabela
 * "CaixaDoLancamento" (lib/caixa-por-usuario.ts). O que não tem quem lançou
 * (site, robô, iFood e outros apps, totem, garçom pelo link, maquininha)
 * vai para o CAIXA PRINCIPAL daquele instante:
 *   1. o caixa aberto pelo login do DONO da loja (a conta sem `ownerId`);
 *   2. se o dono não tem caixa aberto, o caixa aberto há mais tempo — é o que
 *      a loja considera "o caixa do turno";
 *   3. nenhum caixa aberto: não cai em caixa nenhum, como hoje (aparece como
 *      "vendas de antes deste caixa" no fechamento seguinte).
 * Decisão de 13/11/2026: o pedido de fora não tem gaveta física de ninguém
 * (o pago online nem passa pela gaveta), e mandá-lo para o caixa do dono é o
 * que mantém o dinheiro do motoboy e do delivery num lugar só.
 *
 * Cada pedido cai em UM caixa só (o vinculado, ou o principal daquele
 * instante): a soma dos caixas do dia é o dia, sem contar nada duas vezes.
 */

/** O que a tela e o servidor mostram ao LIGAR a chave. */
export const AVISO_AO_LIGAR_CAIXA_POR_USUARIO =
  "Com esta opção ligada, cada login da loja (você e cada pessoa da equipe) tem o seu PRÓPRIO caixa. " +
  "Se um caixa estiver aberto por um usuário e outro usuário entrar, esse outro usuário vai abrir um caixa SEPARADO, só dele. " +
  "Os caixas não se misturam: cada um tem a sua abertura, as suas vendas, as suas entradas e retiradas, o seu fechamento e o seu saldo. " +
  "Pedidos do site, do robô, do iFood e de outros aplicativos, do totem e do garçom pelo link entram no caixa do dono (ou, se o dono não tiver caixa aberto, no caixa aberto há mais tempo).";

/** Para trocar a chave, nenhum caixa pode estar aberto (ver a rota que grava). */
export const MENSAGEM_FECHE_O_CAIXA_PARA_TROCAR =
  "Para ligar ou desligar o caixa por usuário, feche antes o caixa que está aberto. Assim nenhum turno fica com metade das vendas em cada modo.";

/** O PDV com a chave ligada e o caixa DESTE login fechado. */
export const MENSAGEM_ABRA_O_SEU_CAIXA =
  "O seu caixa está fechado. Nesta loja cada usuário tem o seu próprio caixa: abra o seu caixa para vender.";

/** De quem é este caixa: o `usuarioId` gravado na abertura, ou null (caixa da loja, compartilhado). */
export function donoDoCaixa(abertoPor: unknown): string | null {
  let v: any = abertoPor;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== "object") return null;
  if (v.porUsuario !== true) return null;
  const id = typeof v.usuarioId === "string" ? v.usuarioId.trim() : "";
  return id || null;
}

/** Um caixa como a linha do tempo da loja precisa: quando abriu, quando fechou e de quem é. */
export type CaixaNaLinhaDoTempo = { id: string; openedAt: Date; closedAt: Date | null; abertoPor: unknown };

const abertoNoInstante = (c: CaixaNaLinhaDoTempo, t: Date) =>
  c.openedAt.getTime() <= t.getTime() && (!c.closedAt || c.closedAt.getTime() > t.getTime());

/**
 * O caixa que recebe o que não tem quem lançou, no instante `t` (ver o topo:
 * o do dono; senão o aberto há mais tempo; senão nenhum). Só caixas por
 * usuário entram — o compartilhado já conta tudo pelo horário.
 */
export function caixaPrincipalEm(t: Date, caixas: CaixaNaLinhaDoTempo[], lojaId: string): string | null {
  const abertos = caixas
    .filter((c) => donoDoCaixa(c.abertoPor) && abertoNoInstante(c, t))
    .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime() || a.id.localeCompare(b.id));
  if (abertos.length === 0) return null;
  return (abertos.find((c) => donoDoCaixa(c.abertoPor) === lojaId) ?? abertos[0]).id;
}

/** A chave de um vínculo: o que foi lançado (pedido ou conta de mesa) e o id. */
export type TipoDoLancamento = "PEDIDO" | "MESA";
export const chaveDoVinculo = (tipo: TipoDoLancamento, id: string) => `${tipo}:${id}`;

type PedidoParaSeparar = { id: string; createdAt: Date; parentOrderId?: string | null; tableSessionId?: string | null };
type MesaParaSeparar = { id?: string; closedAt?: Date | string | null };

/**
 * De qual caixa é este pedido.
 *
 *  • lançado por um login (vínculo do pedido) → o caixa dele;
 *  • pedido de MESA cuja conta foi fechada por um login → o caixa de quem
 *    fechou, se esse caixa já estava aberto quando o pedido entrou (senão a
 *    conta atravessou dois caixas, e o pedido fica onde estava — como a mesa
 *    que atravessa dois turnos no caixa compartilhado);
 *  • acréscimo de um pedido lançado por alguém → o caixa do pedido principal;
 *  • o resto → o caixa principal daquele instante.
 */
export function caixaDoPedido(
  o: PedidoParaSeparar,
  caixas: CaixaNaLinhaDoTempo[],
  vinculos: Map<string, string>,
  lojaId: string,
): string | null {
  const proprio = vinculos.get(chaveDoVinculo("PEDIDO", o.id));
  if (proprio) return proprio;
  if (o.tableSessionId) {
    const daConta = vinculos.get(chaveDoVinculo("MESA", o.tableSessionId));
    const caixa = daConta ? caixas.find((c) => c.id === daConta) : null;
    if (caixa && abertoNoInstante(caixa, o.createdAt)) return caixa.id;
  }
  if (o.parentOrderId) {
    const doPai = vinculos.get(chaveDoVinculo("PEDIDO", o.parentOrderId));
    if (doPai) return doPai;
  }
  return caixaPrincipalEm(o.createdAt, caixas, lojaId);
}

/** De qual caixa é esta conta de mesa fechada: de quem fechou pelo painel, senão o principal na hora do fechamento. */
export function caixaDaMesa(m: MesaParaSeparar, caixas: CaixaNaLinhaDoTempo[], vinculos: Map<string, string>, lojaId: string): string | null {
  const vinculo = m.id ? vinculos.get(chaveDoVinculo("MESA", m.id)) : undefined;
  if (vinculo) return vinculo;
  return m.closedAt ? caixaPrincipalEm(new Date(m.closedAt), caixas, lojaId) : null;
}

/**
 * Do que a varredura do turno achou pelo HORÁRIO, só o que é DESTE caixa.
 * Quem chama é lib/esperado-do-turno.ts, e só para caixa por usuário: o
 * compartilhado continua contando tudo pelo horário, como sempre.
 */
export function separarDoCaixa<P extends PedidoParaSeparar, M extends MesaParaSeparar>(
  caixaId: string,
  lojaId: string,
  pedidos: P[],
  mesas: M[],
  caixas: CaixaNaLinhaDoTempo[],
  vinculos: Map<string, string>,
): { pedidos: P[]; mesas: M[] } {
  return {
    pedidos: pedidos.filter((o) => caixaDoPedido(o, caixas, vinculos, lojaId) === caixaId),
    mesas: mesas.filter((m) => caixaDaMesa(m, caixas, vinculos, lojaId) === caixaId),
  };
}

/**
 * Quais caixas este login vê no Histórico de caixas. O dono (login sem
 * `ownerId`) vê os de todos e pode filtrar por um usuário; com a chave
 * ligada, o funcionário vê só os próprios. Chave desligada e sem filtro: a
 * lista de sempre, inteira.
 */
export function caixasVisiveis<C extends { abertoPor: unknown }>(
  caixas: C[],
  quem: { usuarioId: string; souDono: boolean; porUsuario: boolean; filtro?: string | null },
): C[] {
  const soDe = quem.porUsuario && !quem.souDono ? quem.usuarioId : quem.souDono && quem.filtro ? quem.filtro : null;
  return soDe ? caixas.filter((c) => donoDoCaixa(c.abertoPor) === soDe) : caixas;
}
