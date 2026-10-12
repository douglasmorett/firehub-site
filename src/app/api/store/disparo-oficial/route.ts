import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { configDoCadastro } from "@/lib/disparo-oficial/meta";
import { lerPublico, lojaLiberada, minimoDeDisparos, precoPorDisparo, previaDoTexto } from "@/lib/disparo-oficial/regras";
import {
  apagarModeloDaLoja,
  atualizarModelosPendentes,
  atualizarNumero,
  cancelarCampanha,
  conectarLoja,
  conexaoDaLoja,
  criarCampanha,
  criarModeloDaLoja,
  criarRecarga,
  desconectarLoja,
  falhasDaCampanha,
  garantirEstruturaDoDisparoOficial,
  publicoDaLoja,
  qrDaRecarga,
  resumoDasCampanhas,
  saldoDaLoja,
} from "@/lib/disparo-oficial/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/store/disparo-oficial — a tela "Disparo oficial" (lib/disparo-oficial/).
 *
 * Só o DONO da loja (conta sem ownerId): conectar o número, comprar crédito e
 * disparar para a base inteira são decisões dele. E só loja liberada em
 * DISPARO_OFICIAL_LOJAS — o teste começa na Hakim antes de abrir para todos.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true, role: true, email: true } });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  if (user.ownerId) return { erro: NextResponse.json({ error: "Só o dono da loja usa o Disparo oficial." }, { status: 403 }) };
  const ehAdmin = String(user.role || "").toUpperCase() === "ADMIN" || String((session.user as any)?.role || "").toUpperCase() === "ADMIN";
  return { lojaId: user.id, email: user.email, liberada: ehAdmin || lojaLiberada(user.id) };
}

export async function GET(req: NextRequest) {
  const s = await lojaDaSessao();
  if ("erro" in s) return s.erro;
  const preco = precoPorDisparo();
  if (!s.liberada) return NextResponse.json({ liberada: false, preco });
  if (!(await garantirEstruturaDoDisparoOficial())) return NextResponse.json({ error: "O Disparo oficial está indisponível agora." }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const db = prisma as any;

  // Só a contagem do público (a tela pergunta ao trocar o filtro).
  if (sp.get("publico")) {
    const clientes = await publicoDaLoja(s.lojaId, lerPublico({ tipo: sp.get("publico"), dias: sp.get("dias"), telefone: sp.get("telefone") }));
    return NextResponse.json({ quantidade: clientes.length });
  }
  if (sp.get("falhas")) {
    return NextResponse.json({ falhas: await falhasDaCampanha(s.lojaId, String(sp.get("falhas"))) });
  }
  if (sp.get("recarga")) {
    const qr = await qrDaRecarga(s.lojaId, String(sp.get("recarga")));
    if (!qr) return NextResponse.json({ error: "Recarga não encontrada." }, { status: 404 });
    return NextResponse.json({ recarga: qr });
  }

  await atualizarModelosPendentes(s.lojaId).catch(() => {});
  const [conexao, saldo, modelos, campanhas, recargas] = await Promise.all([
    conexaoDaLoja(s.lojaId),
    saldoDaLoja(s.lojaId),
    db.disparoModelo.findMany({ where: { franchiseeId: s.lojaId, status: { not: "DESATIVADO" } }, orderBy: { createdAt: "desc" }, take: 30 }),
    resumoDasCampanhas(s.lojaId),
    db.disparoRecarga.findMany({ where: { franchiseeId: s.lojaId }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return NextResponse.json({
    liberada: true,
    preco,
    minimo: minimoDeDisparos(preco),
    cadastro: configDoCadastro(),
    conexao: conexao
      ? {
          status: conexao.status,
          numero: conexao.numero,
          nomeExibido: conexao.nomeExibido,
          qualidade: conexao.qualidade,
          limite: conexao.limite,
          erro: conexao.erro,
          conectadoEm: conexao.conectadoEm,
        }
      : null,
    saldo,
    modelos: modelos.map((m: any) => ({ id: m.id, titulo: m.titulo, texto: m.texto, previa: previaDoTexto(m.texto), botaoPedir: m.botaoPedir, status: m.status, motivo: m.motivo, createdAt: m.createdAt })),
    campanhas,
    recargas: recargas.map((r: any) => ({ id: r.id, disparos: r.disparos, valor: r.valor, tipo: r.tipo, status: r.status, createdAt: r.createdAt, pagaEm: r.pagaEm, descricao: r.tipo === "AJUSTE" ? r.descricao : null })),
  });
}

export async function POST(req: NextRequest) {
  const s = await lojaDaSessao();
  if ("erro" in s) return s.erro;
  if (!s.liberada) return NextResponse.json({ error: "O Disparo oficial ainda não está liberado para esta loja." }, { status: 403 });
  if (!(await garantirEstruturaDoDisparoOficial())) return NextResponse.json({ error: "O Disparo oficial está indisponível agora." }, { status: 503 });

  const body: any = await req.json().catch(() => ({}));
  try {
    switch (body?.acao) {
      case "conectar": {
        if (!body.codigo || !body.wabaId) return NextResponse.json({ error: "O Facebook não devolveu os dados da conta. Tente de novo." }, { status: 400 });
        const c = await conectarLoja({ franchiseeId: s.lojaId, codigo: String(body.codigo), wabaId: String(body.wabaId), phoneNumberId: body.phoneNumberId ? String(body.phoneNumberId) : null, businessId: body.businessId ? String(body.businessId) : null });
        return NextResponse.json({ ok: true, numero: c.numero, nomeExibido: c.nomeExibido });
      }
      case "atualizar-numero":
        await atualizarNumero(s.lojaId);
        return NextResponse.json({ ok: true });
      case "desconectar":
        await desconectarLoja(s.lojaId);
        return NextResponse.json({ ok: true });
      case "recarga": {
        const r = await criarRecarga(s.lojaId, Number(body.disparos), s.email);
        return NextResponse.json({ ok: true, recarga: r });
      }
      case "modelo": {
        const m = await criarModeloDaLoja(s.lojaId, { titulo: String(body.titulo || ""), texto: String(body.texto || ""), botaoPedir: body.botaoPedir !== false });
        return NextResponse.json({ ok: true, modelo: { id: m.id, status: m.status } });
      }
      case "apagar-modelo":
        await apagarModeloDaLoja(s.lojaId, String(body.modeloId || ""));
        return NextResponse.json({ ok: true });
      case "campanha": {
        if (body.confirmouAceite !== true) {
          return NextResponse.json({ error: "Confirme que estes clientes aceitam receber novidades da loja." }, { status: 400 });
        }
        const c = await criarCampanha(s.lojaId, { modeloId: String(body.modeloId || ""), publico: lerPublico(body.publico), nome: body.nome ? String(body.nome) : undefined, criadoPor: s.email });
        return NextResponse.json({ ok: true, campanha: { id: c.id, total: c.total } });
      }
      case "cancelar-campanha": {
        const n = await cancelarCampanha(s.lojaId, String(body.campanhaId || ""));
        return NextResponse.json({ ok: true, devolvidos: n });
      }
      default:
        return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
    }
  } catch (e: any) {
    console.error(`[Disparo oficial] ${body?.acao} (${s.lojaId}): ${e?.message}`);
    return NextResponse.json({ error: e?.message || "Não deu certo. Tente de novo." }, { status: 400 });
  }
}
