/**
 * GRAVAR PRODUTO DO CARDÁPIO — a parte da rota api/admin/menu-products que
 * não depende da sessão do navegador. Saiu de lá quando o Bill passou a
 * cadastrar, editar e apagar produto pelo WhatsApp (lib/assessor/modulos/
 * cardapio.ts, 18/11/2026): a regra da promoção, do horário, das colunas que
 * podem ser gravadas, do código PDV e da exclusão é uma só para a tela e para
 * o Bill. Os textos abaixo são os de lá.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerHorarioDoProduto } from "@/lib/cardapio-interno";
import { proximoCodigoPDV } from "@/lib/espelho-de-integracao";
import { esquecerPausaPeloEstoque } from "@/lib/pausa-pelo-estoque-no-banco";

/**
 * PREÇO PROMOCIONAL: grava só o que é promoção de verdade.
 *
 * A regra do campo é uma só — tem que ser MENOR que o preço de venda. Vazio,
 * zero, negativo e lixo apagam a promoção (é assim que o lojista a encerra:
 * limpando o campo). Já um número MAIOR OU IGUAL ao preço de venda é recusado
 * com 400, não zerado em silêncio: a tela impede o caso, então quem chega aqui
 * assim é uma integração ou um dedo errado — e uma promoção que some sozinha é
 * pior do que um erro que explica o motivo.
 *
 * `precoAtual` é o preço já gravado, para o PUT que muda só a promoção e não
 * manda `price` no corpo.
 *
 * Devolve a mensagem do erro, ou null quando está tudo certo.
 */
export function saneiaPromocao(dados: any, precoAtual?: number | null): string | null {
  if (!("promoPrice" in dados)) return null;

  const promo = Number(dados.promoPrice);
  if (!Number.isFinite(promo) || promo <= 0) {
    dados.promoPrice = null;
    return null;
  }

  const preco = Number(dados.price ?? precoAtual);
  if (!Number.isFinite(preco) || preco <= 0) {
    dados.promoPrice = null;
    return null;
  }

  if (promo >= preco) {
    return `O preço promocional (R$ ${promo.toFixed(2)}) precisa ser MENOR que o preço de venda (R$ ${preco.toFixed(2)}).`;
  }

  dados.promoPrice = promo;
  return null;
}

/**
 * Horário do produto (`availableHours`): chega `{de, ate}` ou nulo e vai para
 * o banco como JSON. Nulo = o dia todo. Horário que não se lê é recusado em
 * vez de gravado: gravado, ele valeria como "o dia todo" sem ninguém saber.
 */
export function saneiaHorario(dados: any): string | null {
  if (dados?.availableHours === undefined) return null;
  if (dados.availableHours === null || dados.availableHours === "") {
    dados.availableHours = null;
    return null;
  }
  const horario = lerHorarioDoProduto(dados.availableHours);
  if (!horario) return "Horário do produto: informe o início e o fim (HH:MM), diferentes um do outro.";
  dados.availableHours = JSON.stringify(horario);
  return null;
}

/**
 * Só colunas do próprio produto chegam ao Prisma. O corpo ia inteiro para o
 * create/update, e uma chave de relação (`franchisee`, `orderItems`,
 * `pausaPeloEstoque`...) com escrita aninhada mexia em outras tabelas: um
 * `franchisee: { update: { role: "ADMIN" } }` tornava o lojista ADMIN.
 * `id` e `franchiseeId` também saem: quem decide a loja é a sessão.
 */
const COLUNAS_DO_PRODUTO = new Set<string>(Object.values(Prisma.MenuProductScalarFieldEnum));
// Carimbo e vínculo do espelho (lib/espelho-de-integracao.ts) nunca vêm do corpo.
const SO_O_SERVIDOR_GRAVA = new Set(["id", "franchiseeId", "origemIntegracao", "codigoExterno", "vinculadoA"]);
export function soColunasDoProduto(dados: any) {
  for (const k of Object.keys(dados)) {
    if (!COLUNAS_DO_PRODUTO.has(k) || SO_O_SERVIDOR_GRAVA.has(k)) delete dados[k];
  }
}

/**
 * Código PDV: o número que o lojista digita no marketplace para o pedido
 * entrar ligado ao produto (lib/espelho-de-integracao.ts). Só quando o
 * corpo não trouxe um; se dois cadastros ao mesmo tempo pegarem o mesmo
 * número (P2002), tenta uma vez com o próximo. `criar` lê `dados.codigoPDV`.
 */
export async function criarComCodigoPDV<T>(dados: any, franchiseeId: string, criar: () => Promise<T>): Promise<T> {
  const semCodigoPDV = dados.codigoPDV == null;
  if (semCodigoPDV) dados.codigoPDV = await proximoCodigoPDV(franchiseeId);
  try {
    return await criar();
  } catch (e: any) {
    if (!semCodigoPDV || e?.code !== "P2002") throw e;
    dados.codigoPDV = await proximoCodigoPDV(franchiseeId);
    return criar();
  }
}

/** Exclui o produto (o aviso à Keeta fica com quem chama). */
export async function excluirProdutoDaLoja(franchiseeId: string | null, productId: string): Promise<{ softDeleted: boolean }> {
  try {
    // 1. Remover o item dos combos DA PRÓPRIA LOJA em que ele estiver vinculado.
    //    Antes o deleteMany era global e podia apagar o vínculo dentro do combo
    //    de outra franquia. Se sobrar referência de fora, o delete abaixo falha
    //    no FK e cai no soft delete — o produto some do cardápio do mesmo jeito.
    await prisma.comboGroupItem.deleteMany({
      where: {
        menuProductId: productId,
        comboGroup: { menuProduct: { franchiseeId } },
      },
    });

    // 2. Excluir o produto do cardápio
    await prisma.menuProduct.delete({ where: { id: productId } });
    return { softDeleted: false };
  } catch {
    // Soft delete se falhar por restrição em histórico de pedidos anteriores
    await prisma.menuProduct.update({ where: { id: productId }, data: { active: false } });
    // Excluído não volta sozinho quando o insumo for reposto.
    if (franchiseeId) await esquecerPausaPeloEstoque(franchiseeId, [productId]);
    return { softDeleted: true };
  }
}
