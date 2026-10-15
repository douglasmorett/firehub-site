/**
 * GET /api/contingencia/bilhete — o bilhete desta tela para a contingência
 * (lib/contingencia/chave.ts), e o endereço do computador da loja.
 *
 * Toda tela do painel e do garçom pede de tempos em tempos e guarda. Se a
 * internet cair, ela leva o bilhete para o computador da loja e entra sem
 * senha. Loja sem contingência ativada: `{ ativo: false }`.
 *
 * A tela do garçom manda `x-operador: garcom` (lib/garcom-auth.ts): aí só o
 * cookie do garçom vale, mesmo com o painel aberto no mesmo navegador.
 *
 * Toda tela do PAINEL que pede o bilhete deixa anotado de que internet (IP
 * público) pediu — no máximo uma gravação a cada 5 min por IP. A tela do
 * módulo compara com o IP do computador da contingência e avisa quando ele não
 * está na internet da loja (lib/contingencia/rede-da-loja.ts). O garçom fica
 * de fora: o celular dele pode estar no 4G.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { quemPede } from "@/lib/contingencia/sessao";
import { assinarBilhete, VALIDADE_DO_BILHETE_MS, type Bilhete } from "@/lib/contingencia/chave";
import { autenticarGarcom, CABECALHO_DO_OPERADOR } from "@/lib/garcom-auth";
import { getClientIp } from "@/lib/rateLimit";
import { anotarTela } from "@/lib/contingencia/rede-da-loja";

export const dynamic = "force-dynamic";

type Quem = { lojaId: string; corpo: Pick<Bilhete, "tipo" | "email" | "garcomId"> };

async function quemEhEsta(): Promise<Quem | null> {
  const pedeGarcom = (await headers()).get(CABECALHO_DO_OPERADOR) === "garcom";
  if (!pedeGarcom) {
    const painel = await quemPede();
    if (painel) return { lojaId: painel.lojaId, corpo: { tipo: "painel", email: painel.email } };
  }
  const g = await autenticarGarcom().catch(() => null);
  if (g && g.ok) return { lojaId: g.garcom.franchiseeId, corpo: { tipo: "garcom", garcomId: g.garcom.id } };
  return null;
}

export async function GET(req: Request) {
  const quem = await quemEhEsta();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const r = await prisma.$queryRawUnsafe<{ segredoDoBilhete: string; relato: any }[]>(
      `SELECT "segredoDoBilhete", "relato" FROM "Contingencia" WHERE "lojaId" = $1`,
      quem.lojaId,
    );
    // `loja` vai junto: a tela só apaga o bilhete guardado se ele for desta
    // loja (TrocaDeContingencia) — outra conta não desarma a do computador.
    if (!r[0]) return NextResponse.json({ ativo: false, loja: quem.lojaId });
    const exp = Date.now() + VALIDADE_DO_BILHETE_MS;
    const bilhete = assinarBilhete({ v: 1, loja: quem.lojaId, exp, ...quem.corpo }, r[0].segredoDoBilhete);
    const relato = r[0].relato || {};
    if (quem.corpo.tipo === "painel") {
      const telas = anotarTela(relato.abas, getClientIp(req));
      if (telas) {
        // Só um aviso para a tela do módulo: não segura o bilhete nem falha com ele.
        prisma.$executeRawUnsafe(
          `UPDATE "Contingencia" SET "relato" = jsonb_set(COALESCE("relato", '{}'::jsonb), '{abas}', $2::jsonb) WHERE "lojaId" = $1`,
          quem.lojaId,
          JSON.stringify(telas),
        ).catch(() => {});
      }
    }
    const porta = Number(relato.porta) || 7890;
    const ips: string[] = Array.isArray(relato.ips) ? relato.ips.filter((ip: unknown) => typeof ip === "string") : [];
    return NextResponse.json({
      ativo: true,
      bilhete,
      loja: quem.lojaId,
      validoAte: new Date(exp).toISOString(),
      porta,
      enderecos: ips.map((ip) => `http://${ip}:${porta}`),
    });
  } catch {
    // Estrutura ainda não criada (boot antigo): é o mesmo que não ativada.
    return NextResponse.json({ ativo: false, loja: quem.lojaId });
  }
}
