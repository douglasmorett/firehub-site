/**
 * Sem caixa aberto não se lança venda presencial.
 *
 * ── Por que a trava existe ──────────────────────────────────────────────────
 *
 * Venda de balcão, mesa e delivery lançado no PDV é dinheiro que entra pela
 * mão do atendente. Sem uma sessão de caixa aberta esse dinheiro não tem onde
 * ser registrado: o fechamento do dia não fecha, e a diferença aparece como
 * falta no relatório — o furo que ninguém explica no fim do mês.
 *
 * A mesma trava já existia no TOTEM desde antes (api/totem/order), pelo mesmo
 * motivo e com a mesma conta. O que faltava era ela valer para quem lança pelo
 * PDV, que é de onde vem a maior parte do dinheiro vivo.
 *
 * ── O que a trava NÃO faz ───────────────────────────────────────────────────
 *
 * Não fecha a loja, não bloqueia pedido do site, do WhatsApp, do iFood, do
 * 99Food nem de nenhuma integração: aquilo entra sozinho, a loja não escolheu
 * a hora, e recusar seria perder venda de verdade. Ela vale só para o que
 * alguém digita no PDV — que é exatamente o que precisa do caixa aberto.
 *
 * Também NÃO apaga o carrinho. O atendente abre o caixa em outra aba, volta e
 * finaliza o mesmo pedido: a regra do totem já era essa ("a tela não some, o
 * carrinho não se perde"), e aqui vale igual.
 *
 * ── Browser-safe de propósito ───────────────────────────────────────────────
 *
 * Só texto, sem prisma: a tela do PDV é componente de cliente e importar o
 * banco daqui o arrastaria para o pacote do navegador. Quem consulta o banco é
 * lib/caixa-aberto-servidor.ts, como em loja-de-origem / lojas-de-origem-da-conta.
 */

/** A frase que a tela e a API dizem — a MESMA, para ninguém traduzir uma na outra. */
export const MENSAGEM_CAIXA_FECHADO =
  "Seu caixa está fechado. Abra o caixa primeiro para poder lançar pedidos — sem ele o dinheiro desta venda não entra no fechamento do dia.";

/** O código que a tela reconhece para oferecer o atalho de abrir o caixa. */
export const ERRO_CAIXA_FECHADO = "caixa_fechado";

// ─── ABRIR O CAIXA DE OUTRA TELA ────────────────────────────────────────────
//
// Quem abre o caixa é o MODAL da barra do topo do painel (components/customer/
// StoreTopNav.tsx), montada em toda tela de /store pelo layout: troco sugerido
// pelo último fechamento, aviso do caixa encerrado por cima. O Balcão e as
// Mesas pedem esse modal por evento em vez de ter um modal próprio.
//
// O atalho era um link para "/store/caixa" — página que nunca existiu (só
// /store/caixa/historico): o "Abrir o caixa →" do Balcão e das Mesas dava 404
// justamente no momento em que o atendente precisava vender.

/** Pede à barra do topo o menu do caixa (ou o modal de abertura, com o caixa fechado). */
export const EVENTO_ABRIR_MENU_DO_CAIXA = "firehub:abrir-menu-caixa";

/** A barra do topo solta este evento depois de ABRIR e de FECHAR o caixa — `detail: { aberto }`. */
export const EVENTO_CAIXA_MUDOU = "firehub:caixa-mudou";

/** `?abrirCaixa=1` no endereço: a barra do topo abre o modal de abertura ao carregar. */
export const PARAMETRO_ABRIR_CAIXA = "abrirCaixa";

/**
 * O caminho quando a barra não está na página: o histórico de caixas — tela
 * que existe, tem a barra do topo (layout de /store) e abre com a MESMA
 * permissão do Balcão e das Mesas (lib/permissao-da-tela: "venda_presencial")
 * — com o pedido de abrir e o `voltar` para a tela de onde veio. A Início
 * (/store) não serve: o funcionário só do caixa não tem a permissão dela, e o
 * proxy o mandaria para outra tela sem o parâmetro.
 */
export function caminhoParaAbrirOCaixa(voltar?: string | null): string {
  const params = new URLSearchParams({ [PARAMETRO_ABRIR_CAIXA]: "1" });
  if (voltar && /^\/store(\/|$)/.test(voltar)) params.set("voltar", voltar);
  return `/store/caixa/historico?${params.toString()}`;
}

/** O `detail` do pedido: "abrir" = quem pede viu o caixa FECHADO e quer o modal de abertura. */
export type PedidoDoCaixa = { acao?: "abrir" };

/**
 * Pede o modal de ABERTURA do caixa à barra do topo.
 *
 * O evento é cancelável e a barra chama `preventDefault()` ao atender — é
 * assim que quem pede sabe que ela está na página. Ninguém atendeu (tela fora
 * do painel, barra ainda carregando): vai para `caminhoParaAbrirOCaixa`, que
 * abre o mesmo modal lá. Com `novaAba`, abre em outra aba — o Balcão fica com
 * o carrinho montado e repergunta o caixa ao ganhar o foco.
 *
 * Devolve `true` quando a barra atendeu ali mesmo.
 */
export function pedirAberturaDoCaixa(opcoes: { novaAba?: boolean } = {}): boolean {
  if (typeof window === "undefined") return false;
  const pedido = new CustomEvent<PedidoDoCaixa>(EVENTO_ABRIR_MENU_DO_CAIXA, { cancelable: true, detail: { acao: "abrir" } });
  // dispatchEvent devolve false quando algum ouvinte chamou preventDefault().
  if (!window.dispatchEvent(pedido)) return true;
  const destino = caminhoParaAbrirOCaixa(window.location.pathname);
  if (opcoes.novaAba) window.open(destino, "_blank", "noopener");
  else window.location.assign(destino);
  return false;
}

/**
 * A barra do topo avisa as telas abertas (Balcão, Mesas) que o caixa abriu ou
 * fechou. Quem ouve REPERGUNTA ao servidor (/api/store/caixa-aberto) em vez de
 * confiar no `detail`: é a mesma consulta que a API do pedido faz para barrar.
 */
export function avisarQueOCaixaMudou(aberto: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ aberto: boolean }>(EVENTO_CAIXA_MUDOU, { detail: { aberto } }));
}
