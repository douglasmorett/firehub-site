/**
 * O LINK CURTO DE CADA TELA DO KDS — firehubfood.com.br/kds/esfirra ou /kds/3.
 *
 * Douglas, 24/10/2026, na Hakim Centro: "queria um link mais curto pra gente
 * digitar pro KDS entrar em cada tela quando necessário". Na Smart TV se
 * digita com o controle: /store/kds/tela?stage=…&tela=<uuid> não dá.
 *
 * A loja vem do LOGIN (a TV já está logada nela), como em todo /store: o link
 * só diz QUAL tela. Pelo nome sem acento, espaço nem hífen ("finalizacao2",
 * "finalizacao-2", "Finalização 2" dão no mesmo) ou pelo número da ordem em
 * que aparece no hub (/kds/3 = a 3ª).
 *
 * SEM IMPORTS: o hub (navegador) e a página de redirecionamento (servidor)
 * usam as mesmas funções.
 */
export type TelaDoKds = { id: string; name: string; stage: string; filter?: string; categoryFilter?: string[] };

/** "Finalização 2" → "finalizacao-2": o que o link mostra. */
export function chaveDaTela(nome: string): string {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Para comparar: sem hífen ("finalizacao2" acha "finalizacao-2"). */
const semHifen = (s: string) => chaveDaTela(s).replace(/-/g, "");

/** A tela do link: pelo número (1 = a primeira) ou pelo nome. */
export function acharTela<T extends TelaDoKds>(telas: T[], pedido: string): T | null {
  const texto = decodeURIComponent(String(pedido || "")).trim();
  if (/^\d{1,2}$/.test(texto)) return telas[Number(texto) - 1] ?? null;
  const alvo = semHifen(texto);
  if (!alvo) return null;
  return telas.find((t) => semHifen(t.name) === alvo) ?? null;
}

/** O endereço completo da tela — o mesmo que o botão ABRIR TELA do hub monta. */
export function urlDaTela(tela: TelaDoKds): string {
  return "/store/kds/tela?stage=" + tela.stage + "&filter=" + (tela.filter || "all") + "&name=" + encodeURIComponent(tela.name)
    + "&tela=" + encodeURIComponent(tela.id);
}
