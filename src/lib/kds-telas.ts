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
  /** "all" | "odd" | "even" | "delivery" | "pickup". Vazio = tudo. */
  filter?: string | null;
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
 * A tela PRECISA dar baixa por causa deste item?
 *
 * ── Por que não é a mesma pergunta de `telaMostraItem` ──────────────────────
 *
 * Mostrar é generoso de propósito: item sem categoria aparece em TODA tela,
 * para nunca sumir da cozinha. Exigir baixa tem que ser o contrário —
 * conservador — e confundir as duas travava o pedido.
 *
 * O caso real: o item de plataforma cuja categoria não casa com nada do
 * cardápio fica sem categoria. Pela regra de mostrar, ele aparecia nas três
 * telas da loja; pela regra de exigir, ele passava a exigir baixa das TRÊS.
 * Basta a loja ter uma tela que ninguém abre e o pedido nunca chega na
 * finalização — comida pronta, esperando um clique que não vem.
 *
 * Aqui só prende quem casa DE VERDADE: filtro que bate com a categoria, ou
 * tela sem filtro nenhum (que é a tela que vê tudo e por isso responde por
 * tudo). Item órfão não prende ninguém — ele continua aparecendo, mas não
 * segura o pedido.
 */
export function telaPrecisaDarBaixa(tela: TelaDoKds, item: ItemParaTela): boolean {
  const filtros = (tela.categoryFilter || []).map(texto).filter(Boolean);
  if (filtros.length === 0) return true;
  const cat = texto(item?.menuProduct?.category ?? item?.category);
  if (!cat) return false;
  return filtros.includes(cat);
}

/**
 * As telas do estágio dado que PRECISAM dar baixa neste pedido.
 *
 * Usa `telaPrecisaDarBaixa`, não `telaMostraItem`: mostrar é generoso e
 * exigir é conservador. A diferença é o que impede o pedido de travar.
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
    if (lista.some((i) => telaPrecisaDarBaixa(t, i))) chaves.push(chave);
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

/**
 * Os NOMES das telas que ainda precisam dar baixa neste pedido.
 *
 * Serve para a tela que acabou de dar baixa dizer por quem está esperando.
 * Pedido que some sem explicação é pedido que a cozinha para de procurar: se
 * ele não foi para a finalização, alguém tem que saber de quem é a vez.
 */
