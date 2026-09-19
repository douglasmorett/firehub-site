/**
 * A MEMÓRIA do pedido que o robô está montando — e o que fazer com a tag
 * [[PEDIDO_IA]] quando já existe um pedido deste cliente no banco.
 *
 * ── Dois defeitos, a mesma raiz ─────────────────────────────────────────────
 *
 * 1) AMNÉSIA. O rascunho (status CRIANDO_IA) era gravado a cada mensagem e
 *    NUNCA voltava ao prompt: a consulta de pedidos recentes o excluía de
 *    propósito. A única memória do pedido era o histórico da conversa, que mora
 *    em RAM (15 mensagens, 30 min) e morre a cada deploy. Depois de um deploy o
 *    cliente dizia "e uma coca", o modelo emitia a tag só com a coca — e como a
 *    tag SUBSTITUI o rascunho inteiro, os dois x-tudo evaporavam.
 *
 * 2) PEDIDO ENVIADO REBAIXADO A RASCUNHO. Para não duplicar pedido quando o
 *    modelo reemite a tag final, o sync aceitava como "rascunho existente"
 *    qualquer pedido NOVO do mesmo telefone criado nos últimos 20 minutos — de
 *    QUALQUER origem. Uma tag não-final nessa janela regravava o pedido com
 *    status CRIANDO_IA: o pedido que a cozinha já tinha imprimido saía do
 *    painel e era CANCELADO pela faxina de rascunhos 20 minutos depois. Valia
 *    até para pedido feito pelo SITE por alguém que depois mandou mensagem.
 *
 * ── A regra agora ───────────────────────────────────────────────────────────
 *
 * - Rascunho (CRIANDO_IA) é do robô: reescreve à vontade.
 * - Pedido ENVIADO (NOVO, do robô, ainda não aceito, dentro da janela) só é
 *   tocado por tag FINAL, e só quando é alteração daquele pedido: o modelo disse
 *   (`alteraPedido`) ou a lista nova contém tudo o que a antiga tinha. NUNCA é
 *   rebaixado a rascunho.
 * - Na dúvida, pedido SEPARADO. Dois pedidos no painel a loja vê e resolve;
 *   pedido reescrito em silêncio ninguém vê.
 * - Tag final IDÊNTICA ao pedido enviado (o modelo repetiu a tag no "obrigado")
 *   não regrava nem reimprime.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-rascunho-do-robo.mjs).
 */

export const JANELA_DO_PEDIDO_ENVIADO_MS = 20 * 60 * 1000;

export type ItemNoBanco = {
  menuProductId?: string | null;
  productName?: string | null;
  quantity?: number | null;
  price?: number | null;
  notes?: string | null;
  comboSelections?: unknown;
  menuProduct?: { name?: string | null } | null;
};

export type PedidoCandidato = {
  id: string;
  status: string;
  source?: string | null;
  createdAt: Date | string | number;
  dailyOrderNumber?: number | string | null;
  customerAddress?: string | null;
  paymentMethod?: string | null;
  deliveryType?: string | null;
  deliveryFee?: number | null;
  totalAmount?: number | null;
  changeAmount?: number | null;
  notes?: string | null;
  items?: ItemNoBanco[] | null;
};

/** O item que o sync vai gravar — mesmo formato de `orderItemsData` em chatbot-ai.ts. */
export type ItemNovo = {
  menuProductId?: string | null;
  productName?: string | null;
  quantity?: number | null;
  notes?: string | null;
  comboSelections?: unknown;
};

export type DestinoDaTag =
  | { acao: "criar"; motivo: string }
  | {
      acao: "reescrever";
      pedido: PedidoCandidato;
      motivo: string;
      /** Rascunho aberto em paralelo que ficou órfão: o sync descarta. */
      descartarRascunhoId?: string;
    }
  /** Pedido já enviado + tag ainda não confirmada: o banco fica como está. */
  | { acao: "nao_mexer"; pedido: PedidoCandidato; motivo: string }
  /** A tag final repete um pedido que já está na loja: nada a gravar, nada a imprimir. */
  | { acao: "identico"; pedido: PedidoCandidato; motivo: string };

const chave = (texto: unknown): string =>
  String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const quando = (d: Date | string | number): number => {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** JSON estável (chaves ordenadas) para comparar `comboSelections`. */
const estavel = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(estavel).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + estavel(o[k])).join(",") + "}";
};

const produtoDoItem = (i: ItemNoBanco | ItemNovo): string =>
  i.menuProductId ? `id:${i.menuProductId}` : `nome:${chave((i as ItemNoBanco).menuProduct?.name || i.productName)}`;

