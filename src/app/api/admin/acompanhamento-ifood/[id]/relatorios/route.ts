import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  adminDaSessao, estruturaPronta, LIMITE_DO_ARQUIVO, SELECT_DO_RELATORIO, tipoDoArquivo,
} from "@/lib/acompanhamento-ifood/servidor";
import { limparNumeros } from "@/lib/acompanhamento-ifood/regras";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST (multipart): guarda o relatório de um mês do cliente. Um relatório por
 * mês — mandar de novo o mesmo mês SUBSTITUI o que mudou (o arquivo só se
 * vier outro). Campos: mes (AAAA-MM), titulo, resumo, status, numeros (JSON) e
 * arquivo (.html do modelo ou .pdf, até 8 MB).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const admin = await adminDaSessao();
  if (!admin) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { id } = await params;

  const cliente = await prisma.acompanhamentoIfood.findUnique({ where: { id }, select: { id: true } });
  if (!cliente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Envio inválido (arquivo grande demais?)." }, { status: 400 });
  }

  const mes = String(form.get("mes") || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return NextResponse.json({ error: "Escolha o mês do relatório." }, { status: 400 });

  const status = String(form.get("status") || "RASCUNHO") === "ENVIADO" ? "ENVIADO" : "RASCUNHO";
  const titulo = String(form.get("titulo") || "").trim().slice(0, 200) || null;
  const resumo = String(form.get("resumo") || "").trim().slice(0, 5000) || null;
  let numeros = {};
  try { numeros = limparNumeros(JSON.parse(String(form.get("numeros") || "{}"))); } catch {}

  let arquivo: { arquivo: Uint8Array<ArrayBuffer>; arquivoNome: string; arquivoTipo: string } | null = null;
  const f = form.get("arquivo");
  if (f && typeof f === "object" && "arrayBuffer" in f && f.size > 0) {
    const tipo = tipoDoArquivo(f.name || "");
    if (!tipo) return NextResponse.json({ error: "O relatório tem de ser .html ou .pdf." }, { status: 400 });
    if (f.size > LIMITE_DO_ARQUIVO) return NextResponse.json({ error: "Arquivo acima de 8 MB." }, { status: 400 });
    arquivo = { arquivo: new Uint8Array(await f.arrayBuffer()), arquivoNome: f.name.slice(0, 200), arquivoTipo: tipo };
  }

  const existente = await prisma.acompanhamentoRelatorio.findFirst({ where: { clienteId: id, mes }, select: { id: true, enviadoEm: true } });
  const enviadoEm = status === "ENVIADO" ? existente?.enviadoEm || new Date() : null;

  const relatorio = existente
    ? await prisma.acompanhamentoRelatorio.update({
        where: { id: existente.id },
        data: { titulo, resumo, numeros, status, enviadoEm, ...(arquivo || {}) },
        select: SELECT_DO_RELATORIO,
      })
    : await prisma.acompanhamentoRelatorio.create({
        data: { clienteId: id, mes, titulo, resumo, numeros, status, enviadoEm, criadoPor: admin.email, ...(arquivo || {}) },
        select: SELECT_DO_RELATORIO,
      });

  return NextResponse.json({ relatorio, substituiu: !!existente });
}
