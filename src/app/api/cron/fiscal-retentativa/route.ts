/**
 * GET /api/cron/fiscal-retentativa
 *
 * A NFC-e que não saiu de primeira não pode ficar parada esperando alguém
 * lembrar dela.
 *
 * ── O que ficava parado ─────────────────────────────────────────────────────
 *
 *   - "Processando": a SEFAZ recebeu e não respondeu a tempo (o Focus devolve
 *     202). O pedido ficava PENDING com `processando: true` até alguém abrir a
 *     tela fiscal e clicar em "Consultar situação" — e a trava de edição
 *     (lib/edicao-de-pedido) segurava o pedido nesse meio tempo.
 *   - FAILED por comunicação: provedor fora do ar, timeout. A nota era devida
 *     e ninguém tentava de novo.
 *   - Pedido que chegou à hora da nota por um caminho sem gancho (rota
 *     despachada, KDS, Brendi, JotaJá, 99Food).
 *   - Conta de mesa fechada sem nota: a nota da conta era tentada uma vez,
 *     sem esperar, no fechamento, e a varredura olhava só pedido sem mesa.
 *
 * O trabalho mora em lib/fiscal-automatico (`retentarNotasFiscais`): consulta
 * os processando, reemite os transitórios com espera dobrando e teto de 5
 * tentativas, e varre os esquecidos (pedidos e contas de mesa) das últimas 2
 * horas. Só lojas com a emissão LIGADA entram — sem nenhuma, é uma leitura e
 * nada mais.
 *
 * A falha que não vai sair sozinha (5 tentativas esgotadas, ou a do botão
 * Emitir num pedido que a automática não cobre) sai da fila de vez, com o
 * motivo gravado no pedido (`retentativaEncerrada`), e conta em `encerradas`
 * na resposta. Antes a busca era `take: 40` sem ordem, e 40 dessas linhas
 * ocupavam a fila por 24 h.
 *
 * ── Registro ────────────────────────────────────────────────────────────────
 *
 * Roda porque está na lista `jobs` de scripts/cron-runner.js (é ele que o
 * Dockerfile sobe em produção), a cada 2 minutos: o gancho de status é a via
 * principal, e isto é a rede de segurança — tem de chegar antes de o motoboy
 * chegar ao cliente. Até 24/09/2026 a linha não existia e nada disto rodava
 * sozinho (nota processando ficava PENDING travando o pedido; contingência
 * não era acompanhada; conta de mesa esquecida só saía no fechamento de
 * caixa). scripts/teste-fiscal-retentativa.ts confere que a linha está lá.
 *
 * Rodadas sobrepostas: o cron-runner desiste da chamada aos 55 s, mas a rota
 * continua rodando — uma rodada lenta (SEFAZ esperando timeout) encostava na
 * seguinte e as duas trabalhavam os mesmos pedidos. Agora o cron-runner não
 * dispara este job enquanto a chamada anterior não voltou (`exclusivo`), e
 * cada loja passa pela CONCESSÃO da rodada (lib/fiscal-automatico →
 * sqlPegarConcessaoDaRodada), que vale entre servidores: a segunda rodada
 * pula a loja que a primeira ainda está trabalhando (`lojasEmOutraRodada` na
 * resposta). O orçamento vale para a rodada inteira: nenhuma varredura começa
 * depois dele (`acabou`).
 *
 * Autenticação: a mesma de todo cron (lib/cron-auth). E só em produção
 * (`motivoParaOCronFiscalNaoRodar`, lib/fiscal-momento): em development o
 * cron-auth libera qualquer chamada, e o .env de desenvolvimento deste
 * projeto aponta para o banco de PRODUÇÃO — um GET no servidor de
 * desenvolvimento emitiria NFC-e reais e gravaria em pedidos reais com o
 * código de uma branch.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { retentarNotasFiscais } from "@/lib/fiscal-automatico";
import { motivoParaOCronFiscalNaoRodar } from "@/lib/fiscal-momento";

export const dynamic = "force-dynamic";
// Uma emissão pode esperar a SEFAZ (45 s de POST + ~12 s de consultas). O
// orçamento da rodada é 45 s: o que não couber fica para a próxima.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const naoRoda = motivoParaOCronFiscalNaoRodar(process.env);
  if (naoRoda) return NextResponse.json({ ok: false, error: "fora_de_producao", mensagem: naoRoda }, { status: 403 });
  try {
    const resumo = await retentarNotasFiscais({ orcamentoMs: 45_000 });
    return NextResponse.json({ ok: true, ...resumo });
  } catch (err: any) {
    console.error("[Cron Fiscal Retentativa] Erro:", err?.message);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
