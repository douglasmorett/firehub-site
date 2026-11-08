/**
 * A resposta do robô das lojas passa por aqui antes de sair: o que o prompt
 * pede e o Haiku nem sempre cumpre vira regra no código.
 *
 * Auditoria de 06/11/2026 (766 conversas do dia, Douglas: "a gente está
 * recebendo muita reclamação do robô"):
 * - 126 conversas com 2+ perguntas na mesma mensagem ("Vai com cebola? Quer
 *   X.NEZE e sachê? E é no mesmo endereço? Pix, cartão ou dinheiro?"). O
 *   cliente responde uma, o robô pergunta tudo de novo.
 * - Pergunta já respondida: Lapastine (Felipe, pedido nº 14) ouviu "Pix ou
 *   dinheiro?" e "pra quanto o troco?" quatro vezes depois de dizer "dinheiro"
 *   e "troco pra 100" — "Já falei mil vezes que é dinheiro".
 * - "Quer acrescentar ou é um pedido separado?" sem o cliente ter pedido item
 *   nenhum (Lapastine 2x, Construção do Lanche 2x depois de "Ok" e "Qual
 *   valor?", Map Grill 3x, Ragnar 3x, Deeds 3x).
 * - Puxar venda: "Bora pedir uma pizza hoje? 🍕", "Bora fechar esse pedido
 *   hoje?", "Quer algo pra acompanhar?".
 *
 * O que faz, nesta ordem, só com frases que são PERGUNTA (terminam em "?"):
 * 1. tira a que puxa venda ("bora pedir/fechar", "pra acompanhar");
 * 2. tira a pergunta de pagamento quando o cliente já disse como paga (vale a
 *    última coisa que ele disse), e a de troco quando ele já falou do troco —
 *    se a frase pedia mais coisa ("me passa a rua e a forma de pagamento?"),
 *    só o pedaço do pagamento sai;
 * 3. tira "é outro pedido? / quer acrescentar?" quando o robô já perguntou
 *    isso na conversa ou quando o cliente não pediu item nenhum agora;
 * 4. tira o "Confirma?" do MESMO resumo (mesmo total) que o robô já mostrou
 *    numa das duas últimas mensagens, quando o cliente falou depois sem
 *    perguntar nada. Charlie Brown 08/11 18:12: "Confirma pra mim?" três vezes
 *    em 18 s. O "Confirma?" fica quando o total mudou (o cliente mexeu no
 *    pedido) e quando o cliente disse "sim": aí o modelo não fechou o pedido,
 *    e calar deixaria o pedido parado sem ninguém saber.
 *    Pergunta qualquer repetida ("Qual sabor?", "Qual o bairro?") NÃO entra:
 *    nas 707 respostas de 08/11 metade das repetições era o cliente que não
 *    tinha respondido ("Perto do Mercadinho do Maia" → "Qual é o bairro?"), e
 *    cortar ali trava o pedido. A repetição de verdade vinha do histórico
 *    velho de cada processo, corrigido no webhook;
 * 5. deixa só a PRIMEIRA pergunta que sobrou.
 * Frase que não é pergunta não é tocada (resumo, preço, link).
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-resposta-enxuta.mjs).
 */

export type MensagemDaConversaCurta = { sender: string; text: string; timestamp?: number };

export type RespostaEnxuta = {
  texto: string;
  /** O que saiu, para o log: "puxar venda", "pagamento já dito"... */
  cortes: string[];
};

const L = "\\p{L}";
const palavra = (alternativas: string) => new RegExp(`(?<!${L})(?:${alternativas})(?!${L})`, "iu");

/** "Bora pedir uma pizza hoje?", "Quer algo pra acompanhar?", "já tem um pedido em mente?" */
const PUXA_VENDA =
  /(?<!\p{L})(bora|vamos)\s+(pedir|fechar|escolher|garantir|aproveitar)|(algo|alguma coisa|mais algo|mais alguma coisa)\s+(pra|para)\s+acompanhar|pedido em mente|j[aá] sabe o que vai (pedir|querer)|quer (aproveitar|experimentar)/iu;

/** A forma de pagamento dita pelo cliente (não a pergunta "aceita cartão?"). */
const FORMA_DE_PAGAMENTO = palavra("pix|dinheiro|esp[eé]cie|cart[aã]o|cr[eé]dito|d[eé]bito|maquininha|vale[- ]refei[cç][aã]o|vr|ticket|alelo|sodexo");
const PERGUNTA_DO_CLIENTE = /\?|^\s*(aceita|aceitam|voc[eê]s aceitam|pode|posso|tem|d[aá] pra|da pra)(?!\p{L})/iu;

