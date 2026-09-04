/**
 * GET /api/garcom/cardapio
 *
 * O cardápio do salão para o garçom logado pelo link.
 *
 * A tela de mesa do painel lê /api/admin/menu-products?canal=salao, mas essa
 * rota mora atrás do middleware que exige sessão do painel — e o garçom não
 * tem uma. Esta rota entrega o MESMO cardápio (mesma consulta, mesmo preço de
 * canal, mesmos filtros) para a sessão do garçom, e nada mais.
 */
import { NextResponse } from "next/server";
import { autenticarGarcom } from "@/lib/garcom-auth";
import { cardapioDaLoja } from "@/lib/cardapio-da-loja";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await autenticarGarcom();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.erro, codigo: auth.codigo }, { status: auth.status });
  }
  try {
    const produtos = await cardapioDaLoja(auth.garcom.franchiseeId, "salao");
    // O garçom vê o que o cliente pode pedir na mesa, e nada mais: item
    // inativo ou desligado para o salão fica de fora aqui, não só na tela; e o
    // custo de compra e os interruptores dos outros canais não viajam para o
    // papel de menor confiança do sistema.
    const paraOGarcom = (produtos as any[])
      .filter((p) => p.active !== false && p.activeGarcom !== false)
      .map(({ cost, activePDV, activeDelivery, activeTotem, ...resto }) => resto);
    return NextResponse.json(paraOGarcom);
  } catch (err: any) {
    console.error("[garcom/cardapio]", err);
    return NextResponse.json({ error: "Erro ao carregar o cardápio" }, { status: 500 });
  }
}
