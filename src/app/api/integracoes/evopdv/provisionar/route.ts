/**
 * POST /api/integracoes/evopdv/provisionar  (Authorization: Bearer <EVOPDV_PROVISIONAMENTO_SEGREDO>)
 *   { cnpj, razaoSocial, nomeFantasia?, inscricaoEstadual, regimeTributario, logradouro, numero,
 *     complemento?, bairro, municipio, codigoMunicipio, uf, cep, telefone?, email?, serie?, numeroInicial? }
 *
 * Servidor-a-servidor: a Vercel do EvoPDV cria (ou acha) a conta fiscal do
 * CNPJ e recebe a chave Bearer da loja (lib/evopdv/conta). Não passa pelo
 * /api/register: nada de e-mail, CRM ou Meta. 201 criada, 200 já existia
 * (chave trocada).
 */
import { NextResponse } from "next/server";
import { provisionarConta, segredoDoProvisionamento } from "@/lib/evopdv/conta";
import { garantirEstruturaDoEvopdv } from "@/lib/evopdv/estrutura-no-banco";
import { corpoJson, responder, traduzirErro } from "@/lib/evopdv/rota";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const segredo = segredoDoProvisionamento(req.headers.get("authorization"));
  if (segredo === "sem_segredo") {
    console.error("[EvoPDV provisionar] EVOPDV_PROVISIONAMENTO_SEGREDO ausente ou curto (mínimo 32): provisionamento desligado.");
    return NextResponse.json({ error: "provisionamento_desligado" }, { status: 503 });
  }
  if (segredo !== "ok") return NextResponse.json({ error: "segredo_invalido" }, { status: 401 });
  try {
    await garantirEstruturaDoEvopdv();
    return await responder(await provisionarConta(await corpoJson(req)));
  } catch (e: any) {
    return traduzirErro("provisionar", e);
  }
}
