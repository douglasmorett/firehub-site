/**
 * src/lib/acrescimo-do-pedido.ts — o cliente que já tem pedido na loja e pede
 * para acrescentar algo pelo WhatsApp.
 *
 * ── O que acontecia (05/10/2026) ────────────────────────────────────────────
 *
 * O robô só enxergava o pedido do cliente por 20 minutos e só deixava alterar o
 * que a loja ainda não tinha aceitado. Depois disso, "me manda mais uma coca"
 * virava um PEDIDO NOVO: outra comanda, outra taxa de entrega, outro motoboy —
 * e a loja só descobria quando os dois saíam.
 *
 * ── A regra do dono ─────────────────────────────────────────────────────────
 *
 *   - O robô sabe que existe pedido deste número hoje e PERGUNTA: "você já tem
 *     o pedido nº X com a gente, quer acrescentar nele?".
 *   - Na cozinha (aceito, em preparo ou pronto): o acréscimo não entra sozinho.
 *     A loja recebe um pop-up "Pedido nº X — cliente pede para acrescentar...
 *     Aceita ou recusa?", e a resposta (com o texto da loja, na recusa) vai ao
 *     cliente pelo WhatsApp.
 *   - Já saiu para entrega: não dá para acrescentar. O robô avisa que seria um
 *     pedido novo, com nova taxa de entrega, e só segue se o cliente topar.
 *
 * Arquivo puro (o banco mora em lib/acrescimo-no-banco.ts): tem teste que o
 * carrega sozinho (scripts/teste-acrescimo-do-pedido.ts).
 */

export type SituacaoDoPedido = "NAO_ACEITO" | "NA_COZINHA" | "SAIU" | "ENCERRADO";

const NA_COZINHA = new Set(["ACEITO", "CONFIRMADO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO"]);
const SAIU = new Set(["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA", "DESPACHADO"]);

/** Em que pé está o pedido, para o que dá para fazer com um acréscimo. */
export function situacaoDoPedido(status: unknown): SituacaoDoPedido {
  const s = String(status || "").toUpperCase().trim();
  if (s === "NOVO") return "NAO_ACEITO";
  if (NA_COZINHA.has(s)) return "NA_COZINHA";
  if (SAIU.has(s)) return "SAIU";
  return "ENCERRADO";
}

/** Rótulo do status para o cliente ler. */
export function statusParaOCliente(status: unknown): string {
  const s = String(status || "").toUpperCase().trim();
  if (s === "PRONTO") return "pronto, esperando para sair";
  if (s === "PREPARANDO" || s === "EM_PREPARO" || s === "EM_ANDAMENTO") return "em preparo na cozinha";
  if (s === "ACEITO" || s === "CONFIRMADO") return "aceito e indo para a cozinha";
  if (s === "NOVO") return "esperando a loja aceitar";
  if (SAIU.has(s)) return "já saiu para entrega";
  return "em andamento";
}

const reais = (n: number) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

export type ItemDoAcrescimo = {
  menuProductId?: string | null;
  productName: string;
  quantity: number;
  /** Preço UNITÁRIO, já com as escolhas (a mesma régua do pedido do robô). */
  price: number;
  notes?: string | null;
  comboSelections?: Record<string, Record<string, number>> | null;
};

/** "2x Coca 2L, 1x Batata (Cheddar)" — para o pop-up e as mensagens. */
export function itensEmTexto(itens: ItemDoAcrescimo[]): string {
  return itens
    .map((i) => {
      const escolhas = escolhasEmLinha(i.comboSelections);
      return `${Math.max(1, Number(i.quantity) || 1)}x ${i.productName}${escolhas ? ` (${escolhas})` : ""}`;
    })
    .join(", ");
}

function escolhasEmLinha(sel: unknown): string {
  if (!sel || typeof sel !== "object") return "";
  const partes: string[] = [];
  for (const grupo of Object.values(sel as Record<string, unknown>)) {
    if (!grupo || typeof grupo !== "object") continue;
    for (const [nome, qtd] of Object.entries(grupo as Record<string, unknown>)) {
      const q = Number(qtd) || 0;
      if (q > 0) partes.push(q > 1 ? `${nome} x${q}` : nome);
    }
  }
  return partes.join(", ");
}

export function valorDosItens(itens: ItemDoAcrescimo[]): number {
  return Math.round(itens.reduce((t, i) => t + (Number(i.price) || 0) * Math.max(1, Number(i.quantity) || 1), 0) * 100) / 100;
}

export type PedidoAtivo = {
  numero: string | number | null;
  status: string;
  /** Minutos desde que o pedido entrou. */
  minutos: number;
  itens: string;
  total: number;
  entrega: boolean;
  /** A taxa de entrega deste pedido — a referência do "vai cobrar entrega de novo". */
  taxaDeEntrega: number;
  /** Já há um acréscimo esperando a resposta da loja. */
  acrescimoPendente?: string | null;
  /**
   * O pedido foi achado pelo NOME, com o telefone um dígito diferente do
   * WhatsApp (lib/pedido-do-cliente.ts) — quase sempre número digitado errado
   * no site. O robô confirma com o cliente antes de tratar o pedido como dele.
   */
  outroTelefone?: { nome: string; telefone: string } | null;
};

