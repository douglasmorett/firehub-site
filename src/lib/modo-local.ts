/**
 * MODO CONTINGÊNCIA — o FireHub rodando no computador da loja
 * (Obsidian: Projetos/FireHub - Modo Contingência.md).
 *
 * Quando a internet da loja ou o nosso servidor cai, o Assistente sobe ESTE
 * mesmo código no computador do caixa, apontando para a cópia local dos dados
 * da loja. `FIREHUB_LOCAL=1` só existe lá: na nuvem a variável nunca é
 * definida, e tudo o que olha para ela fica como sempre foi.
 *
 * O que muda no computador da loja:
 *   - os cookies não usam `__Secure-`/`secure`: a TV e o celular do garçom
 *     chegam por http://<ip-do-computador>, e o navegador recusa cookie seguro
 *     em http fora de localhost;
 *   - nenhuma chamada sai para fora (iFood, WhatsApp, Asaas, SEFAZ…): a cópia
 *     não tem as chaves, e o que sair sem elas só atrasaria a tela até o
 *     timeout — `instalarBloqueioDeSaida` falha na hora;
 *   - o poll de pedidos não consulta parceiros: um computador com internet
 *     consumiria eventos do iFood que a nuvem nunca veria.
 */
export const MODO_LOCAL = process.env.FIREHUB_LOCAL === "1";

/** Cookie `__Secure-` e `secure` só na nuvem (https); no computador da loja é http. */
export const COOKIE_SEGURO = process.env.NODE_ENV === "production" && !MODO_LOCAL;

/** Destinos que o FireHub local pode chamar: ele mesmo e a rede da loja. */
function destinoLocal(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export class SaidaBloqueadaNoModoLocal extends Error {
  constructor(public destino: string) {
    super(`Sem conexão: no modo contingência o FireHub não chama ${destino}.`);
    this.name = "SaidaBloqueadaNoModoLocal";
  }
}

/**
 * Embrulha o `fetch` global do servidor: no modo local, qualquer chamada para
 * fora da loja falha NA HORA. Não existe um ponto único de envio no código —
 * muitas rotas chamam o iFood direto —, então o `fetch` é a única porta que
 * pega todas. Ficam de fora o SDK do Mercado Pago (node-fetch), o nodemailer e
 * a SEFAZ (`node:https`); sem as chaves, eles não têm o que mandar.
 */
export function instalarBloqueioDeSaida(): void {
  if (!MODO_LOCAL) return;
  const g = globalThis as typeof globalThis & { __fetchDaLojaInstalado?: boolean };
  if (g.__fetchDaLojaInstalado) return;
  g.__fetchDaLojaInstalado = true;
  const original = globalThis.fetch.bind(globalThis);
  const avisados = new Set<string>();
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    let host = "";
    try {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      host = new URL(url, "http://127.0.0.1").hostname;
    } catch {
      return original(entrada as any, init);
    }
    if (destinoLocal(host)) return original(entrada as any, init);
    if (!avisados.has(host)) {
      avisados.add(host);
      console.warn(`[Modo local] Chamada para ${host} bloqueada (contingência, sem saída para fora).`);
    }
    throw new SaidaBloqueadaNoModoLocal(host);
  }) as typeof fetch;
}
