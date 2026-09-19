/**
 * O cliente está pedindo para falar com uma PESSOA?
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * O detector antigo era uma regex de uma linha dentro do webhook:
 * `atendente|humano|falar com pessoa|falar com gente|suporte`. "Quero falar com
 * alguém", "me chama o responsável" e "não quero falar com robô" passavam direto
 * para a IA — que respondia o status do pedido em vez de chamar gente. Em
 * 18/09/2026, na Hakim, uma cliente de RETIRADA pediu uma pessoa e leu sete
 * vezes que o pedido "já tinha saído para entrega".
 *
 * Pedido de pessoa não é dúvida: o robô diz uma frase honesta, avisa a loja e
 * sai da conversa. Quem decide é esta função — e só ela, para o webhook, o
 * simulador e os testes nunca divergirem.
 *
 * ── O erro caro é o FALSO POSITIVO ──────────────────────────────────────────
 *
 * Casar aqui cala o robô por 12 horas e manda alerta ao dono. A primeira versão
 * deste arquivo tratava "motoboy", "entregador", "gente" e "dono" como alvos de
 * qualquer verbo, e uma revisão com 180 frases reais mostrou o estrago: "fala
 * com o entregador pra tocar o interfone", "passa pro motoboy que é casa 2",
 * "coloca pra gente 2 cocas" ("a gente" = nós), "não quero a máquina" (de
 * cartão), "avenida Direitos Humanos", "veio sem o suporte dos copos" — tudo
 * mensagem de PEDIDO, tudo calaria o robô no meio da venda.
 *
 * Daí a regra de duas classes:
 *   - gente DA LOJA (atendente, gerente, responsável): o imperativo basta —
 *     "chama o gerente" só pode ser pedido de pessoa;
 *   - gente QUALQUER (pessoa, alguém, dono, motoboy, entregador, moça): só vale
 *     com o CLIENTE como sujeito — "QUERO falar com alguém". "Fala com o
 *     motoboy que…" é instrução de entrega.
 *
 * "Tem alguém aí?" é saudação; "alguém pode me ajudar?" é pedido de atendimento,
 * que o robô faz; "quero falar com vocês" fica de fora de propósito — para o
 * cliente, "vocês" é a loja, e o robô é a voz dela.
 *
 * Arquivo puro, sem imports: tem teste que o carrega sozinho
 * (scripts/teste-pedido-de-atendente.mjs). Frase nova que errar entra LÁ antes
 * de entrar aqui.
 */

export type PedidoDeAtendente = {
  pediu: boolean;
  /** O trecho que disparou, para o log e para a fila da loja. */
  gatilho?: string;
};

