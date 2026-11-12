/**
 * GET /api/store/escala?de=YYYY-MM-DD&ate=YYYY-MM-DD — a Escala da equipe do
 * período (lib/escala-da-equipe): os turnos com quem vem, a lista de pessoas,
 * a configuração do link e, só para o dono, a diária de cada inscrito e o
 * custo previsto.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { configDaLoja, pessoasDaLoja, turnosDoPeriodo } from "@/lib/escala-da-equipe/banco";
import { agoraDaLoja, chaveDaPessoa, custoPrevisto, dataValida, numeroDoDia, periodoDaVisao } from "@/lib/escala-da-equipe/regras";
import { respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const url = new URL(req.url);
    const hoje = agoraDaLoja(s.fuso).data;
    let de = url.searchParams.get("de") || "", ate = url.searchParams.get("ate") || "";
    // Sem período (ou período estranho): a semana de hoje. Mais de ~2 meses de uma vez é engano.
    if (!dataValida(de) || !dataValida(ate) || numeroDoDia(ate) < numeroDoDia(de) || numeroDoDia(ate) - numeroDoDia(de) > 62) {
      ({ de, ate } = periodoDaVisao("semana", hoje));
    }
    const [config, turnos, pessoas, loja] = await Promise.all([
      configDaLoja(s.lojaId),
      turnosDoPeriodo(s.lojaId, de, ate),
      pessoasDaLoja(s.lojaId, { inativos: true }),
      prisma.user.findUnique({ where: { id: s.lojaId }, select: { storeName: true, name: true, storeLogo: true } }),
    ]);

    const diaria = new Map(pessoas.map((p) => [chaveDaPessoa(p.tipo, p.id), p.diaria]));
    const comDiaria = turnos.map((t) => ({
      ...t,
      inscritos: t.inscritos.map((i) => ({ ...i, diaria: s.ehDono ? diaria.get(chaveDaPessoa(i.pessoaTipo, i.pessoaId)) ?? null : null })),
    }));

    return NextResponse.json({
      hoje, de, ate, ehDono: s.ehDono,
      loja: { nome: loja?.storeName || loja?.name || "Loja", logo: loja?.storeLogo || null },
      config,
      turnos: comDiaria,
      // Funcionário não vê o que se paga a ninguém.
      pessoas: s.ehDono ? pessoas : pessoas.map((p) => ({ ...p, diaria: null, diariaDaOrigem: null })),
      custo: s.ehDono ? custoPrevisto(comDiaria) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return respostaDoErro(err, "GET escala");
  }
}