/** produto → quantidade total (o mesmo produto pode vir em duas linhas). */
const quantidades = (itens: Array<ItemNoBanco | ItemNovo>): Map<string, number> => {
  const m = new Map<string, number>();
  for (const i of itens) {
    const q = Math.max(0, Math.round(Number(i.quantity) || 0));
    if (q === 0) continue;
    const k = produtoDoItem(i);
    m.set(k, (m.get(k) || 0) + q);
  }
  return m;
};

/** A lista nova contém TUDO o que a antiga tinha (em quantidade igual ou maior)? */
export function contemTudo(antigos: ItemNoBanco[], novos: ItemNovo[]): boolean {
  const a = quantidades(antigos);
  const n = quantidades(novos);
  if (a.size === 0) return false;
  for (const [k, q] of a) if ((n.get(k) || 0) < q) return false;
  return true;
}

const assinaturaDosItens = (itens: Array<ItemNoBanco | ItemNovo>): string =>
  itens
    .filter((i) => (Number(i.quantity) || 0) > 0)
    .map((i) => `${produtoDoItem(i)}|${Math.round(Number(i.quantity) || 0)}|${chave(i.notes)}|${estavel(i.comboSelections)}`)
    .sort()
    .join("\n");

/** Mesmos produtos, quantidades, escolhas e observações? */
export function mesmosItens(antigos: ItemNoBanco[], novos: ItemNovo[]): boolean {
  const a = assinaturaDosItens(antigos);
  return a !== "" && a === assinaturaDosItens(novos);
}

/**
 * Pedidos deste cliente que a tag PODE tocar: rascunho do robô, ou pedido NOVO
 * do robô ainda dentro da janela. Pedido de outra origem (site, iFood, PDV) e
 * pedido que a loja já aceitou nunca entram.
 */
export function candidatosValidos(candidatos: PedidoCandidato[], agora: number): PedidoCandidato[] {
  return (Array.isArray(candidatos) ? candidatos : [])
    .filter((p) => {
      const status = String(p?.status || "").toUpperCase();
      if (status === "CRIANDO_IA") return true;
      if (status !== "NOVO") return false;
      if (String(p.source || "").toUpperCase() !== "WHATSAPP_IA") return false;
      const idade = agora - quando(p.createdAt);
      return idade >= 0 && idade <= JANELA_DO_PEDIDO_ENVIADO_MS;
    })
    .sort((x, y) => quando(y.createdAt) - quando(x.createdAt));
}

/**
 * Pedidos do robô que a tag NÃO pode reescrever, mas com os quais ela precisa
 * ser COMPARADA: os que a loja já aceitou (ou pôs em preparo) há pouco.
 *
 * Sem isto, a loja com aceite automático ganhava um pedido duplicado a cada
 * "obrigado!": o modelo reemite a tag final, o pedido já saiu de NOVO, ninguém
 * mais o reconhece e nasce outro igual — impresso, cobrado e entregue.
 */
export function candidatosSoDeComparacao(candidatos: PedidoCandidato[], agora: number): PedidoCandidato[] {
  const INTOCAVEIS = ["ACEITO", "PREPARANDO", "PRONTO"];
  return (Array.isArray(candidatos) ? candidatos : [])
    .filter((p) => {
      if (String(p.source || "").toUpperCase() !== "WHATSAPP_IA") return false;
      if (!INTOCAVEIS.includes(String(p?.status || "").toUpperCase())) return false;
      const idade = agora - quando(p.createdAt);
      return idade >= 0 && idade <= JANELA_DO_PEDIDO_ENVIADO_MS;
    })
    .sort((x, y) => quando(y.createdAt) - quando(x.createdAt));
}

/** ENTREGA/DELIVERY é a mesma coisa; RETIRADA/PICKUP/TAKEOUT/BALCAO também. */
function tipoCanonico(v: unknown): string {
  const t = chave(v);
  if (!t) return "";
  if (/retirada|pickup|takeout|balcao|take away/.test(t)) return "RETIRADA";
  if (/entrega|delivery/.test(t)) return "ENTREGA";
  if (/mesa|table|salao/.test(t)) return "MESA";
  return t.toUpperCase();
}

const dinheiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

