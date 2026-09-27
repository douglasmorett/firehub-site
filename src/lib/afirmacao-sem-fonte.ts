/**
 * O robô afirmou um serviço da loja que não está escrito em lugar nenhum?
 *
 * R&D Pizzaria, 27/09/2026: o robô disse ao cliente que a loja tinha RODÍZIO.
 * Não tem — a palavra não aparece no cardápio, nos dados da loja nem nas
 * instruções que o lojista escreveu. O prompt proíbe inventar produto, preço,
 * combo e cupom, mas não dizia nada de MODALIDADE e SERVIÇO: rodízio, buffet,
 * reserva de mesa, estacionamento, música ao vivo, espaço kids. Pizzaria "com
 * loja física" puxa rodízio no modelo, e ele completa.
 *
 * A regra no prompt diz para não afirmar o que não está escrito — mas regra de
 * prompt o modelo às vezes pula. Esta é a rede: termo de serviço na resposta
 * que não existe na FONTE (os dados da loja, não as regras do prompt, que citam
 * esses termos como exemplo) faz a resposta virar "não tenho essa informação,
 * vou chamar alguém" com o atendente chamado de verdade.
 *
 * Loja SÓ DELIVERY pode negar: sem salão não há rodízio, mesa nem
 * estacionamento, e "não, somos só delivery" é verdade deduzida dos dados.
 */

type Termo = { nome: string; padrao: RegExp };

/** Serviços e modalidades que o cliente pergunta e o modelo tende a afirmar. */
export const SERVICOS_QUE_SO_A_LOJA_SABE: Termo[] = [
  { nome: "rodízio", padrao: /\brodizios?\b/ },
  { nome: "buffet", padrao: /\bbuff?ets?\b|\bbufes?\b/ },
  { nome: "self-service", padrao: /\bself[\s-]?service\b|\bpor quilo\b/ },
  { nome: "à la carte", padrao: /\ba la carte\b/ },
  { nome: "reserva", padrao: /\breserv(a|as|ar|amos|e)\b/ },
  { nome: "estacionamento", padrao: /\bestacionamentos?\b|\bmanobristas?\b/ },
  { nome: "música ao vivo", padrao: /\bmusica ao vivo\b|\bshow ao vivo\b|\bbanda ao vivo\b/ },
  { nome: "espaço kids", padrao: /\bespaco kids\b|\bbrinquedoteca\b|\bplayground\b|\bparquinho\b|\bespaco infantil\b/ },
  { nome: "happy hour", padrao: /\bhappy hour\b/ },
  { nome: "open bar", padrao: /\bopen (bar|food)\b/ },
  { nome: "wi-fi", padrao: /\bwi-?fi\b/ },
  { nome: "pet friendly", padrao: /\bpet[\s-]?friendly\b/ },
];

const normalizar = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const NEGACAO = /\bn[aã]o\b|\bnenhum|\bsem\b/;

/**
 * Os serviços que a resposta cita e a fonte não tem. Vazio = tudo certo.
 *
 * `fonte` são os DADOS: nome e endereço da loja, cardápio, instruções do
 * lojista. `soDelivery` libera a negação ("não temos rodízio, somos só
 * delivery"), que nesse caso é fato.
 */
export function servicosSemFonte(resposta: string, fonte: string, opcoes: { soDelivery?: boolean } = {}): string[] {
  const r = normalizar(resposta);
  const f = normalizar(fonte);
  const citados = SERVICOS_QUE_SO_A_LOJA_SABE.filter((t) => t.padrao.test(r) && !t.padrao.test(f));
  if (citados.length === 0) return [];
  if (opcoes.soDelivery && NEGACAO.test(r)) return [];
  return citados.map((t) => t.nome);
}

/** O que o robô diz no lugar — e o atendente é chamado junto. */
export const RESPOSTA_QUANDO_NAO_SABE = "Essa informação eu não tenho aqui, vou chamar alguém da equipe pra te confirmar! 😊";
