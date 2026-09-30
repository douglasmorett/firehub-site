import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { configDoAtendimento } from "@/lib/atendimento/config";
import { sincronizarConexao } from "@/lib/atendimento/entrada";
import { enviarTexto, estadoNoGateway, pedirQrCode } from "@/lib/atendimento/whatsapp";
import { avisarVendedor } from "@/lib/atendimento/avisos";
import { gravarMensagem } from "./mensagens";
import { horaDaAgenda, dataDaAgenda } from "./agenda";
import { jidDoTelefone } from "./telefone";

/**
 * O QUE A AGENDA E O NÚMERO DO FIREHUB FAZEM SOZINHOS — a cada 5 minutos
 * (job `crm-lembretes` do scripts/cron-runner.js):
 *
 *   1. o número caiu e já tinha conectado → pede a reconexão ao gateway (a
 *      sessão salva volta sem QR na maioria das quedas);
 *   2. lembrete ao contato 1 h antes da demonstração (uma vez; remarcar zera);
 *   3. aviso ao vendedor que não saiu na hora em que marcaram na agenda dele
 *      (número fora do ar naquele momento) — até 3 h depois de marcada.
 */
export async function rodarLembretes(agora = new Date()) {
  const resultado = { reconectou: false, lembretes: 0, avisos: 0 };
  if (!(await garantirEstruturaDoCrm())) return resultado;

  const estado = await estadoNoGateway();
  const config = await sincronizarConexao(estado);
  // Só nas primeiras 2 h da queda: depois disso é logout de verdade (aparelho
  // removido no celular) e pedir conexão a cada 5 min só geraria QR para ninguém.
  const caiuEm = config.conexao.desconectadoDesde ? new Date(config.conexao.desconectadoDesde).getTime() : agora.getTime();
  if (estado.conectado === false && config.conexao.jaConectou && agora.getTime() - caiuEm < 2 * 60 * 60_000) {
    const r = await pedirQrCode().catch(() => null);
    resultado.reconectou = !!r?.conectado;
  }
  if (config.conexao.conectado !== true) return resultado;

  if (config.lembreteAoContato) {
    const reunioes = await prisma.agendaReuniao.findMany({
      where: {
        status: "MARCADA",
        tipo: { not: "BLOQUEIO" },
        contatoId: { not: null },
        lembreteEm: null,
        inicio: { gt: new Date(agora.getTime() + 10 * 60_000), lte: new Date(agora.getTime() + 70 * 60_000) },
      },
      include: { contato: true },
      take: 30,
    });
    for (const r of reunioes) {
      const c = r.contato;
      const destino = c?.jid || jidDoTelefone(c?.telefone);
      if (!c || !destino) continue;
      const vendedor = await prisma.ambassador.findUnique({ where: { id: r.vendedorId }, select: { name: true } });
      const primeiroNome = (c.nome || "").split(/\s+/)[0];
      const texto =
        `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! Passando para lembrar da sua ${r.tipo === "DEMONSTRACAO" ? "demonstração do FireHub" : "reunião com o FireHub"} ` +
        `hoje às ${horaDaAgenda(r.inicio)}${vendedor ? ` com ${vendedor.name.split(/\s+/)[0]}` : ""}. ` +
        `${r.local && /^https?:\/\//.test(r.local) ? `O link é este: ${r.local}` : "Vamos te chamar por aqui na hora."} Até já! 🔥`;
      // Marca antes de mandar: dois ciclos seguidos nunca mandam o mesmo lembrete.
      const marcou = await prisma.agendaReuniao.updateMany({ where: { id: r.id, lembreteEm: null }, data: { lembreteEm: agora } });
      if (marcou.count === 0) continue;
      const envio = await enviarTexto(destino, texto);
      await gravarMensagem({ contatoId: c.id, direcao: "SAIDA", autor: "SISTEMA", autorNome: "Lembrete da agenda", texto, status: envio.ok ? "OK" : "FALHOU" });
      if (envio.ok) resultado.lembretes++;
    }
  }

  const semAviso = await prisma.agendaReuniao.findMany({
    where: {
      avisoVendedorEm: null,
      status: "MARCADA",
      tipo: { not: "BLOQUEIO" },
      criadoEm: { gte: new Date(agora.getTime() - 3 * 60 * 60_000) },
      inicio: { gt: agora },
    },
    take: 30,
  });
  for (const r of semAviso) {
    const [, m, d] = dataDaAgenda(r.inicio).split("-");
    const ok = await avisarVendedor(r.vendedorId, `📅 Marcaram na sua agenda: ${r.titulo} — ${d}/${m} às ${horaDaAgenda(r.inicio)}.\nhttps://firehubfood.com.br/vendedor?aba=agenda`);
    if (ok) {
      await prisma.agendaReuniao.update({ where: { id: r.id }, data: { avisoVendedorEm: new Date() } });
      resultado.avisos++;
    }
  }
  return resultado;
}

/** A config mora no CrmConfig — reexportada para a rota do cron não precisar saber disso. */
export { configDoAtendimento };
