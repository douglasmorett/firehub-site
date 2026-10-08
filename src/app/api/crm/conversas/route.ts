import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { filtroDeContatos, nomesDaEquipe, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { etapaValida } from "@/lib/crm/etapas";
import { contatoParaLista } from "@/lib/crm/serializar";
import { configDoAtendimento } from "@/lib/atendimento/config";

export const dynamic = "force-dynamic";

/**
 * GET: a lista de contatos — a coluna da esquerda da caixa de atendimento e o
 * funil do CRM. Vendedor só recebe os contatos dele (lib/crm/acesso.ts).
 *
 *   ?busca=     nome, loja, cidade, e-mail ou telefone
 *   ?filtro=    todas · aguardando (pediu pessoa) · naoLidas · semVendedor · comMensagem
 *   ?vendedor=  id (admin)
 *   ?etapa=     NOVO · CONVERSANDO · …
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });

  const p = req.nextUrl.searchParams;
  const busca = (p.get("busca") || "").trim();
  const filtro = p.get("filtro") || "todas";
  const etapa = etapaValida(p.get("etapa"));
  const vendedor = p.get("vendedor");
  const limite = Math.min(Math.max(Number(p.get("limite")) || 300, 1), 1000);

  const e: Prisma.CrmContatoWhereInput[] = [filtroDeContatos(quem)];
  if (etapa) e.push({ etapa });
  if (quem.tipo === "ADMIN" && vendedor) e.push(vendedor === "sem" ? { vendedorId: null } : { vendedorId: vendedor });
  if (filtro === "aguardando") e.push({ aguardandoHumanoDesde: { not: null } });
  if (filtro === "naoLidas") e.push({ naoLidas: { gt: 0 } });
  if (filtro === "semVendedor") e.push({ vendedorId: null });
  if (filtro === "comMensagem") e.push({ ultimaMensagemEm: { not: null } });
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    e.push({
      OR: [
        { nome: { contains: busca, mode: "insensitive" } },
        { nomeDaLoja: { contains: busca, mode: "insensitive" } },
        { cidade: { contains: busca, mode: "insensitive" } },
        { email: { contains: busca, mode: "insensitive" } },
        ...(digitos.length >= 4 ? [{ telefone: { contains: digitos.slice(-8) } }, { jid: { contains: digitos.slice(-8) } }] : []),
      ],
    });
  }

  const [contatos, nomes, contagem] = await Promise.all([
    prisma.crmContato.findMany({
      where: { AND: e },
      orderBy: [{ ultimaMensagemEm: { sort: "desc", nulls: "last" } }, { criadoEm: "desc" }],
      take: limite,
    }),
    nomesDaEquipe(),
    // Os números do topo (aguardando pessoa, não lidas) sempre sobre TODOS os
    // contatos que a pessoa enxerga, não só sobre o filtro aberto.
    prisma.crmContato.groupBy({
      by: ["etapa"],
      where: filtroDeContatos(quem),
      _count: { _all: true },
    }),
  ]);
  const [aguardando, naoLidas] = await Promise.all([
    prisma.crmContato.count({ where: { ...filtroDeContatos(quem), aguardandoHumanoDesde: { not: null } } }),
    prisma.crmContato.count({ where: { ...filtroDeContatos(quem), naoLidas: { gt: 0 } } }),
  ]);

  return NextResponse.json({
    contatos: contatos.map((c) => contatoParaLista(c, nomes)),
    totais: {
      porEtapa: Object.fromEntries(contagem.map((g) => [g.etapa, g._count._all])),
      aguardando,
      naoLidas,
    },
    quem: { tipo: quem.tipo, id: quem.id, nome: quem.nome },
    // A tela diz "robô atende esta conversa" só se o interruptor geral estiver
    // ligado — o do WhatsApp ou o do chat do painel, conforme a conversa.
    ...(await configDoAtendimento().then((c) => ({ roboLigado: c.roboLigado, roboNoPainel: c.roboNoPainel }))),
  });
}
