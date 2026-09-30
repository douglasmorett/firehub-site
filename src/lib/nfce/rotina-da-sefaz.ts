/**
 * /src/lib/nfce/rotina-da-sefaz.ts
 *
 * O que o cron fiscal (api/cron/fiscal-retentativa → lib/fiscal-automatico →
 * retentarNotasFiscais) faz A MAIS numa loja do emissor próprio, depois de
 * transmitir as contingências e consultar os "processando" (esses passam pelo
 * `sincronizarNota` de sempre):
 *
 *  1. o NÚMERO TENTADO: a nota que foi à SEFAZ e não voltou resposta, cuja
 *     venda saiu num cupom de contingência com OUTRO número. Manual de
 *     Contingência NFC-e 2.0, item 4 (exemplo prático), e Ajuste SINIEF
 *     19/16, cl. 12ª: conferida a situação,
 *       - "não consta" (217) → inutiliza o número (cl. 12ª II → cl. 16ª);
 *       - autorizada → CANCELAMENTO POR SUBSTITUIÇÃO (evento 110112, cl. 12ª I
 *         → cl. 15ª-A), referenciando a NFC-e de contingência que acobertou a
 *         venda, em até 168 h da autorização (no DF, Portaria SEEC 387/2019,
 *         art. 7º § 1º). O 110111 fica para o cancelamento comum (30 min);
 *       - cancelada (a resposta do evento se perdeu) → vai para
 *         `notasAnteriores` com o nfeProc e o evento;
 *     No RITMO que a SEFAZ tolera: 10, 20, 40, 80... min entre conferências
 *     (teto 6 h) e, depois de 8 sem desfecho, "para_pessoa" — sai da fila com a
 *     orientação. Repetir a mesma consulta e a mesma inutilização a cada 2 min
 *     era o caminho do 656 (MOC 7.0, 4.3.3 e 4.3.4);
 *  2. a RECONCILIAÇÃO dos envios sem desfecho de pedidos FAILED — inclusive os
 *     que saíram da retentativa (5 tentativas): a nota pode ter sido
 *     autorizada, e só a consulta pela chave diz. No ritmo lento do envio (até
 *     2 por hora, por 7 dias; depois, uma pessoa), gravando pelo
 *     `sincronizarNota` de sempre;
 *  3. a INUTILIZAÇÃO MENSAL dos buracos (lib/nfce/inutilizacao-da-loja).
 *
 * Nada disso roda com a loja bloqueada por consumo indevido (656).
 *
 * Só servidor.
 */
import { guardarArquivoFiscal, lerXmlFiscal } from "./armazenamento";
import { chaveValida, lerChave } from "./chave";
import { usaEmissorProprio } from "./config-da-loja";
import { FaltaNoEmissor, certificadoDaLoja } from "./credenciais-da-loja";
import { cancelarNaSefaz, consultarNaSefaz } from "./emissor";
import {
  agoraDoEmissor,
  bancoDoEmissor,
  conferirO656,
  envioDoFiscalInfo,
  mesDaNota,
  ponteiroValido,
  proximaConsultaDoEnvio,
  sefazBloqueadaAte,
  transporteDoEmissor,
} from "./emissao-da-loja";
import { inutilizarBuracosDoMes, inutilizarFaixaNaSefaz } from "./inutilizacao-da-loja";
import { sqlMesclarNoFiscalInfo, type Ambiente } from "./numeracao";

type ConfigDaLoja = { uf?: string | null; cnpj?: string | null; ambiente?: number | null; enabled?: boolean; [chave: string]: unknown };
type Registro = Record<string, any>;
const objeto = (v: unknown): Registro => (v && typeof v === "object" && !Array.isArray(v) ? (v as Registro) : {});

/** A resposta sem resposta: esperar a SEFAZ terminar o que recebeu antes de concluir "não chegou". */
const ESPERA_DO_TENTADO_MS = 10 * 60_000;
/** Vendas até 31 dias (o piso do índice franchiseeId+createdAt, como o cron de sempre). */
const JANELA_DO_TENTADO_MS = 31 * 24 * 60 * 60_000;
/** O recuo entre conferências do tentado: 10, 20, 40, 80... min, com teto de 6 h. */
const TETO_DO_RECUO_DO_TENTADO_MS = 6 * 60 * 60_000;
/** Conferências sem desfecho até o tentado ir para uma pessoa. */
export const MAXIMO_DE_CONFERENCIAS_DO_TENTADO = 8;
/** Cancelamento por substituição: até 168 h da autorização (Ajuste SINIEF 19/16, cl. 15ª-A). */
const PRAZO_DA_SUBSTITUICAO_MS = 168 * 60 * 60_000;
/** A reconciliação alcança pedidos de até 31 dias + os 7 dias do envio. */
const JANELA_DA_RECONCILIACAO_MS = 38 * 24 * 60 * 60_000;

