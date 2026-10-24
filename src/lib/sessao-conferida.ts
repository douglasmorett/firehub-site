/**
 * A SESSÃO AINDA VALE? (auditoria de 23/10/2026: F122, F123, F145, F146)
 *
 * A sessão é um JWT de 7 dias que só copiava a conta no login: trocar ou
 * recuperar a senha não derrubava quem já estava dentro, funcionário apagado
 * seguia entrando e admin rebaixado seguia admin até o cookie vencer.
 *
 * Agora o login grava no token a MARCA da senha — 12 caracteres do SHA-256 do
 * hash bcrypt, nunca o hash — e cada leitura da sessão (getServerSession)
 * confere a conta no banco, com 60 s de memória por conta:
 *
 *   • conta apagada (ou desativada, role DELETED) → sessão encerrada;
 *   • marca diferente (a senha mudou)             → sessão encerrada;
 *   • role e permissions passam a ser os de agora.
 *
 * Sem coluna nova: a marca muda sozinha quando o hash muda.
 *
 * Token sem marca (emitido antes desta regra) não cai por senha — só passa a
 * receber role/permissions do banco, e cai se a conta não existir mais. Assim
 * ninguém é deslogado no dia do deploy. Banco fora do ar: a sessão segue como
 * está, para um soluço do banco não derrubar todas as lojas.
 */
import { createHash } from "node:crypto";
import { prisma } from "./prisma";

/** A marca da senha que vai no token: muda quando o hash muda e não entrega o hash. */
export function marcaDaSenha(hash: string | null | undefined): string {
  return createHash("sha256").update(String(hash ?? "")).digest("hex").slice(0, 12);
}

type Conta = { marca: string; role: string; permissions: string | null } | null;

const VALIDADE_MS = 60_000;
const CONTAS_EM_MEMORIA = new Map<string, { conta: Conta; ate: number }>();
const chave = (id: string, parceiro: boolean) => `${parceiro ? "parceiro" : "loja"}:${id}`;

/** A conta da sessão AGORA. Sessão do portal (role AMBASSADOR) mora em Ambassador, as outras em User. */
async function contaAtual(id: string, parceiro: boolean): Promise<Conta> {
  const guardada = CONTAS_EM_MEMORIA.get(chave(id, parceiro));
  if (guardada && guardada.ate > Date.now()) return guardada.conta;
  let conta: Conta;
  if (parceiro) {
    const a = await prisma.ambassador.findUnique({ where: { id }, select: { password: true } });
    conta = a ? { marca: marcaDaSenha(a.password), role: "AMBASSADOR", permissions: "[]" } : null;
  } else {
    const u = await prisma.user.findUnique({ where: { id }, select: { password: true, role: true, permissions: true } });
    conta = u && u.role !== "DELETED" ? { marca: marcaDaSenha(u.password), role: u.role, permissions: u.permissions } : null;
  }
  CONTAS_EM_MEMORIA.set(chave(id, parceiro), { conta, ate: Date.now() + VALIDADE_MS });
  return conta;
}

/** A senha desta conta acabou de mudar: a próxima conferência lê o banco, sem esperar a memória vencer. */
export function esquecerConta(id: string) {
  CONTAS_EM_MEMORIA.delete(chave(id, false));
  CONTAS_EM_MEMORIA.delete(chave(id, true));
}

/**
 * O token conferido com o banco: com role/permissions de agora, ou `null`
 * quando a sessão tem que acabar. Token sem id passa como veio.
 */
export async function conferirSessao<T extends Record<string, any>>(token: T): Promise<T | null> {
  const id = String(token?.id || token?.sub || "");
  if (!id) return token;
  let conta: Conta;
  try {
    conta = await contaAtual(id, token.role === "AMBASSADOR");
  } catch (e) {
    console.error("[sessão] Não consegui conferir a conta; a sessão segue:", (e as Error)?.message);
    return token;
  }
  if (!conta) return null;
  if (token.marcaDaSenha && token.marcaDaSenha !== conta.marca) return null;
  return { ...token, role: conta.role, permissions: conta.permissions };
}
