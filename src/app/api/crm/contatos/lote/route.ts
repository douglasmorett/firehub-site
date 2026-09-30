import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { atribuirVendedor, mudarEtapa } from "@/lib/crm/contatos";
import { etapaValida } from "@/lib/crm/etapas";
import { avisarVendedor } from "@/lib/atendimento/avisos";

export const dynamic = "force-dynamic";

/**
 * POST { ids, vendedorId?, etapa? }: distribuir vários contatos de uma vez
 * (admin). O vendedor recebe UM aviso com a quantidade, não um por contato.
 */
export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
  if (ids.length === 0) return NextResponse.json({ error: "Nenhum contato escolhido." }, { status: 400 });
  const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;

  let mudados = 0;
  const erros: string[] = [];
  if ("vendedorId" in b) {
    const vendedorId = typeof b.vendedorId === "string" && b.vendedorId ? b.vendedorId : null;
    for (const id of ids) {
      try {
        const antes = await prisma.crmContato.findUnique({ where: { id }, select: { vendedorId: true } });
        if (!antes || antes.vendedorId === vendedorId) continue;
        await atribuirVendedor(id, vendedorId, autor);
        mudados++;
      } catch (err: any) {
        erros.push(err?.message || "erro");
      }
    }
    if (vendedorId && mudados > 0) {
      void avisarVendedor(vendedorId, `🎯 ${mudados === 1 ? "Novo contato" : `${mudados} contatos novos`} na sua carteira.\nVeja em https://firehubfood.com.br/vendedor?aba=contatos`).catch(() => null);
    }
  }
  if ("etapa" in b) {
    const etapa = etapaValida(b.etapa);
    if (!etapa) return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });
    for (const id of ids) {
      try {
        await mudarEtapa(id, etapa, autor, typeof b.motivoPerda === "string" ? b.motivoPerda : null);
        mudados++;
      } catch (err: any) {
        erros.push(err?.message || "erro");
      }
    }
  }
  return NextResponse.json({ ok: erros.length === 0, mudados, erros: [...new Set(erros)].slice(0, 5) });
}