async function gravarTentado(ids: string[], tentado: Registro, extra: Registro = {}): Promise<void> {
  await bancoDoEmissor().$executeRaw(sqlMesclarNoFiscalInfo(ids, { numeroTentado: tentado, ...extra }));
}

/** Quando o tentado pode ser conferido de novo (ms). */
export function proximaConferenciaDoTentado(t: unknown): number {
  const o = objeto(t);
  const desde = Date.parse(String(o.desde ?? ""));
  const ultima = Date.parse(String(o.ultimaConferenciaEm ?? ""));
  if (!Number.isFinite(ultima)) return (Number.isFinite(desde) ? desde : 0) + ESPERA_DO_TENTADO_MS;
  const n = Math.max(1, Number(o.conferencias) || 1);
  return ultima + Math.min(ESPERA_DO_TENTADO_MS * 2 ** (n - 1), TETO_DO_RECUO_DO_TENTADO_MS);
}

const dhEmiDoXml = (xml: string | null): string | null => /<dhEmi>([^<]+)<\/dhEmi>/.exec(String(xml ?? ""))?.[1] ?? null;

async function guardarNoCofre(lojaId: string, tipo: "nota" | "evento", identificacao: string, conteudo: string, mes: string): Promise<Registro | null> {
  try {
    const g = await guardarArquivoFiscal({ lojaId, tipo, identificacao, conteudo, mes });
    return { caminho: g.caminho, sha256: g.sha256, tipo };
  } catch (e: any) {
    console.error(`[NFC-e] ❌ ${tipo} ${identificacao} não foi para o cofre: ${String(e?.message ?? e)}`);
    return null;
  }
}

/**
 * Confere os números tentados "a_conferir" da loja (ver o cabeçalho). Devolve
 * quantos saíram da situação "a_conferir" nesta rodada.
 */
