/**
 * POST /api/contingencia/relato — o computador da loja conta como está
 * (Modo Contingência): modo (normal/contingência), quando a cópia foi
 * atualizada, o que falta subir, versão, IPs e porta na rede da loja.
 *
 * A tela do módulo mostra isto ao vivo, e o bilhete das telas leva o
 * endereço do computador (lib/contingencia/chave.ts).
 *
 * A nuvem acrescenta o IP PÚBLICO de quem relatou (`ipPublico`, pela regra de
 * lib/ip-do-cloudflare.ts) e preserva as `abas` (os IPs das telas do painel,
 * gravados pelo /api/contingencia/bilhete): a tela do módulo compara os dois e
 * avisa quando o computador da contingência não está na internet da loja
 * (lib/contingencia/rede-da-loja.ts — 14/10/2026, o PC de casa do Douglas).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const relato: Record<string, unknown> = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? { ...corpo } : {};
  // Quem relata não escolhe o próprio IP nem as telas: isso é a nuvem que vê.
  delete relato.abas;
  const ip = getClientIp(req);
  relato.ipPublico = ip && ip !== "unknown" ? ip : null;
  const texto = JSON.stringify(relato);
  if (texto.length > 8000) return NextResponse.json({ error: "Relato grande demais" }, { status: 413 });
  await prisma.$executeRawUnsafe(
    `UPDATE "Contingencia" SET "ultimoContato" = now(),
        "relato" = $2::jsonb || jsonb_build_object('abas', COALESCE("relato"->'abas', '{}'::jsonb))
      WHERE "lojaId" = $1`,
    loja.lojaId,
    texto,
  );
  return NextResponse.json({ ok: true, agora: new Date().toISOString() });
}
