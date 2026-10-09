/**
 * O item que o robô anotou, do jeito que a COZINHA precisa receber.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O prompt manda o robô perguntar sabor, tamanho, adicional e observação. O
 * cliente responde, a IA anota em `options` — e o pedido era gravado só com
 * quantidade, preço e o id do produto. As escolhas entravam na conta do preço e
 * sumiam: o nome com elas era até montado ("Nugget (15 unidades)") e descartado
 * na hora de criar o item. A comanda do robô saía "1x Pizza Grande", sem sabor.
 * A tag nem tinha campo para "sem cebola".
 *
 * O site grava tudo isso desde sempre (api/customer-order/route.ts), nos mesmos
 * três campos que a impressão, o KDS e o painel já leem: `productName`,
 * `comboSelections` e `notes`. Este arquivo produz os três a partir da tag da
 * IA. Achado por três auditores independentes em 18/09/2026.
 *
 * ── O que NÃO mora aqui ─────────────────────────────────────────────────────
 *
 * O PREÇO. Ele é decidido em chatbot-ai.ts, por `precoUnitarioDoItem` sobre as
 * `comboSelections` daqui (a regra de cada pergunta: SOMA, MAIOR, MÉDIA) e com
 * o piso de `pisoDoPreco` — tirar o piso faria o Nugget de base R$ 0,00 voltar a
 * sair de graça quando a IA manda `options: []` (incidente de 01/08/2026).
 * `somaDasOpcoes` é a soma CHEIA, só para o log: cobrada, ela lançava a pizza
 * meio a meio pelo preço de duas inteiras (Divinos, 25/09/2026).
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-item-do-robo.mjs).
 */

export type GrupoDoProduto = {
  id: string;
  title?: string | null;
  /** Quantas escolhas a pergunta exige: `minQty`, ou exatamente `maxQty` quando nulo (schema). */
  minQty?: number | null;
  maxQty?: number | null;
  items?: Array<{ additionalPrice?: number | null; menuProduct?: { name?: string | null } | null } | null> | null;
};

export type ProdutoParaOItem = {
  name: string;
  comboGroups?: Array<GrupoDoProduto | null> | null;
};

export type ItemDaTag = {
  name?: unknown;
  quantity?: unknown;
  /** Sabores, tamanho, adicionais — texto solto da IA, ou objetos `{ name }`. */
  options?: unknown;
  /** Observação POR ITEM: "sem cebola", "bem passado". */
  notes?: unknown;
  /** Apelidos que o modelo usa no lugar de `notes`. */
  observation?: unknown;
  obs?: unknown;
};

export type EscolhasDoItem = {
  /** Formato do cardápio online: `{ grupoId: { nomeDaOpcao: quantidade } }`. Nulo = nenhuma opção casou. */
  comboSelections: Record<string, Record<string, number>> | null;
  /** Soma CHEIA dos `additionalPrice` das opções que casaram, sem a regra da pergunta. Não é o preço: ver o topo. */
  somaDasOpcoes: number;
  /** Opções que a IA anotou e que não existem no cadastro — NÃO são cobradas. */
  naoCasadas: string[];
  /**
   * Pergunta OBRIGATÓRIA que ficou com menos escolhas do que exige porque algo
   * que o cliente pediu não casou (o título dela), ou null. É o sabor da pizza
   * que o robô anotou com nome que o cadastro não tem: cobrar o piso aqui é
   * cobrar errado, então quem chama segura o pedido para a loja.
   */
  grupoIncompleto: string | null;
  /** Nome para `productName`: o do cadastro, com as escolhas entre parênteses. */
  productName: string;
  /** Texto para `notes` do item, ou null. */
  notes: string | null;
};

/** minúsculas, sem acento, só letra e número — a mesma chave que chatbot-ai usa para casar nomes. */
export function chaveDeNome(texto: unknown): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const LIMITE_DA_OBSERVACAO = 500;

