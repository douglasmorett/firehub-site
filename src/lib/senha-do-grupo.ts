/**
 * A SENHA NOVA DA PRINCIPAL VALE NAS FILIAIS (auditoria de 23/10/2026: F143)
 *
 * A filial nasce com a CÓPIA do hash da senha da principal
 * (api/store/create). Trocar ou recuperar a senha só gravava a principal: a
 * senha antiga seguia abrindo a filial pelo e-mail virtual dela, as sessões
 * da filial seguiam vivas, e da filial o `trocarLoja` (lib/auth.ts) levava de
 * volta à principal sem senha.
 *
 * Agora toda troca de senha passa por aqui: quando a conta é a PRINCIPAL de um
 * grupo (FRANCHISEE sem ownerId e sem accountGroupId), as filiais que ainda
 * tinham o MESMO hash antigo recebem o mesmo hash novo, na mesma transação. A
 * marca da senha muda nelas também e as sessões caem (lib/sessao-conferida.ts).
 * Filial com senha própria (trocada por ela mesma, logada nela) fica como está.
 */
import { prisma } from "./prisma";
import { esquecerConta } from "./sessao-conferida";

/** A conta é a principal de um grupo de lojas? (Filial aponta para ela em accountGroupId.) */
export function ehPrincipalDoGrupo(u: { role?: string | null; ownerId?: string | null; accountGroupId?: string | null } | null | undefined): boolean {
  return !!u && String(u.role || "").toUpperCase() === "FRANCHISEE" && !u.ownerId && !u.accountGroupId;
}

/**
 * Grava o hash novo na conta (com `extra`, ex. o token de recuperação zerado)
 * e nas filiais que usavam a mesma senha. Devolve os ids que mudaram.
 */
export async function gravarSenhaNova(
  contaId: string,
  novoHash: string,
  extra: { resetToken?: null; resetTokenExp?: null } = {},
): Promise<string[]> {
  const conta = await prisma.user.findUnique({
    where: { id: contaId },
    select: { id: true, password: true, role: true, ownerId: true, accountGroupId: true },
  });
  if (!conta) throw new Error("Conta não encontrada.");

  const filiaisComAMesmaSenha = { accountGroupId: conta.id, role: "FRANCHISEE", ownerId: null, password: conta.password };
  const filiais = ehPrincipalDoGrupo(conta) && conta.password
    ? await prisma.user.findMany({ where: filiaisComAMesmaSenha, select: { id: true } })
    : [];

  if (!filiais.length) {
    // Sem filial na mesma senha: a troca de sempre.
    await prisma.user.update({ where: { id: conta.id }, data: { password: novoHash, ...extra } });
  } else {
    // O filtro do hash antigo vai junto: filial que trocou a senha no meio não é sobrescrita.
    await prisma.$transaction([
      prisma.user.update({ where: { id: conta.id }, data: { password: novoHash, ...extra } }),
      prisma.user.updateMany({ where: filiaisComAMesmaSenha, data: { password: novoHash } }),
    ]);
  }

  const mudaram = [conta.id, ...filiais.map((f) => f.id)];
  // As sessões dessas contas caem na próxima leitura, sem esperar a memória de 60 s.
  for (const id of mudaram) esquecerConta(id);
  return mudaram;
}