/** A pergunta do robô sobre como o cliente vai pagar. */
const PERGUNTA_DE_PAGAMENTO =
  /forma de pagamento|como vai pagar|vai pagar como|vai ser no pix|como (prefere|quer) pagar|pix,?\s*cart[aã]o ou dinheiro|(dinheiro|pix|cart[aã]o) ou (pix|dinheiro|cart[aã]o)|ou (no |em |n[oa] )?(pix|dinheiro|cart[aã]o)\s*\?|e o pagamento/iu;

/** "Tudo bem?" de cumprimento não é a pergunta da mensagem: não ocupa o lugar dela. */
const CUMPRIMENTO = /^[^?]{0,40}(tudo bem|tudo certo|tudo bom|tudo tranquilo|beleza|como vai)\s*\?[^\p{L}\p{N}]*$/iu;
const PEDACOS_DE_PAGAMENTO = [
  /,?\s*(e\s+)?(tamb[eé]m\s+)?(me\s+(passa|diz|fala|manda)\s+)?(tamb[eé]m\s+)?(d?[ao]\s+|sua\s+)?forma de pagamento(\s*:\s*pix,?\s*cart[aã]o\s+ou\s+dinheiro)?/giu,
  /,?\s*(e\s+)?(tamb[eé]m\s+)?(como\s+vai\s+pagar|vai\s+pagar\s+como)(\s*:\s*pix,?\s*cart[aã]o\s+ou\s+dinheiro)?/giu,
  /,?\s*(e\s+)?pix,?\s*cart[aã]o\s+ou\s+dinheiro/giu,
];

/** O cliente já falou do troco: "troco pra 100", "sem troco", "não preciso de troco". */
const TROCO_DITO =
  /troco\s*(pra|para|de|p\/)?\s*(r\$\s*)?\d+|\d+\s*(reais\s+)?de\s+troco|sem\s+troco|n[aã]o\s+(preciso|precisa|vou\s+precisar)\s+de\s+troco|troco\s+n[aã]o|(dinheiro|valor)\s+(certo|trocado)|tenho\s+trocado/iu;
const PERGUNTA_DE_TROCO = /troco/iu;
const PEDACOS_DE_TROCO = [
  /,?\s*(e\s+)?(vai\s+)?precisa(r)?\s+de\s+troco(,?\s*(se\s+sim,?\s*)?(pra|para)\s+quanto)?/giu,
  /,?\s*(e\s+)?troco\s+(pra|para)\s+quanto/giu,
];

/** "É outro pedido?", "Quer acrescentar nele ou fazer um separado?" */
const PERGUNTA_DE_OUTRO_PEDIDO =
  /segundo pedido|pedido separado|outro pedido|um separado|fazer um novo|pedido novo|[ée] o mesmo pedido|acrescentar (algo|alguma coisa|mais algo|mais alguma coisa|nele|nesse|neste|no pedido|no seu pedido|no n)/iu;

/**
 * Pergunta que pede para o cliente confirmar o PEDIDO (o resumo): "Confirma
 * pra mim?", "Posso confirmar e mandar pra cozinha?", "Está certo?". Não pega
 * "Confirma o endereço?" nem "Qual o bairro pra eu confirmar a entrega?".
 */
const PERGUNTA_DE_CONFIRMAR =
  /(?<!\p{L})(me\s+)?confirma(\s+(pra|para)\s+mim)?(\s+(pra|para)\s+eu\s+[^?]*)?\s*\?|confirma\s+(o|seu)\s+pedido|posso\s+(confirmar|mandar|enviar|fechar|lan[cç]ar)|(est[aá]|t[aá]|ficou)\s+(tudo\s+)?cert[oi]|(mandar|enviar)\s+(pra|para)\s+(a\s+)?cozinha/iu;
/** "sim", "pode", "isso", "confirmo": o cliente confirmou. */
const CLIENTE_CONFIRMOU = /^\s*(sim|s|ss|isso|isso mesmo|pode|pode sim|pode mandar|pode fechar|confirmo|confirmado|confirma|certo|ok|okay|blz|beleza|t[aá] certo|est[aá] certo|correto|perfeito|fechado|manda|bora)(?!\p{L})/iu;

/** O total que o resumo diz ("Total: 58 reais", "Valor Total a pagar: R$ 58,00") — o último, não o "Subtotal". */
function totalDoResumo(texto: string): string | null {
  const todos = [...texto.matchAll(/(?<!sub)total[^0-9\n]{0,25}(\d+(?:[.,]\d{1,2})?)/giu)];
  const m = todos[todos.length - 1];
  return m ? m[1].replace(",", ".").replace(/\.0+$/, "") : null;
}

