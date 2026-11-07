/**
 * GET /api/store/clientes/cashback/painel?de=&ate=               → o painel da aba Cashback
 * GET /api/store/clientes/cashback/painel?de=&ate=&formato=csv   → a lista para o Excel
 *
 * Minha loja › Fidelidade › Cashback: quem tem saldo, quanto a loja deve, o
 * que vence, o gerado e o usado no período e o comparativo de quem usa × quem
 * não usa (lib/painel-do-cashback.ts). O saldo é o do cardápio e da aba
 * Clientes (lib/cashback-no-banco.ts, `gruposDoCashbackDaLoja`); o período e
 * os pedidos, os dos relatórios (lib/relatorios/servidor.ts).
 *
 * Quem pode: a regra da aba Clientes (`sessaoDosClientes` — dono, ou
 * funcionário com "Minha loja" ou "Financeiro"): é o mesmo dado, saldo e
 * telefone de cliente. A loja é a da sessão, como em Clientes: o cashback é
 * de cada loja, e "Todas as lojas" somaria saldos que não se misturam.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerCashback } from "@/lib/cashback";
import { gruposDoCashbackDaLoja } from "@/lib/cashback-no-banco";
import { baseDosClientesDoSaldo, sessaoDosClientes } from "@/lib/clientes-da-loja";
import { dataNaLoja } from "@/lib/clientes-da-loja-regras";
import { dataDaLoja } from "@/lib/fuso";
import { cashbackNoPainel, comparativoDoCashback, resumoDoPainel } from "@/lib/painel-do-cashback";
import { contextoDoRelatorio, pedidosDoRelatorio } from "@/lib/relatorios/servidor";
import { linkDoCardapioDaLoja } from "@/lib/saudacao-do-dia";

export const dynamic = "force-dynamic";

const semCache = { "Cache-Control": "no-store" };

// A mesma proteção do Excel de api/store/clientes (route.ts não exporta helper):
// o nome vem do cliente, e "=HYPERLINK(...)" viraria fórmula.
const celula = (v: unknown) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^[\d\s()+\-.,]*$/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const reais = (n: number) => n.toFixed(2).replace(".", ",");

export async function GET(req: NextRequest) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  // O período (dia operacional, fuso da loja, teto de dias) é o dos relatórios,
  // com a caixinha da aba Clientes.
  const ctx = await contextoDoRelatorio(req, "/store/clientes");
  if (!ctx.ok) return ctx.resposta;
  const janela = { inicio: ctx.valor.inicio, fim: ctx.valor.fim };
  const agora = new Date();
  const csv = req.nextUrl.searchParams.get("formato") === "csv";

  try {
    const regra = lerCashback(sessao.storeLoyalty);
    const [grupos, pedidosDoPeriodo, loja] = await Promise.all([
      gruposDoCashbackDaLoja(sessao.lojaId),
      pedidosDoRelatorio(
        { ...ctx.valor, lojaIds: [sessao.lojaId] },
        { select: { customerPhone: true, parentOrderId: true, cashbackUsed: true } },
      ),
      prisma.user.findUnique({ where: { id: sessao.lojaId }, select: { storeName: true, name: true, slug: true, chatbotConfig: true } }),
    ]);

    const finais = [...grupos.keys()];
    const base = await baseDosClientesDoSaldo(sessao.lojaId, finais);
    const clientes = finais.map((final) => {
      const g = grupos.get(final)!;
      const b = base.get(final);
      return {
        // O telefone da base é DDD + número; o do grupo pode ser só o final (quem só tem indicação).
        telefone: b?.telefone || g.telefone,
        nome: b?.nome || g.nome,
        pedidos: b?.pedidos ?? 0,
        ultimo: b?.ultimo ?? null,
        ...cashbackNoPainel(regra, g, janela, agora),
      };
    });
    clientes.sort((a, b) => b.saldo - a.saldo || (b.ultimo || "").localeCompare(a.ultimo || ""));

    if (csv) {
      const dia = (iso: string | null | undefined) => dataNaLoja(iso, sessao.fuso);
      const linhas = [
        [
          "Nome", "Telefone", "Saldo (R$)", "Vence em 7 dias (R$)", "Vence em 30 dias (R$)", "Próximo vencimento", "Valor que vence (R$)",
          "Gerado no período (R$)", "Usado no período (R$)", "Gerado desde o início (R$)", "Usado desde o início (R$)", "Vencido (R$)",
          "A receber (R$)", "Pedidos", "Último pedido",
        ].join(";"),
        ...clientes.map((c) =>
          [
            c.nome, c.telefone, reais(c.saldo), reais(c.vence7), reais(c.vence30), dia(c.proximoVencimento?.em), c.proximoVencimento ? reais(c.proximoVencimento.valor) : "",
            reais(c.geradoNoPeriodo), reais(c.usadoNoPeriodo), reais(c.gerado), reais(c.usado), reais(c.vencido),
            reais(c.aReceber), c.pedidos, dia(c.ultimo),
          ].map(celula).join(";"),
        ),
      ];
      return new NextResponse("﻿" + linhas.join("\r\n"), {
        headers: {
          ...semCache,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="cashback-${dataDaLoja(sessao.fuso || "America/Sao_Paulo", agora)}.csv"`,
        },
      });
    }

    return NextResponse.json(
      {
        periodo: { de: ctx.valor.filtros.de, ate: ctx.valor.filtros.ate },
        hoje: ctx.valor.hoje,
        fuso: sessao.fuso,
        regra: { ativo: regra.ativo, taxa: regra.taxa, validadeDias: regra.validadeDias, maxResgatePct: regra.maxResgatePct, canais: regra.canais },
        loja: { nome: loja?.storeName || loja?.name || "", link: loja ? linkDoCardapioDaLoja(loja) : "" },
        resumo: resumoDoPainel(clientes),
        comparativo: comparativoDoCashback(pedidosDoPeriodo),
        clientes,
      },
      { headers: semCache },
    );
  } catch (err: any) {
    console.error("[cashback] painel falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível carregar o cashback agora." }, { status: 500 });
  }
}