export function nomesDasTelasQueFaltam(
  telas: TelaDoKds[] | null | undefined,
  itens: ItemParaTela[] | null | undefined,
  estagio: string,
  prontas: unknown
): string[] {
  const precisam = telasComItem(telas, itens, estagio);
  const jaDeram = lerTelasProntas(prontas);
  const faltando = precisam.filter((c) => !jaDeram.includes(c));
  return faltando.map((chave) => {
    const t = (telas || []).find((x) => chaveDaTela(x) === chave);
    return String(t?.name ?? "").trim() || "outra tela";
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   O PRONTO NA PRODUÇÃO É DO ITEM, NÃO DA TELA

   Decisão do dono em 22/09/2026, e ela junta duas frases que pareciam opostas:

     "se der baixa na esfirra, a pizza continua na tela dela"
     "se duas telas mostram a mesma coisa e alguém já fez, não é pra fazer de novo"

   As duas só brigam se o pronto for da TELA. Sendo do ITEM, viram a mesma
   regra: marcar na tela de esfirra carimba os ITENS de esfirra. A pizza segue
   sem carimbo, então continua na tela de pizza. E o item que aparece nas duas
   telas, uma vez carimbado, sai das duas.

   A finalização é o contrário e continua por TELA: duas telas de finalização
   mostram tudo e são estações diferentes — a baixa de uma não é a da outra.
   ═══════════════════════════════════════════════════════════════════════════ */

/** O item já foi dado por pronto na produção? */
export function itemPronto(item: { prontoEm?: Date | string | null } | null | undefined): boolean {
  return !!item?.prontoEm;
}

/**
 * Os itens que ESTA tela mostra.
 *
 * Usa a regra generosa (`telaMostraItem`): o que está na tela é o que aquele
 * cozinheiro vê e faz, inclusive o item de categoria desconhecida, que aparece
 * em todas. Carimbar o que está na tela é exatamente "o que eu fiz".
 */
export function itensDaTela<T extends ItemParaTela>(tela: TelaDoKds, itens: T[] | null | undefined): T[] {
  return (itens || []).filter((i) => telaMostraItem(tela, i));
}

/**
 * Esta tela de produção ainda tem o que fazer neste pedido?
 *
 * `false` = tudo que ela mostra já está carimbado, então o pedido sai DAQUI —
 * sem tirar de quem ainda tem item pendente.
 */
export function telaTemPendencia<T extends ItemParaTela & { prontoEm?: Date | string | null }>(
  tela: TelaDoKds,
  itens: T[] | null | undefined
): boolean {
  const meus = itensDaTela(tela, itens);
  if (meus.length === 0) return false;
  return meus.some((i) => !itemPronto(i));
}

/** Alguma coisa deste pedido já foi dada por pronta? */
export function temAlgoPronto(itens: { prontoEm?: Date | string | null }[] | null | undefined): boolean {
  return (itens || []).some((i) => itemPronto(i));
}

/** Tudo que o pedido tem já foi dado por pronto? */
export function tudoPronto(itens: { prontoEm?: Date | string | null }[] | null | undefined): boolean {
  const lista = itens || [];
  return lista.length > 0 && lista.every((i) => itemPronto(i));
}

/**
 * Ainda falta alguma tela de FINALIZAÇÃO dar a baixa dela?
 *
 * O pronto aqui não é do item: a finalização não pergunta "a comida ficou
 * pronta", pergunta "esta estação fez a parte dela". Por isso é por tela, e
 * por isso uma não fala pela outra.
 *
 * Mas só pode prender quem ENXERGA o pedido — nos dois sentidos:
 *
 *   • o filtro de ímpar/par/entrega, senão a tela de par travaria todo pedido
 *     ímpar, que ela nunca vai ver;
 *   • o filtro de CATEGORIA, pela mesma razão. A NIK tem "Finalização Esfihas"
 *     e "Finalização Pizza" com listas de categoria separadas: um pedido só de
 *     esfiha não aparece na tela de pizza (a tela esconde pedido sem item seu),
 *     e exigir a baixa dela deixaria o pedido parado para sempre entre a
 *     produção e o finalizado. É o mesmo buraco que o dono apontou na bebida
 *     filtrada para fora de todas as telas.
 *
 * Sem `itens` a régua de categoria não roda — quem chama sem eles trata só do
 * filtro de número.
 */
export function faltaFinalizacao(
  telas: TelaDoKds[] | null | undefined,
  prontas: unknown,
  pedido?: { numero?: unknown; deliveryType?: string | null } | null,
  itens?: ItemParaTela[] | null
): boolean {
  const deFinalizacao = (telas || [])
    .filter((t) => texto(t?.stage) === "finishing")
    .filter((t) => !pedido || telaMostraPedido(t as any, pedido))
    .filter((t) => !itens || itens.length === 0 || itensDaTela(t, itens).length > 0)
    .map(chaveDaTela)
    .filter(Boolean);
  const unicas = [...new Set(deFinalizacao)];
  if (unicas.length <= 1) return false;
  const jaDeram = lerTelasProntas(prontas);
  return unicas.some((c) => !jaDeram.includes(c));
}

/**
 * A tela mostra ESTE PEDIDO? (o filtro de par/ímpar, entrega e retirada)
 *
 * Existe porque duas telas de finalização podem dividir a operação em vez de
 * duplicá-la: uma só ímpar, outra só par (pedido do dono, 22/09/2026). Nesse
 * arranjo o pedido ímpar aparece só numa delas, e exigir baixa das DUAS
 * travaria o pedido para sempre — a outra nunca vai ver aquele número.
 *
 * É a mesma régua que a tela usa para desenhar; mora aqui para o servidor
 * decidir "quem ainda falta" com o mesmo critério que o cozinheiro enxerga.
 */
export function telaMostraPedido(
  tela: { filter?: string | null } | null | undefined,
  pedido: { numero?: unknown; deliveryType?: string | null } | null | undefined
): boolean {
  const f = texto(tela?.filter);
  if (!f || f === "all") return true;
  if (f === "delivery") return texto(pedido?.deliveryType) === "delivery";
  if (f === "pickup") return texto(pedido?.deliveryType) === "retirada";
  if (f === "odd" || f === "even") {
    const n = parseInt(String(pedido?.numero ?? "").replace(/\D/g, "") || "0", 10);
    return f === "odd" ? n % 2 !== 0 : n % 2 === 0;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUEM É DONO DE CADA CATEGORIA, VISTO DE UMA TELA

   "Categoria sem dono acompanha o pedido em toda tela" — e o dono era a união
   dos filtros SALVOS de todas as telas da etapa, inclusive a própria. O filtro
   que o cozinheiro escolhe na própria tela (a lista CATEGORIAS) não entrava:
   na Hakim Centro (24/09/2026), com as 4 telas salvas sem filtro, marcar
   "Esfirras Salgadas" e "Esfirras Doces" deixava as próprias esfirras "sem
   dono" — e a regra do sem dono mostrava tudo. O filtro não filtrava nada.

   Agora: dono = os filtros salvos das OUTRAS telas da etapa + o filtro que
   ESTA tela está usando. O salvo desta tela não entra: quem manda nela é o que
   ela está usando agora.
   ═══════════════════════════════════════════════════════════════════════════ */

export function categoriasComDono(
  telas: TelaDoKds[] | null | undefined,
  estagio: string,
  minha: TelaDoKds | null | undefined,
  filtroDestaTela?: string[] | null
): Set<string> {
  const donos = new Set<string>();
  const chaveMinha = chaveDaTela(minha);
  for (const t of telas || []) {
    if (texto(t?.stage) !== texto(estagio)) continue;
    if (minha && (t === minha || (chaveMinha !== "" && chaveDaTela(t) === chaveMinha))) continue;
    for (const c of t?.categoryFilter || []) {
      const nome = texto(c);
      if (nome) donos.add(nome);
    }
  }
  for (const c of filtroDestaTela || []) {
    const nome = texto(c);
    if (nome) donos.add(nome);
  }
  return donos;
}

/**
 * O pedido como ESTA tela o mostra, ou `null` se ela não o mostra.
 *
 * A decisão é POR PEDIDO, não item a item — é como a cozinha trabalha: "se o
 * pedido tivesse esfirra deveria aparecer tudo; como é só pizza, não tem nada
 * que faz parte do filtro dele, não deve aparecer" (NIK, 22/09/2026).
 *
 *   - Tem item do filtro desta tela: entra. Na finalização, inteiro (é onde a
 *     sacola é montada); na produção, só o que é desta tela mais o que não é
 *     de tela nenhuma (o acompanhamento), menos o que a loja deixou só para a
 *     finalização.
 *   - É TODO de categoria sem dono (a comanda só de refrigerante): entra
 *     inteiro em toda tela — senão não apareceria em nenhuma.
 *   - Senão, não entra.
 *
 * `donos` nulo = as telas ainda não carregaram: só o item sem categoria é
 * curinga, como sempre foi. Morava dentro de store/kds/tela/page.tsx; veio
 * para cá para o teste medir com pedido de verdade.
 */
export function pedidoNaTela<I extends ItemParaTela, P extends { items: I[] }>(
  pedido: P,
  opts: {
    filtroDestaTela: string[];
    donos: Set<string> | null;
    estagio: string;
    config: KdsConfig | null;
  }
): P | null {
  const ativos = (opts.filtroDestaTela || []).map(texto).filter(Boolean);
  if (ativos.length === 0) return pedido;
  const categoriaDoItem = (item: I) => texto(item?.menuProduct?.category || item?.category || "");
  const semDono = (cat: string) => !cat || (!!opts.donos && !opts.donos.has(cat));

  const cats = pedido.items.map(categoriaDoItem);
  const temItemDesteFiltro = cats.some((c) => c && ativos.includes(c));
  const pedidoTodoSemDono = cats.every(semDono);
  if (!temItemDesteFiltro && !pedidoTodoSemDono) return null;
  if (texto(opts.estagio) === "finishing") return pedido;
  if (pedidoTodoSemDono) return pedido;

  const items = pedido.items.filter((item) => {
    const cat = categoriaDoItem(item);
    if (ativos.includes(cat)) return true;
    if (!semDono(cat)) return false;
    return !categoriaSoNaFinalizacao(opts.config, cat, ativos);
  });
  return items.length > 0 ? { ...pedido, items } : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   O QUE NÃO VAI PARA A PRODUÇÃO: A BEBIDA

   Categoria sem tela acompanha o pedido em toda tela (é a borda, feita junto
   com a pizza). Mas a NIK pediu, em 22/09/2026, que a BEBIDA não aparecesse
   nas telas de produção — nem na de pizza, nem na de esfiha — porque ninguém
   produz Coca-Cola: ela só importa na finalização, quando a sacola é montada.

   Isso não cabe no filtro da tela. Pôr "Bebidas" numa tela dá dono a ela e
   ela some das outras; tirar de todas faz acompanhar todas. O que falta é
   uma terceira posição — "só na finalização" — e ela é da LOJA, não da tela:
   a bebida não é produzida em tela nenhuma, e uma tela nova não pode
   trazê-la de volta.

   Mora em `User.kdsConfig.soNaFinalizacao`, por NOME de categoria, como o
   `categoryFilter` das telas.
   ═══════════════════════════════════════════════════════════════════════════ */

export type KdsConfig = {
  /** Nomes de categoria que não aparecem na produção, só na finalização. */
  soNaFinalizacao: string[];
};

/** Lê `User.kdsConfig` sem confiar no formato. Ausente = nada escondido. */
export function lerKdsConfig(bruto: unknown): KdsConfig {
  const obj = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as any) : {};
  const lista = Array.isArray(obj.soNaFinalizacao) ? obj.soNaFinalizacao : [];
  return {
    soNaFinalizacao: [...new Set(lista.map((v: unknown) => String(v ?? "").trim()).filter(Boolean))] as string[],
  };
}

/**
 * Esta categoria fica fora da produção?
 *
 * O filtro explícito da tela vence: se o lojista listou a categoria numa tela
 * de produção, ele quer vê-la ali, e a regra da loja não a esconde.
 */
export function categoriaSoNaFinalizacao(
  config: KdsConfig | null | undefined,
  categoria: string | null | undefined,
  filtroDaTela?: string[] | null
): boolean {
  const cat = texto(categoria);
  if (!cat || !config) return false;
  if ((filtroDaTela || []).map(texto).includes(cat)) return false;
  return config.soNaFinalizacao.map(texto).includes(cat);
}
