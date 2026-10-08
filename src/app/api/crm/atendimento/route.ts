import { NextRequest, NextResponse } from "next/server";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { configDoAtendimento, configParaTela, salvarConfigDoAtendimento, type ConfigDoAtendimento } from "@/lib/atendimento/config";

export const dynamic = "force-dynamic";

/** GET / PUT: a configuração do atendimento do número do FireHub (admin). */
export async function GET() {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  return NextResponse.json({ config: configParaTela(await configDoAtendimento()) });
}

export async function PUT(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const mudancas: Partial<ConfigDoAtendimento> = {};
  if (typeof b.roboLigado === "boolean") mudancas.roboLigado = b.roboLigado;
  if (typeof b.roboNoPainel === "boolean") mudancas.roboNoPainel = b.roboNoPainel;
  if (typeof b.nomeDoAtendente === "string") mudancas.nomeDoAtendente = b.nomeDoAtendente;
  if (typeof b.avisarNoWhatsApp === "string") mudancas.avisarNoWhatsApp = b.avisarNoWhatsApp.replace(/[^\d+]/g, "") || null;
  if (typeof b.instrucoesExtras === "string") mudancas.instrucoesExtras = b.instrucoesExtras;
  if (typeof b.evolutionUrl === "string") mudancas.evolutionUrl = b.evolutionUrl.trim() || null;
  // A chave só é trocada quando vem preenchida (a tela nunca recebe a atual).
  if (typeof b.evolutionApiKey === "string" && b.evolutionApiKey.trim()) mudancas.evolutionApiKey = b.evolutionApiKey.trim();
  if (b.limparChaveDoGateway === true) mudancas.evolutionApiKey = null;
  // Chave própria sem URL própria não tem para onde ir: o gateway padrão só aceita a do ambiente.
  const urlFinal = "evolutionUrl" in mudancas ? mudancas.evolutionUrl : (await configDoAtendimento()).evolutionUrl;
  if (!urlFinal) mudancas.evolutionApiKey = null;
  const config = await salvarConfigDoAtendimento(mudancas);
  return NextResponse.json({ config: configParaTela(config) });
}
