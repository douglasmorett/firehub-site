/**
 * POST /api/contingencia/relato — o computador da loja conta como está
 * (Modo Contingência): modo (normal/contingência), quando a cópia foi
 * atualizada, o que falta subir, versão, IPs e porta na rede da loja.
 *
 * A tela do módulo mostra isto ao vivo, e o bilhete das telas leva o
 * endereço do computador (lib/contingencia/chave.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDaChave } from "@/lib/contingencia/servidor";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const texto = JSON.stringify(corpo ?? {});
  if (texto.length > 8000) return NextResponse.json({ error: "Relato grande demais" }, { status: 413 });
  await prisma.$executeRawUnsafe(
    `UPDATE "Contingencia" SET "ultimoContato" = now(), "relato" = $2::jsonb WHERE "lojaId" = $1`,
    loja.lojaId,
    texto,
  );
  return NextResponse.json({ ok: true, agora: new Date().toISOString() });
}
