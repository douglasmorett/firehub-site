/**
 * /api/store/dados-sensiveis/equipe — a folha da loja, base do CMO.
 *
 *   GET            a lista (quem está e quem saiu)
 *   POST           { nome, funcao?, salario, encargosPct?, beneficios?, valeTransporte?, descontoVtPct?, desde, ate? }
 *   PUT    ?id=    os mesmos campos
 *   DELETE ?id=    apaga. Quem SAIU não se apaga: põe a data de saída em `ate`,
 *                  senão o CMO dos meses em que a pessoa trabalhou muda.
 *
 * Salário é dado sensível: só quem tem a caixinha (lib/cmv/acesso.ts).
 */
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirDadosSensiveis } from "@/lib/cmv/acesso";
import { custoMensal } from "@/lib/cmv/cmo";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { hojeNaLoja } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function ler(body: any, hoje: string): { ok: true; dados: any } | { ok: false; erro: string } {
  const nome = String(body?.nome || "").trim().slice(0, 80);
  if (!nome) return { ok: false, erro: "Informe o nome." };
  const n = lerNumeroBr;
  const salario = n(body?.salario);
  if (!Number.isFinite(salario) || salario < 0) return { ok: false, erro: "Salário inválido." };
  const encargosPct = body?.encargosPct === "" || body?.encargosPct == null ? 0 : lerNumeroBr(body.encargosPct);
  if (!Number.isFinite(encargosPct) || encargosPct < 0 || encargosPct > 200) return { ok: false, erro: "Encargos devem ficar entre 0% e 200%." };
  const beneficios = body?.beneficios === "" || body?.beneficios == null ? 0 : n(body.beneficios);
  if (!Number.isFinite(beneficios) || beneficios < 0) return { ok: false, erro: "Benefícios inválidos." };
  const valeTransporte = body?.valeTransporte === "" || body?.valeTransporte == null ? null : n(body.valeTransporte);
  if (valeTransporte != null && (!Number.isFinite(valeTransporte) || valeTransporte < 0)) return { ok: false, erro: "Vale-transporte inválido." };
  const descontoVtPct = body?.descontoVtPct === "" || body?.descontoVtPct == null ? null : n(body.descontoVtPct);
  if (descontoVtPct != null && (!Number.isFinite(descontoVtPct) || descontoVtPct < 0 || descontoVtPct > 100)) return { ok: false, erro: "O desconto do VT deve ficar entre 0% e 100% do salário." };
  const desde = DIA_RE.test(String(body?.desde || "")) ? String(body.desde) : hoje;
  const ate = DIA_RE.test(String(body?.ate || "")) ? String(body.ate) : null;
  if (ate && ate < desde) return { ok: false, erro: "A saída não pode ser antes da entrada." };
  return { ok: true, dados: { nome, funcao: String(body?.funcao || "").trim().slice(0, 60) || null, salario, encargosPct, beneficios, valeTransporte, descontoVtPct, desde, ate } };
}

const comCusto = (p: any) => ({ ...p, custoMensal: Math.round(custoMensal(p) * 100) / 100 });

export async function GET(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const semSenha = await exigirSenhaDoGerente(req, r.acesso.lojaId, "verDadosSensiveis");
  if (semSenha) return semSenha;
  const pessoas = await prisma.pessoaDaFolha.findMany({ where: { franchiseeId: r.acesso.lojaId }, orderBy: [{ ate: "asc" }, { nome: "asc" }] });
  return NextResponse.json({ pessoas: pessoas.map(comCusto), hoje: hojeNaLoja(r.acesso.tz) });
}

export async function POST(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const semSenha = await exigirSenhaDoGerente(req, r.acesso.lojaId, "verDadosSensiveis");
  if (semSenha) return semSenha;
  const v = ler(await req.json().catch(() => ({})), hojeNaLoja(r.acesso.tz));
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const p = await prisma.pessoaDaFolha.create({ data: { franchiseeId: r.acesso.lojaId, ...v.dados } });
  return NextResponse.json({ success: true, pessoa: comCusto(p) });
}

export async function PUT(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const semSenha = await exigirSenhaDoGerente(req, r.acesso.lojaId, "verDadosSensiveis");
  if (semSenha) return semSenha;
  const id = req.nextUrl.searchParams.get("id") || "";
  const v = ler(await req.json().catch(() => ({})), hojeNaLoja(r.acesso.tz));
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const feito = await prisma.pessoaDaFolha.updateMany({ where: { id, franchiseeId: r.acesso.lojaId }, data: v.dados });
  if (!feito.count) return NextResponse.json({ error: "Pessoa não encontrada." }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const r = await exigirDadosSensiveis();
  if (!r.ok) return r.resposta;
  const semSenha = await exigirSenhaDoGerente(req, r.acesso.lojaId, "verDadosSensiveis");
  if (semSenha) return semSenha;
  const id = req.nextUrl.searchParams.get("id") || "";
  const feito = await prisma.pessoaDaFolha.deleteMany({ where: { id, franchiseeId: r.acesso.lojaId } });
  if (!feito.count) return NextResponse.json({ error: "Pessoa não encontrada." }, { status: 404 });
  return NextResponse.json({ success: true });
}
