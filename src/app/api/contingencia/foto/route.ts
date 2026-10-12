/**
 * GET /api/contingencia/foto — a foto inicial da loja, tabela por tabela
 * (Modo Contingência, lib/contingencia/catalogo.ts).
 *
 *   sem `tabela`   → { cursor, tabelas }: o número do diário de AGORA (a cópia
 *                    continua dele depois da foto) e a lista do que copiar.
 *   ?tabela=X      → { linhas, proximo }: uma página; `&depoisDe=` pega a seguinte.
 *
 * O cursor vem ANTES das linhas: o que mudar durante a foto aparece de novo
 * no diário e é regravado — gravar duas vezes a mesma linha não estraga nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { TABELAS_DA_COPIA, tabelaDaCopia } from "@/lib/contingencia/catalogo";
import { lojaDaChave, paginaDaFoto, ultimaMudanca } from "@/lib/contingencia/servidor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const nome = req.nextUrl.searchParams.get("tabela");
  if (!nome) {
    return NextResponse.json({
      cursor: await ultimaMudanca(loja.lojaId),
      tabelas: TABELAS_DA_COPIA.map((t) => ({ nome: t.nome, chave: t.chave, soPorFoto: !!t.soPorFoto })),
    });
  }
  const t = tabelaDaCopia(nome);
  if (!t) return NextResponse.json({ error: "Tabela fora da cópia" }, { status: 400 });
  const depoisDe = req.nextUrl.searchParams.get("depoisDe");
  return NextResponse.json(await paginaDaFoto(t, loja.lojaId, depoisDe, 1000));
}
