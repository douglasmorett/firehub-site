import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { verifyCronAuth } from "@/lib/cron-auth";
import { sendEvolutionMessage, sendEvolutionMediaUrl } from "@/lib/whatsapp-evolution";

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
 */

/** Marcos de dias sem comprar, com as chaves que a tela do lojista já grava. */
const MARCOS = [
  { dias: 7, ligado: "autoRecuperation7d", msg: "msg7d", img: "img7d", cupom: "coupon7d" },
  { dias: 15, ligado: "autoRecuperation15d", msg: "msg15d", img: "img15d", cupom: "coupon15d" },
  { dias: 30, ligado: "autoRecuperation30d", msg: "msg30d", img: "img30d", cupom: "coupon30d" },
] as const;

/** Teto de mensagens por loja por execução: o WhatsApp bloqueia número que dispara demais. */
const TETO_POR_LOJA = 60;

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

const hojeEmSaoPaulo = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const horaEmSaoPaulo = () =>
  Number(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }));

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log: string[] = [];
  const hora = horaEmSaoPaulo();
  if (hora < 10 || hora >= 20) {
    return NextResponse.json({ ok: true, pulado: `fora do horário (${hora}h em SP)`, enviados: 0 });
  }

  const hoje = hojeEmSaoPaulo();
  let enviadosNoTotal = 0;

  try {
    // Só lojas que ligaram pelo menos um dos marcos.
    const lojas = await prisma.user.findMany({
      where: { NOT: { chatbotConfig: { equals: Prisma.DbNull } } },
      select: { id: true, storeName: true, name: true, slug: true, chatbotConfig: true },
    });

    for (const loja of lojas) {
      const cfg = (loja.chatbotConfig as any) || {};
      const marcosLigados = MARCOS.filter(m => cfg[m.ligado] === true);
      if (marcosLigados.length === 0) continue;

      // Já disparou hoje? Então acabou por hoje.
      if (cfg.ultimaRecuperacaoEm === hoje) {
        log.push(`⏭️ ${loja.storeName || loja.name}: já disparou hoje`);
        continue;
      }

      // O dia é RESERVADO antes do primeiro envio, não depois do último.
      //
      // Com os respiros anti-spam, a leva de uma loja pode levar mais de uma
      // hora — e o job roda de hora em hora. Marcando só no fim, a execução
      // seguinte encontrava a trava aberta e mandava a MESMA mensagem para os
      // MESMOS clientes em paralelo: spam em dobro, que é justamente o que
      // derruba o número da loja. Se o processo morrer no meio, o custo é a
      // loja perder parte da leva de um dia — muito mais barato que o dobro.
      await prisma.user.update({
        where: { id: loja.id },
        data: { chatbotConfig: { ...cfg, ultimaRecuperacaoEm: hoje } },
      });

      let enviadosDaLoja = 0;
      const detalhes: string[] = [];

      for (const marco of marcosLigados) {
        if (enviadosDaLoja >= TETO_POR_LOJA) break;

        const fim = new Date(Date.now() - marco.dias * 24 * 60 * 60 * 1000);
        const inicio = new Date(fim.getTime() - 24 * 60 * 60 * 1000);

        // Último pedido de cada telefone desta loja. O agrupamento devolve o
        // MAIOR createdAt por telefone — é isso que define "sumido há N dias".
        const porTelefone = await prisma.customerOrder.groupBy({
          by: ["customerPhone"],
          where: {
            franchiseeId: loja.id,
            customerPhone: { not: null as any },
            status: { not: "CANCELADO" },
          },
          _max: { createdAt: true },
        });

        const alvos = porTelefone
          .filter(g => {
            const ultimo = g._max?.createdAt;
            if (!ultimo || !g.customerPhone) return false;
            return ultimo >= inicio && ultimo < fim;
          })
          .map(g => g.customerPhone as string)
          // Embaralha: enviar sempre na mesma ordem (a do banco) é mais um
          // padrão previsível para o antispam reconhecer.
          .sort(() => Math.random() - 0.5);

        if (alvos.length === 0) {
          detalhes.push(`${marco.dias}d: ninguém na janela`);
          continue;
        }

        const cupom = String(cfg[marco.cupom] || "").trim();
        const imagem = String(cfg[marco.img] || "").trim();
        const linkDaLoja = loja.slug ? `https://firehubfood.com.br/loja/${loja.slug}` : "";
        let texto = String(cfg[marco.msg] || "").trim();
        if (!texto) {
          detalhes.push(`${marco.dias}d: sem mensagem configurada`);
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
          const digitos = String(telefone).replace(/\D/g, "");
          if (digitos.length < 10) continue;

          try {
            const ok = imagem
              ? await sendEvolutionMediaUrl(loja.id, digitos, imagem, texto)
              : await sendEvolutionMessage(loja.id, digitos, texto);
            if (ok) { enviadosDoMarco++; enviadosDaLoja++; enviadosNoTotal++; }
          } catch (e: any) {
            console.warn(`[Recuperação] falha ao enviar para ${digitos.slice(-4)}: ${e?.message}`);
          }
          // Ritmo humano: intervalo sorteado, com pausa longa de vez em quando.
          const pausaLonga = enviadosDaLoja > 0 && enviadosDaLoja % ENVIOS_ATE_PAUSA_LONGA === 0;
          await dormir(pausaLonga ? aleatorio(120_000, 300_000) : aleatorio(RESPIRO_MIN_MS, RESPIRO_MAX_MS));
        }
        detalhes.push(`${marco.dias}d: ${enviadosDoMarco}/${alvos.length}`);
      }

      log.push(`📣 ${loja.storeName || loja.name}: ${enviadosDaLoja} envio(s) — ${detalhes.join(" | ")}`);
    }

    return NextResponse.json({ ok: true, enviados: enviadosNoTotal, log });
  } catch (err: any) {
    console.error("[Recuperação de clientes] erro:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message, log }, { status: 500 });
  }
}