/** O cliente está pedindo item agora? ("e uma coca", "quero mais 2", "manda também...") */
const PEDE_ITEM = palavra(
  "quero|queria|quer|manda|mande|mais|outr[oa]s?|tamb[eé]m|tb|acrescenta|acrescentar|adiciona|adicionar|coloca|colocar|bota|inclui|incluir|me v[eê]|faltou|esqueci|um|uma|dois|duas|tr[eê]s|\\d+",
);
/** Número que é troco, endereço ou dinheiro não é quantidade de item. */
const NUMEROS_QUE_NAO_SAO_ITEM =
  /troco\s*(pra|para|de|p\/)?\s*(r\$\s*)?\d+|(r\$\s*)?\d+[.,]?\d*\s*(reais|conto)|n[uú]mero\s*\d+|n[ºo°]\.?\s*\d+|(lote|quadra|casa|apto|apartamento|bloco|km)\s*\w+|\d{5}-?\d{3}|(rua|travessa|avenida|av\.?|estrada|alameda)\s+[^,.]*/giu;

export function clientePedeItem(texto: string): boolean {
  return PEDE_ITEM.test(String(texto || "").replace(NUMEROS_QUE_NAO_SAO_ITEM, " "));
}

/**
 * Frases de uma linha, sem quebrar link: corta em ". ", "! ", "? " e no emoji
 * que fecha frase sem pontuação ("fica 14 reais 😊 Maionese a gente não tem").
 */
function frases(linha: string): string[] {
  const partes = linha
    .split(/(?<=[.!?…])\s+|(?<=\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]?)\s+(?=\p{Lu})/u)
    .filter((p) => p.length > 0);
  // Emoji solto depois da frase ("Qual você prefere? 😊") fica com ela.
  const juntas: string[] = [];
  for (const p of partes) {
    const m = /^([^\p{L}\p{N}]+?)\s+(?=[\p{L}\p{N}])([\s\S]*)$/u.exec(p);
    if (juntas.length > 0 && !/[\p{L}\p{N}]/u.test(p)) juntas[juntas.length - 1] += ` ${p}`;
    else if (juntas.length > 0 && m) {
      juntas[juntas.length - 1] += ` ${m[1]}`;
      juntas.push(m[2]);
    } else juntas.push(p);
  }
  return juntas;
}

/** É pergunta? O "?" de dentro de um link não conta. */
function ehPergunta(frase: string): boolean {
  return /\?/.test(frase.replace(/https?:\/\/\S+/giu, ""));
}

/** Tira os pedaços e devolve a pergunta que sobrou, ou "" se não sobrou pergunta de verdade. */
function semPedacos(frase: string, pedacos: RegExp[], assunto: RegExp): string {
  let f = frase;
  for (const p of pedacos) f = f.replace(p, "");
  f = f
    .replace(/\s+([?,.!])/gu, "$1")
    .replace(/,\s*\?/gu, "?")
    .replace(/(^|\s)(e|E)\s*\?/gu, "?")
    .replace(/\s{2,}/gu, " ")
    .trim();
  if (assunto.test(f)) return "";
  const letras = (f.match(/\p{L}+/gu) || []).length;
  return letras >= 3 && ehPergunta(f) ? f : "";
}

