import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { regimeNumerico } from "@/lib/fiscal-config";
import { montarPlanilha, respostaDePlanilha, type Celula, type LinhaDaPlanilha } from "@/lib/planilha-xlsx";
import {
  cestComPontos,
  FONTES,
  ncmComPontos,
  ncmSugeridoEmTexto,
  sugerirParaCardapio,
  type IdDaFonte,
} from "@/lib/nfce/ncm-sugerido";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/fiscal/products/planilha — "Baixar planilha para o contador".
 *
 * Um .xlsx com cada produto ativo: categoria, preço, o que está GRAVADO (NCM,
 * CEST, CFOP, CSOSN) e a SUGESTÃO do NCM assistido (lib/nfce/ncm-sugerido),
 * com a pergunta quando há dois códigos possíveis e a fonte de cada regra. É
 * o que o contador precisa para revisar a classificação de uma vez, em vez de
 * produto a produto na tela. Só leitura.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const [produtos, loja] = await Promise.all([
      prisma.menuProduct.findMany({
        where: { franchiseeId: lojaId, active: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: { id: true, name: true, category: true, price: true, isBeverage: true, apenasEmCombo: true, ncm: true, cest: true, cfop: true, csosn: true },
      }),
      prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, fiscalConfig: true } }),
    ]);
    const fc = (loja?.fiscalConfig && typeof loja.fiscalConfig === "object" ? loja.fiscalConfig : {}) as Record<string, any>;
    const regime = regimeNumerico(fc.regimeTributario) ?? 1;
    const uf = typeof fc.uf === "string" ? fc.uf.toUpperCase() : "";
    const marcas = fc.ncmAssistido && typeof fc.ncmAssistido === "object" ? (fc.ncmAssistido as Record<string, { ncm?: string }>) : {};

    const sugestoes = sugerirParaCardapio(
      produtos.map((p) => ({ id: p.id, nome: p.name, categoria: p.category, preco: p.price, ehBebida: p.isBeverage, apenasEmCombo: p.apenasEmCombo })),
      { regime, uf }
    );
    const porId = new Map(sugestoes.map((s) => [s.produtoId, s]));

    const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const regimeEmTexto = regime === 4 ? "MEI (CRT 4)" : regime === 2 ? "Simples — excesso de sublimite (CRT 2)" : regime === 3 ? "Regime Normal (CRT 3)" : "Simples Nacional (CRT 1)";
    const cabecalho = [
      "Categoria", "Produto", "Preço", "NCM gravado", "CEST gravado", "CFOP gravado", "CSOSN gravado",
      "NCM sugerido", "Pergunta (quando há 2 NCMs)", "CEST sugerido", "CFOP sugerido", "CSOSN sugerido",
      "Substituição tributária", "Confiança", "Situação", "Regra", "Observações",
    ];
    const linhas: Array<LinhaDaPlanilha | Celula[]> = [
      { celulas: [{ v: "NCM, CEST, CFOP e CSOSN — sugestão para revisar com o contador", estilo: "titulo" }] },
      { celulas: [`${loja?.storeName || ""} · CNPJ ${String(fc.cnpj ?? "") || "—"} · ${regimeEmTexto} · UF ${uf || "—"} · gerada em ${hoje}`], estilo: "suave" },
      {
        celulas: [
          "A sugestão sai das palavras do nome e da categoria de cada produto (FireHub, NCM assistido). A classificação fiscal é responsabilidade da empresa: confira cada linha, principalmente as de confiança baixa e as que têm pergunta. As fontes de cada regra estão na aba \"Fontes\".",
        ],
        estilo: "suave",
      },
      { celulas: [] },
      { celulas: cabecalho, estilo: "cabecalho" },
    ];
    for (const p of produtos) {
      const s = porId.get(p.id);
      const ncmGravado = String(p.ncm ?? "").replace(/\D/g, "");
      const marca = marcas[p.id];
      const situacao = ncmGravado.length !== 8
        ? "sem NCM"
        : marca && String(marca.ncm ?? "") === ncmGravado
          ? "sugestão aplicada — revisar"
          : "gravado";
      const cests = s ? [...new Set(s.opcoes.map((o) => (o.cest ? cestComPontos(o.cest) : "—")))].join(" ou ") : "";
      linhas.push([
        p.category,
        p.name,
        { v: p.price, estilo: "reais" },
        ncmGravado ? ncmComPontos(ncmGravado) : "",
        p.cest ? cestComPontos(p.cest) : "",
        p.cfop ?? "",
        p.csosn ?? "",
        s && s.opcoes.length > 0 ? ncmSugeridoEmTexto(s) : "sem sugestão",
        s?.pergunta ? `${s.pergunta.texto} (${s.opcoes.map((o) => `${o.rotulo}: ${ncmComPontos(o.ncm)}`).join(" | ")})` : "",
        cests,
        s?.cfop ?? "",
        s?.csosn ?? (s?.regra ? "CST (defina com o contador)" : ""),
        s?.regra ? (s.substituicao === "sim" ? `sim (${uf})` : s.substituicao === "provavel" ? "provável — confira a nota de compra" : "não") : "",
        s?.regra ? s.confianca : "",
        situacao,
        s?.regra ?? "",
        (s?.avisos ?? []).join(" "),
      ]);
    }

    const usadas = new Set<IdDaFonte>();
    for (const s of sugestoes) {
      for (const f of s.fontes) usadas.add(f);
      for (const o of s.opcoes) for (const f of o.fontes) usadas.add(f);
    }
    const fontes: Array<LinhaDaPlanilha | Celula[]> = [
      { celulas: [{ v: "Fontes das regras do NCM assistido", estilo: "titulo" }] },
      { celulas: ["Fonte", "Onde conferir"], estilo: "cabecalho" },
      ...[...usadas].map((id) => {
        const f = FONTES[id] as { titulo: string; url?: string };
        return [f.titulo, f.url ?? ""] as Celula[];
      }),
    ];

    const buffer = montarPlanilha([
      {
        nome: "Produtos",
        linhas,
        larguras: [26, 36, 10, 12, 12, 10, 10, 22, 60, 16, 10, 12, 22, 10, 22, 18, 80],
        congelarLinhas: 5,
      },
      { nome: "Fontes", linhas: fontes, larguras: [120, 60] },
    ]);
    const nome = String(loja?.storeName || "loja").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const data = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    return respostaDePlanilha(buffer, `ncm-para-o-contador-${nome}-${data}.xlsx`);
  } catch (err: any) {
    console.error("[Fiscal Planilha NCM]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
