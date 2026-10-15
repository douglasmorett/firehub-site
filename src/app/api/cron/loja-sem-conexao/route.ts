/**
 * GET /api/cron/loja-sem-conexao — a cada minuto (scripts/cron-runner.js).
 *
 * A internet da loja caiu no meio do expediente: pausa o que dá para pausar
 * (iFood, site e robô), avisa o dono e desfaz tudo sozinho quando a loja volta.
 * As decisões moram em lib/loja-sem-conexao.ts (sem banco, com teste); aqui só
 * se lê, decide, age e grava.
 *
 * Por loja, a ordem é sempre a mesma:
 *   1. lê os sinais (banco + memória do processo, lib/sinais-da-loja.ts) e o
 *      estado gravado (User.semConexaoEstado, com versão);
 *   2. decide;
 *   3. GRAVA a decisão antes de agir, condicionada à versão lida e com o
 *      "Site aberto" na mesma instrução. Quem perde a corrida não age — é o
 *      que impede duas pausas no iFood e dois avisos para a mesma queda;
 *   4. fala com o iFood e manda o aviso;
 *   5. grava os resultados.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { estadoDaLoja, turnoAgora, FUSO_PADRAO } from "@/lib/loja-aberta";
import { alertaLigado, avisarDono, numerosDoDono } from "@/lib/alertas-do-dono";
import { contextoIfood, ErroIfood, type ContextoIfood } from "@/lib/ifood-token";
import { chamarComContexto } from "@/lib/ifood-http";
import { lerStatusDoMerchant } from "@/lib/ifood-disponibilidade";
import { assistenteVistoEm, esquecerSinaisVelhos, painelVistoEm, servidorSubiuEm } from "@/lib/sinais-da-loja";
import { gravarEstadoSemConexao, lerEstadosSemConexao } from "@/lib/loja-sem-conexao-no-banco";
import { contingenciaAtivada, subidasDesde } from "@/lib/contingencia/aviso-ao-dono";
import {
  ASSISTENTE_RECENTE_MS, DESCRICAO_DA_PAUSA, PAUSA_NO_IFOOD_MS,
  decidirSemConexao, horaLocalParaOIfood, idDaPausaCriada, idsDasNossasPausas, mesmoEstado,
  mensagemDeFimDoHorario, mensagemDeQueda, mensagemDeVolta, protecaoLigada,
  registrarAviso, registrarPausaNoIfood, registrarTiradaDoIfood,
  type ResultadoDaPausa,
} from "@/lib/loja-sem-conexao";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Folga contra o corte do cron-runner (55 s): loja que precisa agir depois disto fica para o próximo minuto. */
const PRAZO_MS = 40_000;
/** Cada chamada ao iFood: uma tentativa só, de no máximo 8 s. A nova tentativa é a próxima rodada. */
const CHAMADA_IFOOD_MS = 8_000;

declare global {
  // eslint-disable-next-line no-var
  var __firehubLojaSemConexaoRodando: number | undefined;
}

type MerchantDaLoja = { merchantId: string; nome: string | null; integrada: boolean };

/**
 * Modo Contingência: o supervisor que o Assistente liga no computador da loja
 * fala com a nuvem a cada 30 s (api/contingencia/relato → ultimoContato). Se
 * ele fala, a internet da loja está de pé — mesmo com o painel e a fila
 * trabalhando no computador (o "Testar agora", ou a volta depois de uma
 * oscilação do nosso servidor). Conta como sinal do Assistente.
 */
async function contatoDosSupervisores(lojaIds: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (!lojaIds.length) return mapa;
  try {
    const linhas = await prisma.$queryRawUnsafe<{ lojaId: string; ultimoContato: Date }[]>(
      `SELECT "lojaId", "ultimoContato" FROM "Contingencia"
        WHERE "lojaId" = ANY($1::text[]) AND "ultimoContato" > now() - interval '1 hour'`,
      lojaIds,
    );
    for (const l of linhas) mapa.set(l.lojaId, new Date(l.ultimoContato).getTime());
  } catch {
    /* sem a tabela da contingência: só os sinais de sempre */
  }
  return mapa;
}

