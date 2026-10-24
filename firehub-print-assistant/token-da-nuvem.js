/**
 * Token da loja na fila da nuvem (1.2.46+).
 *
 * A fila (GET /api/store/print-queue e POST /ack) escolhia a loja só pelo
 * franchiseeId, que é público (está no HTML do cardápio). A tela de
 * Impressoras do painel passou a mandar, no POST /config, um token da loja
 * assinado pelo servidor (`<franchiseeId>.<assinatura>`, src/lib/token-do-assistente.ts
 * do site), e o Assistente o devolve no cabeçalho `x-firehub-assistente` em
 * toda chamada à fila.
 *
 * Nada aqui pode parar a impressão:
 *   - token só vale para o franchiseeId que ele carrega; trocou a loja sem
 *     token novo, o antigo é jogado fora e a fila segue sem token (como a 1.2.45);
 *   - na contingência a fila é o FireHub do computador (outra chave): lá o
 *     token não vai;
 *   - o servidor recusou o token (403 com a marca abaixo)? Para de mandar até
 *     o próximo /config e segue sem, como o Assistente antigo.
 *   - o token nunca sai do Assistente: /status e /config devolvem só `temToken`
 *     (configParaMostrar, em server.js).
 */

const CABECALHO = "x-firehub-assistente";
const MARCA_DA_RECUSA = "token-do-assistente-recusado";
const FORMATO = /^[A-Za-z0-9_-]{1,64}\.[a-f0-9]{32}$/;

/** O token carrega esta loja? */
function tokenDaLoja(token, franchiseeId) {
  return typeof token === "string" && FORMATO.test(token) && !!franchiseeId && token.startsWith(String(franchiseeId) + ".");
}

/**
 * Aplica o que veio no POST /config. `config` já tem o franchiseeId novo.
 * Devolve o token a guardar (ou undefined para apagar).
 */
function tokenDepoisDoConfig(tokenAntigo, tokenRecebido, franchiseeId) {
  const recebido = typeof tokenRecebido === "string" ? tokenRecebido.trim() : "";
  if (recebido && tokenDaLoja(recebido, franchiseeId)) return recebido;
  // Não veio (ou veio estranho): fica o antigo SE ainda for desta loja.
  return tokenDaLoja(tokenAntigo, franchiseeId) ? tokenAntigo : undefined;
}

/** Cabeçalhos da chamada à fila: o token só vai para a nuvem e só se for da loja. */
function cabecalhosDaFila(config, { naContingencia, recusado } = {}) {
  if (naContingencia || recusado) return {};
  const c = config || {};
  return tokenDaLoja(c.token, c.franchiseeId) ? { [CABECALHO]: c.token } : {};
}

/** A resposta é a recusa do token pelo servidor (não um 403 qualquer do caminho)? */
async function ehRecusaDoToken(res) {
  if (!res || res.status !== 403) return false;
  try {
    const corpo = await res.clone().json();
    return !!corpo && corpo.motivo === MARCA_DA_RECUSA;
  } catch {
    return false;
  }
}

module.exports = { CABECALHO, MARCA_DA_RECUSA, tokenDaLoja, tokenDepoisDoConfig, cabecalhosDaFila, ehRecusaDoToken };
