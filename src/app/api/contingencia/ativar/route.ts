/**
 * POST /api/contingencia/ativar — liga o Modo Contingência da loja NESTE
 * computador. DELETE — desliga.
 *
 * A tela do módulo chama isto e entrega a resposta ao Assistente do computador
 * do caixa (POST http://127.0.0.1:7899/contingencia/parear). Ativar de novo
 * troca a chave: o computador anterior deixa de copiar — uma loja, um
 * computador da contingência.
 *
 * A chave volta UMA vez, aqui; a nuvem guarda só o hash (lib/contingencia/chave.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { quemPede } from "@/lib/contingencia/sessao";
import { hashDaChave, novaChave } from "@/lib/contingencia/chave";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!quem.dono && !quem.suporte) {
    return NextResponse.json({ error: "Só o dono da loja ativa o Modo Contingência." }, { status: 403 });
  }
  const chave = novaChave();
  const segredoDoBilhete = crypto.randomBytes(32).toString("base64url");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Contingencia" ("lojaId", "chaveHash", "segredoDoBilhete", "ativadaEm", "ativadaPor", "ultimoContato", "relato")
     VALUES ($1, $2, $3, now(), $4, NULL, NULL)
     ON CONFLICT ("lojaId") DO UPDATE SET "chaveHash" = EXCLUDED."chaveHash", "segredoDoBilhete" = EXCLUDED."segredoDoBilhete",
       "ativadaEm" = now(), "ativadaPor" = EXCLUDED."ativadaPor", "ultimoContato" = NULL, "relato" = NULL`,
    quem.lojaId,
    hashDaChave(chave),
    segredoDoBilhete,
    quem.email,
  );
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "firehubfood.com.br";
  const protocolo = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return NextResponse.json({
    lojaId: quem.lojaId,
    chave,
    segredoDoBilhete,
    nuvem: `${protocolo}://${host}`,
  });
}

export async function DELETE() {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!quem.dono && !quem.suporte) {
    return NextResponse.json({ error: "Só o dono da loja desativa o Modo Contingência." }, { status: 403 });
  }
  await prisma.$executeRawUnsafe(`DELETE FROM "Contingencia" WHERE "lojaId" = $1`, quem.lojaId);
  await prisma.$executeRawUnsafe(`DELETE FROM "ContingenciaMudanca" WHERE "lojaId" = $1`, quem.lojaId);
  return NextResponse.json({ ok: true });
}
