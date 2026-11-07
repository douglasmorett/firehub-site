/**
 * A RODADA DE COTAÇÃO: pedir os preços a cada fornecedor ativo (na hora da
 * agenda ou no "Pedir cotação agora") e, no fim, mandar o resumo ao comprador.
 *
 * Douglas, 07/11/2026: "deixar agendado o dia e a hora, e a loja dele vai
 * mandar mensagem para os fornecedores pedindo a atualização: o envio do
 * encarte, o envio dos preços" — e "depois para o comprador o resultado".
 */
import { prisma } from "@/lib/prisma";
import { paraEnvioWhatsApp } from "@/lib/telefone";
import { lerTrechosDaCotacao, configDaCotacao, cotacaoEstaLigada } from "./assinatura";
import { ligadoAgora } from "@/lib/modulo-pago";
import { horarioDevido, normalizarAgenda, relogioDaLoja } from "./agenda";
import { fornecedorAtende, maioresVariacoes } from "./comparativo";
import { enfileirar, proximaHoraLivre, ESPACO_ENTRE_ENVIOS_MS } from "./fila";
import { textoDoPedidoDePrecos, textoDoResumo } from "./mensagens";
import { comparativoDaLoja, dadosDaLoja, fornecedoresDaLoja, produtosDaLoja, VIDA_DA_RODADA_MS } from "./no-banco";

/** "Pedir cotação agora" de novo antes disto é clique repetido, não cotação nova. */
export const INTERVALO_MINIMO_MANUAL_MS = 60 * 60_000;

export class RodadaRecusadaError extends Error {}

/**
 * Cria a rodada e põe na fila um pedido de preços por fornecedor ativo com
 * WhatsApp, espaçados. `chave` (o horário da agenda) é única por loja: o mesmo
 * horário não vira duas rodadas.
 */
export async function iniciarRodada(franchiseeId: string, origem: "AGENDA" | "MANUAL", chave: string | null, agora: Date = new Date()) {
  if (origem === "MANUAL") {
    const ultima = await prisma.cotacaoRodada.findFirst({ where: { franchiseeId, origem: "MANUAL" }, orderBy: { criadaEm: "desc" }, select: { criadaEm: true } });
    if (ultima && agora.getTime() - ultima.criadaEm.getTime() < INTERVALO_MINIMO_MANUAL_MS) {
      const min = Math.ceil((INTERVALO_MINIMO_MANUAL_MS - (agora.getTime() - ultima.criadaEm.getTime())) / 60_000);
      throw new RodadaRecusadaError(`Você já pediu a cotação há pouco. Para não encher o WhatsApp dos fornecedores, dá para pedir de novo em ${min} min.`);
    }
  }
  const [loja, config, fornecedores, produtos] = await Promise.all([
    dadosDaLoja(franchiseeId), configDaCotacao(franchiseeId), fornecedoresDaLoja(franchiseeId, true), produtosDaLoja(franchiseeId, true),
  ]);
  const comTelefone = fornecedores.filter((f) => f.telefone && paraEnvioWhatsApp(f.telefone));
  if (!comTelefone.length) throw new RodadaRecusadaError("Cadastre pelo menos um fornecedor ativo com WhatsApp.");

  let rodada;
  try {
    rodada = await prisma.cotacaoRodada.create({
      data: { franchiseeId, origem, chave, resumoApos: new Date(agora.getTime() + Math.max(1, config.horasParaResumo) * 60 * 60_000) },
    });
  } catch (err) {
    // O mesmo horário da agenda já virou rodada (outro servidor, ou o cron de novo).
    if ((err as any)?.code === "P2002") return null;
    throw err;
  }

  const minutos = relogioDaLoja(agora, loja.tz).minutos;
  const inicio = await proximaHoraLivre(franchiseeId, agora);
  const envios = comTelefone.map((f, i) => ({
    franchiseeId, rodadaId: rodada.id, fornecedorId: f.id, tipo: "PRECOS" as const, telefone: f.telefone!,
    texto: textoDoPedidoDePrecos({
      loja: loja.nome, contato: f.contato, minutos,
      itens: produtos.filter((p) => fornecedorAtende(f, p.categoria)).map((p) => p.nome),
    }),
    enviarApos: new Date(inicio.getTime() + i * ESPACO_ENTRE_ENVIOS_MS),
  }));
  const naFila = await enfileirar(envios);
  return { rodadaId: rodada.id, naFila, semTelefone: fornecedores.length - comTelefone.length };
}