export function enxugarResposta(
  resposta: string,
  o: { historico: MensagemDaConversaCurta[]; mensagemDoCliente: string },
): RespostaEnxuta {
  const cortes: string[] = [];
  const doCliente = [
    ...(o.historico || []).filter((m) => m && m.sender === "user").map((m) => String(m.text || "")),
    String(o.mensagemDoCliente || ""),
  ];
  // Pagamento dito: em qualquer linha da mensagem atual ou do histórico que
  // não seja pergunta dele ("aceita cartão?").
  const linhasDoCliente = doCliente.flatMap((t) => t.split(/\n+/u));
  const pagamentoDito = linhasDoCliente.some((t) => FORMA_DE_PAGAMENTO.test(t) && !PERGUNTA_DO_CLIENTE.test(t));
  const trocoDito = linhasDoCliente.some((t) => TROCO_DITO.test(t));
  const roboJaPerguntouOutroPedido = (o.historico || []).some(
    (m) => m && m.sender === "bot" && PERGUNTA_DE_OUTRO_PEDIDO.test(String(m.text || "")) && /\?/.test(String(m.text || "")),
  );
  const pedeItem = clientePedeItem(o.mensagemDoCliente);

  // Os totais dos resumos com "Confirma?" das duas últimas mensagens do robô
  // a que o cliente já respondeu: depois delas ele falou, e nada do que
  // falou era pergunta.
  const historico = o.historico || [];
  const resumosJaConfirmaveis: string[] = [];
  let falasDepois = [String(o.mensagemDoCliente || "")];
  let mensagensDoRobo = 0;
  for (let i = historico.length - 1; i >= 0 && mensagensDoRobo < 2; i--) {
    const m = historico[i];
    if (!m) continue;
    if (m.sender === "user") {
      falasDepois.push(String(m.text || ""));
      continue;
    }
    mensagensDoRobo++;
    const texto = String(m.text || "");
    if (!falasDepois.some((t) => t.trim()) || falasDepois.some((t) => ehPergunta(t))) break;
    const total = totalDoResumo(texto);
    const pediuConfirmacao = texto.split("\n").some((linha) => frases(linha).some((f) => ehPergunta(f) && PERGUNTA_DE_CONFIRMAR.test(f)));
    if (total !== null && pediuConfirmacao) resumosJaConfirmaveis.push(total);
    falasDepois = [];
  }
  const totalDaResposta = totalDoResumo(String(resposta || ""));
  const clienteConfirmou = CLIENTE_CONFIRMOU.test(String(o.mensagemDoCliente || ""));
  const confirmacaoJaPedida = (f: string): boolean =>
    PERGUNTA_DE_CONFIRMAR.test(f) && !clienteConfirmou &&
    resumosJaConfirmaveis.some((total) => totalDaResposta === null || totalDaResposta === total);

  let jaTemPergunta = false;
  const linhas = String(resposta || "").split("\n").map((linha) => {
    if (!linha.trim()) return linha;
    const ficam: string[] = [];
    let cortouAnterior = false;
    const cortar = (motivo: string) => {
      cortes.push(motivo);
      cortouAnterior = true;
    };
    const manter = (f: string) => {
      // "Vai precisar de troco? E confirma o X.NEZE?" sem a primeira: sai o "E".
      const solta = cortouAnterior && ficam.length > 0 ? f.replace(/^(e|E)\s+(\p{L})/u, (_m, _e, l: string) => l.toUpperCase()) : f;
      ficam.push(solta);
      cortouAnterior = false;
    };
    for (const original of frases(linha)) {
      let f = original;
      if (!ehPergunta(f)) {
        manter(f);
        continue;
      }
      // "Se sim, pra quanto?" depois de "Vai precisar de troco?" cortada.
      if (cortouAnterior && /^(se sim|se for|se precisar|ou\s)/iu.test(f)) {
        cortar("continuação da pergunta cortada");
        continue;
      }
      if (PUXA_VENDA.test(f)) {
        cortar("puxar venda");
        continue;
      }
      if (PERGUNTA_DE_OUTRO_PEDIDO.test(f) && (roboJaPerguntouOutroPedido || !pedeItem)) {
        cortar(roboJaPerguntouOutroPedido ? "outro pedido? de novo" : "outro pedido? sem item");
        continue;
      }
      if (pagamentoDito && PERGUNTA_DE_PAGAMENTO.test(f)) {
        f = semPedacos(f, PEDACOS_DE_PAGAMENTO, /pagamento|pagar|pix|dinheiro|cart[aã]o/iu);
        if (!f) {
          cortar("pagamento já dito");
          continue;
        }
        cortes.push("pagamento já dito");
      }
      if (trocoDito && PERGUNTA_DE_TROCO.test(f)) {
        f = semPedacos(f, PEDACOS_DE_TROCO, PERGUNTA_DE_TROCO);
        if (!f) {
          cortar("troco já dito");
          continue;
        }
        cortes.push("troco já dito");
      }
      if (CUMPRIMENTO.test(f)) {
        manter(f);
        continue;
      }
      // O mesmo resumo já pediu "Confirma?". O "sim" do cliente com o modelo
      // pedindo de novo NÃO entra (`clienteConfirmou`): a pergunta repetida é
      // ruim, mas o pedido parado sem ninguém saber é pior.
      if (confirmacaoJaPedida(f)) {
        cortar("confirmação: já dito");
        continue;
      }
      if (jaTemPergunta) {
        cortar("segunda pergunta");
        continue;
      }
      jaTemPergunta = true;
      manter(f);
    }
    return ficam.join(" ").trim();
  });

  const texto = linhas
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { texto: cortes.length ? texto : String(resposta || ""), cortes };
}
