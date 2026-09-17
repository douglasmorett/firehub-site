/**
 * O número do pager do cliente que espera no balcão.
 *
 * ── O que é ─────────────────────────────────────────────────────────────────
 *
 * A loja entrega um aparelhinho numerado para quem espera o pedido no balcão e
 * o chama quando fica pronto. O número é digitado no lançamento da venda, é
 * opcional, e a loja numera do jeito dela ("12", "A3", "07") — daí ser texto.
 *
 * ── Por que ele entra pelo NOME DO CLIENTE na comanda ───────────────────────
 *
 * Quem imprime a comanda é o Assistente instalado no PC da loja, não o site.
 * Um campo novo no papel exigiria uma versão nova do Assistente — e em
 * 17/09/2026, das 8 lojas que consultam a fila, só 2 estavam na versão atual
 * (as outras em 1.2.9, 1.2.10, 1.2.13, 1.2.14, e duas sem informar). O lojista
 * digitaria o número do pager e não sairia nada em 6 lojas de 8.
 *
 * Pelo nome do cliente, funciona em TODA versão hoje, sem ninguém atualizar
 * nada — e faz sentido: no balcão o pager É como o atendente identifica quem
 * vai buscar. Quando a pessoa também deu o nome, os dois aparecem juntos.
 *
 * Quando o parque de Assistentes estiver atualizado, dá para promover o pager a
 * campo próprio no papel sem mexer em nada daqui: é só o Assistente passar a
 * ler `pagerNumber`, que já vai no payload.
 */

/** Como o número é escrito em qualquer lugar que o mostre. */
export const ETIQUETA_DO_PAGER = "PAGER";

/**
 * Limpa o que veio da tela. Devolve null quando não há pager.
 *
 * Teto de 10 caracteres: é um número de aparelho, não um campo de texto —
 * sem limite, alguém cola a observação inteira aqui e ela vai parar no nome do
 * cliente impresso na comanda.
 */
export function lerPager(bruto: unknown): string | null {
  if (bruto == null) return null;
  const limpo = String(bruto).trim().slice(0, 10);
  return limpo === "" ? null : limpo;
}

/**
 * O nome que vai para a COMANDA, com o pager embutido.
 *
 * "João" + pager 12  → "João · PAGER 12"
 * "Balcão" + pager 12 → "PAGER 12"   (o rótulo genérico dá lugar ao número)
 * sem pager           → o nome, intacto
 *
 * O caso do rótulo genérico importa: o lançamento de balcão grava "Balcão"
 * como nome quando ninguém digitou nada, e "Balcão · PAGER 12" gasta metade da
 * linha da comanda para dizer o que o cabeçalho já diz. O número é a
 * informação; o resto é ruído numa bobina de 32 colunas.
 */
export function nomeComPager(nome: string | null | undefined, pager: unknown): string {
  const numero = lerPager(pager);
  const base = (nome || "").trim();
  if (!numero) return base;

  const etiqueta = `${ETIQUETA_DO_PAGER} ${numero}`;
  if (!base || ehRotuloGenerico(base)) return etiqueta;
  return `${base} · ${etiqueta}`;
}

/** Os nomes que o sistema inventa quando ninguém digitou um de verdade. */
function ehRotuloGenerico(nome: string): boolean {
  const n = nome.toLowerCase();
  return n === "balcão" || n === "balcao" || n === "cliente" || n === "consumidor";
}