export function destinoDaTag(o: {
  /** Pedidos DESTE telefone, já filtrados por `mesmoTelefone`. */
  candidatos: PedidoCandidato[];
  isFinal: boolean;
  itensNovos: ItemNovo[];
  /** Campo `alteraPedido` da tag: o número do pedido que o cliente quer alterar. */
  alteraPedido?: unknown;
  /** Endereço / pagamento / tipo da tag, para saber se a reemissão mudou algo. */
  endereco?: string | null;
  pagamento?: string | null;
  tipo?: string | null;
  /** Troco e observação DO PEDIDO já normalizados (lib/item-do-robo.ts). */
  troco?: number | null;
  observacao?: string | null;
  agora: number;
}): DestinoDaTag {
  const validos = candidatosValidos(o.candidatos, o.agora);

  /** A tag aponta este pedido em `alteraPedido`? */
  const apontado = (p: PedidoCandidato): boolean => {
    const n = p.dailyOrderNumber;
    if (n === undefined || n === null) return false;
    const pedido = String(o.alteraPedido ?? "").replace(/\D/g, "");
    return pedido !== "" && pedido === String(n).replace(/\D/g, "");
  };

  /** O que a tag traz é igual ao que está gravado neste pedido? */
  const igualA = (p: PedidoCandidato): boolean => {
    if (!mesmosItens(Array.isArray(p.items) ? p.items : [], o.itensNovos)) return false;
    // Endereço, pagamento, tipo, troco e observação: qualquer um diferente e a
    // tag NÃO é uma reemissão — é alteração, e tem de ser gravada. Sem o troco
    // aqui, "esqueci, preciso de troco pra 100" era engolido em silêncio e o
    // cliente lia "registrado na cozinha" com o motoboy saindo sem troco.
    if (o.endereco && chave(o.endereco) !== chave(p.customerAddress)) return false;
    if (o.pagamento && chave(o.pagamento) !== chave(p.paymentMethod)) return false;
    if (o.tipo && tipoCanonico(o.tipo) !== tipoCanonico(p.deliveryType)) return false;
    if (o.troco !== undefined && o.troco !== null && dinheiro(o.troco) !== dinheiro(p.changeAmount)) return false;
    if (o.observacao && !chave(p.notes).includes(chave(o.observacao))) return false;
    return true;
  };

  // O pedido que a loja JÁ ACEITOU não pode ser reescrito nem duplicado: se a
  // tag final o repete (o "obrigado!" depois do aceite automático), não há o
  // que fazer.
  if (o.isFinal) {
    const jaNaLoja = candidatosSoDeComparacao(o.candidatos, o.agora).find(igualA);
    if (jaNaLoja) {
      return {
        acao: "identico",
        pedido: jaNaLoja,
        motivo: `pedido nº ${jaNaLoja.dailyOrderNumber ?? "—"} já foi aceito pela loja e a tag o repete — nada a gravar`,
      };
    }
  }

  // O cliente DISSE qual pedido quer alterar: é ele, mesmo que exista um
  // rascunho mais novo aberto em paralelo. Sem isto, a alteração confirmada era
  // gravada no rascunho e virava um SEGUNDO pedido na cozinha.
  const apontadoPelaTag = validos.find((p) => String(p.status).toUpperCase() === "NOVO" && apontado(p));
  const alvo = apontadoPelaTag || validos[0];
  if (!alvo) return { acao: "criar", motivo: "nenhum rascunho nem pedido recente do robô para este telefone" };

  if (String(alvo.status).toUpperCase() === "CRIANDO_IA") {
    return { acao: "reescrever", pedido: alvo, motivo: "rascunho em andamento" };
  }

  // Daqui para baixo `alvo` é um pedido JÁ ENVIADO à loja (NOVO).
  const antigos = Array.isArray(alvo.items) ? alvo.items : [];
  const numero = alvo.dailyOrderNumber;
  const pediuParaAlterar = o.alteraPedido === true || apontado(alvo);
  // Endereço ou tipo diferentes, sem o cliente dizer que é alteração, é OUTRO
  // pedido — "manda outro igual pra minha mãe na Rua B". Reescrever faria o
  // primeiro sumir do painel e a entrega da Rua A deixar de existir.
  const mudouParaOndeVai =
    (!!o.endereco && chave(o.endereco) !== chave(alvo.customerAddress)) ||
    (!!o.tipo && tipoCanonico(o.tipo) !== tipoCanonico(alvo.deliveryType));
  const ehAlteracao = pediuParaAlterar || (contemTudo(antigos, o.itensNovos) && !mudouParaOndeVai);
  const rotulo = `pedido nº ${numero ?? "—"} já enviado à loja`;

  if (!o.isFinal) {
    return ehAlteracao
      ? { acao: "nao_mexer", pedido: alvo, motivo: `${rotulo}: a alteração só é gravada quando o cliente confirmar (pedido enviado não vira rascunho)` }
      : { acao: "criar", motivo: `${rotulo} fica como está; a tag é de outro pedido` };
  }

  if (igualA(alvo)) {
    return { acao: "identico", pedido: alvo, motivo: `${rotulo}: a tag repete o mesmo pedido — nada a regravar nem reimprimir` };
  }

  if (!ehAlteracao) {
    return { acao: "criar", motivo: `${rotulo} fica como está; a tag final é de um pedido separado` };
  }

  // Rascunho aberto em paralelo enquanto a alteração era combinada: ele não
  // vira pedido nenhum. Sem descartá-lo, a faxina de rascunhos o cancelaria e o
  // robô avisaria o cliente de que "parou" um pedido que está indo para ele.
  const orfao = validos.find((p) => String(p.status).toUpperCase() === "CRIANDO_IA" && p.id !== alvo.id);
  return {
    acao: "reescrever",
    pedido: alvo,
    motivo: `${rotulo}: alteração confirmada pelo cliente`,
    ...(orfao ? { descartarRascunhoId: orfao.id } : {}),
  };
}

