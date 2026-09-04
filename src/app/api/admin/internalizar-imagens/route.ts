/**
 * POST /api/admin/internalizar-imagens
 *
 * Baixa para o volume da loja as fotos de produto que ainda apontam para um
 * servidor de terceiro, e troca a URL no cadastro.
 *
 * Existe por causa da regra da casa: cardápio importado de outra plataforma
 * (MenuDino, Anota AI...) não pode continuar DEPENDENDO dela. A importação do
 * Ragnar entrou com 54 fotos servidas por files.menudino.com — funcionam hoje,
 * somem no dia em que ele cancelar o plano de lá. Esta rota faz o servidor
 * baixar cada uma para o próprio volume (o mesmo de /api/upload) e apontar o
 * produto para /uploads/..., cortando o vínculo.
 *
 * Protegida como as rotas de cron (CRON_SECRET / localhost): é ferramenta de
 * operação, não tela de lojista. Idempotente — produto já em /uploads é pulado,
 * e falha numa foto não derruba as outras (o cardápio fica no pior caso igual
 * ao que era: apontando para fora).
 *
 * Corpo opcional: { "franchiseeId": "..." } para limitar a uma loja;
 *                 { "dominio": "menudino" } para trocar o padrão de origem.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { saveUploadedFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 54 fotos a ~1s cada cabem com folga

export async function POST(req: NextRequest) {
  return internalizar(req);
}

// GET com os padrões: é o que o cron-runner (que só fala GET, de dentro do
// container, com o CRON_SECRET do ambiente) chama a cada 6 horas. Idempotente:
// sem foto apontando para fora, é uma consulta barata e nada mais. Assim a
// regra "cardápio importado não depende da plataforma de origem" vale para
// TODA importação futura, não só a de hoje.
export async function GET(req: NextRequest) {
  return internalizar(req);
}

async function internalizar(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dominio = String((body as any)?.dominio || "menudino");
  const franchiseeId = (body as any)?.franchiseeId ? String((body as any).franchiseeId) : null;

  const produtos = await prisma.menuProduct.findMany({
    where: {
      imageUrl: { contains: dominio },
      ...(franchiseeId ? { franchiseeId } : {}),
    },
    select: { id: true, name: true, imageUrl: true },
  });

  let trocadas = 0;
  const falhas: string[] = [];

  for (const p of produtos) {
    try {
      const res = await fetch(p.imageUrl as string);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bruto = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/webp";
      // File nativo do Node 18+: é o que saveUploadedFile espera receber.
      const arquivo = new File([bruto], `${p.id}.webp`, { type: mime });
      const salvo = await saveUploadedFile(arquivo, "produtos");
      await prisma.menuProduct.update({
        where: { id: p.id },
        data: { imageUrl: salvo.url },
      });
      trocadas++;
    } catch (e: any) {
      falhas.push(`${p.name}: ${e?.message}`);
    }
  }

  console.log(
    `[internalizar-imagens] ${trocadas}/${produtos.length} foto(s) internalizada(s)` +
    (falhas.length ? `; falhas: ${falhas.length}` : "")
  );
  return NextResponse.json({ total: produtos.length, trocadas, falhas });
}
