/**
 * GET /api/integracoes/evopdv/notas/{vendaId}/danfe?formato=html|texto&largura=80|58&via=consumidor|estabelecimento
 *   (Authorization: Bearer <chave da loja>)
 *
 * O DANFE NFC-e montado do XML do cofre, sem marca nem endereço do FireHub (a
 * consulta é pelo link da SEFAZ). `html`: a página pronta para imprimir;
 * `texto`: as linhas da bobina com o lugar do QR (lib/evopdv/notas → danfeDaVenda).
 */
import { danfeDaVenda } from "@/lib/evopdv/notas";
import { comConta } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await params;
  return comConta(req, "danfe", (conta) => danfeDaVenda(conta, decodeURIComponent(vendaId), new URL(req.url).searchParams));
}
