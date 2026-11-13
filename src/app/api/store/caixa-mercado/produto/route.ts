/**
 * PUT { produtoId, unidade, eans, plu, ncmConferido? } — unidade e códigos de um
 * produto (a conferência do cadastro na tela de importação). EAN com dígito
 * errado é recusado.
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { salvarCodigosDoProduto } from "@/lib/caixa-mercado/importar";
import { eanValido } from "@/lib/caixa-mercado/etiqueta";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const corpo: any = await req.json().catch(() => ({}));
  const eans = (Array.isArray(corpo?.eans) ? corpo.eans : []).map((e: unknown) => String(e ?? "").replace(/\D/g, "")).filter(Boolean);
  const errado = eans.find((e: string) => e.length >= 8 && !eanValido(e));
  if (errado) return NextResponse.json({ error: `O código ${errado} tem o dígito verificador errado.` }, { status: 400 });
  const plu = String(corpo?.plu ?? "").replace(/\D/g, "");
  try {
    await salvarCodigosDoProduto(ctx.quem.lojaId, String(corpo?.produtoId || ""), {
      unidade: corpo?.unidade === "KG" ? "KG" : "UN",
      eans,
      plu: plu ? String(Number(plu)) : null,
      ncmConferido: corpo?.ncmConferido === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu para salvar." }, { status: 400 });
  }
}
