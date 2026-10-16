/**
 * O LANCHE DOS MOTOBOYS — o QR colado na parede da loja abre aqui
 * (lib/lanche-da-equipe.ts). O motoboy entra com o login do app do entregador
 * e pede o lanche do dia no cardápio do site, sem a Promoção do Dia.
 *
 * Só para as lojas de LOJAS_COM_LANCHE_DA_EQUIPE (a Hakim Centro); as outras
 * recebem 404. Dinâmica: o limite e o cardápio valem na hora.
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { propsDoCardapio, SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { LOJAS_COM_LANCHE_DA_EQUIPE, ehPromocaoDoDia } from "@/lib/lanche-da-equipe-regras";
import { palavrasDeBebidaDaLoja, produtoEhBebida } from "@/lib/lanche-da-equipe";
import LancheDaEquipe from "@/components/lanche/LancheDaEquipe";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lanche da equipe", robots: { index: false, follow: false } };

export default async function LancheDaEquipePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loja = await prisma.user.findUnique({ where: { slug }, select: SELECT_DA_LOJA_NO_CARDAPIO });
  if (!loja || !LOJAS_COM_LANCHE_DA_EQUIPE.has(loja.id)) notFound();

  const props = await propsDoCardapio(loja, "delivery");
  // A Promoção do Dia (a esfiha de R$ 1,90) não é do lanche da equipe.
  const menuProducts = (props.menuProducts as any[]).filter((p) => !ehPromocaoDoDia(p));
  const storeCategories = ((props.storeCategories || []) as any[]).filter((c) => !ehPromocaoDoDia({ category: c.name }));

  // As bebidas pela régua do servidor, para a tela avisar antes da 2ª do dia.
  // (o cardápio público não traz o isBeverage do cadastro: vem à parte).
  const palavras = await palavrasDeBebidaDaLoja(loja.id);
  const marcadas = new Set((await prisma.menuProduct.findMany({ where: { franchiseeId: loja.id, isBeverage: true }, select: { id: true } })).map((p) => p.id));
  const idsDeBebida: string[] = [];
  for (const p of menuProducts) if (await produtoEhBebida({ ...p, isBeverage: marcadas.has(p.id) }, palavras)) idsDeBebida.push(String(p.id));

  return <LancheDaEquipe slug={slug} cardapio={{ ...props, menuProducts, storeCategories }} idsDeBebida={idsDeBebida} />;
}
