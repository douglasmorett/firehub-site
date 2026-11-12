import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO, dataDaLoja, horaDaLoja } from "@/lib/fuso";
import { Prisma } from "@prisma/client";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pegarVez } from "@/lib/vez";
import { sendEvolutionMessage, sendEvolutionMediaUrl } from "@/lib/whatsapp-evolution";
import { telefoneDeVerdade, paraEnvioWhatsApp } from "@/lib/telefone";
import { RECUPERACAO_PELO_QR_LIGADA, aceiteDoRiscoQr } from "@/lib/disparo-em-massa";
import { chaveDoTelefone, mesclarNoChatbotConfig } from "@/lib/disparo-pelo-qr";
import { foraDaAutomacao, marcosLigadosNoOficial } from "@/lib/disparo-oficial/servidor";
import { telefoneDaMeta } from "@/lib/disparo-oficial/regras";
import { acharCupom, cupomVenceu } from "@/lib/cupons";
import { ehConversaDeCliente } from "@/lib/jid-de-cliente";
import { mesmoNumero, numeroDaEquipeDoFireHub, numeroEstaNaListaDeIgnorados } from "@/lib/numeros-ignorados";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/recuperacao-clientes
 *
 * Traz de volta quem sumiu: manda a mensagem de 7, 15 e 30 dias para o cliente
 * que não pede há esse tempo.
 *
 * ── POR QUE ESTE ARQUIVO PASSOU A EXISTIR ───────────────────────────────────
 *
 * A tela do lojista já dizia "Recupere clientes ausentes AUTOMATICAMENTE" e
 * tinha os três interruptores (7, 15 e 30 dias) com mensagem, cupom e imagem
 * configuráveis — tudo salvo bonitinho em `chatbotConfig`. Só que NENHUM código
 * lia aquilo para enviar: `autoRecuperation7d/15d/30d`, `msg7d/15d/30d` e
 * `img7d/15d/30d` eram escritos pela tela e nunca consumidos, e o cron-runner
 * não tinha job nenhum de marketing. O único envio existente era o
 * `send_test_7d`, que manda UMA mensagem para um número digitado à mão.
 *
 * Ou seja: o lojista clicava ATIVADO, via o verde na tela, e não saía nada.
 * Meses de cliente sumido sem nenhuma tentativa de retorno.
 *
 * ── COMO ESTE DISPARO EVITA VIRAR SPAM ──────────────────────────────────────
 *
 * 1. JANELA FECHADA: pega quem fez o último pedido ENTRE 7 e 8 dias atrás (e o
 *    equivalente em 15 e 30). Como a janela tem 24h e o job roda uma vez por
 *    dia, cada cliente cai nela uma única vez por marco. Não precisa de tabela
 *    de "já enviei" para não repetir.
 * 2. TRAVA DIÁRIA POR LOJA: `ultimaRecuperacaoEm` guarda o dia em que a loja
 *    já disparou. Se o cron rodar de novo no mesmo dia (reinício, execução
 *    manual), ele não manda outra vez.
 * 3. HORÁRIO CIVILIZADO: só entre 10h e 20h de Brasília. Ninguém recebe
 *    propaganda da pastelaria às 4 da manhã.
 * 4. QUEM JÁ VOLTOU NÃO RECEBE: o critério é o ÚLTIMO pedido. Quem pediu
 *    ontem não está em nenhuma janela.
 * 5. TETO POR LOJA E RESPIRO ENTRE ENVIOS: protege o número de WhatsApp da
 *    loja de ser marcado como spam e bloqueado.
 *
 * ── RELIGADA COM ACEITE (11/11/2026) ────────────────────────────────────────
 *
 * Pausada em 13/10 (saía pelo QR) e religada pelo Douglas em 11/11 só para a
 * loja que ACEITOU o risco (lib/disparo-em-massa.ts). O aceite é conferido de
 * novo antes de CADA envio: desfeito no meio da leva, a leva para.
 *
 * Convive com a recuperação OFICIAL (lib/disparo-oficial, rodarRecuperacao)
 * sem o cliente receber a mesma coisa pelos dois caminhos:
 *   - o marco ligado no oficial fica parado aqui (marcosLigadosNoOficial);
 *   - quem recebeu uma automática do oficial nos últimos 6 dias, ou pediu
 *     para parar ("Parar promoções"), não recebe aqui (foraDaAutomacao);
 *   - quem recebe aqui fica anotado em chatbotConfig.recuperacaoQrEnvios, e o
 *     oficial lê esse mapa no mesmo foraDaAutomacao.
 *
 * O cupom de cada marco é conferido no cadastro de cupons: desligado ou
 * vencido, o marco não sai (não se promete desconto que o site recusa).
 *
 * ── QUEM CONVERSOU E NÃO COMPROU (11/11/2026, Lucas/Frangoso) ───────────────
 *
 * Mais um marco: quem mandou mensagem ao robô da loja há DIAS_DA_CONVERSA dias
 * e não tem nenhum pedido nesta loja. A fonte é ChatbotConversationState (uma
 * linha por loja e conversa, gravada pelo anti-loop a cada mensagem recebida
 * e nunca apagada; a faxina só zera o histórico). `lastMessageAt` é a última
 * mensagem do contato. Ficam de fora: conversa que o dono assumiu pelo
 * celular (humanTakeoverAt — fornecedor, família, motoboy), conversa que o
 * robô passou para atendente (degradedAt), endereço @lid (não é telefone),
 * motoboys e funcionários da loja, a lista de números que o robô ignora e o
 * próprio número da loja.
 */

