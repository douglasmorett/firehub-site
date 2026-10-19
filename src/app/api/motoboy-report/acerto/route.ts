/**
 * Acertar com o motoboy: marca como pago o acerto que está na tela.
 *
 *   POST   { motoboyId, de: "2026-10-12", ate: "2026-10-18", dias: [...], valorDoAcerto: 742.19, abaterFiado: true }
 *   DELETE ?id=…  — desfaz (fica no banco marcado; a baixa do fiado sai).
 *
 * `valorDoAcerto` é o total que a tela mostra (a conta é a do relatório). Com
 * `abaterFiado`, o fiado em aberto do motoboy (até o valor do acerto) vira uma
 * baixa no Fiado e sai do que a loja paga. Dia já pago não entra de novo.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { acertosDoPeriodo, desfazerAcertoPago, registrarAcertoPago } from "@/lib/acerto-pago";
import { fiadoDosMotoboys } from "@/lib/fiado-do-motoboy";
import { motoboyDaLoja, quemMexeNoAcerto } from "../sessao";

export const dynamic = "force-dynamic";

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const body = await req.json().catch(() => ({}));
  const mb = await motoboyDaLoja(body?.motoboyId, s.lojaId);
  if (!mb) return NextResponse.json({ error: "Motoboy não encontrado nesta loja." }, { status: 404 });

  const de = String(body?.de || ""), ate = String(body?.ate || "");
  const dias: string[] = Array.isArray(body?.dias) ? body.dias.map(String).filter((d: string) => DIA.test(d)) : [];
  const valorDoAcerto = Number(body?.valorDoAcerto);
  if (!DIA.test(de) || !DIA.test(ate) || de > ate) return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  if (!dias.length) return NextResponse.json({ error: "Nenhum dia trabalhado no período." }, { status: 400 });
  if (!Number.isFinite(valorDoAcerto) || valorDoAcerto < 0) return NextResponse.json({ error: "Valor do acerto inválido." }, { status: 400 });

  try {
    const jaPagos = (await acertosDoPeriodo({ lojaId: s.lojaId, motoboyIds: [mb.id], de, ate })).get(mb.id) || [];
    const repetidos = dias.filter((d) => jaPagos.some((a) => a.dias.includes(d)));
    if (repetidos.length) {
      return NextResponse.json({ error: `Já tem acerto pago em ${repetidos.map((d) => d.split("-").reverse().slice(0, 2).join("/")).join(", ")}. Desfaça aquele acerto ou filtre só os dias que faltam.` }, { status: 409 });
    }

    let fiado: { cadastroId: string; saldoEmAberto: number } | null = null;
    if (body?.abaterFiado === true) {
      const completo = await prisma.motoboy.findUnique({ where: { id: mb.id }, select: { id: true, name: true, phone: true, franchiseeId: true } });
      const f = completo ? (await fiadoDosMotoboys({ lojaId: s.lojaId, motoboys: [completo], de: new Date(0), ate: new Date() })).get(mb.id) : null;
      if (f && f.saldoEmAberto > 0) fiado = { cadastroId: f.cadastroId, saldoEmAberto: f.saldoEmAberto };
    }

    const acerto = await registrarAcertoPago({ lojaId: s.lojaId, motoboyId: mb.id, de, ate, dias, valorDoAcerto, quem: s.quem, fiado });
    return NextResponse.json({ ok: true, acerto });
  } catch (err: any) {
    console.error("[Acerto] marcar pago:", err?.message);
    return NextResponse.json({ error: "Não deu para marcar o acerto agora. Tente de novo." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Acerto não informado." }, { status: 400 });
  try {
    const achou = await desfazerAcertoPago({ lojaId: s.lojaId, id, quem: s.quem });
    if (!achou) return NextResponse.json({ error: "Acerto não encontrado (talvez já desfeito)." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[Acerto] desfazer:", err?.message);
    return NextResponse.json({ error: "Não deu para desfazer agora. Tente de novo." }, { status: 500 });
  }
}
