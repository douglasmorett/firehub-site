/**
 * POST /api/integracoes/evopdv/testar-sefaz  (Authorization: Bearer <chave da loja>)
 *   { ambiente?: "homologacao" | "producao" }
 *
 * O status do serviço da SEFAZ com o A1 da loja no TLS — prova, antes da
 * primeira venda, que o certificado abre e a SEFAZ responde
 * (lib/nfce/emissao-da-loja → testarConexaoDaLoja). Com a loja bloqueada
 * (656), não chama.
 */
import { testarSefazDaConta } from "@/lib/evopdv/notas";
import { comConta, corpoJson } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return comConta(req, "testar-sefaz", async (conta) => testarSefazDaConta(conta, await corpoJson(req)));
}
