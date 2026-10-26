/**
 * GET /api/integracoes/evopdv/notas/{vendaId}[?consultar=1]  (Authorization: Bearer <chave da loja>)
 *
 * A nota da venda. `consultar=1` pergunta à SEFAZ agora (processando,
 * contingência ou autorizada), no ritmo que ela tolera — sem ele, o estado
 * gravado (o cron acompanha a cada 2 minutos).
 */
import { consultarNotaDaVenda } from "@/lib/evopdv/notas";
import { comConta } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await params;
  const consultar = new URL(req.url).searchParams.get("consultar") === "1";
  return comConta(req, "consultar", (conta) => consultarNotaDaVenda(conta, decodeURIComponent(vendaId), { consultar }));
}