function maisRecente(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Uma rodada por vez neste processo. O cron-runner também segura
  // (`exclusivo`), mas ele desiste aos 55 s e a rota segue rodando: a rodada
  // de um minuto atrás ainda falando com o iFood não pode ser atropelada.
  const rodando = globalThis.__firehubLojaSemConexaoRodando;
  if (rodando && Date.now() - rodando < 2 * 60_000) {
    return NextResponse.json({ ok: true, pulada: "a rodada anterior ainda está no ar" });
  }
  globalThis.__firehubLojaSemConexaoRodando = Date.now();

  const inicio = Date.now();
  const resumo = { lojas: 0, emQueda: 0, apagaram: 0, voltaram: 0, avisos: 0, adiadas: 0 };

  try {
    esquecerSinaisVelhos(inicio);
    const estados = await lerEstadosSemConexao();
    // Loja em queda (ou com pausa nossa por tirar) entra mesmo com o
    // Assistente mudo há horas: é preciso desfazer o que foi feito.
    const comPendencia = Array.from(estados.entries())
      .filter(([, g]) => g.estado.episodio || (g.estado.tirarDoIfood?.length ?? 0) > 0)
      .map(([id]) => id);

    const lojas = await prisma.user.findMany({
      where: {
        ownerId: null,
        NOT: { email: { startsWith: "deleted_" } },
        OR: [
          // Assistente vivo há pouco: é quem pode apagar. Loja que nunca usou o
          // Assistente nem entra — fica como sempre foi.
          { printQueuePolledAt: { gte: new Date(inicio - ASSISTENTE_RECENTE_MS - 5 * 60_000) } },
          ...(comPendencia.length > 0 ? [{ id: { in: comPendencia } }] : []),
        ],
      },
      select: {
        id: true, email: true, storeName: true, name: true,
        storeOpen: true, storeHours: true, storePause: true, storeTimezone: true,
        chatbotConfig: true, notificationPhone: true, printQueuePolledAt: true,
        ifoodConnected: true, ifoodMerchantId: true, food99Connected: true,
      },
    });

    // As lojas do iFood de todas de uma vez (é a mesma regra da abertura: a
    // tabela de integrações; sem nenhuma, o vínculo antigo do User).
    const integracoes = lojas.length > 0
      ? await prisma.ifoodIntegration.findMany({
          where: { userId: { in: lojas.map((l) => l.id) }, active: true },
          select: { userId: true, merchantId: true, label: true },
        })
      : [];

    const bootEm = servidorSubiuEm(inicio);
    const supervisores = await contatoDosSupervisores(lojas.map((l) => l.id));

    for (const loja of lojas) {
      resumo.lojas++;
      try {
        const agora = Date.now();
        const tz = loja.storeTimezone || FUSO_PADRAO;
        const nome = loja.storeName || loja.name || "Sua loja";
        const config = (loja.chatbotConfig as any) || {};
        // Sem horário cadastrado não há "dentro do horário": nada a proteger.
        const temHorario = Array.isArray(loja.storeHours) && loja.storeHours.length > 0;
        const turno = temHorario ? turnoAgora(loja.storeHours, tz, new Date(agora)) : null;
        const emPausa = temHorario && estadoDaLoja({
          storeHours: loja.storeHours, storePause: loja.storePause, storeOpen: true, timezone: tz, agora: new Date(agora),
        }).motivo === "pausa";
        const merchants = merchantsDaLoja(loja, integracoes);
        const gravado = estados.get(loja.id) ?? { estado: {}, versao: 0 };

        const d = decidirSemConexao({
          sinais: {
            agora, bootEm,
            assistenteNoBanco: loja.printQueuePolledAt ? loja.printQueuePolledAt.getTime() : null,
            assistenteNaMemoria: maisRecente(assistenteVistoEm(loja.id), supervisores.get(loja.id) ?? null),
            painelNaMemoria: painelVistoEm(loja.id),
          },
          loja: { turno: turno?.chave ?? null, emPausa, storeOpen: loja.storeOpen, protecaoLigada: protecaoLigada(config) },
          ifood: merchants.map((m) => ({ merchantId: m.merchantId, nome: m.nome })),
          podeAvisar: alertaLigado(config, "loja_sem_conexao") && numerosDoDono(loja.notificationPhone, config).length > 0,
          estado: gravado.estado,
        });
        if (d.estado.episodio) resumo.emQueda++;

        const a = d.acoes;
        const age = !!(a.fecharSite || a.reabrirSite || a.pausarNoIfood.length || a.renovarNoIfood.length || a.tirarDoIfood.length || a.aviso);
        if (!age && mesmoEstado(d.estado, gravado.estado)) continue;
        if (age && Date.now() - inicio >= PRAZO_MS) {
          resumo.adiadas++;
          continue;
        }

        // ── 1. Grava a decisão ANTES de agir ───────────────────────────────
        const gravou = await gravarEstadoSemConexao({
          lojaId: loja.id,
          versaoLida: gravado.versao,
          estado: d.estado,
          site: a.fecharSite ? "fechar" : a.reabrirSite ? "reabrir" : undefined,
        });
        if (!gravou) {
          // Outra rodada gravou primeiro, ou o dono fechou o site neste
          // meio-tempo (a queda só começa com ele ligado): a próxima rodada relê.
          console.warn(`[loja-sem-conexao] ${nome}: o estado mudou desde a leitura — fica para a próxima rodada.`);
          continue;
        }
        if (!age) continue;

        if (d.evento === "apagou") {
          resumo.apagaram++;
          console.warn(`[loja-sem-conexao] 📡 ${nome}: SEM CONEXÃO (Assistente mudo desde ${new Date(d.estado.episodio!.ultimoSinal).toISOString()}, nenhum painel). Site fechado; pausando ${merchants.length} loja(s) do iFood.`);
        } else if (d.evento === "voltou") {
          resumo.voltaram++;
          console.log(`[loja-sem-conexao] ✅ ${nome}: fim da queda (${d.motivo}). Desfazendo o que foi feito.`);
        }

        // ── 2. iFood ─────────────────────────────────────────────────────────
        let estado = d.estado;
        const merchantPara = (id: string): MerchantDaLoja =>
          merchants.find((m) => m.merchantId === id) ?? { merchantId: id, nome: null, integrada: false };

        for (const merchantId of a.pausarNoIfood) {
          const r = await pausarNoIfood(loja.email, merchantPara(merchantId), tz, true);
          if (r.situacao !== "pausada") console.warn(`[loja-sem-conexao] ${nome}: iFood ${merchantId} não pausado (${r.situacao}${"erro" in r && r.erro ? `: ${r.erro}` : ""}).`);
          estado = registrarPausaNoIfood(estado, merchantId, r);
        }
        for (const { merchantId, ids } of a.renovarNoIfood) {
          // Tira as nossas e põe outra de 2 h. Se a velha não sai, nada muda e
          // a próxima rodada tenta de novo (ela ainda vale até vencer).
          const m = merchantPara(merchantId);
          const tirou = await tirarNossasPausas(loja.email, m, ids);
          const r: ResultadoDaPausa = tirou ? await pausarNoIfood(loja.email, m, tz, false) : { situacao: "mantida" };
          estado = registrarPausaNoIfood(estado, merchantId, r);
        }
        const ficou: string[] = [];
        for (const t of a.tirarDoIfood) {
          const ok = await tirarNossasPausas(loja.email, merchantPara(t.merchantId), t.ids);
          if (!ok) {
            ficou.push(t.merchantId);
            console.warn(`[loja-sem-conexao] ${nome}: a pausa nossa do iFood ${t.merchantId} não saiu — tento de novo.`);
          }
          estado = registrarTiradaDoIfood(estado, t.merchantId, ok);
        }

        // ── 3. Aviso ao dono ─────────────────────────────────────────────────
        if (a.aviso) {
          let mensagem: string | null = null;
          if (a.aviso === "queda" && estado.episodio) {
            mensagem = mensagemDeQueda({
              loja: nome, episodio: estado.episodio, tz, semPausaAutomatica: await canaisSemPausa(loja),
              contingencia: await contingenciaAtivada(loja.id),
            });
          } else if (a.aviso === "volta" && d.encerrado) {
            // Modo Contingência: o que o computador do caixa subiu desde o começo da queda.
            const contingencia = (await contingenciaAtivada(loja.id))
              ? { subida: await subidasDesde(loja.id, new Date(d.encerrado.ultimoSinal - 60_000)) }
              : undefined;
            mensagem = mensagemDeVolta({ loja: nome, episodio: d.encerrado, agora, tz, ifoodQueFicou: ficou, contingencia });
          } else if (a.aviso === "fim_do_horario" && d.encerrado) {
            mensagem = mensagemDeFimDoHorario({ loja: nome, episodio: d.encerrado, agora, tz, ifoodQueFicou: ficou });
          }
          if (mensagem) {
            const saiu = await avisarDono(loja.id, "loja_sem_conexao", mensagem);
            if (saiu) resumo.avisos++;
            estado = registrarAviso(estado, a.aviso, saiu, agora);
          }
        }

        // ── 4. Os resultados ─────────────────────────────────────────────────
        if (!mesmoEstado(estado, d.estado)) {
          const ok = await gravarEstadoSemConexao({ lojaId: loja.id, versaoLida: gravado.versao + 1, estado });
          if (!ok) console.error(`[loja-sem-conexao] ${nome}: não consegui gravar o resultado (outra rodada gravou no meio).`);
        }
      } catch (err: any) {
        // Uma loja com problema não para as outras.
        console.error(`[loja-sem-conexao] Falha na loja ${loja.id}:`, err?.message);
      }
    }

    return NextResponse.json({ ok: true, ...resumo, ms: Date.now() - inicio });
  } catch (err: any) {
    console.error("[loja-sem-conexao] Falha:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  } finally {
    globalThis.__firehubLojaSemConexaoRodando = undefined;
  }
}

/** As lojas do iFood desta loja do FireHub: as integrações; sem nenhuma, o vínculo antigo do User. */
function merchantsDaLoja(
  loja: { id: string; ifoodConnected: boolean | null; ifoodMerchantId: string | null },
  integracoes: { userId: string; merchantId: string; label: string | null }[],
): MerchantDaLoja[] {
  const vistos = new Set<string>();
  const daLoja: MerchantDaLoja[] = [];
  for (const i of integracoes) {
    if (i.userId !== loja.id || !i.merchantId || vistos.has(i.merchantId)) continue;
    vistos.add(i.merchantId);
    daLoja.push({ merchantId: i.merchantId, nome: i.label ?? null, integrada: true });
  }
  if (daLoja.length > 0) return daLoja;
  if (loja.ifoodConnected && loja.ifoodMerchantId) return [{ merchantId: loja.ifoodMerchantId, nome: null, integrada: false }];
  return [];
}

/** Uma tentativa, com prazo curto: quem repete é a próxima rodada. */
const opcoesDoIfood = () => ({ tentativasMax: 1, signal: AbortSignal.timeout(CHAMADA_IFOOD_MS) });

/** As credenciais do iFood da loja para uma loja do iFood. `semAcesso` = não adianta repetir. */
async function contextoDaLoja(email: string, m: MerchantDaLoja): Promise<{ ctx: ContextoIfood } | { erro: string; semAcesso: boolean }> {
  try {
    return { ctx: await contextoIfood({ email, merchantId: m.integrada ? m.merchantId : null }) };
  } catch (err: any) {
    // ErroIfood é "sem autorização / loja não integrada"; o resto (banco,
    // rede ao renovar o token) é passageiro.
    return { erro: String(err?.message || err).slice(0, 160), semAcesso: err instanceof ErroIfood };
  }
}

/**
 * Pausa uma loja do iFood por 2 h com a NOSSA descrição. Com `conferirStatus`,
 * não mexe na loja que o iFood já mostra fechada (horário de lá, pausa do dono).
 */
async function pausarNoIfood(email: string, m: MerchantDaLoja, tz: string, conferirStatus: boolean): Promise<ResultadoDaPausa> {
  const c = await contextoDaLoja(email, m);
  if ("erro" in c) return { situacao: c.semAcesso ? "sem_acesso" : "falhou", erro: c.erro };
  const base = `/merchant/v1.0/merchants/${encodeURIComponent(m.merchantId)}`;

  if (conferirStatus) {
    const st = await chamarComContexto(c.ctx, `${base}/status`, opcoesDoIfood());
    const lido = st.ok ? lerStatusDoMerchant(st.data) : null;
    if (lido && !lido.aberta) return { situacao: "ja_fechada" };
    // Status ilegível (sem o módulo Merchant, iFood instável): tenta a pausa
    // assim mesmo — é ela que diz se dá ou não.
  }

  // Começa AGORA (não no início da rodada): o mesmo "agora" que o painel manda
  // ao pausar (StoreTopNav), no relógio da loja e sem fuso.
  const inicio = Date.now();
  const ate = inicio + PAUSA_NO_IFOOD_MS;
  const r = await chamarComContexto(c.ctx, `${base}/interruptions`, {
    method: "POST",
    body: JSON.stringify({ description: DESCRICAO_DA_PAUSA, start: horaLocalParaOIfood(inicio, tz), end: horaLocalParaOIfood(ate, tz) }),
    ...opcoesDoIfood(),
  });
  if (r.ok) {
    let id = idDaPausaCriada(r.data);
    if (!id) {
      // Criou e não disse o id: acha a nossa pela descrição.
      const lista = await chamarComContexto(c.ctx, `${base}/interruptions`, opcoesDoIfood());
      id = lista.ok ? idsDasNossasPausas(lista.data).pop() ?? null : null;
    }
    return { situacao: "pausada", interrupcaoId: id ?? undefined, ate };
  }
  // 409 InterruptionOverlap: já há pausa nesse intervalo (do dono, ou uma
  // nossa cuja resposta se perdeu). A loja já está parada no iFood.
  if (r.status === 409) return { situacao: "ja_fechada" };
  if (r.status === 401 || r.status === 403) return { situacao: "sem_acesso", erro: `iFood respondeu ${r.status}` };
  return { situacao: "falhou", erro: `iFood respondeu ${r.status} ${r.texto || ""}`.trim().slice(0, 160) };
}

/**
 * Tira as NOSSAS pausas de uma loja do iFood: as de id conhecido e as que têm
 * a nossa descrição. A do dono nunca. true = não sobrou nenhuma nossa.
 */
async function tirarNossasPausas(email: string, m: MerchantDaLoja, idsConhecidos: string[]): Promise<boolean> {
  const c = await contextoDaLoja(email, m);
  if ("erro" in c) return false;
  const base = `/merchant/v1.0/merchants/${encodeURIComponent(m.merchantId)}`;

  const alvo = new Set(idsConhecidos);
  const lista = await chamarComContexto(c.ctx, `${base}/interruptions`, opcoesDoIfood());
  if (lista.ok) {
    for (const id of idsDasNossasPausas(lista.data)) alvo.add(id);
  } else if (alvo.size === 0) {
    return false; // sem listagem e sem id: não dá para saber o que tirar
  }

  let ok = true;
  for (const id of alvo) {
    const r = await chamarComContexto(c.ctx, `${base}/interruptions/${encodeURIComponent(id)}`, { method: "DELETE", ...opcoesDoIfood() });
    // 404 = já não existe (venceu, ou alguém tirou): resolvido.
    if (!r.ok && r.status !== 404) ok = false;
  }
  return ok;
}

/**
 * Canais ligados à loja que o FireHub NÃO consegue pausar — o aviso diz ao
 * dono que os pedidos de lá continuam entrando. Cada consulta falha sozinha
 * (tabela que não existe ainda = canal não ligado).
 */
async function canaisSemPausa(loja: { id: string; food99Connected: boolean | null }): Promise<string[]> {
  const canais: string[] = [];
  try {
    let tem99 = !!loja.food99Connected;
    if (!tem99) {
      const r = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Food99Store" WHERE "userId" = ${loja.id} AND "active" = true
      `;
      tem99 = (r[0]?.n ?? 0) > 0;
    }
    if (tem99) canais.push("99Food");
  } catch { /* sem a tabela: só a coluna antiga vale */ }
  try {
    const r = await prisma.$queryRaw<{ ativa: boolean }[]>`
      SELECT "ativa" FROM "KeetaLoja" WHERE "franchiseeId" = ${loja.id} LIMIT 1
    `;
    if (r[0]?.ativa) canais.push("Keeta");
  } catch { /* tabela da Keeta ainda não criada */ }
  try {
    const r = await prisma.$queryRaw<{ ligada: boolean | null }[]>`
      SELECT "wabizConnected" AS ligada FROM "User" WHERE "id" = ${loja.id} LIMIT 1
    `;
    if (r[0]?.ligada) canais.push("Wabiz");
  } catch { /* coluna da Wabiz ausente */ }
  return canais;
}