export async function conferirNumerosTentados(p: { lojaId: string; config: ConfigDaLoja; agora?: Date; acabou?: () => boolean; limite?: number }): Promise<number> {
  const agora = p.agora ?? agoraDoEmissor();
  if (sefazBloqueadaAte(p.lojaId, p.config, agora)) return 0;
  const banco = bancoDoEmissor();
  const pedidos: Array<{ id: string; fiscalStatus: string | null; fiscalInfo: unknown }> = await banco.customerOrder.findMany({
    where: {
      franchiseeId: p.lojaId,
      createdAt: { gte: new Date(agora.getTime() - JANELA_DO_TENTADO_MS) },
      fiscalInfo: { path: ["numeroTentado", "situacao"], equals: "a_conferir" },
    },
    select: { id: true, fiscalStatus: true, fiscalInfo: true },
    orderBy: { createdAt: "desc" },
    take: p.limite ?? 20,
  });
  // A conta da mesa grava o mesmo tentado em todos os pedidos: um por chave.
  const porChave = new Map<string, { ids: string[]; info: Registro; fiscalStatus: string | null }>();
  for (const o of pedidos) {
    const t = objeto(objeto(o.fiscalInfo).numeroTentado);
    if (!chaveValida(String(t.chave ?? ""))) continue;
    const g = porChave.get(t.chave) ?? { ids: [], info: objeto(o.fiscalInfo), fiscalStatus: o.fiscalStatus ?? null };
    g.ids.push(o.id);
    porChave.set(t.chave, g);
  }
  if (porChave.size === 0) return 0;

  let certificado;
  try {
    certificado = await certificadoDaLoja(p.config);
  } catch (e) {
    if (e instanceof FaltaNoEmissor) return 0;
    throw e;
  }
  const uf = String(p.config.uf ?? "").toUpperCase();
  let resolvidos = 0;

  for (const [chave, g] of porChave) {
    if (p.acabou?.()) break;
    // Um 656 nesta rodada (outra conferência, outra nota): para tudo.
    if (sefazBloqueadaAte(p.lojaId, p.config)) break;
    const t = objeto(g.info.numeroTentado);
    if (proximaConferenciaDoTentado(t) > agora.getTime()) continue;
    const ambiente: Ambiente = Number(t.ambiente) === 1 ? 1 : 2;
    const partes = lerChave(chave);
    const numero = Number(t.numero) || partes.numero;
    const serie = Number(t.serie) || partes.serie;
    const conferencias = (Number(t.conferencias) || 0) + 1;
    const tentativa: Registro = { ...t, conferencias, ultimaConferenciaEm: agora.toISOString() };
    const cupom = String(g.info.nfceNumber ?? "");
    const contingencia = String(g.info.nfceKey ?? "");
    const ctx = { certificado, uf, ambiente, transporte: transporteDoEmissor() };
    /** A conferência não resolveu: registra e, na 8ª, vai para uma pessoa. */
    const semDesfecho = async (erro: string) => {
      if (conferencias >= MAXIMO_DE_CONFERENCIAS_DO_TENTADO) {
        await gravarTentado(g.ids, {
          ...tentativa,
          situacao: "para_pessoa",
          ultimoErro: erro.slice(0, 300),
          orientacao:
            `O número ${numero} (série ${serie}, chave ${chave}) foi à SEFAZ sem resposta e, em ${conferencias} conferências, não houve desfecho ` +
            `(${erro.slice(0, 160)}). Consulte a chave no portal da SEFAZ: AUTORIZADA → cancele por substituição (evento 110112, referenciando a ` +
            `chave ${contingencia || "da NFC-e de contingência"}) em até 168 h da autorização; NÃO CONSTA → inutilize o número ${numero} pela tela Fiscal.`,
        });
        console.error(`[NFC-e] ⚠️ Número tentado ${chave} foi para uma pessoa depois de ${conferencias} conferências: ${erro}`);
        resolvidos++;
        return;
      }
      await gravarTentado(g.ids, { ...tentativa, ultimoErro: erro.slice(0, 300) });
    };

    const doCofre = ponteiroValido(t.xml);
    const xml = doCofre ? await lerXmlFiscal(doCofre.caminho, doCofre.sha256).catch(() => null) : null;
    const r = await consultarNaSefaz(chave, { ...ctx, xmlAssinado: xml });
    if (!r.ok && (await conferirO656(p.lojaId, r.statusSefaz, "consulta do número tentado"))) {
      await gravarTentado(g.ids, { ...tentativa, ultimoErro: r.mensagem.slice(0, 300) });
      break;
    }

    // ── Não chegou: inutiliza o número ────────────────────────────────────
    if (!r.ok && r.statusSefaz === "217") {
      const inut = await inutilizarFaixaNaSefaz({
        lojaId: p.lojaId,
        config: p.config,
        serie,
        numeroInicial: numero,
        numeroFinal: numero,
        ambiente,
        origem: "tentado",
        permitir: [numero],
        justificativa: `Numero ${numero} enviado sem resposta da SEFAZ; a venda saiu na NFC-e ${cupom || "de contingencia"} emitida em contingencia off-line`,
      });
      if (inut.ok) {
        await gravarTentado(g.ids, {
          ...tentativa,
          situacao: "inutilizado",
          inutilizadoEm: agora.toISOString(),
          protocoloDaInutilizacao: inut.protocolo,
          ...(inut.semProtocolo ? { semProtocolo: true } : {}),
        });
        resolvidos++;
        continue;
      }
      if (inut.statusSefaz === "656") break;
      // 241 ("um número da faixa já foi utilizado"): a nota pode ter sido
      // autorizada depois do 217 — a próxima conferência consulta de novo.
      await semDesfecho(inut.mensagem);
      continue;
    }

    // ── Autorizada: a mesma venda tem duas notas ──────────────────────────
    if (r.ok) {
      // O nfeProc vai para o cofre e o ponteiro para o tentado JÁ: se a
      // resposta do evento se perder, a próxima rodada acha a nota cancelada
      // e monta o registro com este XML.
      let xmlNoCofre: Registro | null = ponteiroValido(t.xmlNoCofre);
      if (!xmlNoCofre && r.xml) xmlNoCofre = await guardarNoCofre(p.lojaId, "nota", chave, r.xml, mesDaNota(r.emitidaEm));
      const autorizada = { protocolo: r.protocolo, emitidaEm: r.emitidaEm };
      const comAutorizacao = { ...tentativa, nfceKey: chave, protocolo: r.protocolo, emitidaEm: r.emitidaEm, autorizada, xmlNoCofre };
      await gravarTentado(g.ids, comAutorizacao);

      const autorizadaEm = Date.parse(r.emitidaEm);
      const contingenciaVale = g.fiscalStatus === "EMITTED" && chaveValida(contingencia) && contingencia !== chave;
      const orientacaoBase =
        `A NFC-e nº ${numero} (chave ${chave}) foi AUTORIZADA pela SEFAZ, e o cupom entregue ao cliente foi o da contingência ` +
        `(nº ${cupom || "?"}, chave ${contingencia || "?"}). As duas notas acobertam a mesma venda.`;
      if (Number.isFinite(autorizadaEm) && agora.getTime() - autorizadaEm > PRAZO_DA_SUBSTITUICAO_MS) {
        await gravarTentado(g.ids, {
          ...comAutorizacao,
          situacao: "autorizado",
          paraPessoa: true,
          orientacao:
            `${orientacaoBase} Passaram as 168 h do cancelamento por substituição (Ajuste SINIEF 19/16, cl. 15ª-A): ` +
            "peça o cancelamento extemporâneo à SEFAZ (cl. 15ª-A § 6º) com o contador.",
        });
        resolvidos++;
        continue;
      }
      if (!contingenciaVale) {
        // A contingência foi recusada ou cancelada: a nota tentada pode ser a
        // única que vale para esta venda — ninguém cancela nada sozinho.
        await gravarTentado(g.ids, {
          ...comAutorizacao,
          situacao: "autorizado",
          paraPessoa: true,
          orientacao:
            `${orientacaoBase} Mas a NFC-e de contingência deste pedido não está valendo agora (${g.fiscalStatus ?? "sem nota"}): ` +
            "a tentada pode ser a nota desta venda. Confira com o contador antes de cancelar qualquer uma.",
        });
        resolvidos++;
        continue;
      }
      if (g.info.contingencia === true) {
        // A de contingência ainda não foi autorizada: o 110112 referencia
        // ela — espera a transmissão (a rodada do cron cuida), sem contar.
        await gravarTentado(g.ids, { ...comAutorizacao, conferencias: conferencias - 1, ultimoErro: "aguardando a NFC-e de contingência ser autorizada" });
        continue;
      }
      const justificativa = `NFC-e substituida pela NFC-e ${cupom || "de contingencia"} emitida em contingencia off-line (chave ${contingencia})`;
      const c = await cancelarNaSefaz({ chave, protocolo: r.protocolo, justificativa, chaveSubstituta: contingencia }, ctx);
      if (c.ok) {
        const xmlCancelamentoNoCofre = c.xml ? await guardarNoCofre(p.lojaId, "evento", `cancelamento:${chave}`, c.xml, mesDaNota(null, agora)) : null;
        await gravarTentado(
          g.ids,
          { ...comAutorizacao, situacao: "cancelado", canceladoEm: c.canceladaEm, protocoloDoCancelamento: c.protocolo },
          {
            notasAnteriores: comNotaAnterior(g.info, {
              chave, numero, serie, ambiente, protocolo: r.protocolo, emitidaEm: r.emitidaEm, canceladaEm: c.canceladaEm,
              protocoloCancelamento: c.protocolo, justificativa, xmlNoCofre, xmlCancelamentoNoCofre,
            }),
          }
        );
        console.warn(`[NFC-e] Nota tentada ${chave} estava AUTORIZADA e foi cancelada por substituição (110112 → ${contingencia}).`);
        resolvidos++;
        continue;
      }
      if (await conferirO656(p.lojaId, c.statusSefaz, "cancelamento por substituição")) {
        await gravarTentado(g.ids, { ...comAutorizacao, ultimoErro: c.mensagem.slice(0, 300) });
        break;
      }
      // Sem resposta (o evento PODE ter sido registrado) ou 573 (já tem
      // cancelamento): a próxima conferência consulta, e a consulta cancelada
      // traz o evento.
      if (c.motivo === "erro_de_comunicacao" || c.statusSefaz === "573") {
        await gravarTentado(g.ids, { ...comAutorizacao, ultimoErro: c.mensagem.slice(0, 300) });
        continue;
      }
      // Recusado: fica a orientação para quem tem o certificado e o contador.
      await gravarTentado(g.ids, {
        ...comAutorizacao,
        situacao: "autorizado",
        paraPessoa: true,
        orientacao:
          `${orientacaoBase} O cancelamento por substituição (evento 110112, referenciando a chave ${contingencia}) foi recusado: ${c.mensagem}. ` +
          "Resolva no portal da SEFAZ ou com o contador.",
      });
      console.error(`[NFC-e] ⚠️ Nota tentada ${chave} AUTORIZADA e sem cancelamento automático: ${c.mensagem}`);
      resolvidos++;
      continue;
    }

    // ── Cancelada: o nosso evento (a resposta se perdeu) ou um de fora ────
    if (r.motivo === "rejeitada" && /CANCELADA/.test(r.mensagem)) {
      let xmlNoCofre: Registro | null = ponteiroValido(t.xmlNoCofre);
      if (!xmlNoCofre && r.xml) xmlNoCofre = await guardarNoCofre(p.lojaId, "nota", chave, r.xml, mesDaNota(dhEmiDoXml(xml)));
      const ev = r.cancelamento ?? null;
      const xmlCancelamentoNoCofre = ev?.xml ? await guardarNoCofre(p.lojaId, "evento", `cancelamento:${chave}`, ev.xml, mesDaNota(null, agora)) : null;
      const protocolo = String(objeto(t.autorizada).protocolo ?? r.protocoloDaAutorizacao ?? t.protocolo ?? "");
      await gravarTentado(
        g.ids,
        { ...tentativa, situacao: "cancelado", canceladoEm: ev?.em ?? agora.toISOString(), protocoloDoCancelamento: ev?.protocolo ?? null, xmlNoCofre, mensagem: r.mensagem.slice(0, 300) },
        {
          notasAnteriores: comNotaAnterior(g.info, {
            chave, numero, serie, ambiente, protocolo, emitidaEm: String(objeto(t.autorizada).emitidaEm ?? dhEmiDoXml(xml) ?? ""),
            canceladaEm: ev?.em ?? null, protocoloCancelamento: ev?.protocolo ?? null,
            justificativa: ev?.tpEvento === "110112" ? "cancelamento por substituição" : null, xmlNoCofre, xmlCancelamentoNoCofre,
          }),
        }
      );
      resolvidos++;
      continue;
    }

    // ── Denegada: o número é da SEFAZ ───────────────────────────────────
    if (r.motivo === "rejeitada") {
      await gravarTentado(g.ids, { ...tentativa, situacao: "denegado", mensagem: r.mensagem.slice(0, 300) });
      resolvidos++;
      continue;
    }

    // Sem resposta: a próxima conferência, no recuo.
    await semDesfecho(r.mensagem);
  }
  return resolvidos;
}

