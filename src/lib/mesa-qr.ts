/**
 * O QR Code da mesa — o cliente escaneia, abre o cardápio do salão e o pedido
 * cai na conta DAQUELA mesa, como se o garçom tivesse lançado.
 *
 * O código no link é assinado (HMAC), porque o link fica impresso na mesa e é
 * público: sem a assinatura, trocar o número no endereço mandaria pedido para
 * outra mesa, e trocar o id mandaria pedido para outra LOJA. A assinatura
 * amarra as duas coisas — a loja e a mesa — e só o servidor sabe gerá-la.
 *
 * Dois tipos:
 *  - da mesa:  `<id da Table>.<assinatura>` — a loja vem da própria mesa no
 *    banco (table.franchiseeId), e a assinatura é conferida com ELA. Mesa
 *    apagada ou desativada = QR morto.
 *  - geral:    `geral.<assinatura>` — um QR só para o salão inteiro; o cliente
 *    escolhe a mesa na tela. A loja vem do slug do link e a assinatura é
 *    conferida com ela.
 *
 * O QR não expira: é papel colado na mesa. O segredo é MESA_QR_SECRET (ou o
 * NEXTAUTH_SECRET, se aquele não existir) — trocar o segredo invalida todos os
 * QRs impressos de todas as lojas.
 *
 * Curto de propósito: QR com menos caracteres tem quadradinhos maiores e lê
 * melhor de longe e com pouca luz.
 */
import { createHmac, timingSafeEqual } from "crypto";

const VERSAO = "mesa-qr:v1";
const TAMANHO_DA_ASSINATURA = 16;

function segredo(): string {
  const s = process.env.MESA_QR_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Sem segredo para assinar o QR da mesa (MESA_QR_SECRET ou NEXTAUTH_SECRET).");
  return s;
}

const assinar = (franchiseeId: string, mesa: string) =>
  createHmac("sha256", segredo()).update(`${VERSAO}:${franchiseeId}:${mesa}`).digest("base64url").slice(0, TAMANHO_DA_ASSINATURA);

function confere(certa: string, veio: string): boolean {
  const a = Buffer.from(certa);
  const b = Buffer.from(veio);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** O código do QR de UMA mesa. */
export function codigoDaMesa(franchiseeId: string, tableId: string): string {
  return `${tableId}.${assinar(franchiseeId, tableId)}`;
}

/** O código do QR geral do salão (o cliente escolhe a mesa). */
export function codigoGeral(franchiseeId: string): string {
  return `geral.${assinar(franchiseeId, "*")}`;
}

export type CodigoLido = { tipo: "mesa"; tableId: string; assinatura: string } | { tipo: "geral"; assinatura: string };

/** Só a FORMA do código; quem diz se vale é `valeParaAMesa` / `valeParaALoja`. */
export function lerCodigo(codigo: unknown): CodigoLido | null {
  const texto = String(codigo ?? "").trim();
  const m = texto.match(/^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{8,64})$/);
  if (!m) return null;
  return m[1] === "geral" ? { tipo: "geral", assinatura: m[2] } : { tipo: "mesa", tableId: m[1], assinatura: m[2] };
}

/** A assinatura do QR de mesa confere com a loja DONA da mesa (do banco)? */
export function valeParaAMesa(lido: CodigoLido, franchiseeIdDaMesa: string): boolean {
  return lido.tipo === "mesa" && confere(assinar(franchiseeIdDaMesa, lido.tableId), lido.assinatura);
}

/** A assinatura do QR geral confere com esta loja? */
export function valeParaALoja(lido: CodigoLido, franchiseeId: string): boolean {
  return lido.tipo === "geral" && confere(assinar(franchiseeId, "*"), lido.assinatura);
}

/** O caminho que vai no QR (o domínio entra na tela, pelo `origin`). */
export function caminhoDoQr(slug: string, codigo: string): string {
  return `/loja/${slug}/mesa/${codigo}`;
}
