/**
 * GET /api/integracoes/evopdv/status  (Authorization: Bearer <chave da loja>)
 *
 * A situação da conta fiscal: dados da empresa, ambiente, série, certificado,
 * CSC, pendências para emitir, último teste da SEFAZ, bloqueio 656 e a
 * assinatura fiscal. Não fala com a SEFAZ (lib/evopdv/conta → statusDaConta).
 */
import { statusDaConta } from "@/lib/evopdv/conta";
import { comConta } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return comConta(req, "status", (conta) => statusDaConta(conta));
}
