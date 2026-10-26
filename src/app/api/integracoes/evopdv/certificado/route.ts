/**
 * POST /api/integracoes/evopdv/certificado  (Authorization: Bearer <chave da loja>)
 *   { certificadoBase64, senha }
 *
 * O A1 (.pfx) da empresa, conferido como na tela fiscal (senha, validade,
 * e-CNPJ da mesma empresa — lib/nfce/envio-do-certificado), cifrado no cofre;
 * a senha vai cifrada. Nada do que chegou volta na resposta nem no log.
 */
import { NextResponse } from "next/server";
import { guardarCertificadoDaConta } from "@/lib/evopdv/conta";
import { comConta } from "@/lib/evopdv/rota";
import { TAMANHO_MAXIMO_DO_PFX } from "@/lib/nfce/envio-do-certificado";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Base64 cresce ~4/3: 4x o limite do arquivo é teto folgado para o corpo.
  if (Number(req.headers.get("content-length") || 0) > TAMANHO_MAXIMO_DO_PFX * 4) {
    return NextResponse.json({ error: "grande_demais", mensagem: "Um certificado A1 tem poucos KB (limite 50 KB)." }, { status: 413 });
  }
  return comConta(req, "certificado", async (conta) => guardarCertificadoDaConta(conta, await req.json().catch(() => null)));
}
