/**
 * /src/lib/nfce/inutilizacao-da-loja.ts
 *
 * Inutilização de numeração pelo emissor próprio: a faixa pedida na tela
 * (api/store/fiscal/inutilizacao) e a INUTILIZAÇÃO MENSAL dos buracos.
 *
 * ── A obrigação ─────────────────────────────────────────────────────────────
 *
 * Ajuste SINIEF 19/16, cl. 16ª: "O contribuinte deverá solicitar, mediante
 * Pedido de Inutilização de Número da NFC-e, até o 10 (décimo) dia do mês
 * subsequente, a inutilização de números de NFC-e não utilizados, na
 * eventualidade de quebra de sequência da numeração da NFC-e" (texto conferido
 * no CONFAZ em 29/09/2026). Com a Focus, era ela que controlava a sequência;
 * com o emissor próprio o buraco é nosso — a nota rejeitada que ninguém
 * reemitiu, a reserva de um pedido que nunca virou nota, o número tentado sem
 * resposta que a SEFAZ não recebeu.
 *
 * ── A trava de segurança ────────────────────────────────────────────────────
 *
 * Inutilizar é irreversível. Antes de pedir, a faixa é conferida contra TUDO
 * que os pedidos da loja registram (lib/nfce/numeracao): nota autorizada,
 * cancelada, denegada, em contingência — a nota off-line ainda vai ser
 * transmitida COM aquele número; inutilizá-lo a tornaria impossível de
 * autorizar ("nunca inutilizar número usado em contingência") —, reserva viva,
 * envio a conferir, número tentado. Se a faixa pega um desses, nada é pedido.
 *
 * Só servidor.
 */
import { Prisma } from "@prisma/client";
import { guardarArquivoFiscal } from "./armazenamento";
import { FaltaNoEmissor, certificadoDaLoja } from "./credenciais-da-loja";
import { JA_INUTILIZADA, inutilizarNaSefaz } from "./emissor";
import {
  agoraDoEmissor,
  bancoDoEmissor,
  conferirO656,
  mensagemDoBloqueio,
  mesDaNota,
  sefazBloqueadaAte,
  sqlMesclarNoEmissorDaLoja,
  transporteDoEmissor,
} from "./emissao-da-loja";
import {
  buracosParaInutilizar,
  chaveDaTrava,
  faixasInutilizadas,
  lerLinhasDosNumeros,
  marcaDoMaiorNumero,
  sqlDaTrava,
  sqlDosNumerosDaLoja,
  sqlLiberarReserva,
  type Ambiente,
  type NumeroGravado,
} from "./numeracao";
import { configDoEmissorProprio, usaEmissorProprio } from "./config-da-loja";
import { numeroInicialDoEmissor, serieDoEmissor, ambienteDaLoja } from "./pendencias";
import { FUSO_DA_UF, dataHoraNoFuso } from "./xml-da-nota";

type ConfigDaLoja = { uf?: string | null; cnpj?: string | null; ambiente?: number | null; enabled?: boolean; [chave: string]: unknown };
type Registro = Record<string, any>;
const objeto = (v: unknown): Registro => (v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : {});

/**
 * Acrescenta uma inutilização a fiscalConfig.inutilizacoes NO BANCO (jsonb):
 * o PUT da tela grava o fiscalConfig inteiro, e o cron que inutiliza no meio de
 * um "Salvar" não pode ser desfeito por ele (nem desfazê-lo).
 */
export function sqlAnexarInutilizacao(lojaId: string, registro: Registro): Prisma.Sql {
  return Prisma.sql`/* fh:anexar-inutilizacao */ UPDATE "User"
SET "fiscalConfig" = jsonb_set(
      CASE WHEN jsonb_typeof("fiscalConfig") = 'object' THEN "fiscalConfig" ELSE '{}'::jsonb END,
      '{inutilizacoes}',
      (CASE WHEN jsonb_typeof("fiscalConfig"->'inutilizacoes') = 'array' THEN "fiscalConfig"->'inutilizacoes' ELSE '[]'::jsonb END) || ${JSON.stringify([registro])}::jsonb,
      true),
    "updatedAt" = NOW()
WHERE "id" = ${lojaId}`;
}

