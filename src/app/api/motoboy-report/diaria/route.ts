/**
 * A diária de UM dia de UM motoboy, mudada no relatório (Motoboys → Relatório).
 *
 *   PUT    { motoboyId, dia: "2026-10-15", valor: "30,00" } — grava a diária do dia
 *   DELETE ?motoboyId=…&dia=2026-10-15                      — volta para a do cadastro
 *
 * O dia é o do expediente (vira às 5h, fuso da loja). O cadastro do motoboy não
 * muda: os outros dias seguem com a diária dele. A conta está em
 * lib/relatorio-do-entregador.ts (lib/ajustes-do-acerto-regras.ts).
 */
import { NextResponse } from "next/server";
import { lerAcerto } from "@/lib/ganho-do-entregador";
import { salvarDiariaDoDia, voltarDiariaAoPadrao } from "@/lib/ajustes-do-acerto";
import { ehDia, validarDiariaDoDia } from "@/lib/ajustes-do-acerto-regras";
import { motoboyDaLoja, quemMexeNoAcerto } from "../sessao";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const body = await req.json().catch(() => ({}));
  const mb = await motoboyDaLoja(body?.motoboyId, s.lojaId);
  if (!mb) return NextResponse.json({ error: "Motoboy não encontrado nesta loja." }, { status: 404 });
  const v = validarDiariaDoDia(body || {});
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  try {
    // A do cadastro fica guardada junto, para conferência: "era 40, ficou 30".
    await salvarDiariaDoDia({ lojaId: s.lojaId, motoboyId: mb.id, dia: v.dia, valor: v.valor, padrao: lerAcerto(mb as any).dailyRate, quem: s.quem });
    return NextResponse.json({ ok: true, dia: v.dia, valor: v.valor });
  } catch (err: any) {
    console.error("[Acerto] diária do dia:", err?.message);
    return NextResponse.json({ error: "Não deu para salvar a diária agora. Tente de novo." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const url = new URL(req.url);
  const mb = await motoboyDaLoja(url.searchParams.get("motoboyId"), s.lojaId);
  if (!mb) return NextResponse.json({ error: "Motoboy não encontrado nesta loja." }, { status: 404 });
  const dia = url.searchParams.get("dia");
  if (!ehDia(dia)) return NextResponse.json({ error: "Dia inválido." }, { status: 400 });
  try {
    await voltarDiariaAoPadrao({ lojaId: s.lojaId, motoboyId: mb.id, dia });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Acerto] voltar diária:", err?.message);
    return NextResponse.json({ error: "Não deu para voltar a diária agora. Tente de novo." }, { status: 500 });
  }
}
