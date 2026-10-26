/**
 * POST /api/integracoes/evopdv/notas  (Authorization: Bearer <chave da loja>)
 *   a venda (lib/evopdv/venda → conferirVenda): emite a NFC-e, idempotente por `vendaId`.
 * GET  /api/integracoes/evopdv/notas?desde=&ate=&situacao=&limite=&antesDe=
 *   as notas da loja, a mais recente primeiro.
 *
 * Ver lib/evopdv/notas.
 */
import { emitirNotaDaVenda, listarNotas } from "@/lib/evopdv/notas";
import { comConta, corpoJson } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return comConta(req, "emitir", async (conta) => emitirNotaDaVenda(conta, await corpoJson(req)));
}

export async function GET(req: Request) {
  return comConta(req, "listar", (conta) => listarNotas(conta, new URL(req.url).searchParams));
}
