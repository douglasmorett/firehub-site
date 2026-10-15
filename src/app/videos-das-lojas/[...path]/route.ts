import type { NextRequest } from "next/server";
import { GET as servirUpload } from "../../uploads/[...path]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /uploads/lojas/<vídeo>.mp4|webm chega aqui pelo rewrite `beforeFiles` do
 * next.config — o mesmo caminho dos tutoriais (arquivos-dos-tutoriais).
 *
 * O volume dos uploads está montado em public/uploads, e arquivo de public/ o
 * Next serve sozinho, antes de qualquer rota: o vídeo da capa respondia 200
 * inteiro a "bytes=0-1", sem Accept-Ranges nem Content-Length, e o Safari do
 * iPhone ficava na imagem da capa. No computador e no Android tocava (visto na
 * Map Grill, 15/10/2026). Daqui a resposta é a da rota de uploads: pedaços (206).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return servirUpload(req, { params: Promise.resolve({ path: ["lojas", ...(path || [])] }) });
}