/** "1/2 ", "meia ", "metade de " na frente do sabor — já na chave (sem acento, "1/2" vira "1 2"). */
const FRACAO_DA_PIZZA = /^(?:1 [234]|meia|meio|metade)\s+(?:(?:de|da|do)\s+)?/;

/** Teto de bom senso: pedido de 30 unidades da mesma opção é erro do modelo. */
const MAXIMO_POR_OPCAO = 30;

/**
 * "6x Esfirra de Queijo", "Esfirra de Queijo x6", {name, quantity: 6} — tudo
 * isso é a MESMA coisa, e antes nada disso funcionava: o texto com o número
 * junto não casava com o cadastro e ia para "conferir, não está no cadastro",
 * e o objeto com `quantity` virava uma unidade só. O combo de 10 esfirras da
 * Hakim chegava à cozinha como 1x de cada sabor.
 */
function quantidadeENome(bruta: unknown): { nome: string; quantidade: number } | null {
  const obj = bruta && typeof bruta === "object" ? (bruta as any) : null;
  const texto = String((obj ? obj.name ?? obj.nome : bruta) ?? "").trim();
  if (!texto) return null;

  const daChave = Number(obj?.quantity ?? obj?.qtd ?? obj?.quantidade);
  let quantidade = Number.isFinite(daChave) && daChave >= 1 ? Math.floor(daChave) : 1;

  let nome = texto;
  // Só com "x" explícito: "2 Andares" é nome de produto, não dois "Andares".
  const prefixo = texto.match(/^(\d{1,2})\s*[xX×]\s*(.+)$/);
  const sufixo = texto.match(/^(.+?)\s*[\(\[]?\s*[xX×]\s*(\d{1,2})\s*[\)\]]?$/);
  if (prefixo) {
    quantidade = Math.max(quantidade, parseInt(prefixo[1], 10) || 1);
    nome = prefixo[2].trim();
  } else if (sufixo) {
    quantidade = Math.max(quantidade, parseInt(sufixo[2], 10) || 1);
    nome = sufixo[1].trim();
  }

  if (!nome) return null;
  return { nome, quantidade: Math.min(Math.max(quantidade, 1), MAXIMO_POR_OPCAO) };
}

