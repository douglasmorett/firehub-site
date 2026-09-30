import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { configDoAtendimento } from "@/lib/atendimento/config";
import { sincronizarConexao } from "@/lib/atendimento/entrada";
import { estadoNoGateway, pedirQrCode } from "@/lib/atendimento/whatsapp";
import { avisarVendedor } from "@/lib/atendimento/avisos";
import { horaDaAgenda, dataDaAgenda } from "./agenda";

/**
 * O QUE O CRM FAZ SOZINHO — a cada 5 minutos (job `crm-lembretes` do
 * scripts/cron-runner.js):
 *
 *   1. o número do FireHub caiu e já tinha conectado → pede a reconexão ao
 *      gateway (a sessão salva volta sem QR na maioria das quedas);
 *   2. aviso ao vendedor (por e-mail) que não saiu na hora em que marcaram na
 *      agenda dele — até 3 h depois de marcada.
 *
 * NÃO manda nada pelo WhatsApp do FireHub: aquele número só responde quem
 * escreveu (o FireHub já perdeu um número por notificação automática — regra
 * do Douglas, 30/09/2026). O lembrete ao contato é um BOTÃO na reunião, que uma
 * pessoa clica (`textoDoLembrete` + api/crm/agenda/[id]/lembrete).
 */

/** O lembrete da reunião, do jeito que sai para o contato quando alguém clica em "Mandar lembrete". */
export function textoDoLembrete(r: { tipo: string; inicio: Date; local: string | null }, contato: { nome: string | null }, vendedorNome: string | null): string {
  const primeiroNome = (contato.nome || "").split(/\s+/)[0];
  const [, m, d] = dataDaAgenda(r.inicio).split("-");
  const hoje = dataDaAgenda(new Date()) === dataDaAgenda(r.inicio);
  return (
    `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! Passando para lembrar da sua ${r.tipo === "DEMONSTRACAO" ? "demonstração do FireHub" : "reunião com o FireHub"} ` +
    `${hoje ? "hoje" : `no dia ${d}/${m}`} às ${horaDaAgenda(r.inicio)}${vendedorNome ? ` com ${vendedorNome.split(/\s+/)[0]}` : ""}. ` +
    `${r.local && /^https?:\/\//.test(r.local) ? `O link é este: ${r.local}` : "Vamos te chamar por aqui na hora."} Até já! 🔥`
  );
}

export async function rodarLembretes(agora = new Date()) {
  const resultado = { reconectou: false, avisos: 0 };
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
    const ok = await avisarVendedor(r.vendedorId, {
      assunto: `📅 Na sua agenda: ${d}/${m} às ${horaDaAgenda(r.inicio)}`,
      texto: `Marcaram na sua agenda: ${r.titulo} — ${d}/${m} às ${horaDaAgenda(r.inicio)}.`,
      link: "https://firehubfood.com.br/vendedor?aba=agenda",
    });
    if (ok) {
      await prisma.agendaReuniao.update({ where: { id: r.id }, data: { avisoVendedorEm: new Date() } });
      resultado.avisos++;
    }
  }
  return resultado;
}

/** A config mora no CrmConfig — reexportada para a rota do cron não precisar saber disso. */
export { configDoAtendimento };
