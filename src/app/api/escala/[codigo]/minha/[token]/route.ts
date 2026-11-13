/**
 * A página pessoal da escala (/escala/<código>/minha/<token>) — o link que o
 * WhatsApp da loja manda à pessoa (lib/escala-da-equipe/aviso.ts). SEM login:
 * o token assinado é a prova de quem é.
 *
 * GET  ?mes=YYYY-MM — os turnos dela no mês (horário, função, diária e o
 *        aceite) e os que faltam aceitar (de hoje em diante, qualquer mês).
 * POST { acao: "aceitar", inscricaoIds } — "Aceito": grava a hora, o telefone
 *        para onde a mensagem foi, o IP e o aparelho (user-agent). Só aceita o
 *        que é dela e ainda não terminou; aceitar de novo não grava outra vez.
 *
 * Lucas/Frangoso (13/11/2026): equipe sem carteira — a prova de que a pessoa
 * escolheu os dias. A diária aparece aqui porque o link é só dela.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { ErroDaEscala, aceitarTurnos, escalaDaPessoa, lojaPeloCodigo, pessoasDaLoja } from "@/lib/escala-da-equipe/banco";
import { pessoaDoToken } from "@/lib/escala-da-equipe/aviso";
import { agoraDaLoja, fimDoMes, mesValido, resumoDaEscalaPessoal, somarDias, turnoJaTerminou } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ codigo: string; token: string }> };

const ROTULO = { motoboy: "Motoboy", equipe: "Equipe", freelancer: "Freelancer" } as const;

async function quemEOnde(codigo: string, token: string) {
  const achada = await lojaPeloCodigo(codigo);
  const quem = achada ? pessoaDoToken(codigo, token) : null;
  if (!achada || !quem) throw new ErroDaEscala("Este link não vale mais. Peça para a loja mandar de novo.", 404);
  const pessoa = (await pessoasDaLoja(achada.lojaId, { inativos: true })).find((p) => p.tipo === quem.tipo && p.id === quem.id);
  if (!pessoa) throw new ErroDaEscala("Não achamos o seu cadastro nesta loja. Fale com a loja.", 404);
  const agora = agoraDaLoja(await fusoDaLoja(achada.lojaId));
  return { lojaId: achada.lojaId, pessoa, agora };
}

/** O que falta aceitar: da véspera (turno que vira a meia-noite) até ~2 meses, sem os que já terminaram. */
async function pendentesDe(lojaId: string, pessoa: { tipo: string; id: string }, agora: ReturnType<typeof agoraDaLoja>) {
  return (await escalaDaPessoa(lojaId, pessoa, somarDias(agora.data, -1), somarDias(agora.data, 62)))
    .filter((t) => !t.aceitoEm && !turnoJaTerminou(t, agora));
}

export async function GET(req: Request, { params }: Params) {
  try {
    if (!checkRateLimit(`escala-minha:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 60 }).allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Espere um minuto." }, { status: 429 });
    }
    const { codigo, token } = await params;
    const { lojaId, pessoa, agora } = await quemEOnde(codigo, token);
    const pendentes = await pendentesDe(lojaId, pessoa, agora);
    const pedido = new URL(req.url).searchParams.get("mes");
    // Sem mês: o do primeiro turno a aceitar (quem abre pela mensagem cai nele), senão o de hoje.
    const mes = mesValido(pedido) ? pedido : (pendentes[0]?.data || agora.data).slice(0, 7);
    const turnos = await escalaDaPessoa(lojaId, pessoa, `${mes}-01`, fimDoMes(`${mes}-01`));
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, name: true, storeLogo: true } });
    const limpa = ({ avisoEm: _a, ...t }: (typeof turnos)[number]) => t;
    return NextResponse.json({
      loja: { nome: loja?.storeName || loja?.name || "Loja", logo: loja?.storeLogo || null },
      pessoa: { nome: pessoa.nome, tipo: ROTULO[pessoa.tipo], telefone: pessoa.telefone },
      hoje: agora.data, mes,
      turnos: turnos.map(limpa),
      resumo: resumoDaEscalaPessoal(turnos),
      pendentes: pendentes.map(limpa),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return respostaDoErro(err, "GET minha escala");
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const ip = getClientIp(req);
    if (!checkRateLimit(`escala-aceite:${ip}`, { windowMs: 60_000, maxRequests: 15 }).allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Espere um minuto." }, { status: 429 });
    }
    const { codigo, token } = await params;
    const corpo = await lerCorpo(req);
    if (corpo.acao !== "aceitar") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    const { lojaId, pessoa, agora } = await quemEOnde(codigo, token);
    // Só o que está pendente AGORA (o servidor decide, não a lista que veio da tela).
    const pendentes = new Set((await pendentesDe(lojaId, pessoa, agora)).map((t) => t.inscricaoId));
    const ids = (Array.isArray(corpo.inscricaoIds) ? corpo.inscricaoIds : []).filter((x): x is string => typeof x === "string" && pendentes.has(x));
    const aceitos = await aceitarTurnos(lojaId, pessoa, ids, { telefone: pessoa.telefone, ip, agente: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true, aceitos });
  } catch (err) {
    return respostaDoErro(err, "POST aceite");
  }
}