/**
 * O cliente desistiu: o que a tag de cancelamento pode cancelar?
 *
 * Rascunho, sempre — ninguém preparou nada ainda. Pedido JÁ ENVIADO à loja, só
 * quando o cliente aponta o número dele: no meio de uma alteração o modelo
 * emite "cancelado" para desfazer o RASCUNHO, e sem essa trava esse "deixa pra
 * lá" derrubava o pedido que já estava na cozinha.
 */
export function cancelamentoDaTag(o: { candidatos: PedidoCandidato[]; alteraPedido?: unknown; agora: number }):
  | { acao: "cancelar"; pedido: PedidoCandidato }
  | { acao: "nada"; pedido?: PedidoCandidato; motivo: string } {
  const validos = candidatosValidos(o.candidatos, o.agora);
  const rascunho = validos.find((p) => String(p.status).toUpperCase() === "CRIANDO_IA");
  if (rascunho) return { acao: "cancelar", pedido: rascunho };

  const enviado = validos[0];
  if (!enviado) return { acao: "nada", motivo: "não havia pedido nem rascunho para cancelar" };

  const pedido = String(o.alteraPedido ?? "").replace(/\D/g, "");
  const numero = enviado.dailyOrderNumber;
  const apontou = pedido !== "" && numero !== undefined && numero !== null && pedido === String(numero).replace(/\D/g, "");
  return apontou
    ? { acao: "cancelar", pedido: enviado }
    : { acao: "nada", pedido: enviado, motivo: `o pedido nº ${numero ?? "—"} já foi enviado à loja e o cliente não disse que quer cancelá-lo` };
}

// ── O RASCUNHO DE VOLTA AO PROMPT ────────────────────────────────────────────

const brl = (n: unknown): string => (Number(n) || 0).toFixed(2).replace(".", ",");

/** "Calabresa, 2x Borda recheada" a partir de `{ grupoId: { nome: qtd } }`. */
export function escolhasEmTexto(comboSelections: unknown): string {
  if (!comboSelections || typeof comboSelections !== "object") return "";
  const partes: string[] = [];
  for (const grupo of Object.values(comboSelections as Record<string, unknown>)) {
    if (!grupo || typeof grupo !== "object") continue;
    for (const [nome, qtd] of Object.entries(grupo as Record<string, unknown>)) {
      const q = Math.round(Number(qtd) || 0);
      if (q <= 0 || !String(nome).trim()) continue;
      partes.push(q > 1 ? `${q}x ${nome}` : String(nome));
    }
  }
  return partes.join(", ");
}

const linhaDoItem = (i: ItemNoBanco): string => {
  const nome = String(i.menuProduct?.name || i.productName || "item").trim();
  const escolhas = escolhasEmTexto(i.comboSelections);
  const obs = String(i.notes || "").trim();
  return `- ${Math.round(Number(i.quantity) || 0)}x ${nome}` +
    (escolhas ? ` [opções: ${escolhas}]` : "") +
    (obs ? ` (obs: ${obs})` : "") +
    ` — R$ ${brl(i.price)} cada`;
};

const dadosDoPedido = (p: PedidoCandidato): string => {
  const partes: string[] = [];
  if (p.deliveryType) partes.push(`Tipo: ${p.deliveryType}`);
  if (p.customerAddress) partes.push(`Endereço: ${p.customerAddress}`);
  if (p.paymentMethod) partes.push(`Pagamento: ${p.paymentMethod}`);
  if (Number(p.changeAmount) > 0) partes.push(`Troco para: R$ ${brl(p.changeAmount)}`);
  if (Number(p.deliveryFee) > 0) partes.push(`Taxa de entrega: R$ ${brl(p.deliveryFee)}`);
  if (Number(p.totalAmount) > 0) partes.push(`Total: R$ ${brl(p.totalAmount)}`);
  return partes.join(" · ");
};

