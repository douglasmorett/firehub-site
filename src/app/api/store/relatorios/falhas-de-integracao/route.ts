/**
 * GET /api/store/relatorios/falhas-de-integracao — "Pedidos com falha na integração".
 *
 * O pedido do iFood ou do 99Food que não entrou no FireHub, no período (pela
 * hora da primeira falha, no dia operacional da loja), e se entrou depois.
 * Filtros: o período e as lojas (tipo, canal, marca e horário não se aplicam:
 * o pedido não existe). `formato=xlsx` baixa a planilha.
 *
 * A conta e o porquê estão em lib/relatorios/falhas-de-integracao.ts (testada
 * em scripts/teste-falhas-de-integracao.ts); quem grava é
 * lib/falhas-de-integracao-no-banco.ts. Lido por SQL: a tabela nasce no boot
 * (garantir-colunas) e a rota funciona num client gerado antes dela.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cabecalhoDoRelatorio, contextoDoRelatorio } from "@/lib/relatorios/servidor";
import { fmtDia } from "@/lib/relatorios/base";
import { garantirEstruturaDeFalhasDeIntegracao } from "@/lib/garantir-colunas";
import { FALHAS_REGISTRADAS_DESDE, falhasDoRelatorio, type FalhaDoBanco } from "@/lib/relatorios/falhas-de-integracao";
import { montarPlanilha, respostaDePlanilha, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";

export const dynamic = "force-dynamic";

/** Mais que isto num período é a integração inteira fora do ar: a tela não precisa de todas. */
const LIMITE = 5000;

export async function GET(req: NextRequest) {
  const r = await contextoDoRelatorio(req);
  if (!r.ok) return r.resposta;
  const ctx = r.valor;
  const planilha = req.nextUrl.searchParams.get("formato") === "xlsx";

  let linhas: FalhaDoBanco[] = [];
  if (await garantirEstruturaDeFalhasDeIntegracao()) {
    // "Entrou depois": o pedido com o mesmo id do parceiro existe hoje.
    linhas = await prisma.$queryRaw<FalhaDoBanco[]>(Prisma.sql`
      SELECT f."id", f."plataforma", f."pedidoExterno", f."codigo", f."erro", f."tentativas", f."primeiraEm", f."ultimaEm",
             COALESCE(oi."id", o9."id") AS "pedidoId",
             COALESCE(oi."dailyOrderNumber", o9."dailyOrderNumber") AS "numeroDoPedido"
      FROM "FalhaDeIntegracao" f
      LEFT JOIN "CustomerOrder" oi ON f."plataforma" = 'IFOOD' AND oi."ifoodOrderId" = f."pedidoExterno"
      LEFT JOIN "CustomerOrder" o9 ON f."plataforma" = '99FOOD' AND o9."openDeliveryOrderId" = f."pedidoExterno"
      WHERE f."franchiseeId" IN (${Prisma.join(ctx.lojaIds)})
        AND f."primeiraEm" >= ${ctx.inicio} AND f."primeiraEm" < ${ctx.fim}
      ORDER BY f."primeiraEm" DESC
      LIMIT ${LIMITE}`);
  }
  const resultado = falhasDoRelatorio(linhas, ctx.tz);
  const cabecalho = cabecalhoDoRelatorio(ctx);
  const avisos = {
    registradasDesde: FALHAS_REGISTRADAS_DESDE,
    periodoAntesDoRegistro: ctx.filtros.de < FALHAS_REGISTRADAS_DESDE,
    cortado: linhas.length >= LIMITE,
  };

  if (!planilha) return NextResponse.json({ ...cabecalho, ...resultado, avisos });

  const relogio = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const linhasDaPlanilha: LinhaDaPlanilha[] = [
    { celulas: [{ v: `Pedidos com falha na integração — ${cabecalho.lojas.join(", ")}`, estilo: "titulo" }] },
    { celulas: [{ v: `Período: ${fmtDia(ctx.filtros.de)} a ${fmtDia(ctx.filtros.ate)} (o dia vira às 5h) · ${resultado.total} falha(s), ${resultado.entraram} entraram depois, ${resultado.naoEntraram} não entraram`, estilo: "suave" }] },
    { celulas: [{ v: `As falhas são registradas desde ${fmtDia(FALHAS_REGISTRADAS_DESDE)} (iFood e 99Food).`, estilo: "suave" }] },
    { celulas: [] },
    { celulas: ["Dia", "Hora", "Plataforma", "Pedido no app", "O que aconteceu", "Situação hoje", "Tentativas", "Última tentativa", "Id do pedido no app", "Erro técnico"], estilo: "cabecalho" },
    ...resultado.lista.map((l) => ({
      celulas: [
        fmtDia(l.dia), l.hora, l.nomeDaPlataforma, l.codigo, l.oQueAconteceu,
        { v: l.situacao, estilo: l.entrou ? ("texto" as const) : ("negrito" as const) },
        { v: l.tentativas, estilo: "qtd" as const }, relogio.format(new Date(l.ultimaEm)).replace(",", ""), l.pedidoExterno, l.detalhe,
      ],
    })),
  ];
  const buffer = montarPlanilha([
    { nome: "Falhas", congelarLinhas: 5, larguras: [12, 7, 11, 16, 60, 30, 11, 16, 40, 60], linhas: linhasDaPlanilha },
  ]);
  return respostaDePlanilha(buffer, `falhas-de-integracao_${ctx.filtros.de}_a_${ctx.filtros.ate}.xlsx`);
}
