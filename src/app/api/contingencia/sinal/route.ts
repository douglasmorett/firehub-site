/**
 * GET /api/contingencia/sinal — "a nuvem está de pé?" (Modo Contingência).
 *
 * O computador da loja pergunta a cada poucos segundos, e a tela que está no
 * computador da loja durante uma queda pergunta para saber quando voltar.
 * Leve de propósito (o /api/health faz checagens que levam segundos): só
 * confere que o banco responde. CORS aberto: quem pergunta é uma página em
 * http://<ip-do-computador>, que não é este domínio.
 *
 * Com `?loja=<id>` (a tela na nuvem, a cada 5 s), diz também se o computador
 * da loja está vivo — o supervisor falou com a nuvem há pouco, com a cópia
 * pronta e sem avisar que está parando. A tela só pula para ele numa queda se
 * ele estava vivo (lib/contingencia/troca.ts → computadorRecebeTelas). Uma
 * consulta só, para todas as lojas, a cada 10 s.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computadorRecebeTelas } from "@/lib/contingencia/troca";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "no-store",
};

type Contato = { vistoEm: number; copiaPronta: string | null; modo: string | null; parando: string | null };
let contatos: { lidoEm: number; porLoja: Map<string, Contato> } | null = null;

async function pcVivo(lojaId: string): Promise<boolean> {
  if (!contatos || Date.now() - contatos.lidoEm > 10_000) {
    const porLoja = new Map<string, Contato>();
    try {
      // copiaPronta, e não pronta: pronta é sempre false em modo normal.
      const linhas = await prisma.$queryRawUnsafe<{ lojaId: string; ultimoContato: Date; copiaPronta: string | null; modo: string | null; parando: string | null }[]>(
        `SELECT "lojaId", "ultimoContato", "relato"->>'copiaPronta' AS "copiaPronta", "relato"->>'modo' AS "modo", "relato"->>'parando' AS "parando"
           FROM "Contingencia" WHERE "ultimoContato" > now() - interval '5 minutes'`,
      );
      for (const l of linhas) porLoja.set(l.lojaId, { vistoEm: new Date(l.ultimoContato).getTime(), copiaPronta: l.copiaPronta, modo: l.modo, parando: l.parando });
    } catch {
      /* sem a tabela: ninguém vivo */
    }
    contatos = { lidoEm: Date.now(), porLoja };
  }
  const visto = contatos.porLoja.get(lojaId);
  return !!visto && computadorRecebeTelas(visto.vistoEm, visto);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, falha) => setTimeout(() => falha(new Error("banco demorou")), 4000)),
    ]);
    const loja = req.nextUrl.searchParams.get("loja");
    const pc = loja ? await pcVivo(loja) : undefined;
    return NextResponse.json({ ok: true, em: new Date().toISOString(), pc }, { headers: CORS });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: CORS });
  }
}
