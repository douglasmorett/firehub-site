"use client";
import React from "react";
import { COR_DA_ETAPA, ROTULO_DA_ETAPA, type Etapa } from "@/lib/crm/etapas";

/**
 * Peças comuns das telas do CRM (admin e /vendedor): o estilo, o selo de
 * etapa, as datas relativas e o `api` que trata erro do mesmo jeito em todas.
 *
 * O estilo vem num <style> próprio com prefixo `crm-` porque as duas telas que
 * usam estes componentes têm folhas diferentes (`fha-` no admin, `vd-` no
 * vendedor) — e nenhuma das duas pode quebrar a outra.
 */

export const FUSO = "America/Sao_Paulo";

export function quandoCurto(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
  if (dia === hoje) return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(d);
  const ontem = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(Date.now() - 86_400_000));
  if (dia === ontem) return "ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(d);
}

export function haQuanto(iso: string | null | undefined): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export function dataHora(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function horaDe(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** fetch com JSON, que devolve `{ ok, dados, erro }` e nunca lança. */
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: boolean; dados: T; erro: string | null; status: number }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
      cache: "no-store",
    });
    const dados = await r.json().catch(() => ({}));
    return { ok: r.ok, dados, erro: r.ok ? null : dados?.error || dados?.erro || `Erro ${r.status}`, status: r.status };
  } catch {
    return { ok: false, dados: {} as T, erro: "Sem conexão. Tente de novo.", status: 0 };
  }
}

export function SeloDaEtapa({ etapa, pequeno }: { etapa: string; pequeno?: boolean }) {
  const cor = COR_DA_ETAPA[etapa as Etapa] || { fundo: "#F1F5F9", texto: "#475569" };
  return (
    <span className="crm-selo" style={{ background: cor.fundo, color: cor.texto, fontSize: pequeno ? "0.64rem" : undefined, padding: pequeno ? "2px 7px" : undefined }}>
      {ROTULO_DA_ETAPA[etapa as Etapa] || etapa}
    </span>
  );
}

export function Iniciais({ texto, tamanho = 36 }: { texto: string; tamanho?: number }) {
  const limpo = (texto || "?").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const partes = limpo.split(/\s+/).filter(Boolean);
  const ini = ((partes[0]?.[0] || "?") + (partes[1]?.[0] || "")).toUpperCase();
  let h = 0;
  for (const ch of limpo) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div style={{
      width: tamanho, height: tamanho, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
      background: `hsl(${h} 70% 92%)`, color: `hsl(${h} 45% 30%)`, fontWeight: 800, fontSize: tamanho * 0.36,
    }}>{ini}</div>
  );
}

