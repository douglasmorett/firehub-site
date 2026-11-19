import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lojaDasReservasDaSessao } from "@/lib/reservas/sessao";
import {
  DIAS_DE_TESTE_DAS_RESERVAS, TermoNaoAceitoError, estadoDasReservas, ligarOuDesligarReservas, salvarConfigDasReservas,
} from "@/lib/reservas/assinatura";
import { agoraNaLoja, consumoDasReservas, fusoDaLoja, reservasEntre } from "@/lib/reservas/no-banco";
import {
  dataValida, diaDaSemana, disponibilidadeDoDia, horariosDoDia, numerosDasReservas, somarDias,
  type ReservaParaNumeros,
} from "@/lib/reservas/regras";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

/**
 * /store/reservas — o painel das reservas de mesa (lib/reservas).
 *
 * GET ?data=AAAA-MM-DD — o estado do módulo e, ligado: o dia escolhido na linha
 *     do tempo (ocupação × capacidade de cada horário), a semana, o mês (o
 *     calendário), os números de valor do mês e as mesas para ligar à reserva.
 * POST { ligar, aceite: { versao } } — ativa/desativa (só o dono; termo em lib/reservas/termo.ts).
 * PUT  { config } — horários, duração, quantas reservas ao mesmo tempo.
 */
const publico = (e: Awaited<ReturnType<typeof estadoDasReservas>>) => ({
  ativo: e.ativo, cobradoEsteMes: e.cobradoEsteMes, testeAte: e.testeAte, emTeste: e.emTeste, jaTestou: e.jaTestou,
  isento: e.isento, desligaEm: e.desligaEm, fimDoMes: e.fimDoMes,
});

const inicioDaSemana = (data: string) => somarDias(data, -diaDaSemana(data));
const ultimoDiaDoMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const mesAnterior = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

export async function GET(req: Request) {
  const s = await lojaDasReservasDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre as reservas. Peça ao dono da loja." }, { status: 403 });
  const estado = await estadoDasReservas(s.franchiseeId);
  const base = {
    estado: publico(estado),
    podeContratar: s.podeContratar,
    preco: estado.preco,
    diasDeTeste: DIAS_DE_TESTE_DAS_RESERVAS,
    mensalidade: { percentual: FIREHUB_PLAN.PERCENT_RATE, minimo: FIREHUB_PLAN.MIN_MONTHLY, teto: FIREHUB_PLAN.MAX_MONTHLY },
  };
  if (!estado.ativo) return NextResponse.json(base);

  const tz = await fusoDaLoja(s.franchiseeId);
  const agora = agoraNaLoja(tz);
  const pedida = new URL(req.url).searchParams.get("data") || "";
  const data = dataValida(pedida) ? pedida : agora.data;
  const config = estado.config;

  const ym = data.slice(0, 7);
  const semanaDe = inicioDaSemana(data);
  const semanaAte = somarDias(semanaDe, 6);
  const de = [`${ym}-01`, semanaDe].sort()[0];
  const ate = [ultimoDiaDoMes(ym), semanaAte].sort()[1];
  const [periodo, doMesAnterior, mesas] = await Promise.all([
    reservasEntre(s.franchiseeId, de, ate),
    reservasEntre(s.franchiseeId, `${mesAnterior(ym)}-01`, ultimoDiaDoMes(mesAnterior(ym))),
    prisma.table.findMany({
      where: { franchiseeId: s.franchiseeId, isActive: true, OR: [{ tipo: null }, { tipo: { not: "COMANDA" } }] },
      select: { id: true, number: true, label: true, capacity: true },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    }).catch(() => []),
  ]);
  const doDia = (d: string) => periodo.filter((r) => r.data === d);

  // O mês: o calendário (uma célula por dia) e os números de valor.
  const doMes = periodo.filter((r) => r.data.slice(0, 7) === ym);
  const consumo = await consumoDasReservas(s.franchiseeId, doMes, tz).catch(() => ({} as Record<string, number>));
  const numeros = numerosDasReservas(doMes.map((r): ReservaParaNumeros => ({ ...r, consumo: consumo[r.id] ?? null })));
  const anterior = numerosDasReservas(doMesAnterior);
  const calendario: { data: string; aceita: boolean; reservas: number; pessoas: number; pico: number }[] = [];
  for (let d = `${ym}-01`; d.slice(0, 7) === ym; d = somarDias(d, 1)) {
    const lista = doDia(d);
    const horarios = disponibilidadeDoDia(config, lista, d, agora);
    const pico = horarios.reduce((m, h) => Math.max(m, h.ocupacao.reservas), 0);
    const ativas = lista.filter((r) => r.status !== "CANCELADA");
    calendario.push({ data: d, aceita: horariosDoDia(config, d).length > 0, reservas: ativas.length, pessoas: ativas.reduce((t, r) => t + r.pessoas, 0), pico });
  }

  // A semana: os 7 dias × os horários, com a ocupação de cada um.
  const semana = Array.from({ length: 7 }, (_, i) => {
    const d = somarDias(semanaDe, i);
    const lista = doDia(d);
    return {
      data: d,
      horarios: disponibilidadeDoDia(config, lista, d, agora).map((h) => ({
        hora: h.hora, ocupadas: h.ocupacao.reservas, pessoas: h.ocupacao.pessoas, livre: h.livre, semVaga: h.motivo === "lotado" || h.motivo === "lotado_pessoas",
      })),
      reservas: lista.filter((r) => r.status !== "CANCELADA").length,
      pessoas: lista.filter((r) => r.status !== "CANCELADA").reduce((t, r) => t + r.pessoas, 0),
    };
  });

  return NextResponse.json({
    ...base,
    hoje: agora.data,
    agoraMin: agora.minutos,
    data,
    config,
    configurado: estado.configurado,
    dia: { reservas: doDia(data).map((r) => ({ ...r, consumo: consumo[r.id] ?? null })), horarios: disponibilidadeDoDia(config, doDia(data), data, agora) },
    semana,
    calendario,
    valor: { mes: ym, numeros, anterior: { reservas: anterior.reservas, pessoas: anterior.pessoas, comparecimento: anterior.comparecimento } },
    mesas: mesas.map((m) => ({ id: m.id, nome: m.label || `Mesa ${m.number}`, capacidade: m.capacity })),
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja ativa ou desativa as reservas." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });

  // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
  let aceite = null;
  if (corpo.ligar) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = corpo?.aceite?.versao
      ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
      : null;
  }
  try {
    const estado = await ligarOuDesligarReservas(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json({ ok: true, estado: publico(estado) });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const s = await lojaDasReservasDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre as reservas. Peça ao dono da loja." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (!corpo?.config || typeof corpo.config !== "object") return NextResponse.json({ error: "Informe a configuração." }, { status: 400 });
  try {
    const config = await salvarConfigDasReservas(s.franchiseeId, corpo.config);
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
