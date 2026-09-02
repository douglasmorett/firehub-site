/**
 * GET  /api/admin/migrar-blob  → ENSAIO: mostra o que sairia do Vercel Blob.
 * POST /api/admin/migrar-blob  → APLICA: grava os arquivos e troca as colunas.
 *
 * Só ADMIN. Existe porque o arquivo precisa cair no volume do Coolify montado
 * em public/uploads, e quem está com esse volume montado é o app em produção —
 * ver o cabeçalho de src/lib/migrar-blob.ts.
 *
 * Como usar, logado como admin no painel, pelo console do navegador:
 *
 *   // 1) ensaio — não altera nada
 *   await (await fetch('/api/admin/migrar-blob')).json()
 *
 *   // 2) valendo
 *   await (await fetch('/api/admin/migrar-blob', { method: 'POST' })).json()
 *
 * Terminou quando a resposta trouxer `restam: 0`. Depois disso o Blob Store da
 * Vercel pode ser apagado sem quebrar logo de loja.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { migrarImagensDoBlob } from "@/lib/migrar-blob";

export const dynamic = "force-dynamic";
// Baixar e recomprimir dezenas de imagens não cabe no limite padrão.
export const maxDuration = 300;

async function exigirAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}

export async function GET() {
  const barrado = await exigirAdmin();
  if (barrado) return barrado;

  try {
    const relatorio = await migrarImagensDoBlob(false);
    return NextResponse.json({
      ...relatorio,
      aviso: "Ensaio: nada foi gravado. Repita com POST para aplicar.",
    });
  } catch (err: any) {
    console.error("[migrar-blob] ensaio falhou:", err?.message);
    return NextResponse.json({ error: err?.message || "Erro interno" }, { status: 500 });
  }
}

export async function POST() {
  const barrado = await exigirAdmin();
  if (barrado) return barrado;

  try {
    const relatorio = await migrarImagensDoBlob(true);
    return NextResponse.json({
      ...relatorio,
      aviso:
        relatorio.restam === 0
          ? "Zerado. O Blob Store da Vercel já pode ser apagado."
          : `Ainda restam ${relatorio.restam} linhas apontando para o Blob — ver os itens com erro.`,
    });
  } catch (err: any) {
    console.error("[migrar-blob] aplicação falhou:", err?.message);
    return NextResponse.json({ error: err?.message || "Erro interno" }, { status: 500 });
  }
}