/** O cron: cada loja com o módulo ligado e um horário da agenda vencendo agora. */
export async function rodarAgendas(agora: Date = new Date()): Promise<number> {
  const linhas = await prisma.$queryRawUnsafe<{ franchiseeId: string; trechos: unknown; agenda: unknown }[]>(
    `SELECT "franchiseeId", "trechos", "agenda" FROM "CotacaoAssinatura" WHERE jsonb_array_length(CASE WHEN jsonb_typeof("agenda") = 'array' THEN "agenda" ELSE '[]'::jsonb END) > 0`,
  );
  let criadas = 0;
  for (const l of linhas) {
    try {
      const agenda = normalizarAgenda(typeof l.agenda === "string" ? JSON.parse(l.agenda) : l.agenda);
      if (!agenda.length) continue;
      // Ligado pelos trechos; isenta (sem trecho) cai na conferência completa.
      if (!ligadoAgora(lerTrechosDaCotacao(l.trechos), agora) && !(await cotacaoEstaLigada(l.franchiseeId))) continue;
      const { tz } = await dadosDaLoja(l.franchiseeId);
      const chave = horarioDevido(agenda, agora, tz);
      if (!chave) continue;
      const ja = await prisma.cotacaoRodada.findFirst({ where: { franchiseeId: l.franchiseeId, chave }, select: { id: true } });
      if (ja) continue;
      const r = await iniciarRodada(l.franchiseeId, "AGENDA", chave, agora).catch((err) => {
        if (!(err instanceof RodadaRecusadaError)) console.error(`[Cotação] Rodada da agenda da loja ${l.franchiseeId} falhou:`, err?.message);
        return null;
      });
      if (r) criadas++;
    } catch (err: any) {
      console.error(`[Cotação] Agenda da loja ${l.franchiseeId}:`, err?.message);
    }
  }
  return criadas;
}

/**
 * O resumo para o comprador: na hora marcada (X horas depois do pedido de
 * preços) ou antes, se todos já responderam. Uma vez por rodada (a marca
 * `resumoEnviadoEm` é pega com UPDATE condicional).
 */
export async function enviarResumos(agora: Date = new Date()): Promise<number> {
  const rodadas = await prisma.cotacaoRodada.findMany({
    where: { resumoEnviadoEm: null, criadaEm: { gte: new Date(agora.getTime() - VIDA_DA_RODADA_MS) } },
    take: 200,
  });
  let mandados = 0;
  for (const r of rodadas) {
    try {
      const [envios, respostas] = await Promise.all([
        prisma.cotacaoEnvio.findMany({ where: { rodadaId: r.id, tipo: "PRECOS" }, select: { fornecedorId: true, status: true } }),
        prisma.cotacaoResposta.findMany({ where: { rodadaId: r.id, status: "LIDA" }, select: { fornecedorId: true } }),
      ]);
      const pendentes = envios.some((e) => e.status === "FILA" || e.status === "ENVIANDO");
      const pedidos = new Set(envios.filter((e) => e.status === "ENVIADO").map((e) => e.fornecedorId)).size;
      const responderam = new Set(respostas.map((x) => x.fornecedorId)).size;
      const venceu = r.resumoApos ? r.resumoApos.getTime() <= agora.getTime() : false;
      const todos = !pendentes && pedidos > 0 && responderam >= pedidos;
      if (!venceu && !todos) continue;
      const pego = await prisma.cotacaoRodada.updateMany({ where: { id: r.id, resumoEnviadoEm: null }, data: { resumoEnviadoEm: agora } });
      if (pego.count === 0 || pedidos === 0) continue;

      const [loja, config] = await Promise.all([dadosDaLoja(r.franchiseeId), configDaCotacao(r.franchiseeId)]);
      const destino = config.compradorTelefone || loja.telefoneDoDono;
      if (!destino || !paraEnvioWhatsApp(destino)) continue;
      const { comparativo } = await comparativoDaLoja(r.franchiseeId, agora);
      const { quedas, altas } = maioresVariacoes(comparativo, r.criadaEm.toISOString());
      const paraConferir = await prisma.cotacaoPreco.count({ where: { rodadaId: r.id, status: { in: ["SUGERIDO", "SEM_PRODUTO"] } } });
      const texto = textoDoResumo({ loja: loja.nome, responderam, pedidos, quedas, altas, paraConferir });
      await enfileirar([{ franchiseeId: r.franchiseeId, rodadaId: r.id, tipo: "RESUMO", telefone: destino, texto, enviarApos: await proximaHoraLivre(r.franchiseeId, agora) }]);
      mandados++;
    } catch (err: any) {
      console.error(`[Cotação] Resumo da rodada ${r.id}:`, err?.message);
    }
  }
  return mandados;
}
