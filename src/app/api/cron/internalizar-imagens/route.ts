/**
 * GET /api/cron/internalizar-imagens — a porta do CRON para a internalização.
 *
 * A lógica inteira mora em /api/admin/internalizar-imagens. Isto aqui é só o
 * endereço, e o endereço é o bug que esta rota conserta.
 *
 * ── O que aconteceu ────────────────────────────────────────────────────────
 *
 * O job estava agendado em `/api/admin/internalizar-imagens`, e `src/proxy.ts`
 * exige sessão NextAuth em TODO `/api/admin/*` — uma trava correta, posta para
 * impedir que qualquer um na internet chamasse seed-hakim-menu e irmãs. O
 * cron-runner chega com `Authorization: Bearer <CRON_SECRET>` e sem cookie
 * nenhum, então levava 401 do proxy ANTES de a rota existir. A rota nunca
 * rodou: nove dias, cinco lojas, 439 fotos de cardápio importado que
 * continuaram servidas pelo concorrente, e nenhum erro em lugar nenhum —
 * porque `verifyCronAuth`, que autorizaria a chamada, fica depois do proxy.
 *
 * Os outros 16 jobs sempre funcionaram porque todos vivem em `/api/cron/*`,
 * que o proxy não tranca. Era o único fora do padrão.
 *
 * ── A regra que fica ───────────────────────────────────────────────────────
 *
 * Job de cron mora em `/api/cron/*`. Se um dia alguém agendar algo em
 * `/api/admin/*`, vai falhar do mesmo jeito calado — por isso o aviso também
 * está em src/proxy.ts, ao lado da trava.
 *
 * `/api/admin/internalizar-imagens` continua de pé e é por onde o ADMIN dispara
 * pelo painel e LÊ o resultado (quantas trocaram, quais falharam e por quê).
 */
import { NextRequest } from "next/server";
import { GET as internalizar } from "@/app/api/admin/internalizar-imagens/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return internalizar(req);
}