/** Dias depois da última mensagem ao robô, para quem conversou e não comprou. */
const DIAS_DA_CONVERSA = 3;

/** Marcos de dias sem comprar, com as chaves que a tela do lojista já grava. */
const MARCOS = [
  { dias: 7, ligado: "autoRecuperation7d", msg: "msg7d", img: "img7d", cupom: "coupon7d", conversa: false },
  { dias: 15, ligado: "autoRecuperation15d", msg: "msg15d", img: "img15d", cupom: "coupon15d", conversa: false },
  { dias: 30, ligado: "autoRecuperation30d", msg: "msg30d", img: "img30d", cupom: "coupon30d", conversa: false },
  { dias: DIAS_DA_CONVERSA, ligado: "autoRecuperacaoConversa", msg: "msgConversa", img: "imgConversa", cupom: "couponConversa", conversa: true },
] as const;

/** Por quanto tempo o envio fica anotado (o oficial espera 6 dias; folga de 1). */
const GUARDA_DO_ENVIO_MS = 7 * 24 * 60 * 60 * 1000;

/** Teto de mensagens por loja por execução: o WhatsApp bloqueia número que dispara demais. */
const TETO_POR_LOJA = 60;

/**
 * Quanto tempo a reserva do dia segura outra execução. A leva mais longa (60
 * envios com respiro) passa de uma hora; depois disso, reserva sem conclusão
 * é processo que morreu no meio e a execução seguinte retoma.
 */
const RESERVA_VALE_MS = 100 * 60_000;

/**
 * Respiro ALEATÓRIO entre um envio e outro.
 *
 * O que derruba número de WhatsApp não é só o volume: é o PADRÃO. Trinta
 * mensagens saindo exatamente a cada 1,5 segundo é assinatura de robô — é o
 * que o antispam procura. Gente real tem ritmo irregular: digita, se distrai,
 * volta.
 *
 * Por isso o intervalo é sorteado numa faixa larga e, a cada poucos envios,
 * entra uma pausa maior, como se a pessoa tivesse largado o telefone. Fica
 * lento de propósito: 60 mensagens levam cerca de uma hora, e é esse vagar
 * que mantém o número da loja vivo.
 */
const RESPIRO_MIN_MS = 25_000;
const RESPIRO_MAX_MS = 75_000;
/** A cada N envios, uma pausa longa (2 a 5 min), imitando quem parou um pouco. */
const ENVIOS_ATE_PAUSA_LONGA = 8;

const aleatorio = (min: number, max: number) => Math.floor(min + Math.random() * (max - min));
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));