export type ResultadoDaInutilizacaoDaLoja =
  | {
      ok: true;
      protocolo: string;
      statusSefaz: string;
      mensagemSefaz: string;
      serie: number;
      numeroInicial: number;
      numeroFinal: number;
      homologadaEm: string;
      /** O ambiente em que a faixa foi inutilizada (a tela mostra — produção é a que vale). */
      ambiente: Ambiente;
      /** O que foi gravado em fiscalConfig.inutilizacoes. */
      registro: Registro;
      /**
       * A SEFAZ disse que a faixa JÁ estava inutilizada (256/563/206 — a
       * resposta do nosso pedido anterior se perdeu): vale, sem o protocolo.
       */
      semProtocolo?: boolean;
    }
  | {
      ok: false;
      /** "recusada_aqui": a faixa pega número que o FireHub usou ou reservou — nada foi pedido. */
      motivo: "rejeitada" | "erro_de_comunicacao" | "recusada_aqui" | "nao_configurado";
      mensagem: string;
      detalhe?: string;
      conflitos?: number[];
      pendencias?: unknown[];
      /** O cStat da SEFAZ, quando ela respondeu (241 = número da faixa já usado; 656 = bloqueio). */
      statusSefaz?: string;
    };

/** Os números gravados da loja numa série/ambiente, lidos DENTRO da trava. */
async function numerosDaSerie(tx: any, lojaId: string, serie: number, ambiente: Ambiente): Promise<{ numeros: NumeroGravado[]; fiscalConfig: unknown }> {
  const linhas = (await tx.$queryRaw(sqlDosNumerosDaLoja(lojaId))) as Array<Record<string, unknown>>;
  const numeros = lerLinhasDosNumeros(linhas).filter((t) => t.serie === serie && t.ambiente === ambiente);
  const loja = await tx.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } });
  return { numeros, fiscalConfig: loja?.fiscalConfig ?? null };
}

/**
 * Inutiliza uma faixa (serie, ini..fim) no ambiente pedido: confere contra os
 * registros da loja, pede à SEFAZ, guarda o ProcInutNFe no cofre e anexa o
 * registro em fiscalConfig.inutilizacoes (a tela e o pacote do contador leem
 * de lá). `permitir`: números que a conferência deixa passar (o número tentado
 * que a SEFAZ disse não ter — ele está registrado justamente para esta hora).
 *
 * O pedido ASSINADO vai para o cofre antes de sair: se a resposta se perder,
 * a SEFAZ pode ter homologado, e o que sobra dessa inutilização é ele. Na
 * próxima tentativa a SEFAZ responde "já inutilizada" (256 para a faixa de um
 * número, 563 para a mesma faixa, 206) — e isso vale como inutilizada, sem o
 * protocolo (`semProtocolo`), em vez de pedir de novo a cada rodada: 20
 * recusas iguais são 656 (MOC 7.0, 4.3.3).
 *
 * Pela tela, a faixa não passa do maior número já ocupado da série: depois
 * dele não há quebra de sequência (cl. 16ª), e inutilizar ali só queimaria os
 * números das próximas vendas.
 */
