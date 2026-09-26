/**
 * GET /api/cron/abertura-da-loja — a cada minuto (scripts/cron-runner.js).
 *
 * 1. ABRE E FECHA a loja no horário, para quem ligou "Abrir e fechar sozinha
 *    no horário" em Minha Loja → Horários (User.aberturaAutomatica).
 * 2. AVISA O DONO no WhatsApp, pelo robô da loja, quando ela devia estar
 *    vendendo e não está: loja fechada no FireHub, caixa não aberto, loja
 *    fechada no iFood. Cada aviso liga e desliga em Chatbot IA → Notificações.
 *
 * As decisões moram em lib/abertura-da-loja.ts (sem banco, com teste); aqui
 * só se lê, pergunta e grava. Os carimbos ficam em User.aberturaEstado, uma
 * coluna própria — gravar em `chatbotConfig` a cada virada de turno correria o
 * risco de desfazer uma configuração do robô salva no mesmo instante.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { estadoDaLoja, turnoAgora, FUSO_PADRAO } from "@/lib/loja-aberta";
import { alertaLigado, avisarDono, type TipoDeAlerta } from "@/lib/alertas-do-dono";
import { disponibilidadeNoIfood } from "@/lib/ifood-disponibilidade";
import {
  avisosDevidos, consultarIfoodAgora, decidirAbertura, decidirIfood, limparIfoodForaDoTurno, marcarAviso,
  mensagemCaixa, mensagemIfoodFechado, mensagemLojaFechada,
  type AvisoDoTurno, type EstadoDaAbertura,
} from "@/lib/abertura-da-loja";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Folga contra o corte do cron-runner (55 s): consulta ao iFood para aqui e segue no próximo minuto. */
const PRAZO_MS = 40_000;

