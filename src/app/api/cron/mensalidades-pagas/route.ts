import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { conferirMensalidadesNoAsaas } from "@/lib/pagamento-da-mensalidade";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A cada 30 minutos (scripts/cron-runner.js): pergunta ao Asaas por cada boleto
 * de mensalidade que o FireHub ainda não viu pago e grava o que ele disser
 * (lib/pagamento-da-mensalidade.ts). É a rede de segurança do webhook — só lê
 * no Asaas, não cria nem cancela cobrança.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const r = await conferirMensalidadesNoAsaas();
    // O anual da Black November também (lib/black-november-no-banco.ts).
    const { conferirBlackNovemberNoAsaas } = await import("@/lib/black-november-no-banco");
    const anuaisPagos = await conferirBlackNovemberNoAsaas().catch((e) => { console.error(`[Black November] Conferência falhou: ${e?.message}`); return 0; });
    if (anuaisPagos > 0) console.log(`[Black November] Conferência: ${anuaisPagos} anuais pagos agora.`);
    if (r.pagos > 0 || r.erros.length > 0) {
      console.log(`[Mensalidade] Conferência: ${r.conferidos} boletos, ${r.pagos} pagos agora, ${r.erros.length} erros.`);
    }
    return NextResponse.json({ ok: true, ...r, anuaisPagos });
  } catch (err: any) {
    console.error(`[Mensalidade] Conferência falhou: ${err?.message}`);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
