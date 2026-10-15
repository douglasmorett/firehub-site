import type { NextRequest } from "next/server";
import { GET as servirUpload } from "../../uploads/[...path]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /uploads/tutoriais/* chega aqui pelo rewrite `beforeFiles` do next.config.
 *
 * O volume dos uploads está montado em public/uploads, e arquivo de public/ o
 * Next serve sozinho, ANTES de qualquer rota: os tutoriais saíam sem
 * Access-Control-Allow-Origin e sem Range (sempre 200 inteiro). Com o
 * `crossOrigin` do <video>, o app do FireCheck (capacitor://localhost) recusava
 * o vídeo, e o Safari do iPhone não toca vídeo sem 206 — "Não foi possível
 * carregar o vídeo agora" (visto no app do iPhone, 14/10/2026). Daqui a
 * resposta é a da rota de uploads: pedaços (206) e os cabeçalhos de qualquer site.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return servirUpload(req, { params: Promise.resolve({ path: ["tutoriais", ...(path || [])] }) });
}
