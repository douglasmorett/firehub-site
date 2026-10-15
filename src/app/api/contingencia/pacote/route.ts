/**
 * GET /api/contingencia/pacote — a lista ASSINADA dos arquivos desta versão
 * (lib/contingencia/pacote.ts): `{ conteudo, assinatura }`. O Assistente
 * confere a assinatura sobre os bytes de `conteudo` antes de usar a lista.
 * Com a chave da loja: só computador ativado baixa o FireHub.
 *
 * `adiar` (fora da parte assinada, só um conselho): o motivo para a cópia do
 * computador da loja NÃO trocar de versão agora — a mesma regra que segura a
 * atualização do Assistente (loja no horário, pedido recente). O Assistente
 * só obedece quando o esquema do banco não mudou entre as versões (ver
 * decidirTroca em firehub-print-assistant/contingencia.js): com esquema novo a
 * cópia velha quebraria justo numa queda. Trocar a versão deixa a porta da
 * loja fechada ~20-35 s; em 14/10/2026 isso aconteceu duas vezes no jantar.
 */
import { NextRequest, NextResponse } from "next/server";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { pacoteDaVersao } from "@/lib/contingencia/pacote";
import { podeAtualizarAgora } from "@/lib/assistente-da-loja";

export const dynamic = "force-dynamic";

async function motivoParaAdiar(lojaId: string): Promise<string | null> {
  try {
    const decisao = await podeAtualizarAgora(lojaId);
    return decisao.pode ? null : decisao.motivo;
  } catch {
    // Sem saber da loja, não segura: o Assistente ainda exige a nuvem estável.
    return null;
  }
}

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const pacote = pacoteDaVersao();
  if (!pacote) return NextResponse.json({ error: "Esta versão do FireHub não tem o pacote da contingência." }, { status: 503 });
  return NextResponse.json({ ...pacote.assinado, adiar: await motivoParaAdiar(loja.lojaId) });
}