export async function inutilizarFaixaNaSefaz(p: {
  lojaId: string;
  config: ConfigDaLoja;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  ambiente?: Ambiente;
  origem: "tela" | "mensal" | "tentado";
  permitir?: number[];
  /** Na mensal: o mês dos buracos (AAAAMM). */
  mes?: string;
}): Promise<ResultadoDaInutilizacaoDaLoja> {
  const ambiente: Ambiente = p.ambiente ?? ambienteDaLoja(p.config);
  const serie = Number(p.serie);
  const ini = Number(p.numeroInicial);
  const fim = Number(p.numeroFinal);
  const justificativa = String(p.justificativa ?? "").trim();
  if (!(Number.isInteger(serie) && serie >= 1 && serie <= 999)) return { ok: false, motivo: "recusada_aqui", mensagem: "Série inválida (1 a 999)." };
  if (!(Number.isInteger(ini) && Number.isInteger(fim) && ini >= 1 && fim >= ini && fim <= 999_999_999)) {
    return { ok: false, motivo: "recusada_aqui", mensagem: "Faixa inválida: número inicial de 1 em diante e final maior ou igual ao inicial." };
  }
  if (justificativa.length < 15) return { ok: false, motivo: "recusada_aqui", mensagem: "A justificativa precisa ter pelo menos 15 caracteres — é exigência da SEFAZ." };
  const bloqueio = sefazBloqueadaAte(p.lojaId, p.config);
  if (bloqueio) return { ok: false, motivo: "erro_de_comunicacao", mensagem: `${mensagemDoBloqueio(bloqueio, String(p.config.uf ?? ""))} A inutilização não foi pedida.`, statusSefaz: "656" };

  // ── A conferência, dentro da trava da série ──────────────────────────────
  const banco = bancoDoEmissor();
  const inicioDaSerie = serie === serieDoEmissor(p.config) ? numeroInicialDoEmissor(p.config) : 1;
  const conferencia = await banco.$transaction(
    async (tx: any) => {
      await tx.$executeRaw(sqlDaTrava(chaveDaTrava(p.lojaId, serie, ambiente)));
      const { numeros, fiscalConfig } = await numerosDaSerie(tx, p.lojaId, serie, ambiente);
      const usados = [...new Set(numeros.filter((t) => t.numero >= ini && t.numero <= fim && !(p.permitir ?? []).includes(t.numero)).map((t) => t.numero))].sort((a, b) => a - b);
      const jaInutilizados = faixasInutilizadas(fiscalConfig).filter((f) => f.serie === serie && f.ambiente === ambiente && f.final >= ini && f.inicial <= fim);
      // O maior número ocupado: os registros e a marca de maior número (e o
      // que vem antes do início da série, que o FireHub nunca usa).
      // (reduce, não Math.max(...lista): anos de nota estourariam a pilha de argumentos.)
      const maiorOcupado = numeros.reduce((m, t) => Math.max(m, t.numero), Math.max(inicioDaSerie - 1, marcaDoMaiorNumero(fiscalConfig, serie, ambiente)));
      return { usados, jaInutilizados, maiorOcupado };
    },
    { maxWait: 10_000, timeout: 20_000 }
  );
  if (p.origem === "tela" && fim > conferencia.maiorOcupado) {
    return {
      ok: false,
      motivo: "recusada_aqui",
      mensagem:
        `A faixa ${ini}–${fim} passa do maior número já usado na série ${serie} em ${ambiente === 1 ? "produção" : "homologação"} ` +
        `(${conferencia.maiorOcupado || "nenhum"}): depois dele não há quebra de sequência, e inutilizar ali queimaria os números das ` +
        "próximas vendas. Nada foi enviado à SEFAZ.",
    };
  }
  if (conferencia.usados.length > 0) {
    const lista = conferencia.usados.slice(0, 10).join(", ") + (conferencia.usados.length > 10 ? "…" : "");
    return {
      ok: false,
      motivo: "recusada_aqui",
      mensagem:
        `A faixa ${ini}–${fim} da série ${serie} tem número(s) que o FireHub já usou ou reservou (${lista}): nota emitida, em contingência ` +
        "ou em andamento. Inutilizar um desses tornaria a nota impossível de autorizar. Nada foi enviado à SEFAZ.",
      conflitos: conferencia.usados,
    };
  }
  if (conferencia.jaInutilizados.length > 0) {
    const f = conferencia.jaInutilizados[0];
    return { ok: false, motivo: "recusada_aqui", mensagem: `A faixa ${f.inicial}–${f.final} da série ${serie} já foi inutilizada. Nada foi enviado à SEFAZ.` };
  }

  // ── A SEFAZ ──────────────────────────────────────────────────────────────
  let certificado;
  try {
    certificado = await certificadoDaLoja(p.config);
  } catch (e) {
    if (e instanceof FaltaNoEmissor) return { ok: false, motivo: "nao_configurado", mensagem: e.message, pendencias: e.pendencias };
    throw e;
  }
  const agora = agoraDoEmissor();
  const pedido: { noCofre: { caminho: string; sha256: string } | null } = { noCofre: null };
  const r = await inutilizarNaSefaz(
    { cnpj: String(p.config.cnpj ?? ""), serie, numeroInicial: ini, numeroFinal: fim, justificativa },
    {
      certificado,
      uf: String(p.config.uf ?? "").toUpperCase(),
      ambiente,
      transporte: transporteDoEmissor(),
      // O pedido assinado, ANTES de sair (ver o cabeçalho da função). Se o
      // disco falhar, a inutilização não sai: sem ele, uma resposta perdida
      // não deixaria rastro nenhum do que a SEFAZ pode ter homologado.
      aoAssinarPedido: async (inutNFe) => {
        const g = await guardarArquivoFiscal({ lojaId: p.lojaId, tipo: "inutilizacao", identificacao: `pedido-inut:${ambiente}:${serie}:${ini}-${fim}`, conteudo: inutNFe, mes: mesDaNota(null, agora) });
        pedido.noCofre = { caminho: g.caminho, sha256: g.sha256 };
      },
    }
  ).catch((e: any) => ({ ok: false as const, motivo: "erro_de_comunicacao" as const, mensagem: `Não consegui guardar o pedido de inutilização antes de enviar (${String(e?.message ?? e).slice(0, 200)}). Nada foi enviado à SEFAZ.`, statusSefaz: undefined, detalhe: undefined }));
  const jaInutilizada = !r.ok && Boolean(r.statusSefaz) && (r.statusSefaz === "563" || (JA_INUTILIZADA.has(r.statusSefaz!) && ini === fim));
  if (!r.ok && !jaInutilizada) {
    await conferirO656(p.lojaId, r.statusSefaz, "inutilização");
    return { ok: false, motivo: r.motivo, mensagem: r.mensagem, detalhe: r.detalhe, statusSefaz: r.statusSefaz };
  }

  let xmlNoCofre: { caminho: string; sha256: string } | null = null;
  if (r.ok && r.xml) {
    try {
      const g = await guardarArquivoFiscal({ lojaId: p.lojaId, tipo: "inutilizacao", identificacao: `inut:${ambiente}:${serie}:${ini}-${fim}`, conteudo: r.xml, mes: mesDaNota(null, agora) });
      xmlNoCofre = { caminho: g.caminho, sha256: g.sha256 };
    } catch (e: any) {
      console.error(`[NFC-e] ❌ Inutilização ${serie}/${ini}-${fim} homologada, mas o XML não foi para o cofre: ${String(e?.message ?? e)}`);
    }
  }
  const protocolo = r.ok ? r.protocolo : "";
  const registro: Registro = {
    serie,
    numeroInicial: ini,
    numeroFinal: fim,
    protocolo: r.ok ? r.protocolo : null,
    statusSefaz: r.statusSefaz ?? null,
    mensagemSefaz: r.ok ? r.mensagemSefaz : r.mensagem,
    justificativa,
    homologadaEm: r.ok ? r.homologadaEm : agora.toISOString(),
    ambiente,
    provedor: "sefaz",
    origem: p.origem,
    // O XML da inutilização homologada é o que se guarda por 5 anos e vai no
    // pacote do contador (lib/contador-pacote lê do cofre).
    xmlNoCofre,
    xmlUrl: null,
    // O pedido assinado: na inutilização "já feita" (sem a resposta), é o
    // único documento dela aqui — o protocolo se consulta no portal da SEFAZ.
    pedidoNoCofre: pedido.noCofre,
    ...(jaInutilizada ? { semProtocolo: true } : {}),
    ...(p.mes ? { mes: p.mes } : {}),
  };
  await banco.$executeRaw(sqlAnexarInutilizacao(p.lojaId, registro)).catch((e: any) => {
    // Homologada e não registrada: a SEFAZ tem; a próxima conferência acha o
    // buraco de novo e a SEFAZ recusa (já inutilizada) — o log explica.
    console.error(`[NFC-e] ❌ Inutilização ${serie}/${ini}-${fim} (protocolo ${protocolo || "—"}) não foi gravada no fiscalConfig: ${String(e?.message ?? e)}`);
  });
  if (jaInutilizada) console.warn(`[NFC-e] Faixa ${serie}/${ini}-${fim} (ambiente ${ambiente}) já estava inutilizada na SEFAZ (${r.statusSefaz}): registrada sem protocolo.`);
  return {
    ok: true,
    protocolo,
    statusSefaz: String(r.statusSefaz ?? ""),
    mensagemSefaz: r.ok ? r.mensagemSefaz : r.mensagem,
    serie,
    numeroInicial: ini,
    numeroFinal: fim,
    homologadaEm: registro.homologadaEm,
    ambiente,
    registro,
    ...(jaInutilizada ? { semProtocolo: true } : {}),
  };
}

