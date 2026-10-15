/**
 * TEF no totem (pinpad PayGo pelo Assistente) — o painel liga e desliga por
 * licença. Ver lib/tef-do-totem.ts.
 *
 * GET    — quais licenças da loja têm TEF ligado.
 * POST   { licencaId } — liga (ou religa, trocando as credenciais). Devolve UMA
 *          vez a chave do Assistente e o segredo local; a tela entrega os dois
 *          ao Assistente DESTE computador (POST 127.0.0.1:<porta>/tef/parear),
 *          por isso ligar só faz sentido aberto no computador do totem.
 * DELETE { licencaId } — desliga: o totem volta a cobrar pela maquininha.
 *
 * Só o dono da loja (ou o suporte dentro da loja), como o Modo Contingência.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemPede } from "@/lib/contingencia/sessao";
import { desligarTef, ligarTef, tefDaLoja } from "@/lib/tef-do-totem";

export const dynamic = "force-dynamic";

async function licencaDaLoja(licencaId: unknown, lojaId: string) {
  if (typeof licencaId !== "string" || !licencaId) return null;
  return prisma.totemLicense.findFirst({ where: { id: licencaId, franchiseeId: lojaId }, select: { id: true, label: true } });
}

export async function GET() {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    return NextResponse.json({ ligados: await tefDaLoja(quem.lojaId) });
  } catch (e) {
    console.error("[TEF Painel] GET:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!quem.dono && !quem.suporte) {
    return NextResponse.json({ error: "Só o dono da loja liga o TEF do totem." }, { status: 403 });
  }
  const { licencaId } = await req.json().catch(() => ({}));
  const licenca = await licencaDaLoja(licencaId, quem.lojaId);
  if (!licenca) return NextResponse.json({ error: "Totem não encontrado nesta loja." }, { status: 404 });
  try {
    const { chave, segredoLocal } = await ligarTef({ licencaId: licenca.id, franchiseeId: quem.lojaId, por: quem.email });
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "firehubfood.com.br";
    const protocolo = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
    return NextResponse.json({ licencaId: licenca.id, rotulo: licenca.label, lojaId: quem.lojaId, chave, segredoLocal, nuvem: `${protocolo}://${host}` });
  } catch (e) {
    console.error("[TEF Painel] POST:", e);
    return NextResponse.json({ error: "Não foi possível ligar o TEF agora." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!quem.dono && !quem.suporte) {
    return NextResponse.json({ error: "Só o dono da loja desliga o TEF do totem." }, { status: 403 });
  }
  const { licencaId } = await req.json().catch(() => ({}));
  if (typeof licencaId !== "string" || !licencaId) return NextResponse.json({ error: "licencaId obrigatório" }, { status: 400 });
  await desligarTef(licencaId, quem.lojaId);
  return NextResponse.json({ ok: true });
}
