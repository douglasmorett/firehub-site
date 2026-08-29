import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { lerConfigDoContador } from "@/app/api/store/fiscal/contador/route";
import { devoEnviarHoje, hojeNaLoja, periodoDoEnvio } from "@/lib/contador-agenda";
import { enviarPacoteParaContador } from "@/lib/contador-envio";

export const dynamic = "force-dynamic";
// Cada loja baixa os XMLs do mês no provedor. Com poucas lojas é rápido, mas
// o teto precisa caber num mês cheio.
export const maxDuration = 300;

/**
 * GET /api/cron/relatorio-contador
 *
 * Envia o pacote fiscal mensal para o contador das lojas que agendaram.
 *
 * Roda UMA VEZ POR DIA. A escolha da data é da loja (todo dia 1º, no último dia
 * do mês, num dia fixo, ou numa data marcada) e mora em fiscalConfig.contador.
 *
 * ── A TRAVA DE ENVIO DUPLICADO ──────────────────────────────────────────────
 *
 * Se este cron for chamado duas vezes no mesmo dia — agendador com retry,
 * deploy no meio da execução, alguém abrindo a URL — o contador receberia o
 * mesmo pacote de novo. Por isso o `ultimoEnvioEm` é conferido contra o dia de
 * hoje NO FUSO DA LOJA antes de mandar. Contador recebendo o mesmo anexo duas
 * vezes não é só chato: ele pode lançar em dobro.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const resultados: { loja: string; status: string }[] = [];

  try {
    const lojas = await prisma.user.findMany({
      where: { fiscalConfig: { not: undefined } },
      select: { id: true, storeName: true, name: true, fiscalConfig: true, storeTimezone: true },
    });

    for (const loja of lojas) {
      const cfg = lerConfigDoContador((loja.fiscalConfig as any) || {});
      if (!cfg.automatico || !cfg.email) continue;

      const fuso = loja.storeTimezone || "America/Sao_Paulo";
      const hoje = hojeNaLoja(fuso);
      if (!devoEnviarHoje(cfg, hoje)) continue;

      // Já saiu hoje? Não manda de novo.
      if (cfg.ultimoEnvioEm) {
        const enviadoEm = hojeNaLoja(fuso, new Date(cfg.ultimoEnvioEm));
        if (enviadoEm.iso === hoje.iso) {
          resultados.push({ loja: loja.storeName || loja.id, status: "já enviado hoje" });
          continue;
        }
      }

      const periodo = periodoDoEnvio(cfg, hoje);
      try {
        const r = await enviarPacoteParaContador(loja.id, periodo);
        resultados.push({ loja: loja.storeName || loja.id, status: r.mensagem });
        console.log(`[Contador] ${loja.storeName || loja.id}: ${r.mensagem}`);
      } catch (err: any) {
        // Uma loja que falha não pode impedir o envio das outras.
        resultados.push({ loja: loja.storeName || loja.id, status: `erro: ${err?.message}` });
        console.error(`[Contador] Erro na loja ${loja.id}:`, err?.message);
      }
    }
  } catch (err: any) {
    console.error("[Contador] Falha geral:", err?.message);
    return NextResponse.json({ ok: false, erro: err?.message, resultados }, { status: 500 });
  }

  return NextResponse.json({ ok: true, lojasProcessadas: resultados.length, resultados });
}
