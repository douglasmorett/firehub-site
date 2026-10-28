/**
 * O FireCheck pergunta o que está liberado para a loja ligada a ele
 * (Bearer = a chave da ligação, lib/cmv/firecheck.ts). O FireHub é a fonte
 * da verdade dos módulos no boleto (lib/firecheck-modulos/assinatura.ts):
 *
 *   GET → { ok, lojaId, loja, email, peloFirehub, checklists, ponto, bloqueada }
 *
 * `peloFirehub` falso = a loja nunca ligou módulo aqui (ligação só do
 * descarte): o FireCheck não mexe na conta. `bloqueada` = a mensalidade em
 * aberto travou a loja; o FireCheck bloqueia inteiro ("deixou de pagar
 * qualquer coisinha, bloqueia completo. Tudo junto." — Douglas, 28/10/2026).
 * Também é por aqui que o FireCheck confere a chave de uma conta nova.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDaChave } from "@/lib/cmv/firecheck";
import { estadoDoFirecheck } from "@/lib/firecheck-modulos/assinatura";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req.headers.get("authorization"));
  if (!loja) return NextResponse.json({ error: "Chave inválida." }, { status: 401 });
  const [estado, bloqueada, dono] = await Promise.all([
    estadoDoFirecheck(loja.id),
    lojaBloqueadaPorMensalidade(loja.id),
    prisma.user.findUnique({ where: { id: loja.id }, select: { email: true } }),
  ]);
  return NextResponse.json({
    ok: true,
    lojaId: loja.id,
    loja: loja.nome,
    email: dono?.email || null,
    peloFirehub: estado.peloFirehub,
    checklists: estado.modulos.checklists.ativo,
    ponto: estado.modulos.ponto.ativo,
    bloqueada,
  });
}