export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Interruptor geral (lib/disparo-em-massa.ts). Ligado, cada loja ainda precisa do aceite.
  if (!RECUPERACAO_PELO_QR_LIGADA) {
    return NextResponse.json({ ok: true, pausada: "recuperação pelo QR desligada no interruptor geral" });
  }
  // Cinto do cron-runner (que já só dispara no líder): com dois containers
  // vivos — o velho e o novo no deploy, ou A e B —, só um roda esta volta.
  // Vale 48 min (~0,8 do intervalo) e é renovada pelo mesmo servidor (lib/vez.ts).
  if (!(await pegarVez("job:recuperacao-clientes", 48 * 60_000))) {
    return NextResponse.json({ ok: true, pulada: "outro servidor está nesta volta" });
  }

  const log: string[] = [];
  let enviadosNoTotal = 0;

  try {
    // Só lojas que aceitaram o risco e ligaram pelo menos um dos marcos.
    const lojas = await prisma.user.findMany({
      where: { NOT: { chatbotConfig: { equals: Prisma.DbNull } } },
      select: { id: true, chatbotConfig: true },
    });

    for (const daLista of lojas) {
      const cfgDaLista = (daLista.chatbotConfig as any) || {};
      if (!aceiteDoRiscoQr(cfgDaLista) || !MARCOS.some(m => cfgDaLista[m.ligado] === true)) continue;

      // Lida de novo AGORA: a leva de cada loja leva até uma hora, e a lista lá
      // de cima pode ter sido lida há horas — um aceite desfeito nesse meio
      // tempo não pode valer como aceito.
      const loja = await prisma.user.findUnique({
        where: { id: daLista.id },
        select: { id: true, storeName: true, name: true, slug: true, chatbotConfig: true, storeTimezone: true, storeCoupons: true },
      });
      if (!loja) continue;
      const cfg = (loja.chatbotConfig as any) || {};
      if (!aceiteDoRiscoQr(cfg)) continue;
      // O marco que a recuperação oficial já manda fica parado aqui.
      const noOficial = await marcosLigadosNoOficial(loja.id).catch(() => [] as number[]);
      const marcosLigados = MARCOS.filter(m => cfg[m.ligado] === true && (m.conversa || !noOficial.includes(m.dias)));
      if (marcosLigados.length === 0) continue;

      // Janela das 10h às 20h NO RELÓGIO DA LOJA. Era uma checagem só, em
      // Brasília, antes do laço: uma loja em Manaus recebia mensagem às 9h dela.
      const fuso = loja.storeTimezone || FUSO_PADRAO;
      const hora = horaDaLoja(fuso);
      if (hora < 10 || hora >= 20) {
        log.push(`⏭️ ${loja.storeName || loja.name}: fora do horário (${hora}h na loja)`);
        continue;
      }
      const hoje = dataDaLoja(fuso);

      // Já disparou hoje? Então acabou por hoje.
      // Já fez hoje? Só se a leva CHEGOU AO FIM (`recuperacaoConcluidaEm`).
      // Reservado mas não concluído: se a reserva é recente, outra execução
      // ainda está mandando; se passou de RESERVA_VALE_MS, o processo morreu
      // no meio (deploy reinicia o servidor — Frangoso, 12/11/2026: 3 deploys
      // no dia e nenhuma mensagem saiu) e esta execução retoma. Quem já recebeu
      // está em `fora` (recuperacaoQrEnvios), então retomar não repete ninguém.
      if (cfg.recuperacaoConcluidaEm === hoje) {
        log.push(`⏭️ ${loja.storeName || loja.name}: já disparou hoje`);
        continue;
      }
      if (cfg.ultimaRecuperacaoEm === hoje) {
        const reservadaHa = Date.now() - new Date(cfg.recuperacaoReservadaEm || 0).getTime();
        if (reservadaHa < RESERVA_VALE_MS) {
          log.push(`⏭️ ${loja.storeName || loja.name}: leva de hoje em andamento`);
          continue;
        }
        log.push(`🔁 ${loja.storeName || loja.name}: a leva de hoje não terminou — retomando`);
      }

      // O dia é RESERVADO antes do primeiro envio, não depois do último.
      //
      // Com os respiros anti-spam, a leva de uma loja pode levar mais de uma
      // hora — e o job roda de hora em hora. Marcando só no fim, a execução
      // seguinte encontrava a trava aberta e mandava a MESMA mensagem para os
      // MESMOS clientes em paralelo: spam em dobro, que é justamente o que
      // derruba o número da loja. Se o processo morrer no meio, o custo é a
      // loja perder parte da leva de um dia — muito mais barato que o dobro.
      // Grava só este campo (jsonb `||`), sem reescrever o resto da config.
      await mesclarNoChatbotConfig(loja.id, { ultimaRecuperacaoEm: hoje, recuperacaoReservadaEm: new Date().toISOString() });

      // Quem não entra hoje: pediu para parar, ou recebeu uma automática (do
      // oficial ou daqui) nos últimos 6 dias. Chaves no formato telefoneDaMeta.
      const fora = await foraDaAutomacao(loja.id).catch(() => new Set<string>());

      // Último pedido de cada telefone desta loja. O agrupamento devolve o
      // MAIOR createdAt por telefone — é isso que define "sumido há N dias".
      // Uma consulta por loja (era uma por marco).
      const porTelefone = await prisma.customerOrder.groupBy({
        by: ["customerPhone"],
        where: {
          franchiseeId: loja.id,
          customerPhone: { not: null as any },
          status: { not: "CANCELADO" },
        },
        _max: { createdAt: true },
      });

      let enviadosDaLoja = 0;
      let falhasDaLoja = 0;
      let aceiteDesfeito = false;
      const detalhes: string[] = [];
      const envios: Record<string, string> = {
        ...(cfg.recuperacaoQrEnvios && typeof cfg.recuperacaoQrEnvios === "object" ? cfg.recuperacaoQrEnvios : {}),
      };

      for (const marco of marcosLigados) {
        if (enviadosDaLoja >= TETO_POR_LOJA || aceiteDesfeito) break;
        const nomeDoMarco = marco.conversa ? "conversou e não comprou" : `${marco.dias}d`;

        const fim = new Date(Date.now() - marco.dias * 24 * 60 * 60 * 1000);
        const inicio = new Date(fim.getTime() - 24 * 60 * 60 * 1000);

        const alvos = (
          marco.conversa
            ? await conversaramENaoCompraram(loja.id, cfg, inicio, fim, porTelefone.map(g => g.customerPhone))
            : porTelefone
                .filter(g => {
                  const ultimo = g._max?.createdAt;
                  if (!ultimo || !g.customerPhone) return false;
                  return ultimo >= inicio && ultimo < fim;
                })
                .map(g => g.customerPhone as string)
        )
          // Embaralha: enviar sempre na mesma ordem (a do banco) é mais um
          // padrão previsível para o antispam reconhecer.
          .sort(() => Math.random() - 0.5);

        if (alvos.length === 0) {
          detalhes.push(`${nomeDoMarco}: ninguém na janela`);
          continue;
        }

        const cupom = String(cfg[marco.cupom] || "").trim();
        if (cupom) {
          const cadastrado = acharCupom(loja.storeCoupons, cupom);
          if (!cadastrado || cupomVenceu(cadastrado, hoje)) {
            detalhes.push(`${nomeDoMarco}: cupom ${cupom} desligado ou vencido — nada enviado`);
            continue;
          }
        }
        const imagem = String(cfg[marco.img] || "").trim();
        const linkDaLoja = loja.slug ? `https://firehubfood.com.br/loja/${loja.slug}` : "";
        let texto = String(cfg[marco.msg] || "").trim();
        if (!texto) {
          detalhes.push(`${nomeDoMarco}: sem mensagem configurada`);
          continue;
        }
        if (cupom && !texto.toUpperCase().includes(cupom.toUpperCase())) {
          texto += `\n\nUse o cupom: *${cupom}*`;
        }
        if (linkDaLoja && !texto.includes(linkDaLoja)) {
          texto += `\n${linkDaLoja}`;
        }

        let enviadosDoMarco = 0;
        for (const telefone of alvos) {
          if (enviadosDaLoja >= TETO_POR_LOJA) break;
          // "00000000000" (carimbo do balcão e da mesa) tem 11 dígitos e
          // passava neste tamanho: a campanha disparava para um número que
          // não existe, toda semana, pela instância de WhatsApp da loja —
          // que é o padrão que o antispam procura.
          if (!telefoneDeVerdade(telefone)) continue;
          const digitos = paraEnvioWhatsApp(telefone).replace(/\D/g, "");
          if (digitos.length < 10) continue;
          const chave = chaveDoTelefone(telefone);
          if (fora.has(chave)) continue;

          // O aceite de novo, antes de cada mensagem: desfeito, a leva para.
          const agora = await prisma.user.findUnique({ where: { id: loja.id }, select: { chatbotConfig: true } });
          if (!aceiteDoRiscoQr(agora?.chatbotConfig)) {
            aceiteDesfeito = true;
            break;
          }

          try {
            const ok = imagem
              ? await sendEvolutionMediaUrl(loja.id, digitos, imagem, texto)
              : await sendEvolutionMessage(loja.id, digitos, texto);
            if (!ok) {
              falhasDaLoja++;
              console.warn(`[Recuperação] ${loja.storeName || loja.id}: o gateway não confirmou o envio para ${digitos.slice(-4)}`);
            }
            if (ok) {
              enviadosDoMarco++; enviadosDaLoja++; enviadosNoTotal++;
              // Anotado na hora, não no fim: se o processo cair no meio, o
              // oficial ainda sabe quem já recebeu por aqui.
              fora.add(chave);
              envios[chave] = new Date().toISOString();
              const corte = Date.now() - GUARDA_DO_ENVIO_MS;
              for (const [t, em] of Object.entries(envios)) {
                if (!(new Date(em).getTime() >= corte)) delete envios[t];
              }
              await mesclarNoChatbotConfig(loja.id, { recuperacaoQrEnvios: envios }).catch(() => {});
            }
          } catch (e: any) {
            falhasDaLoja++;
            console.warn(`[Recuperação] falha ao enviar para ${digitos.slice(-4)}: ${e?.message}`);
          }
          // Ritmo humano: intervalo sorteado, com pausa longa de vez em quando.
          const pausaLonga = enviadosDaLoja > 0 && enviadosDaLoja % ENVIOS_ATE_PAUSA_LONGA === 0;
          await dormir(pausaLonga ? aleatorio(120_000, 300_000) : aleatorio(RESPIRO_MIN_MS, RESPIRO_MAX_MS));
        }
        detalhes.push(`${nomeDoMarco}: ${enviadosDoMarco}/${alvos.length}`);
      }

      if (aceiteDesfeito) detalhes.push("parou: a loja desfez o aceite do risco");
      log.push(`📣 ${loja.storeName || loja.name}: ${enviadosDaLoja} envio(s) — ${detalhes.join(" | ")}`);
      // Fim da leva: o dia está feito, e o resumo fica na loja para conferir
      // depois sem depender do log do servidor.
      await mesclarNoChatbotConfig(loja.id, {
        recuperacaoConcluidaEm: hoje,
        recuperacaoResumo: { em: new Date().toISOString(), enviados: enviadosDaLoja, falhas: falhasDaLoja, detalhes },
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, enviados: enviadosNoTotal, log });
  } catch (err: any) {
    console.error("[Recuperação de clientes] erro:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message, log }, { status: 500 });
  }
}

/**
 * Quem mandou a última mensagem ao robô da loja entre `inicio` e `fim` e não
 * tem pedido nesta loja (o que fica de fora, e por quê, está no cabeçalho).
 */
async function conversaramENaoCompraram(
  lojaId: string,
  cfg: any,
  inicio: Date,
  fim: Date,
  telefonesComPedido: (string | null)[]
): Promise<string[]> {
  const conversas = await prisma.chatbotConversationState.findMany({
    where: { userId: lojaId, lastMessageAt: { gte: inicio, lt: fim }, humanTakeoverAt: null, degradedAt: null },
    select: { remoteJid: true },
  });
  if (conversas.length === 0) return [];

  const comPedido = new Set(telefonesComPedido.map(t => telefoneDaMeta(t)).filter(Boolean) as string[]);
  const [motoboys, equipe] = await Promise.all([
    prisma.motoboy.findMany({ where: { franchiseeId: lojaId }, select: { phone: true } }),
    prisma.storeEmployee.findMany({ where: { franchiseeId: lojaId }, select: { phone: true } }),
  ]);
  const daCasa = [...motoboys.map(m => m.phone), ...equipe.map(e => e.phone), cfg.phone].filter(Boolean);

  const alvos = new Set<string>();
  for (const { remoteJid } of conversas) {
    if (!ehConversaDeCliente(remoteJid) || /@lid$/i.test(remoteJid)) continue;
    const tel = telefoneDaMeta(remoteJid.split("@")[0]);
    if (!tel || comPedido.has(tel)) continue;
    if (numeroDaEquipeDoFireHub(tel) || numeroEstaNaListaDeIgnorados(tel, cfg.numerosIgnorados)) continue;
    if (daCasa.some(n => mesmoNumero(n, tel))) continue;
    alvos.add(tel);
  }
  return [...alvos];
}
