/**
 * POST /api/integracoes/evopdv/notas/{vendaId}/cancelar  (Authorization: Bearer <chave da loja>)
 *   { justificativa }  (15 a 255 caracteres)
 *
 * Cancela na SEFAZ (evento 110111) a nota autorizada da venda, em até 30
 * minutos da autorização (lib/evopdv/notas → cancelarNotaDaVenda). Funciona
 * com a assinatura fiscal inativa.
 */
import { cancelarNotaDaVenda } from "@/lib/evopdv/notas";
import { comConta, corpoJson } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await params;
  return comConta(req, "cancelar", async (conta) => cancelarNotaDaVenda(conta, decodeURIComponent(vendaId), await corpoJson(req)));
}