/** minúsculas, sem acento, espaços colapsados. A pontuação FICA: "brincadeira" depende dela. */
function normalizar(texto: string): string {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ART = "(?:um |uma |o |a |os |as |algum |alguma )?";
/** Gente DA LOJA: o imperativo basta ("chama o gerente"). */
const EQUIPE =
  ART + "(?:atendentes?|humano|humana|ser humano|responsavel|gerente|proprietario|proprietaria|supervisor|supervisora)";
/** Gente qualquer — também é o porteiro, a dona Maria, o motoboy, "a gente" (= nós). Só vale com o CLIENTE como sujeito. */
const GENERICO =
  ART +
  "(?:pessoa|pessoas|alguem|algm|gente|dono|dona|chefe|funcionario|funcionaria|motoboy|entregador|moto boy|moca|moco|rapaz|menina|menino)";
const QUER =
  "(?:quero|queria|qro|kero|preciso|posso|prefiro|gostaria de|tem como|da pra|da para|consigo|como faco pra|como faco para)(?: eu)?(?: e| era)?";
const VERBO_FALAR = "(?:falar|fala|falo|conversar|conversa|tratar|resolver|reclamar) (?:isso |direto |diretamente )?(?:com|c/|cm|c)";
/** Depois do alvo: lugar ("na portaria", "do bloco B"), "a mais", oração ("que vai pagar") — aí não é pedido de pessoa. */
const NAO_E_LUGAR =
  "(?! (?:n[oa]s?|a mais|que|quando|d[oa]s?(?! loja| equipe| pizzaria| lanchonete| hamburgueria| restaurante| estabelecimento))\\b)";

const REGRAS: { nome: string; re: RegExp }[] = [
  // Palavras que sozinhas já dizem tudo, com os erros que o celular produz (o
  // relato que originou este arquivo dizia "falar com humado"). "atende" e
  // "atendem" ficam de fora de propósito: "vocês atendem até que horas?".
  {
    nome: "atendente",
    re: /\b(?:atendentes?|atendenti|atendete|atendnte|antendente|atendende|atendent|atendemte|atemdente)\b/,
  },
  // Sem plural: ninguém pede "humanos", e "Avenida Direitos Humanos" é endereço.
  { nome: "humano", re: /\b(?:ser )?h?uma[nmd][oa]\b/ },
  { nome: "atendimento humano", re: /\batendimento (?:humano|pessoal|com (?:uma )?pessoa)\b/ },
  // "suporte" seco pede gente; "suporte dos copos", "suporte de celular" é objeto.
  { nome: "suporte", re: /\bsuporte\b(?! (?:de|d[oa]s?|pra|para|pr[oa]s?) )/ },
  { nome: "falar com equipe", re: new RegExp("\\b" + VERBO_FALAR + " " + EQUIPE + "\\b") },
  { nome: "falar com pessoa", re: new RegExp("\\b" + QUER + " " + VERBO_FALAR + " " + GENERICO + "\\b") },
  // Mensagem que É só isso: "falar com alguém".
  { nome: "falar com pessoa (seco)", re: new RegExp("^(?:falar|conversar) (?:com|c/|cm|c) " + GENERICO + "\\b" + NAO_E_LUGAR) },
  { nome: "quero equipe", re: /\b(?:quero|queria|cade|kd) (?:o |a |um |uma )?(?:gerente|responsavel|supervisor|supervisora)\b/ },
  {
    nome: "chamar equipe",
    re: new RegExp(
      "\\b(?:chama|chamar|chame|chamem|passa|passar|passe|transfere|transferir|transfira|coloca|colocar|bota|botar)(?: ai)? " +
        "(?:pra mim |para mim |me )?(?:pra |para |pro |pra a |para o |para a |com )?" + EQUIPE + "\\b",
    ),
  },
  {
    // Sem coloca/bota e sem "gente": "coloca pra gente 2 cocas" é pedido.
    nome: "chamar pessoa",
    re: new RegExp(
      "\\b(?:chama|chamar|chame|chamem|passa|passar|passe|transfere|transferir|transfira)(?: ai)? " +
        "(?:pra mim |para mim |me )?(?:pra |para |pro |para o |para a )?" +
        "(?:um |uma |o |algum |alguma )?(?:pessoa|alguem|algm|dono|chefe)\\b" + NAO_E_LUGAR,
    ),
  },
  { nome: "me transfere", re: /\bme transfer[ei]\b(?! o | a | pra conta| para conta| o valor| um pix)/ },
  {
    nome: "quero pessoa",
    re: /\b(?:quero|queria|preciso de|prefiro|gostaria de) (?:falar com )?(?:um |uma )?(?:pessoa|gente|alguem|algm)(?: de verdade| real)?\b(?! para| pra| que | boa| aqui)/,
  },
  { nome: "pessoa me atender", re: /\b(?:uma pessoa|alguem de verdade|gente de verdade) (?:pra |para |pode |possa )?me (?:atender|ajudar)\b/ },
  { nome: "atendido por pessoa", re: /\batendid[oa] por (?:um |uma )?(?:pessoa|gente|alguem|humano|humana)\b/ },
  { nome: "pessoa de verdade", re: /\b(?:pessoa|gente|alguem) (?:de verdade|real|de carne e osso)\b/ },
  {
    // "maquina" e "ia" só com o verbo: "não quero a máquina" é a de cartão, e "ia" é verbo.
    nome: "nao quero robo",
    re: /\bnao quero (?:(?:falar|conversar) com|ser atendid[oa] por) (?:um |uma |o |a )?(?:robo|bot|maquina|ia|inteligencia artificial|automatico|resposta automatica)\b|\bnao quero (?:um |o )?(?:robo|bot|resposta automatica)\b/,
  },
  {
    nome: "chega de robo",
    re: /\b(?:(?:chega|para|cansei) de|odeio) (?:(?:falar|conversar) com (?:robo|bot|maquina)|robo|bot)\b/,
  },
];

/** Anulam SÓ a palavra solta "atendente": elogio, relato e emprego não são pedido. */
const ATENDENTE_SEM_PEDIDO: RegExp[] = [
  /\b(?:o|a) atendente (?:foi|era|e|estava) (?:muito |super )?(?:otim|bom|boa|excelente|educad|simpatic|atencios|maravilhos|top|nota)/,
  /\b(?:o|a) atendente (?:disse|falou|confirmou|informou|avisou|me |ja )/,
  /\bfalei com (?:o|a|um|uma) atendente\b/,
  /\b(?:sou|trabalho (?:de|como)|vaga (?:de|pra|para)|contrata\w*|precisa(?:m|ndo)? de) (?:um |uma )?atendente\b/,
];

/** Brincadeira DECLARADA ("…? brincadeira, quero uma coca") — nunca a bronca ("que brincadeira é essa"). */
const E_BRINCADEIRA = /(?:^|[?!.,;] ?)brincadeira\b(?! e essa| comigo)/;

export function detectarPedidoDeAtendente(texto: string): PedidoDeAtendente {
  const t = normalizar(texto);
  if (!t) return { pediu: false };
  if (E_BRINCADEIRA.test(t)) return { pediu: false };
  for (const regra of REGRAS) {
    if (regra.nome === "atendente" && ATENDENTE_SEM_PEDIDO.some((re) => re.test(t))) continue;
    const m = t.match(regra.re);
    if (m) return { pediu: true, gatilho: `${regra.nome}: "${m[0]}"` };
  }
  return { pediu: false };
}

/** O que o cliente lê quando o robô sai da conversa a pedido dele. */
export const FRASE_DE_CHAMAR_ATENDENTE =
  "Claro! Já avisei nossa equipe e uma pessoa vai te responder por aqui. Só um instante, por favor! 😊";