/**
 * A tentada cancelada vai para `notasAnteriores` — é por lá que o contador
 * recebe a nota e o evento (lib/contador-pacote). Sem repetir a chave.
 */
function comNotaAnterior(
  info: Registro,
  n: {
    chave: string;
    numero: number;
    serie: number;
    ambiente: Ambiente;
    protocolo: string;
    emitidaEm: string;
    canceladaEm: string | null;
    protocoloCancelamento: string | null;
    justificativa: string | null;
    xmlNoCofre: Registro | null;
    xmlCancelamentoNoCofre: Registro | null;
  }
): Registro[] {
  const anteriores: Registro[] = (Array.isArray(info.notasAnteriores) ? info.notasAnteriores : []).filter((a: unknown) => objeto(a).nfceKey !== n.chave);
  return [
    ...anteriores,
    {
      idDaNota: `tentado:${n.chave}`,
      nfceKey: n.chave,
      nfceNumber: n.numero,
      serie: n.serie,
      ambiente: n.ambiente,
      protocol: n.protocolo,
      emittedAt: n.emitidaEm,
      canceladaEm: n.canceladaEm,
      protocoloCancelamento: n.protocoloCancelamento,
      justificativaCancelamento: n.justificativa,
      provedor: "sefaz",
      xmlNoCofre: n.xmlNoCofre,
      xmlCancelamentoNoCofre: n.xmlCancelamentoNoCofre,
      ...(typeof info.valorDaNota === "number" ? { valorDaNota: info.valorDaNota } : {}),
      ...(typeof info.formaNaNota === "string" ? { formaNaNota: info.formaNaNota } : {}),
      origem: "tentativa sem resposta substituída pela contingência",
    },
  ];
}