/**
 * O bloco do prompt para o pedido de HOJE deste cliente que já passou da fase
 * em que o robô altera sozinho (lib/rascunho-do-robo.ts cuida do pedido ainda
 * não aceito, nos primeiros 20 minutos).
 */
export function pedidoAtivoParaOPrompt(p: PedidoAtivo): string {
  const situacao = situacaoDoPedido(p.status);
  if (situacao === "ENCERRADO") return "";
  const n = p.numero ?? "—";
  const numeroNaTag = typeof p.numero === "number" ? String(p.numero) : JSON.stringify(String(n));
  const cabecalho =
    `📦 ESTE CLIENTE JÁ TEM UM PEDIDO HOJE: nº ${n}, feito há ${p.minutos} min, ${statusParaOCliente(p.status)}.\n` +
    `Itens: ${p.itens}. Total: ${reais(p.total)}.` +
    (p.outroTelefone
      ? `
Este pedido está no nome de "${p.outroTelefone.nome}" com o telefone ${p.outroTelefone.telefone}, um dígito diferente deste WhatsApp ` +
        `(o número foi digitado errado no pedido). Na primeira resposta sobre ele, confirme: "É o pedido nº ${n}, no nome de ${p.outroTelefone.nome}?". ` +
        `Se o cliente disser que não é dele, ignore este pedido e atenda normalmente.`
      : "");

  if (situacao === "SAIU") {
    return (
      `${cabecalho}\n` +
      `→ O pedido JÁ SAIU PARA ENTREGA: não dá mais para acrescentar nada nele.\n` +
      `→ Se o cliente pedir para acrescentar ou quiser mais alguma coisa, responda antes de anotar qualquer item: ` +
      `"Seu pedido nº ${n} já saiu para entrega 🛵. Para incluir mais itens, a gente precisa fazer um pedido novo, ` +
      `e a entrega é cobrada de novo${p.entrega && p.taxaDeEntrega > 0 ? ` (a taxa foi ${reais(p.taxaDeEntrega)} no seu pedido)` : ""}. Tudo bem pra você?"\n` +
      `→ Só depois que ele concordar, monte o pedido novo normalmente (tag normal, sem "acrescentarAoPedido"). ` +
      `Se ele não quiser, tudo bem: não insista.`
    );
  }

  if (p.acrescimoPendente) {
    return (
      `${cabecalho}\n` +
      `→ Já existe um pedido de acréscimo esperando a resposta da loja: ${p.acrescimoPendente}. ` +
      `Se o cliente perguntar, diga que a cozinha ainda vai responder e que você avisa por aqui. ` +
      `NÃO emita outra tag para o mesmo acréscimo.`
    );
  }

  return (
    `${cabecalho}\n` +
    `→ Se o cliente pedir QUALQUER item agora, antes de montar pedido novo pergunte: ` +
    `"Você já tem o pedido nº ${n} com a gente (${statusParaOCliente(p.status)}). Quer acrescentar nesse pedido?"\n` +
    `→ Se ele quiser ACRESCENTAR: confirme os itens novos e o valor deles (sem taxa de entrega nova), e só depois que ele confirmar emita ` +
    `[[PEDIDO_IA: {"acrescentarAoPedido": ${numeroNaTag}, "items": [SÓ os itens NOVOS, no formato de sempre], "finalized": true}]]. ` +
    `Diga que vai pedir à cozinha para incluir e que avisa assim que a loja responder. NÃO diga que já foi incluído: quem decide é a loja.\n` +
    `→ Se ele quiser um pedido SEPARADO, monte normalmente (tag normal, sem "acrescentarAoPedido").\n` +
    `→ Tirar, trocar item ou cancelar este pedido não é com você: escreva [[CHAMAR_ATENDENTE]].\n` +
    `→ NUNCA emita a tag com os itens que já estão no pedido: a cozinha prepararia tudo de novo.`
  );
}

/** O que o robô responde logo depois de registrar o acréscimo. */
export function mensagemDoAcrescimoEnviado(numero: string | number | null, itens: ItemDoAcrescimo[]): string {
  return (
    `Pronto! Pedi para a cozinha incluir no seu pedido nº ${numero ?? "—"}: ${itensEmTexto(itens)} (+${reais(valorDosItens(itens))}). ` +
    `Assim que a loja responder, eu te aviso por aqui 😊`
  );
}

/** A resposta da loja, que vai ao cliente pelo WhatsApp. */
export function mensagemDaResposta(opcoes: {
  aceito: boolean;
  numero: string | number | null;
  itens: ItemDoAcrescimo[];
  novoTotal?: number | null;
  textoDaLoja?: string | null;
}): string {
  const n = opcoes.numero ?? "—";
  if (opcoes.aceito) {
    return (
      `✅ Boa notícia! A loja incluiu no seu pedido nº ${n}: ${itensEmTexto(opcoes.itens)}.` +
      (opcoes.novoTotal != null ? `\n\n*Novo total: ${reais(opcoes.novoTotal)}*` : "") +
      (opcoes.textoDaLoja ? `\n\n${opcoes.textoDaLoja}` : "")
    );
  }
  const motivo = String(opcoes.textoDaLoja || "").trim();
  return (
    `😕 A loja não conseguiu incluir ${itensEmTexto(opcoes.itens)} no seu pedido nº ${n}.` +
    (motivo ? `\n\n${motivo}` : "") +
    `\n\nSe quiser, posso fazer um pedido separado para você.`
  );
}
