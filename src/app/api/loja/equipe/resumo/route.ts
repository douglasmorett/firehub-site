/**
 * GET /api/loja/equipe/resumo — o topo e o "Meus lanches" da tela do motoboy:
 * o limite, quanto já usou hoje e os lanches dos últimos 31 dias (dia, hora,
 * itens, quanto ficou no combinado e quanto foi descontado).
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirMotoboy } from "@/lib/motoboy-sessao";
import { configDaLoja, descontoDoAcerto, diaDoExpediente, lanchesDoPeriodo, consumoDoDia, garantirTabelaDoLanche } from "@/lib/lanche-da-equipe";
import { fusoDaLoja } from "@/lib/fuso-da-loja";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const motoboy = await exigirMotoboy(req);
  if (!motoboy) return NextResponse.json({ error: "Sua sessão acabou. Entre de novo." }, { status: 401 });
  try {
    const cfg = await configDaLoja(motoboy.franchiseeId);
    if (!cfg.disponivel) return NextResponse.json({ error: "Esta loja não tem o lanche pelo sistema." }, { status: 404 });
    await garantirTabelaDoLanche();
    const fuso = await fusoDaLoja(motoboy.franchiseeId);
    const dia = diaDoExpediente(fuso);
    const { usado, bebidas } = await consumoDoDia(motoboy.franchiseeId, motoboy.id, dia);
    const agora = new Date();
    const lanches = await lanchesDoPeriodo({
      lojaId: motoboy.franchiseeId, motoboyId: motoboy.id, de: new Date(agora.getTime() - 31 * 86_400_000), ate: agora,
    });
    const doMes = lanches.filter((l) => l.dia.slice(0, 7) === dia.slice(0, 7));
    return NextResponse.json({
      motoboy: { nome: motoboy.name },
      ativo: cfg.ativo,
      limite: cfg.limite,
      umaBebidaPorDia: cfg.umaBebidaPorDia,
      fuso,
      hoje: { dia, usado, bebidas, restante: Math.max(0, Math.round((cfg.limite - usado) * 100) / 100) },
      mes: { lanches: doMes.filter((l) => !l.cancelado).length, descontado: descontoDoAcerto(doMes) },
      lanches,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[Lanche] resumo falhou:", err?.message || err);
    return NextResponse.json({ error: "Não deu para carregar agora." }, { status: 500 });
  }
}
