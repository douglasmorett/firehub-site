/**
 * Os números da tela "Meu aplicativo" — base de aparelhos, ativos, e o que
 * o app vendeu no mês.
 *
 * Venda segue a RÉGUA ÚNICA (lib/relatorios/regua-da-venda.ts): status fora
 * da venda e reposição ficam de fora, mesa conta uma vez, ticket = valor ÷
 * vendas. Período no dia OPERACIONAL da loja (vira às 5h, fuso da loja,
 * lib/relatorios/base.ts) — "este mês" aqui é o mesmo "Este mês" dos
 * Relatórios. Pedido do app = está em PedidoAparelho ou em AppDaLojaPedido.
 */
import { prisma } from "@/lib/prisma";
import { STATUS_FORA_DA_VENDA, naLoja, somarDias } from "@/lib/relatorios/base";
import { SEM_REPOSICAO } from "@/lib/relatorios/sem-reposicao";
import { atendimentosDaVenda, cent, entraNaVenda, reais, ticketMedio } from "@/lib/relatorios/regua-da-venda";
import { aberturasPorDia, lerBase, pedidosDoApp, type AppDaConta } from "@/lib/app-da-loja/instalacoes";
import { contarBase, juntarBase, tokensDoPublico, type ContagemDaBase, type Publico } from "@/lib/app-da-loja/regras-do-push";
import { marcosDaConta } from "@/lib/app-da-loja/notificacoes";

export type NumerosDoApp = {
  base: ContagemDaBase;
  /** Quantos aparelhos cada público alcança agora. */
  alcance: Record<Publico, number>;
  mes: { de: string; ate: string; pedidos: number; faturamento: number; ticketMedio: number };
  /** Últimos 30 dias operacionais, do mais antigo para hoje. */
  porDia: { dia: string; aberturas: number; pedidos: number }[];
  /** Quando o primeiro aparelho avisou a abertura (null = nenhum ainda: versão nova do app não chegou). */
  temAberturas: boolean;
};

export async function numerosDoApp(app: Pick<AppDaConta, "chave" | "lojaIds" | "tz">, agora: Date = new Date()): Promise<NumerosDoApp> {
  const m = marcosDaConta(app.tz, agora);
  const { aberturas, pedidos } = await lerBase(app);
  const juntos = juntarBase(aberturas, pedidos);
  const base = contarBase(juntos, m);
  const alcance = { todos: tokensDoPublico(juntos, "todos", m.inicio30).length, ativos30: tokensDoPublico(juntos, "ativos30", m.inicio30).length };

  const desde = m.inicio30 < m.inicioDoMes ? m.inicio30 : m.inicioDoMes;
  const ids = await pedidosDoApp(app.lojaIds, new Date(desde.getTime() - 60 * 60 * 1000));
  const vendas: { id: string; createdAt: Date; status: string; totalAmount: number; tableSessionId: string | null; parentOrderId: string | null; reposicao: unknown }[] = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const lote = await prisma.customerOrder.findMany({
      where: {
        id: { in: ids.slice(i, i + 1000) },
        franchiseeId: { in: app.lojaIds },
        createdAt: { gte: desde, lt: new Date(agora.getTime() + 60_000) },
        status: { notIn: [...STATUS_FORA_DA_VENDA] },
        ...SEM_REPOSICAO,
      },
      select: { id: true, createdAt: true, status: true, totalAmount: true, tableSessionId: true, parentOrderId: true, reposicao: true },
    });
    vendas.push(...(lote as any[]));
  }

  const doMes = vendas.filter((v) => v.createdAt >= m.inicioDoMes && entraNaVenda(v as any));
  const atend = atendimentosDaVenda(doMes as any);
  const valor = reais(doMes.reduce((s, v) => s + cent(v.totalAmount), 0));

  const porDiaPedidos: Record<string, number> = {};
  const ultimos = vendas.filter((v) => v.createdAt >= m.inicio30);
  const abre = atendimentosDaVenda(ultimos as any).abre;
  for (const v of ultimos) if (abre.has(v.id)) {
    const d = naLoja(v.createdAt, app.tz).dia;
    porDiaPedidos[d] = (porDiaPedidos[d] || 0) + 1;
  }
  const primeiroDia = somarDias(m.hoje, -29);
  const abriram = await aberturasPorDia(app.chave, primeiroDia);
  const porDia = Array.from({ length: 30 }, (_, i) => {
    const dia = somarDias(primeiroDia, i);
    return { dia, aberturas: abriram[dia] || 0, pedidos: porDiaPedidos[dia] || 0 };
  });

  return {
    base,
    alcance,
    mes: { de: `${m.hoje.slice(0, 7)}-01`, ate: m.hoje, pedidos: atend.vendas, faturamento: valor, ticketMedio: ticketMedio(valor, atend.vendas) },
    porDia,
    temAberturas: aberturas.length > 0,
  };
}
