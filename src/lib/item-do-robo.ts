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

  /** Procura a opção no cadastro do produto; null quando não existe. */
  const procurar = (chave: string) => {
    for (const grupo of produto.comboGroups || []) {
      if (!grupo) continue;
      const opcao = (grupo.items || []).find((gi) => gi && chaveDeNome(gi.menuProduct?.name) === chave);
      if (opcao) return { grupo, opcao };
    }
    return null;
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

  return {
    comboSelections: Object.keys(selecoes).length > 0 ? selecoes : null,
    somaDasOpcoes: Math.round(somaDasOpcoes * 100) / 100,
    naoCasadas,
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