/**
 * Os envios sem desfecho de pedidos FAILED (ver o cabeçalho, passo 2). A
 * marca `envioSefaz.aConferir` diz quem entra — o pedido que a retentativa
 * encerrou também. O ritmo é o do envio (`proximaConsultaDoEnvio`: no máximo
 * 2 consultas da chave por hora); o que se descobre é gravado pela
 * `sincronizarNota` (lib/fiscal-automatico), a mesma do "Consultar situação".
 */
export async function reconciliarEnviosSemDesfecho(p: { lojaId: string; config: ConfigDaLoja; agora?: Date; acabou?: () => boolean; limite?: number }): Promise<number> {
  const agora = p.agora ?? agoraDoEmissor();
  if (sefazBloqueadaAte(p.lojaId, p.config, agora)) return 0;
  const pedidos: Array<{ id: string; fiscalStatus: string | null; fiscalInfo: unknown }> = await bancoDoEmissor().customerOrder.findMany({
    where: {
      franchiseeId: p.lojaId,
      fiscalStatus: "FAILED",
      createdAt: { gte: new Date(agora.getTime() - JANELA_DA_RECONCILIACAO_MS) },
      fiscalInfo: { path: ["envioSefaz", "aConferir"], equals: true },
    },
    select: { id: true, fiscalStatus: true, fiscalInfo: true },
    orderBy: { createdAt: "desc" },
    take: p.limite ?? 40,
  });
  if (pedidos.length === 0) return 0;
  const { sincronizarNota } = await import("../fiscal-automatico");
  const { idDaNotaDoPedido } = await import("../fiscal-momento");
  const porNota = new Map<string, { ids: string[]; info: Registro; fiscalStatus: string | null; lojaId: string }>();
  for (const o of pedidos) {
    const info = objeto(o.fiscalInfo);
    const envio = envioDoFiscalInfo(info);
    if (!envio || envio.chave === info.nfceKey || envio.situacao === "para_pessoa") continue;
    if (proximaConsultaDoEnvio(envio) > agora.getTime()) continue;
    const id = idDaNotaDoPedido(o);
    const g = porNota.get(id) ?? { ids: [], info, fiscalStatus: o.fiscalStatus ?? null, lojaId: p.lojaId };
    g.ids.push(o.id);
    porNota.set(id, g);
  }
  let conferidos = 0;
  for (const [idDaNota, grupo] of porNota) {
    if (p.acabou?.() || sefazBloqueadaAte(p.lojaId, p.config)) break;
    await sincronizarNota(grupo, idDaNota, p.config as any);
    conferidos++;
  }
  return conferidos;
}

