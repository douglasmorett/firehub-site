import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { nomesDaEquipe, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import {
  dataDaAgenda, horaDaAgenda, instanteDaAgenda, minutosDoHorario, somarDias, vagasDoDia, ANTECEDENCIA_MINIMA_MIN,
} from "@/lib/crm/agenda";
import { disponibilidadesDos, marcarReuniao, reunioesEntre, vendedoresDaEquipe, HorarioOcupado } from "@/lib/crm/agenda-servidor";
import { ContatoDeOutraCarteira, criarContatoManual } from "@/lib/crm/contatos";
import { TIPOS_DE_REUNIAO, type TipoDeReuniao } from "@/lib/crm/etapas";
import { reuniaoParaTela } from "@/lib/crm/serializar";
import { avisarVendedor } from "@/lib/atendimento/avisos";

export const dynamic = "force-dynamic";

const ehData = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * GET ?de=YYYY-MM-DD&dias=N — a agenda DA EQUIPE (é compartilhada): cada
 * vendedor ativo com a disponibilidade da semana, as reuniões do período e as
 * vagas de cada dia. O vendedor vê a grade de todos, mas nas colunas dos
 * outros só "Ocupado" — sem o nome do lead dos colegas.
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });

  const hoje = dataDaAgenda(new Date());
  const de = ehData(req.nextUrl.searchParams.get("de")) ? req.nextUrl.searchParams.get("de")! : hoje;
  const dias = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("dias")) || 1, 31));

  const equipe = await vendedoresDaEquipe();
  const ids = equipe.map((v) => v.id);
  const [disp, reunioes, nomes] = await Promise.all([
    disponibilidadesDos(ids),
    reunioesEntre(instanteDaAgenda(de, "00:00"), instanteDaAgenda(somarDias(de, dias), "00:00")),
    nomesDaEquipe(),
  ]);

  const agora = new Date();
  const vagas: { vendedorId: string; data: string; vagas: string[] }[] = [];
  for (let i = 0; i < dias; i++) {
    const data = somarDias(de, i);
    for (const v of equipe) {
      const doVendedor = reunioes.filter((r) => r.vendedorId === v.id);
      vagas.push({ vendedorId: v.id, data, vagas: vagasDoDia(disp.get(v.id)!, data, doVendedor, agora, ANTECEDENCIA_MINIMA_MIN).map((h) => h.inicio.toISOString()) });
    }
  }

  return NextResponse.json({
    hoje,
    de,
    dias,
    equipe: equipe.map((v) => ({ id: v.id, nome: v.name, disponibilidade: disp.get(v.id) })),
    reunioes: reunioes.map((r) => reuniaoParaTela(r, nomes, quem.tipo === "VENDEDOR" && r.vendedorId !== quem.id)),
    vagas,
    quem: { tipo: quem.tipo, id: quem.id, nome: quem.nome },
  });
}

/**
 * POST: marca na agenda. { vendedorId, data, hora, duracaoMin?, tipo?, titulo?,
 * contatoId? | novoContato { nome, telefone, nomeDaLoja }, local?, observacao? }
 * O vendedor marca só na coluna dele; o admin em qualquer uma.
 */
export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const b = await req.json().catch(() => ({}));

  const vendedorId = quem.tipo === "VENDEDOR" ? quem.id : String(b.vendedorId || "");
  if (!vendedorId) return NextResponse.json({ error: "Escolha o vendedor." }, { status: 400 });
  if (quem.tipo === "VENDEDOR" && b.vendedorId && b.vendedorId !== quem.id) {
    return NextResponse.json({ error: "Você marca só na sua agenda." }, { status: 403 });
  }
  if (!ehData(b.data) || minutosDoHorario(b.hora) === null) return NextResponse.json({ error: "Data ou hora inválida." }, { status: 400 });

  const tipo: TipoDeReuniao = (TIPOS_DE_REUNIAO as readonly string[]).includes(b.tipo) ? b.tipo : "DEMONSTRACAO";
  const duracao = Math.max(15, Math.min(Number(b.duracaoMin) || 45, 600));
  const inicio = instanteDaAgenda(b.data, b.hora);
  const fim = new Date(inicio.getTime() + duracao * 60_000);
  const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;

  // O vendedor só marca com contato DELE — contato sem vendedor também não:
  // marcar uma reunião não é jeito de pegar lead (é o admin quem distribui).
  const semPosse = NextResponse.json({ error: "Esse contato não está na sua carteira. Peça ao admin para passá-lo para você." }, { status: 403 });
  let contatoId: string | null = typeof b.contatoId === "string" && b.contatoId ? b.contatoId : null;
  if (contatoId && quem.tipo === "VENDEDOR") {
    const c = await prisma.crmContato.findUnique({ where: { id: contatoId }, select: { vendedorId: true } });
    if (!c || c.vendedorId !== quem.id) return semPosse;
  }
  if (!contatoId && b.novoContato && typeof b.novoContato === "object" && tipo !== "BLOQUEIO") {
    const n = b.novoContato;
    if ((typeof n.telefone === "string" && n.telefone.trim()) || (typeof n.nome === "string" && n.nome.trim()) || (typeof n.nomeDaLoja === "string" && n.nomeDaLoja.trim())) {
      try {
        const { contato } = await criarContatoManual(
          { telefone: n.telefone, nome: n.nome, nomeDaLoja: n.nomeDaLoja, origem: "MANUAL", vendedorId },
          autor,
        );
        if (quem.tipo === "VENDEDOR" && contato?.vendedorId !== quem.id) return semPosse;
        contatoId = contato?.id || null;
      } catch (err: any) {
        return NextResponse.json({ error: err?.message || "Não consegui cadastrar o contato." }, { status: err instanceof ContatoDeOutraCarteira ? 403 : 400 });
      }
    }
  }

  try {
    const reuniao = await marcarReuniao(
      { vendedorId, contatoId, tipo, titulo: b.titulo, inicio, fim, local: b.local, observacao: b.observacao },
      autor,
    );
    // Marcaram na agenda de outra pessoa: ela fica sabendo na hora.
    if (!(quem.tipo === "VENDEDOR" && quem.id === vendedorId) && tipo !== "BLOQUEIO") {
      const [, m, d] = b.data.split("-");
      void avisarVendedor(vendedorId, `📅 ${quem.nome} marcou na sua agenda: ${reuniao.titulo} — ${d}/${m} às ${horaDaAgenda(inicio)}.\nhttps://firehubfood.com.br/vendedor?aba=agenda`)
        .then((ok) => (ok ? prisma.agendaReuniao.update({ where: { id: reuniao.id }, data: { avisoVendedorEm: new Date() } }) : null))
        .catch(() => null);
    }
    const completa = await prisma.agendaReuniao.findUnique({ where: { id: reuniao.id }, include: { contato: true } });
    return NextResponse.json({ reuniao: reuniaoParaTela(completa, await nomesDaEquipe()) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não foi possível marcar." }, { status: err instanceof HorarioOcupado ? 409 : 400 });
  }
}
