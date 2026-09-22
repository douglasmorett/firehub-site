/**
 * src/lib/kds-telas.ts — a baixa do KDS quando o pedido está em MAIS DE UMA tela.
 *
 * ── O que quebrava ──────────────────────────────────────────────────────────
 *
 * A NIK separa a cozinha em duas telas por categoria: uma de esfirra e uma de
 * pizza. Um pedido com 20 esfirras e 1 pizza aparece nas DUAS, cada uma
 * mostrando só os itens dela — isso sempre funcionou, porque o filtro de
 * categoria é da tela.
 *
 * A BAIXA é que não era. `kdsStage` é um campo só do pedido, então a esfirra
 * dar baixa finalizava o pedido INTEIRO: ele sumia também da tela de pizza,
 * que nem tinha começado, e ia direto para a finalização (relatado em
 * 21/09/2026). A cozinha perdia a pizza de vista.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * `CustomerOrder.kdsTelasProntas` guarda QUAIS telas já deram baixa. A partir
 * daí:
 *
 *   - a tela que deu baixa para de ver o pedido (ele saiu dali);
 *   - as outras continuam vendo, com os itens delas;
 *   - o `kdsStage` só avança quando TODAS as telas que têm item naquele
 *     pedido tiverem dado baixa — só então ele vai para a finalização.
 *
 * ── Por que só as telas do MESMO estágio ────────────────────────────────────
 *
 * Produção e finalização são sequenciais, não paralelas: a de finalização só
 * recebe o pedido depois que a produção acabou. Contá-la como "tela que falta"
 * faria a produção esperar por quem ainda nem viu o pedido — e nada avançaria
 * nunca.
 *
 * ── Por que tela SEM filtro conta como "tem item" ───────────────────────────
 *
 * Filtro vazio significa "mostro tudo". Essa tela vê qualquer pedido, então
 * ela participa de qualquer baixa. Deixá-la de fora faria o pedido avançar com
 * ela ainda cheia.
 */

/** Uma tela configurada na loja (`User.kdsScreens`). */
export type TelaDoKds = {
  id?: string | null;
  name?: string | null;
  stage?: string | null;
  /** Nomes de categoria. Vazio = a tela mostra tudo. */
  categoryFilter?: string[] | null;
};

/** O que basta de um item para saber em que tela ele aparece. */
export type ItemParaTela = {
  category?: string | null;
  menuProduct?: { category?: string | null } | null;
};

const texto = (v: unknown) => String(v ?? "").toLowerCase().trim();

/**
 * A chave que identifica a tela na lista de baixas.
 *
 * O id do hub é o certo. O nome é a reserva para a tela aberta por um link
 * antigo, de antes deste recurso: sem ela, a tela velha gravaria `""` e duas
 * telas diferentes compartilhariam a mesma marca.
 */
export function chaveDaTela(tela: TelaDoKds | null | undefined): string {
  if (!tela) return "";
  const id = String(tela.id ?? "").trim();
  if (id) return id;
  const nome = texto(tela.name);
  return nome ? `nome:${nome}` : "";
}

/**
 * A tela mostra este item?
 *
 * Item SEM categoria aparece em toda tela filtrada — é a mesma rede de
 * segurança do filtro da tela (o espelho do iFood chega com categoria da
 * plataforma, e era por isso que a pizza do iFood sumia da tela de pizza;
 * ver lib/categoria-do-item.ts).
 */
export function telaMostraItem(tela: TelaDoKds, item: ItemParaTela): boolean {
  const filtros = (tela.categoryFilter || []).map(texto).filter(Boolean);
  if (filtros.length === 0) return true;
  const cat = texto(item?.menuProduct?.category ?? item?.category);
  if (!cat) return true;
  return filtros.includes(cat);
}

/**
 * As telas do estágio dado que têm pelo menos um item deste pedido.
 *
 * É a lista de quem PRECISA dar baixa para o pedido andar.
 */
export function telasComItem(
  telas: TelaDoKds[] | null | undefined,
  itens: ItemParaTela[] | null | undefined,
  estagio: string
): string[] {
  const doEstagio = (telas || []).filter((t) => texto(t?.stage) === texto(estagio));
  const lista = itens || [];
  const chaves: string[] = [];
  for (const t of doEstagio) {
    const chave = chaveDaTela(t);
    if (!chave || chaves.includes(chave)) continue;
    if (lista.some((i) => telaMostraItem(t, i))) chaves.push(chave);
  }
  return chaves;
}

/** Lê o campo do banco sem confiar no formato. */
export function lerTelasProntas(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  return [...new Set(bruto.map((v) => String(v ?? "").trim()).filter(Boolean))];
}

/**
 * Ainda falta alguma tela dar baixa neste pedido?
 *
 * `false` = pode avançar o `kdsStage`. Com a loja SEM telas configuradas (ou
 * com uma só), `telasComItem` devolve no máximo uma chave e a primeira baixa
 * já libera — que é exatamente como o KDS sempre funcionou.
 */
export function faltaTelaDarBaixa(
  telas: TelaDoKds[] | null | undefined,
  itens: ItemParaTela[] | null | undefined,
  estagio: string,
  prontas: unknown
): boolean {
  const precisam = telasComItem(telas, itens, estagio);
  if (precisam.length <= 1) return false;
  const jaDeram = lerTelasProntas(prontas);
  return precisam.some((c) => !jaDeram.includes(c));
}