// ── A INUTILIZAÇÃO MENSAL ───────────────────────────────────────────────────

/** Buraco maior que isto não sai sozinho: é cadastro errado (série, número inicial), não quebra de sequência. */
export const LIMITE_DE_BURACOS_AUTOMATICOS = 500;
/** O cron roda a cada 2 minutos; a verificação dos buracos, no máximo a cada 30 (e só até sair limpa no mês). */
const INTERVALO_DA_VERIFICACAO_MS = 30 * 60_000;
const ultimaVerificacao = new Map<string, number>();

/** O mês corrente no fuso da loja: o começo dele e o AAAAMM do mês anterior. */
export function mesDaLoja(uf: string, agora: Date): { inicioDoMes: Date; mesAnterior: string; mesAtual: string } {
  const fuso = FUSO_DA_UF[String(uf ?? "").toUpperCase()] ?? "America/Sao_Paulo";
  const local = dataHoraNoFuso(agora, fuso); // "2026-10-01T00:05:00-03:00"
  const ano = Number(local.slice(0, 4));
  const mes = Number(local.slice(5, 7));
  const offset = local.slice(19);
  const inicioDoMes = new Date(`${local.slice(0, 7)}-01T00:00:00${offset}`);
  const anterior = mes === 1 ? `${ano - 1}12` : `${ano}${String(mes - 1).padStart(2, "0")}`;
  return { inicioDoMes, mesAnterior: anterior, mesAtual: `${local.slice(0, 4)}${local.slice(5, 7)}` };
}

