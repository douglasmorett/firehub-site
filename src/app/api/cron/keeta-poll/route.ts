import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { keetaConfigurada, eventosDaKeeta, confirmarLeitura, acaoNoPedidoKeeta, type EventoKeeta } from "@/lib/keeta/api";
import { processarEventoKeeta } from "@/lib/keeta/eventos";
import { lojaDoMerchant, merchantsAtivos } from "@/lib/keeta/lojas";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { acoesPendentes, marcarTentativa } from "@/lib/keeta/acoes-pendentes";
import { idNaKeeta } from "@/lib/keeta/status";

/**
 * GET /api/cron/keeta-poll — a cada 30 s, os eventos das lojas vinculadas.
 *
 * Rede de segurança do webhook: o mesmo evento pode vir pelos dois, e a
 * gravação é idempotente. Ack SÓ do que foi resolvido (gravado, ou que não
 * precisa de nada); o resto volta no próximo ciclo — a Keeta guarda 4h10.
 *
 * Limite da Keeta: 2 chamadas de polling por minuto por token. Este ciclo faz
 * UMA (até 100 lojas). Depois, repete as chamadas à Keeta que falharam
 * (lib/keeta/acoes-pendentes.ts) — o dispatch barrado do iFood que ninguém
 * repetiu (03/10/2026) não se repete aqui.
 *
 * Sem KEETA_CLIENT_ID/SECRET no servidor: responde na hora, sem tocar no banco.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!keetaConfigurada()) return NextResponse.json({ ok: true, desligada: true });

  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < 45_000;
  const log: string[] = [];

  // Loja bloqueada por mensalidade (lib/loja-bloqueada.ts) sai da lista do
  // polling: a Keeta não entrega os eventos dela, nada é importado nem
  // confirmado, e o pedido fica no Portal da Keeta.
  const merchants: string[] = [];
  for (const m of await merchantsAtivos()) {
    const loja = await lojaDoMerchant(m).catch(() => null);
    if (loja && (await lojaBloqueadaPorMensalidade(loja.franchiseeId))) {
      log.push(`[bloqueio] ${loja.nomeNaKeeta || m}: bloqueada por mensalidade — fora do polling`);
      continue;
    }
    merchants.push(m);
  }
  if (merchants.length > 100) log.push(`⚠️ ${merchants.length} lojas vinculadas — o polling cobre as 100 primeiras; o webhook cobre o resto`);

  if (merchants.length > 0) {
    const r = await eventosDaKeeta(merchants);
    if (!r.ok) {
      log.push(`❌ polling: ${r.erro}`);
    } else {
      const resolvidos: EventoKeeta[] = [];
      // Dedupe dentro do lote: a Keeta avisa que pode mandar o mesmo evento mais de uma vez.
      const vistos = new Set<string>();
      for (const ev of r.dados || []) {
        if (!temTempo()) {
          log.push("⏱️ tempo do ciclo acabou — o resto fica para o próximo");
          break;
        }
        if (vistos.has(ev.eventId)) {
          resolvidos.push(ev);
          continue;
        }
        vistos.add(ev.eventId);
        try {
          const res = await processarEventoKeeta(ev);
          log.push(`${ev.eventType} ${ev.orderId}: ${res.acao}${res.mensagem ? ` — ${res.mensagem}` : ""}`);
          if (res.confirmar) resolvidos.push(ev);
        } catch (e: any) {
          log.push(`❌ ${ev.eventType} ${ev.orderId}: ${e?.message}`);
        }
      }
      if (resolvidos.length > 0) {
        const a = await confirmarLeitura(resolvidos);
        if (!a.ok) log.push(`❌ ack de ${resolvidos.length} evento(s): ${a.erro}`);
      }
    }
  }

  // ── Chamadas à Keeta que falharam antes ────────────────────────────────────
  for (const p of await acoesPendentes()) {
    if (!temTempo()) break;
    const r = await acaoNoPedidoKeeta("", p.acao as any, idNaKeeta(p.pedidoId), p.corpo ?? undefined);
    await marcarTentativa(p.id, r.ok || !r.repetir, r.ok ? undefined : r.erro);
    log.push(`↻ ${p.acao} ${p.pedidoId}: ${r.ok ? "ok" : r.erro}`);
  }

  if (log.length > 0) console.log(`[Keeta Poll] ${log.join(" | ")}`);
  return NextResponse.json({ ok: true, lojas: merchants.length, log });
}