export function escolhasDoItem(item: ItemDaTag | null | undefined, produto: ProdutoParaOItem): EscolhasDoItem {
  const brutas: unknown[] = Array.isArray(item?.options) ? (item!.options as unknown[]) : [];

  const selecoes: Record<string, Record<string, number>> = {};
  const casadas: Array<{ nome: string; quantidade: number }> = [];
  const naoCasadas: string[] = [];
  let somaDasOpcoes = 0;

  /** A opção com este nome exato no cadastro do produto; null quando não existe. */
  const exata = (chave: string) => {
    for (const grupo of produto.comboGroups || []) {
      if (!grupo) continue;
      const opcao = (grupo.items || []).find((gi) => gi && chaveDeNome(gi.menuProduct?.name) === chave);
      if (opcao) return { grupo, opcao };
    }
    return null;
  };

  /**
   * Procura a opção: o nome exato; senão sem a fração da meia pizza; senão a
   * ÚNICA opção que contém o nome pedido inteiro; senão pelas PALAVRAS.
   *
   * Deeds Delivery, 02/10/2026, pedido #21: a IA anotou "1/2 Pizza Premium Dois
   * Queijos" e "1/2 Pizza Premium Calacheese LANÇAMENTO!" — é como se escreve
   * meio a meio. O "1/2" não casava, os dois sabores foram para "conferir", e a
   * pizza que o robô disse ao cliente por R$ 69,79 (com o broto) foi gravada por
   * R$ 42,89.
   *
   * Deeds de novo, 08/10/2026, pedido #21: "1/2 Pizza Frango I" e "1/2 Pizza
   * Calabresa" para um cadastro com "Pizza Tradicional Frango I" e "Pizza
   * Tradicional Calabresa". O modelo pulou a palavra do meio ("Tradicional"),
   * o nome inteiro não está contido em nenhuma opção, e a pizza que o robô
   * disse por R$ 41,90 saiu por R$ 39,90 com "conferir". Então, por último,
   * valem as palavras: toda palavra pedida tem de aparecer na opção. Várias
   * opções servem ("Calabresa" cabe em Calabresa, Calabresa Paulista e
   * Calabresa Argentina)? Fica a que tem MENOS palavras a mais — a versão
   * simples do sabor é o que quem diz só "calabresa" quer — e só se ela for
   * única nesse tamanho. Empate ("Frango" entre Frango I e Frango Especial)
   * continua ambiguidade: não se adivinha, vai para a conferência.
   */
  type Achado = { grupo: GrupoDoProduto; opcao: NonNullable<NonNullable<GrupoDoProduto["items"]>[number]> };
  const todasAsOpcoes = (): Achado[] => {
    const lista: Achado[] = [];
    for (const grupo of produto.comboGroups || []) {
      if (!grupo) continue;
      for (const gi of grupo.items || []) if (gi) lista.push({ grupo, opcao: gi });
    }
    return lista;
  };
  const procurar = (chave: string) => {
    if (!chave) return null;
    const direto = exata(chave);
    if (direto) return direto;
    const semFracao = chave.replace(FRACAO_DA_PIZZA, "").trim();
    if (semFracao && semFracao !== chave) {
      const achado = exata(semFracao);
      if (achado) return achado;
    }
    const pedido = semFracao || chave;
    const alvo = ` ${pedido} `;
    const contem = todasAsOpcoes().filter((c) => ` ${chaveDeNome(c.opcao.menuProduct?.name)} `.includes(alvo));
    const nomesQueContem = new Set(contem.map((c) => chaveDeNome(c.opcao.menuProduct?.name)));
    if (nomesQueContem.size === 1) return contem[0];

    const palavras = pedido.split(" ").filter(Boolean);
    if (palavras.length === 0) return null;
    const porNome = new Map<string, { c: Achado; tamanho: number }>();
    for (const c of todasAsOpcoes()) {
      const nome = chaveDeNome(c.opcao.menuProduct?.name);
      const daOpcao = nome.split(" ").filter(Boolean);
      if (!palavras.every((p) => daOpcao.includes(p))) continue;
      if (!porNome.has(nome)) porNome.set(nome, { c, tamanho: daOpcao.length });
    }
    if (porNome.size === 0) return null;
    const menor = Math.min(...[...porNome.values()].map((v) => v.tamanho));
    const curtas = [...porNome.values()].filter((v) => v.tamanho === menor);
    return curtas.length === 1 ? curtas[0].c : null;
  };

  for (const bruta of brutas) {
    const texto = String((bruta && typeof bruta === "object" ? (bruta as any).name ?? (bruta as any).nome : bruta) ?? "").trim();
    // O nome INTEIRO primeiro: um cadastro com "Pizza 2x1" tem de casar antes
    // de o "2x" ser lido como quantidade.
    let achado = texto ? procurar(chaveDeNome(texto)) : null;
    let quantidade = 1;
    if (achado) {
      const daChave = Number((bruta as any)?.quantity ?? (bruta as any)?.qtd ?? (bruta as any)?.quantidade);
      quantidade = Number.isFinite(daChave) && daChave >= 1 ? Math.min(Math.floor(daChave), MAXIMO_POR_OPCAO) : 1;
    } else {
      const lido = quantidadeENome(bruta);
      if (!lido) continue;
      achado = procurar(chaveDeNome(lido.nome));
      quantidade = lido.quantidade;
      if (!achado) { naoCasadas.push(texto || lido.nome); continue; }
    }

    // O nome gravado é o DO CADASTRO, não o que a IA escreveu: é por ele que a
    // comanda e o relatório agrupam ("bacon" e "Bacon" seriam dois adicionais).
    const nome = String(achado.opcao.menuProduct?.name || texto);
    selecoes[achado.grupo.id] = selecoes[achado.grupo.id] || {};
    // Opção repetida é quantidade: ["Bacon", "Bacon"] = 2x Bacon, cobrado duas vezes.
    selecoes[achado.grupo.id][nome] = (selecoes[achado.grupo.id][nome] || 0) + quantidade;
    somaDasOpcoes += (Number(achado.opcao.additionalPrice) || 0) * quantidade;
    casadas.push({ nome, quantidade });
  }

  // O que o cliente pediu e o cadastro não tem NÃO some: vai para a observação
  // do item, para a loja ler e conferir — sem ser cobrado, porque não há preço
  // de onde tirar.
  const obsDoCliente = [item?.notes, item?.observation, item?.obs]
    .find((t) => typeof t === "string" && t.trim().length > 0) as string | undefined;
  const partes: string[] = [];
  if (obsDoCliente) partes.push(obsDoCliente.trim().replace(/\s+/g, " "));
  if (naoCasadas.length > 0) partes.push(`pediu: ${naoCasadas.join(", ")} (conferir — não está no cadastro)`);
  const notes = partes.length > 0 ? partes.join(" · ").slice(0, LIMITE_DA_OBSERVACAO) : null;

  // Escolhas repetidas aparecem uma vez com a quantidade: "Bacon x2".
  const contagem = new Map<string, number>();
  for (const c of casadas) contagem.set(c.nome, (contagem.get(c.nome) || 0) + c.quantidade);
  const resumo = [...contagem.entries()].map(([n, q]) => (q > 1 ? `${n} x${q}` : n));

  // Pergunta obrigatória que ficou curta POR CAUSA de algo que não casou. A
  // que o modelo nem preencheu (`options: []`) não entra: aí vale o piso de
  // sempre, que é o Nugget de base R$ 0,00 (01/08/2026).
  let grupoIncompleto: string | null = null;
  if (naoCasadas.length > 0) {
    for (const grupo of produto.comboGroups || []) {
      if (!grupo) continue;
      const exigidas = grupo.minQty != null ? Number(grupo.minQty) || 0 : Number(grupo.maxQty) || 0;
      if (exigidas < 1) continue;
      const escolhidas = Object.values(selecoes[grupo.id] || {}).reduce((s, q) => s + q, 0);
      if (escolhidas < exigidas) { grupoIncompleto = String(grupo.title || "").trim() || "opção obrigatória"; break; }
    }
  }

  return {
    comboSelections: Object.keys(selecoes).length > 0 ? selecoes : null,
    somaDasOpcoes: Math.round(somaDasOpcoes * 100) / 100,
    naoCasadas,
    grupoIncompleto,
    productName: resumo.length > 0 ? `${produto.name} (${resumo.join(", ")})` : produto.name,
    notes,
  };
}

