/**
 * GET /api/store/clientes?q=&filtro=&ordem=&pagina=      → { clientes, total, resumo, cashback }
 * GET /api/store/clientes?formato=csv&q=&filtro=&ordem=  → planilha com a lista inteira
 *
 * A aba Clientes do painel: a base da loja (pedidos + cadastros trazidos de
 * outro sistema + quem tem lançamento de saldo), com o saldo de cashback de
 * cada um. A junção mora em lib/clientes-da-loja.ts.
 */
import { NextResponse } from "next/server";
import { lerCashback } from "@/lib/cashback";
import {
  listarClientes,
  sessaoDosClientes,
  type FiltroDeClientes,
  type OrdemDeClientes,
} from "@/lib/clientes-da-loja";

export const dynamic = "force-dynamic";

const semCache = { "Cache-Control": "no-store" };

const celula = (v: unknown) => {
  const s = String(v ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const reais = (n: number) => n.toFixed(2).replace(".", ",");
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

export async function GET(req: Request) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const p = new URL(req.url).searchParams;
  const csv = p.get("formato") === "csv";
  try {
    const { clientes, total, resumo } = await listarClientes(sessao, {
      q: p.get("q"),
      filtro: (p.get("filtro") || "todos") as FiltroDeClientes,
      ordem: (p.get("ordem") || "recentes") as OrdemDeClientes,
      pagina: csv ? 1 : Number(p.get("pagina")) || 1,
      porPagina: csv ? 50_000 : 50,
    });

    if (csv) {
      const linhas = [
        ["Nome", "Telefone", "Pedidos", "Gasto (R$)", "Último pedido", "Primeiro pedido", "Saldo de cashback (R$)", "Veio de outro sistema"].join(";"),
        ...clientes.map((c) =>
          [c.nome, c.telefone, c.pedidos, reais(c.gasto), dia(c.ultimo), dia(c.primeiro), reais(c.saldo), c.importado ? "sim" : ""]
            .map(celula)
            .join(";"),
        ),
      ];
      // BOM para o Excel abrir com acento.
      return new NextResponse("﻿" + linhas.join("\r\n"), {
        headers: {
          ...semCache,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="clientes-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const regra = lerCashback(sessao.storeLoyalty);
    return NextResponse.json(
      {
        clientes,
        total,
        porPagina: 50,
        resumo,
        cashback: { ativo: regra.ativo, taxa: regra.taxa, validadeDias: regra.validadeDias, maxResgatePct: regra.maxResgatePct },
      },
      { headers: semCache },
    );
  } catch (err: any) {
    console.error("[clientes] lista falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível carregar os clientes agora." }, { status: 500 });
  }
}
