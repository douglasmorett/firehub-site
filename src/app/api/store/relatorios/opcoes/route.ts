/**
 * GET /api/store/relatorios/opcoes — o que os filtros dos relatórios oferecem:
 * tipos de venda, canais, marcas (lojas de iFood/99), lojas da conta,
 * categorias e produtos do cardápio de verdade. Uma chamada ao abrir a tela;
 * cada relatório busca os números na rota dele.
 */
import { NextRequest, NextResponse } from "next/server";
import { canaisConhecidos } from "@/lib/canal-do-pedido";
import { ROTULO_DO_TIPO, TIPOS_DE_VENDA } from "@/lib/relatorios/base";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { catalogoDoRelatorio } from "@/lib/relatorios/catalogo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const catalogo = await catalogoDoRelatorio(ctx.lojaIds);
  return NextResponse.json({
    ...cabecalhoDoRelatorio(ctx),
    tipos: TIPOS_DE_VENDA.map((t) => ({ chave: t, rotulo: ROTULO_DO_TIPO[t] })),
    canais: canaisConhecidos()
      .filter((c) => c.chave !== "DESCONHECIDO")
      .map((c) => ({ chave: c.chave, rotulo: `${c.emoji} ${c.nome}` })),
    categorias: catalogo.categorias,
    produtos: catalogo.produtos,
  });
}
