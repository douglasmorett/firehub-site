/* ═══════════════════════════════════════════════════════════════════════════
   A ÚLTIMA TELA DO KDS DESTE APARELHO

   O endereço curto da TV (/tv do computador da loja, ou /store/kds/tela
   digitado à mão) chega SEM etapa, e a tela mandava para a lista de telas
   — onde, no controle remoto, é preciso navegar até o "ABRIR TELA" (Hakim
   Centro, 14/10/2026). Cada aparelho guarda a tela que abriu por último
   (localStorage `kds-ultima-tela`, a query inteira) e o endereço sem etapa
   reabre essa tela.

   Sem laço: só se guarda e só se reabre query COM etapa válida — a tela
   reaberta tem etapa, então não passa por aqui de novo. Endereço que já traz
   algum parâmetro de tela (o link quebrado ou antigo) não é trocado pelo
   guardado: vai para a lista, como sempre foi, para ninguém abrir a tela
   errada achando que é a do link.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CHAVE_DA_ULTIMA_TELA = "kds-ultima-tela";

const ETAPAS = new Set(["production", "finishing"]);
/** Parâmetros que dizem QUAL tela é. Com qualquer um deles, o link manda. */
const PARAMETROS_DA_TELA = ["stage", "tela", "name", "filter", "categories"];

function semInterrogacao(query: string | null | undefined): string {
  const q = String(query ?? "").trim();
  return q.startsWith("?") ? q.slice(1) : q;
}

/**
 * O que guardar da tela aberta agora: a query (sem "?") quando ela tem etapa
 * válida; `null` quando não há o que guardar.
 */
export function ultimaTelaParaGuardar(query: string | null | undefined): string | null {
  const q = semInterrogacao(query);
  if (!q) return null;
  const etapa = new URLSearchParams(q).get("stage");
  return etapa && ETAPAS.has(etapa) ? q : null;
}

/**
 * Para onde vai o /store/kds/tela que abriu sem etapa: a última tela deste
 * aparelho, se o endereço não trouxe nenhum parâmetro de tela e o guardado
 * for uma tela válida; senão a lista de telas (/store/kds).
 */
export function destinoDaTelaSemEtapa(queryAtual: string | null | undefined, guardada: string | null | undefined): string {
  const atual = new URLSearchParams(semInterrogacao(queryAtual));
  const trouxeTela = PARAMETROS_DA_TELA.some((p) => atual.has(p));
  const ultima = ultimaTelaParaGuardar(guardada);
  if (!trouxeTela && ultima) return `/store/kds/tela?${ultima}`;
  return "/store/kds";
}
