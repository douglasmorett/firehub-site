import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { conferirRecibos, faxinaDasAberturas, soltarAgendados } from "@/lib/app-da-loja/notificacoes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A cada minuto (scripts/cron-runner.js): solta as notificações agendadas
 * da tela Meu aplicativo, pergunta ao Expo se o Google/Apple entregou as de
 * 15 min atrás (e tira da base o aparelho de onde o app saiu) e, uma vez por
 * hora, apaga o carimbo de abertura com mais de 60 dias. Sem nada pendente,
 * são três consultas e acabou.
 */
let rodando = false;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (rodando) return NextResponse.json({ ok: true, pulou: "rodada anterior ainda enviando" });
  rodando = true;
  try {
    const soltos = await soltarAgendados();
    const recibos = await conferirRecibos();
    await faxinaDasAberturas();
    return NextResponse.json({ ok: true, soltos, ...recibos });
  } catch (err: any) {
    console.error(`[App da loja] Cron das notificações falhou: ${err?.message}`);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  } finally {
    rodando = false;
  }
}