/**
 * A seção do prompt com o que já está no banco para este cliente. "" quando não
 * há nada — o prompt não ganha seção vazia.
 */
export function memoriaDoPedidoParaOPrompt(candidatos: PedidoCandidato[], agora: number): string {
  const validos = candidatosValidos(candidatos, agora).filter((p) => (p.items || []).length > 0);
  const enviado = validos.find((p) => String(p.status).toUpperCase() === "NOVO");
  // Rascunho MAIS VELHO que o pedido enviado é resto de conversa anterior (a
  // faxina ainda não passou): mostrá-lo como "em andamento" confundiria o modelo.
  const rascunho = validos.find(
    (p) => String(p.status).toUpperCase() === "CRIANDO_IA" && (!enviado || quando(p.createdAt) > quando(enviado.createdAt)),
  );
  const blocos: string[] = [];

  if (rascunho) {
    const dados = dadosDoPedido(rascunho);
    blocos.push(
      `📝 RASCUNHO EM ANDAMENTO DESTE CLIENTE — é a MEMÓRIA do pedido que você está montando com ele.\n` +
      `Já está anotado no sistema e ainda NÃO foi para a cozinha:\n` +
      (rascunho.items || []).map(linhaDoItem).join("\n") +
      (dados ? `\n${dados}` : "") +
      `\n→ A tag [[PEDIDO_IA]] SUBSTITUI este rascunho inteiro. Ao emiti-la, repita TODOS os itens acima (com as mesmas opções e observações) junto com o que o cliente pedir agora. Só deixe um item de fora se o cliente pediu para tirar.` +
      `\n→ Não pergunte de novo o que já está aqui (endereço, pagamento). Se o cliente mudou de assunto, não insista no pedido.`,
    );
  }

  if (enviado) {
    const minutos = Math.max(0, Math.round((agora - quando(enviado.createdAt)) / 60000));
    const n = enviado.dailyOrderNumber ?? "—";
    const dados = dadosDoPedido(enviado);
    blocos.push(
      `📦 PEDIDO Nº ${n} ENVIADO À LOJA HÁ ${minutos} MIN — a loja ainda não aceitou, então ainda dá para alterar:\n` +
      (enviado.items || []).map(linhaDoItem).join("\n") +
      (dados ? `\n${dados}` : "") +
      `\n→ Se o cliente quiser ACRESCENTAR, TIRAR ou TROCAR algo NESTE pedido: monte a lista COMPLETA (o que fica + o que muda), diga o novo total e, só depois que ele confirmar, emita a tag com "finalized": true e "alteraPedido": ${typeof n === "number" ? n : JSON.stringify(String(n))}. O sistema ATUALIZA o pedido nº ${n} — não cria outro.` +
      `\n→ Enquanto estiver combinando essa alteração, TODA tag que você emitir leva "alteraPedido": ${typeof n === "number" ? n : JSON.stringify(String(n))}, inclusive as de "finalized": false. Sem esse campo o sistema entende que é um pedido diferente e a cozinha recebe DOIS.` +
      `\n→ Se ele quiser um pedido NOVO, separado deste: tag normal, SEM "alteraPedido".` +
      `\n→ Se ele só agradeceu ou perguntou outra coisa: NÃO emita a tag de novo. O pedido já está na loja.`,
    );
  }

  const aceito = candidatosSoDeComparacao(candidatos, agora).filter((p) => (p.items || []).length > 0)[0];
  if (aceito && !enviado) {
    const n = aceito.dailyOrderNumber ?? "—";
    blocos.push(
      `👨‍🍳 PEDIDO Nº ${n} JÁ ACEITO PELA LOJA e em preparo:\n` +
      (aceito.items || []).map(linhaDoItem).join("\n") +
      `\n→ NÃO emita a tag deste pedido de novo, em hipótese nenhuma: sairia um pedido gêmeo na cozinha.` +
      `\n→ Alteração ou cancelamento deste pedido não é com você: escreva [[CHAMAR_ATENDENTE]] para uma pessoa da loja resolver.` +
      `\n→ Se o cliente quiser um pedido NOVO, aí sim monte do zero, normalmente.`,
    );
  }

  return blocos.join("\n\n");
}
