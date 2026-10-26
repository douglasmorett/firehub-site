/**
 * GET /api/integracoes/evopdv/notas/{vendaId}/xml[?evento=cancelamento]  (Authorization: Bearer <chave da loja>)
 *
 * O XML guardado no cofre: o nfeProc autorizado (a NFe assinada, na
 * contingência ainda não transmitida) ou, com `evento=cancelamento`, o
 * procEventoNFe do cancelamento. O EvoPDV guarda uma cópia local.
 */
import { xmlDaVenda } from "@/lib/evopdv/notas";
import { comConta } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await params;
  return comConta(req, "xml", (conta) => xmlDaVenda(conta, decodeURIComponent(vendaId), new URL(req.url).searchParams));
}
