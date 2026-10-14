/**
 * Chave e bilhete do Modo Contingência — sem banco, usados na nuvem e no
 * computador da loja.
 *
 * CHAVE: o computador da loja se identifica na nuvem com ela (cópia, relato,
 * subida). Nasce na ativação, vai para o Assistente uma vez e a nuvem guarda
 * só o hash. Hoje o Assistente fala com a nuvem só com o `franchiseeId`, que
 * está no HTML do cardápio — basta para imprimir, nunca para copiar os dados
 * da loja.
 *
 * BILHETE: com internet, cada tela do painel e do garçom guarda um bilhete
 * assinado. Quando a internet cai, a tela vai para o computador da loja com
 * ele, e o FireHub local abre a sessão sem pedir senha — a senha do painel não
 * desce para o computador. Assinado com o segredo do bilhete da loja (nasce na
 * ativação, a nuvem e o computador guardam) e só vale para a loja dele.
 *
 * Validade de 1 ano, contada da última vez que a tela teve internet (com
 * internet ela pede um novo a cada ~30 min). Era 24 h: um computador que
 * passasse um dia desligado, ou uma queda de dias, deixava o dono trancado
 * para fora do painel — a senha não desce, o bilhete é a única porta. Pedido
 * do Douglas (14/10/2026): "ficou três dias sem internet, ele consegue entrar
 * na loja dele e usar tudo". Ativar de novo troca o segredo e invalida todos.
 */
import crypto from "node:crypto";

export function novaChave(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashDaChave(chave: string): string {
  return crypto.createHash("sha256").update(chave).digest("hex");
}

export type Bilhete = {
  v: 1;
  loja: string;
  tipo: "painel" | "garcom";
  /** Painel: o e-mail da conta (a sessão do NextAuth resolve a loja por ele). */
  email?: string;
  /** Garçom: o id dele. */
  garcomId?: string;
  /** Validade, em ms desde 1970. */
  exp: number;
};

export const VALIDADE_DO_BILHETE_MS = 365 * 24 * 60 * 60 * 1000;

function assinatura(corpo: string, segredo: string): string {
  return crypto.createHmac("sha256", segredo).update(corpo).digest("base64url");
}

export function assinarBilhete(b: Bilhete, segredo: string): string {
  const corpo = Buffer.from(JSON.stringify(b)).toString("base64url");
  return `${corpo}.${assinatura(corpo, segredo)}`;
}

/** O bilhete, se a assinatura confere, é desta loja e não venceu; senão `null`. */
export function lerBilhete(texto: string, segredo: string, lojaEsperada: string, agora: number = Date.now()): Bilhete | null {
  if (!texto || !segredo) return null;
  const [corpo, assinado] = String(texto).split(".");
  if (!corpo || !assinado) return null;
  const esperado = assinatura(corpo, segredo);
  const a = Buffer.from(assinado);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const bilhete = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Bilhete;
    if (bilhete?.v !== 1 || bilhete.loja !== lojaEsperada) return null;
    if (!Number.isFinite(bilhete.exp) || bilhete.exp < agora) return null;
    if (bilhete.tipo === "painel" && !bilhete.email) return null;
    if (bilhete.tipo === "garcom" && !bilhete.garcomId) return null;
    if (bilhete.tipo !== "painel" && bilhete.tipo !== "garcom") return null;
    return bilhete;
  } catch {
    return null;
  }
}
