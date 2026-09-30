import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { nomesDaEquipe, podeVerContato, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { atribuirVendedor, mudarEtapa, registrarEvento, vincularLoja } from "@/lib/crm/contatos";
import { etapaValida, origemValida } from "@/lib/crm/etapas";
import { mensagensDoContato } from "@/lib/crm/mensagens";
import { contatoCompleto, mensagemParaTela, reuniaoParaTela } from "@/lib/crm/serializar";
import { estadoDaLojaParaSuporte } from "@/lib/atendimento/estado-da-loja";
import { avisarVendedor } from "@/lib/atendimento/avisos";

export const dynamic = "force-dynamic";

/**
 * GET: a conversa inteira e a ficha do contato (etapa, vendedor, notas,
 * reuniões, linha do tempo e, se for lojista, o raio-x da loja). Abrir a
 * conversa zera as não lidas.
 *
 *   ?aoVivo=1  confere no gateway se o robô DA LOJA está conectado (mais lento)
 *   ?desde=ISO só as mensagens depois disto (a tela pergunta a cada poucos segundos)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });

  const { id } = await params;
  const contato = await prisma.crmContato.findUnique({ where: { id } });
  if (!contato || !podeVerContato(quem, contato)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

  const nomes = await nomesDaEquipe();
  const desde = req.nextUrl.searchParams.get("desde");
  if (desde) {
    // Só o que é novo — a pergunta de poucos em poucos segundos da tela aberta.
    const novas = await prisma.crmMensagem.findMany({
      where: { contatoId: id, criadoEm: { gt: new Date(desde) } },
      orderBy: { criadoEm: "asc" },
      take: 200,
    });
    if (novas.length > 0 && contato.naoLidas > 0) await prisma.crmContato.update({ where: { id }, data: { naoLidas: 0 } });
    return NextResponse.json({ contato: contatoCompleto({ ...contato, naoLidas: 0 }, nomes), mensagens: novas.map(mensagemParaTela) });
  }

  const [mensagens, eventos, reunioes, loja] = await Promise.all([
    mensagensDoContato(id, 300),
    prisma.crmEvento.findMany({ where: { contatoId: id }, orderBy: { criadoEm: "desc" }, take: 60 }),
    prisma.agendaReuniao.findMany({ where: { contatoId: id }, orderBy: { inicio: "desc" }, take: 20, include: { contato: true } }),
    contato.userId ? estadoDaLojaParaSuporte(contato.userId, { aoVivo: req.nextUrl.searchParams.get("aoVivo") === "1" }).catch(() => null) : Promise.resolve(null),
  ]);
  if (contato.naoLidas > 0) await prisma.crmContato.update({ where: { id }, data: { naoLidas: 0 } });

  return NextResponse.json({
    contato: contatoCompleto({ ...contato, naoLidas: 0 }, nomes),
    mensagens: mensagens.map(mensagemParaTela),
    eventos: eventos.map((e) => ({ id: e.id, tipo: e.tipo, texto: e.texto, autorNome: e.autorNome, autorTipo: e.autorTipo, criadoEm: e.criadoEm.toISOString() })),
    reunioes: reunioes.map((r) => reuniaoParaTela(r, nomes)),
    loja,
  });
}

/**
 * PATCH: edita a ficha. Vendedor mexe nos dados, na etapa e nas notas dos
 * contatos DELE; trocar o vendedor é só do admin (é o que muda a comissão).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const { id } = await params;
  const contato = await prisma.crmContato.findUnique({ where: { id } });
  if (!contato || !podeVerContato(quem, contato)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;
  const dados: Record<string, string | null> = {};
  for (const campo of ["nome", "nomeDaLoja", "cidade", "email", "notas"] as const) {
    if (campo in b) {
      const v = typeof b[campo] === "string" ? b[campo].trim() : "";
      dados[campo] = v ? v.slice(0, campo === "notas" ? 4000 : campo === "email" ? 160 : 120) : null;
      if (campo === "email" && dados[campo]) dados[campo] = dados[campo]!.toLowerCase();
    }
  }
  if ("origem" in b) {
    const origem = origemValida(b.origem);
    if (origem) dados.origem = origem;
  }

  try {
    if (Object.keys(dados).length > 0) {
      await prisma.crmContato.update({ where: { id }, data: dados });
      if ("notas" in dados && dados.notas !== contato.notas) {
        await registrarEvento(id, "NOTA", "Atualizou as notas.", autor);
      }
    }
    if ("etapa" in b) {
      const etapa = etapaValida(b.etapa);
      if (!etapa) return NextResponse.json({ error: "Etapa inválida." }, { status: 400 });
      await mudarEtapa(id, etapa, autor, typeof b.motivoPerda === "string" ? b.motivoPerda : null);
    }
    if ("userId" in b) {
      if (quem.tipo !== "ADMIN") return NextResponse.json({ error: "Só o admin liga o contato a uma loja." }, { status: 403 });
      await vincularLoja(id, typeof b.userId === "string" && b.userId ? b.userId : null, autor);
    }
    if ("vendedorId" in b) {
      if (quem.tipo !== "ADMIN") return NextResponse.json({ error: "Só o admin troca o vendedor do contato." }, { status: 403 });
      const vendedorId = typeof b.vendedorId === "string" && b.vendedorId ? b.vendedorId : null;
      if (vendedorId !== contato.vendedorId) {
        await atribuirVendedor(id, vendedorId, autor);
        if (vendedorId) {
          const quemE = contato.nomeDaLoja || contato.nome || "um contato";
          void avisarVendedor(vendedorId, {
            assunto: `🎯 Novo contato: ${quemE}`,
            texto: `O admin passou ${quemE} para a sua carteira. Veja a conversa e responda pelo WhatsApp do FireHub, na aba Conversas.`,
            link: `https://firehubfood.com.br/vendedor?aba=conversas&contato=${id}`,
          }).catch(() => null);
        }
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 400 });
  }

  const atualizado = await prisma.crmContato.findUnique({ where: { id } });
  return NextResponse.json({ contato: contatoCompleto(atualizado, await nomesDaEquipe()) });
}