const TIPO: Record<AvisoDoTurno, TipoDeAlerta> = {
  lojaFechada: "loja_fechada_no_horario",
  caixa: "caixa_nao_aberto",
};

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function pontoDaLoja(v: any): { lat: number; lng: number } | null {
  const lat = Number(v?.lat ?? v?.latitude);
  const lng = Number(v?.lng ?? v?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const resumo = { lojas: 0, abertas: 0, fechadas: 0, avisos: 0, consultasIfood: 0 };

  try {
    // Quem liga a abertura automática, e quem tem para onde mandar aviso.
    // Loja sem número de alerta não entra pelos avisos: `avisarDono` só
    // registraria "não enviado" no log a cada minuto.
    const lojas = await prisma.user.findMany({
      where: {
        ownerId: null,
        NOT: { email: { startsWith: "deleted_" } },
        OR: [{ aberturaAutomatica: true }, { notificationPhone: { not: null } }],
      },
      select: {
        id: true, email: true, storeName: true, name: true,
        storeOpen: true, storeHours: true, storePause: true, storeTimezone: true, storeLatLng: true,
        notificationPhone: true, chatbotConfig: true,
        aberturaAutomatica: true, aberturaEstado: true,
        ifoodConnected: true, ifoodMerchantId: true,
      },
    });

    for (const loja of lojas) {
      // Sem horário cadastrado não há "devia estar aberta": o padrão de
      // normalizeStoreHours (18h–23h) seria um horário que a loja nunca escolheu.
      if (!Array.isArray(loja.storeHours) || loja.storeHours.length === 0) continue;
      resumo.lojas++;

      const agora = Date.now();
      const tz = loja.storeTimezone || FUSO_PADRAO;
      const nome = loja.storeName || loja.name || "Sua loja";
      const turno = turnoAgora(loja.storeHours, tz, new Date(agora));
      const emPausa = estadoDaLoja({
        storeHours: loja.storeHours, storePause: loja.storePause, storeOpen: true, timezone: tz, agora: new Date(agora),
      }).motivo === "pausa";
      const salvo = ((loja.aberturaEstado as any) || {}) as EstadoDaAbertura;
      let estado: EstadoDaAbertura = salvo;
      let storeOpen = loja.storeOpen;
      let novoStoreOpen: boolean | undefined;

      // ── 1. Abertura automática ─────────────────────────────────────────
      if (loja.aberturaAutomatica) {
        const d = decidirAbertura({ turno, storeOpen, emPausa, estado });
        estado = d.estado;
        if (d.storeOpen !== undefined) {
          novoStoreOpen = d.storeOpen;
          storeOpen = d.storeOpen;
        }
        if (d.acao === "abriu") resumo.abertas++;
        if (d.acao === "fechou") resumo.fechadas++;
        if (d.acao) console.log(`[abertura-da-loja] ${nome}: ${d.acao} (turno ${turno?.chave ?? estado.fechou}).`);
      }

      // ── 2. Avisos ao dono ──────────────────────────────────────────────
      if (soDigitos(loja.notificationPhone).length >= 10) {
        const config = loja.chatbotConfig as any;

        const precisaDoCaixa = !!turno && alertaLigado(config, "caixa_nao_aberto");
        const caixaAberto = precisaDoCaixa
          ? (await prisma.cashSession.count({ where: { franchiseeId: loja.id, status: "OPEN" } })) > 0
          : true;

        const r = avisosDevidos({ turno, agora, storeOpen, emPausa, caixaAberto, estado });
        estado = r.estado;
        for (const tipo of r.devidos) {
          if (!turno) break;
          if (!alertaLigado(config, TIPO[tipo])) {
            // Desligado: carimba o turno para não reavaliar a cada minuto.
            estado = marcarAviso(estado, tipo, turno, true, agora);
            continue;
          }
          const mensagem = tipo === "lojaFechada"
            ? mensagemLojaFechada({ loja: nome, turno, fechadaDesde: estado.fechadaDesde ?? agora, tz, automatica: !!loja.aberturaAutomatica })
            : mensagemCaixa({ loja: nome, turno });
          const saiu = await avisarDono(loja.id, TIPO[tipo], mensagem);
          if (saiu) resumo.avisos++;
          estado = marcarAviso(estado, tipo, turno, saiu, agora);
        }

        // iFood: só dentro do turno, a cada 5 min, e só com o aviso ligado.
        if (!turno) {
          estado = limparIfoodForaDoTurno(estado);
        } else if (alertaLigado(config, "ifood_fechado") && Date.now() - inicio < PRAZO_MS) {
          const integracoes = await prisma.ifoodIntegration.findMany({
            where: { userId: loja.id, active: true },
            select: { merchantId: true, label: true },
          });
          const merchants = integracoes.length > 0
            ? integracoes.map((i) => ({ merchantId: i.merchantId, label: i.label, integrada: true }))
            : loja.ifoodConnected && loja.ifoodMerchantId
              ? [{ merchantId: loja.ifoodMerchantId, label: null as string | null, integrada: false }]
              : [];

          for (const m of merchants) {
            if (!m.merchantId || Date.now() - inicio >= PRAZO_MS) continue;
            const anterior = estado.ifood?.[m.merchantId];
            if (!consultarIfoodAgora(turno, anterior, agora)) continue;

            resumo.consultasIfood++;
            const disp = await disponibilidadeNoIfood({
              email: loja.email, merchantId: m.merchantId, integrada: m.integrada, ponto: pontoDaLoja(loja.storeLatLng),
            });
            const d = decidirIfood({ aberta: disp.aberta, agora, registro: anterior });
            const registro = d.registro;
            if (d.avisar) {
              const saiu = await avisarDono(loja.id, "ifood_fechado", mensagemIfoodFechado({
                loja: nome, lojaIfood: m.label, turno, fechadoDesde: registro.fechadoDesde ?? agora, tz, motivo: disp.motivo,
              }));
              if (saiu) {
                resumo.avisos++;
                registro.avisadoDesde = registro.fechadoDesde;
                delete registro.tentouEm;
              } else {
                registro.tentouEm = agora;
              }
            }
            estado = { ...estado, ifood: { ...(estado.ifood || {}), [m.merchantId]: registro } };
          }
        }
      }

      // ── Grava só o que mudou ───────────────────────────────────────────
      const mudouEstado = JSON.stringify(estado) !== JSON.stringify(salvo);
      if (mudouEstado || novoStoreOpen !== undefined) {
        await prisma.user
          .update({
            where: { id: loja.id },
            data: {
              ...(novoStoreOpen !== undefined ? { storeOpen: novoStoreOpen } : {}),
              ...(mudouEstado ? { aberturaEstado: estado as any } : {}),
            },
          })
          .catch((err) => console.error(`[abertura-da-loja] Falha ao gravar a loja ${loja.id}:`, err?.message));
      }
    }

    return NextResponse.json({ ok: true, ...resumo, ms: Date.now() - inicio });
  } catch (err: any) {
    console.error("[abertura-da-loja] Falha:", err?.message);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