export type ResumoDaInutilizacaoMensal = {
  mes: string;
  pulou?: string;
  faixas: Registro[];
  erros: string[];
  reservasSoltas: number;
};

/**
 * Inutiliza os buracos de numeração de PRODUÇÃO que ficaram para trás (ver
 * `buracosParaInutilizar`, lib/nfce/numeracao), série a série. Só para loja
 * com emissão ligada e provedor "sefaz" (quem chama confere a emissão; aqui se
 * confere de novo). Grava o que fez em fiscalConfig.sefaz.inutilizacaoMensal
 * — { mes, verificadoEm, faixas, erros, pendente } — e cada faixa em
 * fiscalConfig.inutilizacoes. Homologação não tem valor fiscal: fica de fora.
 */
export async function inutilizarBuracosDoMes(p: { lojaId: string; config: ConfigDaLoja; agora?: Date; forcar?: boolean }): Promise<ResumoDaInutilizacaoMensal> {
  const agora = p.agora ?? agoraDoEmissor();
  const { inicioDoMes, mesAnterior } = mesDaLoja(String(p.config.uf ?? ""), agora);
  const resumo: ResumoDaInutilizacaoMensal = { mes: mesAnterior, faixas: [], erros: [], reservasSoltas: 0 };
  if (!usaEmissorProprio(p.config) || p.config.enabled !== true) return { ...resumo, pulou: "emissão própria desligada" };
  const feito = objeto((configDoEmissorProprio(p.config) as Registro).inutilizacaoMensal);
  if (!p.forcar && feito.mes === mesAnterior && feito.pendente !== true) return { ...resumo, pulou: "mês já conferido" };
  const ultima = ultimaVerificacao.get(p.lojaId);
  if (!p.forcar && ultima != null && agora.getTime() - ultima < INTERVALO_DA_VERIFICACAO_MS) return { ...resumo, pulou: "conferido há pouco" };
  ultimaVerificacao.set(p.lojaId, agora.getTime());

  const ambiente: Ambiente = 1;
  const banco = bancoDoEmissor();
  const numeroInicial = numeroInicialDoEmissor(p.config);
  if (sefazBloqueadaAte(p.lojaId, p.config, agora)) return { ...resumo, pulou: "SEFAZ bloqueada (656)" };
  // As séries com número de produção registrado (a loja pode ter trocado de série no mês).
  const todas = lerLinhasDosNumeros((await banco.$queryRaw(sqlDosNumerosDaLoja(p.lojaId))) as Array<Record<string, unknown>>);
  const series = [...new Set(todas.filter((t) => t.ambiente === ambiente).map((t) => t.serie))].sort((a, b) => a - b);
  let pendente = false;

  for (const serie of series) {
    // Dentro da trava: calcula os buracos e solta as reservas vencidas que
    // caíram neles — ninguém reusa um número que vai ser inutilizado.
    const calculo = await banco.$transaction(
      async (tx: any) => {
        await tx.$executeRaw(sqlDaTrava(chaveDaTrava(p.lojaId, serie, ambiente)));
        const { numeros, fiscalConfig } = await numerosDaSerie(tx, p.lojaId, serie, ambiente);
        const inutilizadas = faixasInutilizadas(fiscalConfig)
          .filter((f) => f.serie === serie && f.ambiente === ambiente)
          .map((f) => ({ inicial: f.inicial, final: f.final, em: f.em }));
        // O número inicial vale só para a série do emissor; outra série começa no 1.
        const inicio = serie === serieDoEmissor(p.config) ? numeroInicial : 1;
        const b = buracosParaInutilizar({ numeros, inutilizadas, numeroInicial: inicio, inicioDoMes, agora });
        if (b.total === 0 || b.total > LIMITE_DE_BURACOS_AUTOMATICOS) return b;
        for (const v of b.reservasVencidas) {
          const r = await tx.$executeRaw(
            sqlLiberarReserva(v.pedido, { numero: v.numero, serie, ambiente, em: v.em }, {
              reservaLiberada: { numero: v.numero, serie, ambiente, reservadaEm: v.em, liberadaEm: agora.toISOString(), motivo: `inutilização mensal ${mesAnterior}` },
            })
          );
          resumo.reservasSoltas += Number(r) || 0;
        }
        return b;
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
    if (calculo.total === 0) continue;
    if (calculo.total > LIMITE_DE_BURACOS_AUTOMATICOS) {
      resumo.erros.push(
        `Série ${serie}: ${calculo.total} números sem nota entre ${numeroInicial} e ${calculo.limite} — grande demais para inutilizar sozinho. ` +
          "Confira a série e o número inicial do emissor e inutilize pela tela Fiscal."
      );
      continue;
    }
    for (const f of calculo.faixas) {
      const r = await inutilizarFaixaNaSefaz({
        lojaId: p.lojaId,
        config: p.config,
        serie,
        numeroInicial: f.inicial,
        numeroFinal: f.final,
        ambiente,
        origem: "mensal",
        mes: mesAnterior,
        justificativa: `Numeracao nao utilizada (quebra de sequencia) - inutilizacao mensal ${mesAnterior.slice(4)}/${mesAnterior.slice(0, 4)} - Ajuste SINIEF 19/16`,
      });
      if (r.ok) resumo.faixas.push({ serie, numeroInicial: f.inicial, numeroFinal: f.final, protocolo: r.protocolo });
      else {
        resumo.erros.push(`Série ${serie}, ${f.inicial}–${f.final}: ${r.mensagem}`);
        // Sem resposta: tenta de novo na próxima verificação. Recusa (da
        // SEFAZ ou da conferência) é para uma pessoa olhar.
        if (r.motivo === "erro_de_comunicacao") pendente = true;
      }
    }
  }

  await banco
    .$executeRaw(
      sqlMesclarNoEmissorDaLoja(p.lojaId, {
        inutilizacaoMensal: { mes: mesAnterior, verificadoEm: agora.toISOString(), faixas: resumo.faixas, erros: resumo.erros.slice(0, 10), pendente },
      })
    )
    .catch((e: any) => console.error("[NFC-e] Não gravei o registro da inutilização mensal:", String(e?.message ?? e).slice(0, 200)));
  if (resumo.faixas.length > 0) console.log(`[NFC-e] Inutilização mensal ${mesAnterior} da loja ${p.lojaId}: ${resumo.faixas.length} faixa(s).`);
  if (resumo.erros.length > 0) console.warn(`[NFC-e] Inutilização mensal ${mesAnterior} da loja ${p.lojaId}: ${resumo.erros.join(" | ")}`);
  return resumo;
}