export type ResumoDaRotinaDaSefaz = { tentadosConferidos: number; enviosReconciliados: number; faixasInutilizadas: number; errosDaInutilizacao: number };

/** O passo do cron para uma loja do emissor próprio. Nunca lança: o cron segue para a próxima loja. */
export async function rotinaDoEmissorProprio(p: { lojaId: string; config: ConfigDaLoja; agora?: Date; acabou?: () => boolean }): Promise<ResumoDaRotinaDaSefaz> {
  const resumo: ResumoDaRotinaDaSefaz = { tentadosConferidos: 0, enviosReconciliados: 0, faixasInutilizadas: 0, errosDaInutilizacao: 0 };
  if (!usaEmissorProprio(p.config) || p.config.enabled !== true) return resumo;
  try {
    resumo.tentadosConferidos = await conferirNumerosTentados(p);
  } catch (e: any) {
    console.error(`[NFC-e] Erro ao conferir números tentados da loja ${p.lojaId}:`, String(e?.message ?? e).slice(0, 300));
  }
  if (p.acabou?.()) return resumo;
  try {
    resumo.enviosReconciliados = await reconciliarEnviosSemDesfecho(p);
  } catch (e: any) {
    console.error(`[NFC-e] Erro na reconciliação dos envios sem desfecho da loja ${p.lojaId}:`, String(e?.message ?? e).slice(0, 300));
  }
  if (p.acabou?.() || sefazBloqueadaAte(p.lojaId, p.config)) return resumo;
  try {
    const mensal = await inutilizarBuracosDoMes({ lojaId: p.lojaId, config: p.config, agora: p.agora });
    resumo.faixasInutilizadas = mensal.faixas.length;
    resumo.errosDaInutilizacao = mensal.erros.length;
  } catch (e: any) {
    console.error(`[NFC-e] Erro na inutilização mensal da loja ${p.lojaId}:`, String(e?.message ?? e).slice(0, 300));
  }
  return resumo;
}