export function Modal({ titulo, aoFechar, children, largura = 480 }: { titulo: string; aoFechar: () => void; children: React.ReactNode; largura?: number }) {
  return (
    <div className="crm-modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="crm-modal" style={{ maxWidth: largura }} role="dialog" aria-label={titulo}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.02rem", fontWeight: 800 }}>{titulo}</h3>
          <button className="crm-x" onClick={aoFechar} aria-label="Fechar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EstiloDoCrm() {
  return (
    <style>{`
      .crm { font-family: 'Inter', system-ui, sans-serif; color: #0F172A; }
      .crm * { box-sizing: border-box; }
      .crm-card { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; }
      .crm-btn { background: #FFFFFF; color: #334155; border: 1px solid #E2E8F0; padding: 7px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer; font-family: inherit; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
      .crm-btn:hover:not(:disabled) { background: #F8FAFC; border-color: #CBD5E1; }
      .crm-btn:disabled { opacity: .55; cursor: default; }
      .crm-btn-dark { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
      .crm-btn-dark:hover:not(:disabled) { background: #27272A; border-color: #27272A; }
      .crm-btn-primary { background: #E8360C; color: #FFFFFF; border-color: #E8360C; }
      .crm-btn-primary:hover:not(:disabled) { background: #C92E09; border-color: #C92E09; }
      .crm-btn-perigo { color: #B91C1C; }
      .crm-btn-sm { padding: 4px 9px; font-size: 0.72rem; border-radius: 7px; }
      .crm-input, .crm-select, .crm-textarea { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 9px; padding: 8px 11px; color: #0F172A; font-size: 0.84rem; font-family: inherit; outline: none; width: 100%; }
      .crm-select { cursor: pointer; width: auto; }
      .crm-textarea { resize: vertical; min-height: 64px; line-height: 1.4; }
      .crm-input:focus, .crm-select:focus, .crm-textarea:focus { border-color: #E8360C; box-shadow: 0 0 0 3px rgba(232,54,12,.12); }
      .crm-rotulo { display: block; font-size: 0.68rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: .4px; margin: 0 0 4px; }
      .crm-chip { padding: 6px 11px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; cursor: pointer; font-family: inherit; background: #FFFFFF; color: #475569; border: 1px solid #E2E8F0; white-space: nowrap; }
      .crm-chip.on { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
      .crm-chip.alerta.on { background: #B91C1C; border-color: #B91C1C; }
      .crm-selo { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap; }
      .crm-muted { color: #94A3B8; }
      .crm-sub { color: #64748B; font-size: 0.74rem; }
      .crm-x { background: none; border: none; font-size: 1.5rem; line-height: 1; color: #94A3B8; cursor: pointer; padding: 0 4px; }
      .crm-x:hover { color: #0F172A; }
      .crm-erro { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; padding: 9px 12px; border-radius: 9px; font-size: 0.8rem; font-weight: 600; }
      .crm-aviso { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; padding: 9px 12px; border-radius: 9px; font-size: 0.8rem; }
      .crm-ok { background: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; padding: 9px 12px; border-radius: 9px; font-size: 0.8rem; font-weight: 600; }
      .crm-modal-fundo { position: fixed; inset: 0; background: rgba(15,23,42,.45); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
      .crm-modal { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 16px; width: 100%; max-height: calc(100vh - 32px); overflow: auto; padding: 20px 22px; box-shadow: 0 20px 40px rgba(15,23,42,.18); }
      .crm-grade2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      @media (max-width: 560px) { .crm-grade2 { grid-template-columns: 1fr; } }

      /* ── Caixa de atendimento ── */
      .crm-caixa { position: relative; display: grid; grid-template-columns: 320px minmax(0, 1fr) 330px; height: calc(100vh - 170px); min-height: 540px; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; overflow: hidden; }
      .crm-lista { border-right: 1px solid #EEF0F3; display: flex; flex-direction: column; min-height: 0; }
      .crm-lista-topo { padding: 12px; border-bottom: 1px solid #EEF0F3; display: flex; flex-direction: column; gap: 8px; }
      .crm-lista-itens { overflow-y: auto; flex: 1; }
      .crm-item { display: flex; gap: 10px; padding: 11px 12px; border-bottom: 1px solid #F4F5F7; cursor: pointer; align-items: flex-start; }
      .crm-item:hover { background: #FAFBFC; }
      .crm-item.ativo { background: #FFF4F0; box-shadow: inset 3px 0 0 #E8360C; }
      .crm-item-nome { font-weight: 700; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .crm-item-previa { color: #64748B; font-size: 0.76rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
      .crm-bolinha { min-width: 19px; height: 19px; border-radius: 10px; background: #E8360C; color: #FFFFFF; font-size: 0.66rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; }
      .crm-conversa { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: #F6F7F9; }
      .crm-conversa-topo { background: #FFFFFF; padding: 10px 14px; border-bottom: 1px solid #EEF0F3; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .crm-mensagens { flex: 1; overflow-y: auto; padding: 16px 16px 8px; display: flex; flex-direction: column; gap: 6px; }
      .crm-balao { max-width: min(78%, 560px); padding: 8px 11px 6px; border-radius: 12px; font-size: 0.86rem; line-height: 1.4; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 1px rgba(15,23,42,.05); }
      .crm-balao.entrada { align-self: flex-start; background: #FFFFFF; border: 1px solid #ECEEF1; border-top-left-radius: 4px; }
      .crm-balao.saida { align-self: flex-end; border-top-right-radius: 4px; }
      .crm-balao .quem { font-size: 0.66rem; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 2px; opacity: .8; }
      .crm-balao .hora { font-size: 0.64rem; opacity: .6; text-align: right; margin-top: 3px; }
      .crm-dia { align-self: center; background: #E9ECEF; color: #475569; font-size: 0.68rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; margin: 8px 0 4px; }
      .crm-compor { background: #FFFFFF; border-top: 1px solid #EEF0F3; padding: 10px 12px; }
      .crm-ficha { border-left: 1px solid #EEF0F3; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; background: #FFFFFF; }
      .crm-bloco h4 { margin: 0 0 8px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .5px; color: #64748B; font-weight: 800; }
      .crm-linha { display: flex; justify-content: space-between; gap: 10px; font-size: 0.8rem; padding: 3px 0; }
      .crm-linha span:first-child { color: #64748B; }
      .crm-linha span:last-child { font-weight: 600; text-align: right; }
      .crm-vazio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; color: #64748B; padding: 30px; height: 100%; font-size: 0.86rem; }
      .crm-voltar { display: none; }
      @media (max-width: 1200px) {
        .crm-caixa { grid-template-columns: minmax(0, 300px) minmax(0, 1fr); }
        .crm-ficha { display: none; position: absolute; top: 0; right: 0; bottom: 0; width: min(360px, 100%); z-index: 20; box-shadow: -12px 0 30px rgba(15,23,42,.12); }
        .crm-caixa.ficha-aberta .crm-ficha { display: flex; }
      }
      @media (max-width: 760px) {
        .crm-caixa { grid-template-columns: minmax(0, 1fr); height: calc(100vh - 120px); }
        .crm-caixa.com-conversa .crm-lista { display: none; }
        .crm-caixa:not(.com-conversa) .crm-conversa { display: none; }
        .crm-voltar { display: inline-flex; }
      }

      /* ── Funil ── */
      .crm-kanban { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 8px; }
      .crm-coluna { background: #F1F3F5; border-radius: 12px; padding: 10px; min-height: 240px; display: flex; flex-direction: column; gap: 8px; }
      .crm-coluna.soltar { outline: 2px dashed #E8360C; outline-offset: -2px; background: #FFF4F0; }
      .crm-cartao { background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 10px; padding: 10px 11px; cursor: grab; }
      .crm-cartao:hover { border-color: #CBD5E1; box-shadow: 0 2px 8px rgba(15,23,42,.06); }
      .crm-tabela { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
      .crm-tabela th { padding: 9px 10px; text-align: left; color: #64748B; font-weight: 700; font-size: 0.68rem; text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid #EEF0F3; background: #F8FAFC; white-space: nowrap; }
      .crm-tabela td { padding: 9px 10px; border-bottom: 1px solid #F1F3F5; vertical-align: middle; }
      .crm-tabela tr:hover td { background: #FAFBFC; }

      /* ── Agenda ── */
      .crm-agenda-grade { display: grid; overflow-x: auto; border: 1px solid #E5E7EB; border-radius: 12px; background: #FFFFFF; }
      .crm-agenda-hora { font-size: 0.66rem; color: #94A3B8; text-align: right; padding-right: 6px; transform: translateY(-6px); }
      .crm-agenda-col { position: relative; border-left: 1px solid #EEF0F3; }
      .crm-agenda-cab { position: sticky; top: 0; background: #FFFFFF; z-index: 3; border-bottom: 1px solid #EEF0F3; padding: 8px; text-align: center; }
      .crm-reuniao { position: absolute; left: 4px; right: 4px; border-radius: 8px; padding: 4px 7px; font-size: 0.72rem; line-height: 1.25; overflow: hidden; cursor: pointer; border-left: 4px solid; z-index: 2; }
      .crm-vaga { position: absolute; left: 4px; right: 4px; border: 1.5px dashed #86EFAC; background: #F0FDF4; color: #15803D; border-radius: 8px; font-size: 0.7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 1; }
      .crm-vaga:hover { background: #DCFCE7; border-color: #22C55E; }
      .crm-semana td.dia { cursor: pointer; text-align: center; }
      .crm-semana td.dia:hover { background: #FFF4F0; }
    `}</style>
  );
}
