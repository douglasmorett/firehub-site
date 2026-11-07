/**
 * GET /api/store/clientes?q=&filtro=&ordem=&pagina=      → { clientes, total, resumo, cashback, fuso, visao }
 * GET /api/store/clientes?formato=csv&q=&filtro=&ordem=  → planilha com a lista inteira
 *
 * A aba Clientes do painel: a base da loja (pedidos + cadastros trazidos de
 * outro sistema + quem tem lançamento de saldo), com o saldo de cashback de
 * cada um. A junção mora em lib/clientes-da-loja.ts.
 *
 * As datas e o nome do arquivo saem no relógio da LOJA (lib/clientes-da-loja-regras.ts):
 * o nome do arquivo usava a data UTC e virava o dia seguinte depois das 21h.
 */
import { NextResponse } from "next/server";
import { lerCashback } from "@/lib/cashback";
import {
  listarClientes,
  sessaoDosClientes,
  visaoDasLojas,
  type FiltroDeClientes,
  type OrdemDeClientes,
} from "@/lib/clientes-da-loja";
import { dataNaLoja, nomeDoArquivoDeClientes } from "@/lib/clientes-da-loja-regras";
import { COOKIE_DA_LOJA_ATIVA } from "@/lib/loja-ativa";
import { prisma } from "@/lib/prisma";
import { dataDaLoja } from "@/lib/fuso";
import { cupomVenceu, descreverBeneficio, lerCupons } from "@/lib/cupons";
import { linkDoCardapioDaLoja } from "@/lib/saudacao-do-dia";

export const dynamic = "force-dynamic";

const semCache = { "Cache-Control": "no-store" };

const celula = (v: unknown) => {
  let s = String(v ?? "");
  // O nome vem do cliente: "=HYPERLINK(...)" viraria fórmula no Excel. Começo de
  // fórmula ganha apóstrofo — menos número/telefone puro ("-5,00", "+55 22 ...").
  if (/^[=+\-@\t\r]/.test(s) && !/^[\d\s()+\-.,]*$/.test(s)) s = `'${s}`;
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const reais = (n: number) => n.toFixed(2).replace(".", ",");

/** O valor de um cookie no cabeçalho da requisição. */
function cookie(req: Request, nome: string): string | null {
  for (const parte of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nome) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * O que o parabéns pelo WhatsApp usa (lib/clientes-da-loja-regras.ts,
 * mensagemDeAniversario): o nome da loja, o link do cardápio e os cupons
 * ativos e dentro da validade — o de primeiro pedido fica fora (o aniversariante
 * já é cliente e o site recusaria).
 */
async function presenteDeAniversario(lojaId: string, fuso: string | undefined) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, name: true, slug: true, chatbotConfig: true, storeCoupons: true },
  });
  const hoje = dataDaLoja(fuso);
  return {
    loja: loja?.storeName?.trim() || loja?.name?.trim() || "a loja",
    link: loja ? linkDoCardapioDaLoja(loja) || null : null,
    cupons: lerCupons(loja?.storeCoupons)
      .filter((c) => c.active && !c.primeiroPedido && !cupomVenceu(c, hoje))
      .map((c) => ({ codigo: c.code, beneficio: descreverBeneficio(c) })),
  };
}

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
      const dia = (iso: string | null) => dataNaLoja(iso, sessao.fuso);
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
          "Content-Disposition": `attachment; filename="${nomeDoArquivoDeClientes(new Date(), sessao.fuso)}"`,
        },
      });
    }

    const regra = lerCashback(sessao.storeLoyalty);
    const visao = await visaoDasLojas(sessao, cookie(req, COOKIE_DA_LOJA_ATIVA));
    // Filtro de aniversário: o que o botão de parabéns precisa para montar o
    // texto (o nome da loja, o link do cardápio e os cupons que valem hoje).
    const filtro = p.get("filtro") || "";
    const presente = filtro === "aniversario_mes" || filtro === "aniversario_semana" ? await presenteDeAniversario(sessao.lojaId, sessao.fuso) : null;
    return NextResponse.json(
      {
        clientes,
        total,
        porPagina: 50,
        resumo,
        cashback: { ativo: regra.ativo, taxa: regra.taxa, validadeDias: regra.validadeDias, maxResgatePct: regra.maxResgatePct, canais: regra.canais },
        fuso: sessao.fuso,
        visao,
        ...(presente ? { presente } : {}),
      },
      { headers: semCache },
    );
  } catch (err: any) {
    console.error("[clientes] lista falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível carregar os clientes agora." }, { status: 500 });
  }
}
