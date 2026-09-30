/**
 * /src/lib/nfce/link-do-danfe.ts
 *
 * O LINK PÚBLICO do DANFE: o endereço que a tela e o WhatsApp mandam ao
 * cliente para ele abrir o cupom fiscal sem login (rota src/app/nfce/[token]).
 *
 * ── Por que pode ──────────────────────────────────────────────────────────────
 * "Se o adquirente concordar, o DANFE-NFC-e poderá ter sua impressão
 * substituída pelo envio em formato eletrônico ou pelo envio da chave de
 * acesso" (Ajuste SINIEF 19/16, cl. 10ª, §3º, I, "a" — redação do Ajuste
 * SINIEF 20/23; no PA, IN SEFA 11/2014, art. 7º, I). O link é esse envio
 * eletrônico. A concordância do cliente é de quem manda o link (a tela, o
 * robô): este arquivo só garante que o link não abre nada além DAQUELE DANFE.
 *
 * ── O token ─────────────────────────────────────────────────────────────────
 *   <id do pedido>-<selo>
 *   selo = HMAC-SHA256(chave do link, "danfe-nfce:<id do pedido>:<chave de acesso>"),
 *          32 dígitos hexadecimais (128 bits)
 *
 *  - O id do pedido vai no token para a rota achar o pedido sem varrer o JSON
 *    do fiscalInfo. Ele não é segredo (a página de acompanhamento do pedido já
 *    usa o id na URL); o que ninguém forja é o selo.
 *  - A chave de acesso entra no selo e NÃO no token: ela sai impressa no cupom
 *    e na consulta da SEFAZ, e não pode bastar para abrir o DANFE (que traz CPF
 *    e endereço do cliente da entrega). Quem tem só a chave, consulta na SEFAZ.
 *  - Nota cancelada e reemitida tem chave nova: o link antigo para de valer
 *    sozinho, sem lista de links revogados.
 *  - A chave do HMAC é a subchave "selo-do-link" da FISCAL_CHAVE (HKDF, em
 *    lib/fiscal-credenciais.ts): a chave que cifra os arquivos do cofre nunca é
 *    usada para assinar link, e em produção não há reserva no NEXTAUTH_SECRET.
 *    Trocar a FISCAL_CHAVE invalida os links já enviados — a não ser que a
 *    velha fique em FISCAL_CHAVES_ANTIGAS: o selo antigo continua conferindo
 *    (`tokenConfere` tenta a atual e as antigas), e o link novo sai com a nova.
 *  - Hexadecimal e hífen: o token não tem ponto (a rota não parece arquivo) nem
 *    caractere que o WhatsApp corte ao reconhecer o link.
 *
 * Só servidor (usa a chave fiscal). Sem banco.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { subchaveFiscal, subchavesQueConferem } from "@/lib/fiscal-credenciais";

const TAMANHO_DO_SELO = 32;
const ID_OK = /^[A-Za-z0-9_-]{6,64}$/;
const CHAVE_OK = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;

function seloCom(chaveDoSelo: Buffer, pedidoId: string, chave: string): string {
  return createHmac("sha256", chaveDoSelo)
    .update(`danfe-nfce:${pedidoId}:${String(chave).toUpperCase()}`)
    .digest("hex")
    .slice(0, TAMANHO_DO_SELO);
}

/** O selo (HMAC truncado) de um pedido + chave de acesso, com a chave fiscal ATUAL. */
export function seloDoDanfe(pedidoId: string, chave: string): string {
  return seloCom(subchaveFiscal("selo-do-link"), pedidoId, chave);
}

/** O token do link: "<pedidoId>-<selo>". */
export function tokenDoDanfe(pedidoId: string, chave: string): string {
  const id = String(pedidoId ?? "").trim();
  const ch = String(chave ?? "").trim().toUpperCase();
  if (!ID_OK.test(id)) throw new Error(`Id de pedido inválido para o link do DANFE: "${id}".`);
  if (!CHAVE_OK.test(ch)) throw new Error(`Chave de acesso inválida para o link do DANFE: "${ch}".`);
  return `${id}-${seloDoDanfe(id, ch)}`;
}

/** Separa o token em pedido e selo, sem conferir nada ainda. Formato errado → null. */
export function lerTokenDoDanfe(token: unknown): { pedidoId: string; selo: string } | null {
  const m = /^([A-Za-z0-9_-]{6,64})-([0-9a-f]{32})$/.exec(String(token ?? "").trim());
  return m ? { pedidoId: m[1], selo: m[2] } : null;
}

/**
 * O token vale para ESTA chave de acesso? Comparação em tempo constante — o
 * tempo da resposta não pode ir revelando o selo certo, dígito a dígito. Vale
 * o selo da chave fiscal atual ou de uma de FISCAL_CHAVES_ANTIGAS (o link
 * enviado antes de uma troca de chave).
 */
export function tokenConfere(token: unknown, chave: string): boolean {
  const lido = lerTokenDoDanfe(token);
  if (!lido || !CHAVE_OK.test(String(chave ?? "").toUpperCase())) return false;
  const recebido = Buffer.from(lido.selo, "utf8");
  let confere = false;
  // Todas as chaves, sem parar na primeira: o tempo não diz qual conferiu.
  for (const chaveDoSelo of subchavesQueConferem("selo-do-link")) {
    const esperado = Buffer.from(seloCom(chaveDoSelo, lido.pedidoId, chave), "utf8");
    if (esperado.length === recebido.length && timingSafeEqual(esperado, recebido)) confere = true;
  }
  return confere;
}

/**
 * Origem do site, sem barra no fim. A mesma guarda de lib/meta-ads.ts
 * (urlDoSite): no Coolify o NEXTAUTH_URL já veio mascarado como
 * "[SENSITIVE]", e um link com isso dentro não abre no celular de ninguém.
 */
function origemDoSite(): string {
  const bruto = (process.env.NEXTAUTH_URL || "").trim();
  const ok = Boolean(bruto) && !bruto.includes("[SENSITIVE]") && /^https?:\/\//.test(bruto);
  return (ok ? bruto : "https://firehubfood.com.br").replace(/\/+$/, "");
}

/**
 * O endereço que vai para o cliente (tela, WhatsApp):
 * https://firehubfood.com.br/nfce/<pedidoId>-<selo>
 */
export function linkPublicoDoDanfe(pedidoId: string, chave: string, origem: string = origemDoSite()): string {
  return `${String(origem).replace(/\/+$/, "")}/nfce/${tokenDoDanfe(pedidoId, chave)}`;
}
