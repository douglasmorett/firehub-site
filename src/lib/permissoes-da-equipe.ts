/**
 * Quem da loja pode o quê nas rotas de /api — a régua das telas
 * (lib/permissao-da-tela.ts) aplicada também na API.
 *
 * O proxy só confere as caixinhas do funcionário ao abrir a PÁGINA. A rota
 * chamada direto (fetch, curl) passava para qualquer login da loja: o caixa
 * com só "Pedidos" criava chave de API, baixava o pacote do contador, trocava
 * o Pix do robô (auditoria de 23/10/2026).
 *
 * Os dados vêm do banco (role, ownerId, permissions), nunca do cookie.
 */
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export type QuemPede = {
  role?: string | null;
  ownerId?: string | null;
  permissions?: string | null;
};

/**
 * O dono da loja (FRANCHISEE sem dono acima dele — a filial também é FRANCHISEE,
 * presa por accountGroupId) ou o ADMIN. Funcionário (STAFF) nunca.
 */
export function ehDonoOuAdmin(u: QuemPede | null | undefined): boolean {
  if (!u) return false;
  const papel = String(u.role || "").toUpperCase();
  if (papel === "ADMIN") return true;
  return papel === "FRANCHISEE" && !u.ownerId;
}

/**
 * Pode fazer o que a tela `tela` faz? Dono e ADMIN sempre; o funcionário só com
 * a caixinha que abre a tela — o mesmo `role === "STAFF" && !funcionarioAbre`
 * das rotas do Fiscal e das despesas.
 */
export function podeComoNaTela(u: QuemPede | null | undefined, tela: string): boolean {
  if (!u) return false;
  if (String(u.role || "").toUpperCase() === "STAFF") return funcionarioAbre(tela, u.permissions);
  return true;
}

/**
 * A sessão é de um ADMIN, conferido no banco. O papel do cookie é o do dia do
 * login: o ADMIN rebaixado seguia passando por quem só lia o cookie.
 */
export async function ehAdminNoBanco(session: any): Promise<boolean> {
  const email = session?.user?.email;
  if (!email) return false;
  const u = await prisma.user.findUnique({ where: { email: String(email) }, select: { role: true } }).catch(() => null);
  return u?.role === "ADMIN";
}