/**
 * A observação do PEDIDO e o troco, vindos da tag.
 *
 * `changeFor` é a NOTA que o cliente vai entregar ("troco para 50"), a mesma
 * convenção de `CustomerOrder.changeAmount` no resto do sistema — não o troco.
 * Só vale para pagamento em dinheiro e quando é maior que o total; senão é
 * ruído do modelo e gravar geraria um "leve R$ -12,00 de troco" no app do
 * motoboy.
 */
export function trocoEObservacaoDoPedido(e: {
  changeFor?: unknown;
  observation?: unknown;
  paymentMethod?: unknown;
  total: number;
}): { changeAmount: number | null; observacao: string | null } {
  const bruto = typeof e.changeFor === "string" ? e.changeFor.replace(/[^\d.,]/g, "").replace(",", ".") : e.changeFor;
  const valor = Number(bruto);
  const ehDinheiro = /dinheiro|esp[eé]cie|cash/i.test(String(e.paymentMethod || ""));
  const changeAmount =
    ehDinheiro && Number.isFinite(valor) && valor > Number(e.total || 0) && valor <= 10000
      ? Math.round(valor * 100) / 100
      : null;
  const texto = typeof e.observation === "string" ? e.observation.trim().replace(/\s+/g, " ") : "";
  return { changeAmount, observacao: texto ? texto.slice(0, 300) : null };
}
