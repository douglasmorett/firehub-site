"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { sanitizarConfigDeEtiqueta } from "@/lib/etiqueta-campos";

/** Mesma resolucao de loja de kitchenItems.ts — `ownerId || id`. */
async function lojaDaSessao(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Não autorizado");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) throw new Error("Usuário não encontrado");

  return user.ownerId || user.id;
}

export async function saveLabelData(productId: string, labelData: any) {
  const franchiseeId = await lojaDaSessao();

  // Era `update({ where: { id: productId } })` com so `if (!session)`: qualquer
  // usuario logado sobrescrevia o campo `tags` de um produto de cardapio de
  // QUALQUER loja. O franchiseeId entra no WHERE da propria escrita.
  const { count } = await prisma.menuProduct.updateMany({
    where: { id: productId, franchiseeId },
    data: { tags: JSON.stringify(labelData) },
  });
  if (count === 0) throw new Error("Produto não encontrado nesta loja");

  revalidatePath("/store/etiquetas");
}

export async function updateStoreLabelInfo(cpfCnpj: string, storeAddress: string, storeName: string, storeLogo: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Não autorizado" };

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return { success: false, error: "Usuário não encontrado" };

    // CNPJ, endereco, nome e logo sao da LOJA, nao de quem esta logado. Gravar
    // em `user.id` fazia o funcionario salvar os dados no proprio cadastro: a
    // tela dizia "salvo", a etiqueta continuava saindo com os dados antigos, e
    // nao havia como descobrir por que.
    await prisma.user.update({
      where: { id: user.ownerId || user.id },
      data: { cpfCnpj, storeAddress, storeName, storeLogo }
    });

    revalidatePath("/store/etiquetas");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Erro desconhecido" };
  }
}

/**
 * Grava a regra de layout da etiqueta — o que sai no papel e o que não sai.
 *
 * É UMA regra por LOJA, gravada em `User.labelFieldsConfig`, pelo mesmo motivo
 * que já está escrito logo acima sobre CNPJ e endereço: gravar em `user.id`
 * fazia o funcionário salvar a configuração no próprio cadastro, a tela dizia
 * "salvo" e a etiqueta continuava saindo do mesmo jeito, sem nada para
 * investigar. `lojaDaSessao()` resolve `ownerId || id`.
 *
 * A entrada passa pelo sanitizador antes de encostar no banco: Json aberto vira
 * saco sem fundo se a action gravar o que o cliente mandar.
 */
export async function salvarConfigDaEtiqueta(entrada: any) {
  try {
    const franchiseeId = await lojaDaSessao();

    const limpo = sanitizarConfigDeEtiqueta(entrada);
    if (!limpo.ok) return { success: false, error: limpo.erro };

    await prisma.user.update({
      where: { id: franchiseeId },
      data: { labelFieldsConfig: limpo.config },
    });

    revalidatePath("/store/etiquetas");
    return { success: true };
  } catch (error: any) {
    // A coluna `labelFieldsConfig` nasce no boot (garantir-colunas.ts:256), mas
    // um banco que ainda não subiu com a estrutura de lotes vai estourar aqui —
    // e o certo é a tela avisar que não salvou, nunca fingir que salvou.
    return { success: false, error: error?.message || "Não consegui salvar a configuração da etiqueta." };
  }
}
