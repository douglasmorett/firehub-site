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

      /* ── Caixa de atendimento: tinta, creme e areia ──
         Tela de ficar horas lendo conversa: nada de branco estourado. Faixas
         "tinta" (o preto da barra do admin) no topo das três colunas, creme na
         lista e na ficha, areia com textura leve na conversa (o papel de parede
         que a equipe já conhece do WhatsApp). Balões dizem quem falou pela cor:
         contato em branco, gente da equipe em verde, robô em lilás, aviso em
         âmbar. O laranja do FireHub fica raro: enviar, selecionada, não lidas. */
      .crm-caixa {
        --tinta: #1C1917; --tinta-2: #2A2622; --tinta-borda: #45403A; --tinta-texto: #F5F0E8; --tinta-sub: #B5ADA5;
        --creme: #F8F3EA; --creme-hover: #F1E8DA; --areia: #E9DFCF;
        --linha: #E6DCCB; --linha-forte: #D8CAB4;
        --texto: #1C1917; --texto-2: #57534E; --texto-3: #6B625A; --texto-4: #7A7068;
        --laranja: #E8360C;
        position: relative; display: grid; grid-template-columns: 320px minmax(0, 1fr) 320px;
        height: calc(100vh - 186px); min-height: 560px; background: var(--creme);
        border: 1px solid var(--linha-forte); border-radius: 16px; overflow: hidden;
        box-shadow: 0 1px 2px rgba(28,25,23,.06), 0 18px 40px -22px rgba(28,25,23,.38);
        scrollbar-color: var(--linha-forte) transparent;
      }
      .crm-caixa ::selection { background: #F7CDBD; color: #1C1917; }
      .crm-caixa :focus-visible { outline: 2px solid var(--laranja); outline-offset: 2px; }
      .crm-caixa *::-webkit-scrollbar { width: 10px; height: 10px; }
      .crm-caixa *::-webkit-scrollbar-track { background: transparent; }
      .crm-caixa *::-webkit-scrollbar-thumb { background: var(--linha-forte); border-radius: 10px; border: 3px solid transparent; background-clip: content-box; }
      .crm-caixa .crm-input, .crm-caixa .crm-select, .crm-caixa .crm-textarea { background: #FFFFFF; border-color: var(--linha-forte); }
      .crm-caixa .crm-input::placeholder, .crm-caixa .crm-textarea::placeholder { color: var(--texto-4); }
      .crm-caixa .crm-chip { background: #FFFFFF; border-color: var(--linha-forte); color: #44403C; display: inline-flex; align-items: center; gap: 5px; }
      .crm-caixa .crm-chip:hover { border-color: #BFAE94; }
      .crm-caixa .crm-chip.on { background: var(--tinta); border-color: var(--tinta); color: #FFFFFF; }
      .crm-caixa .crm-chip.alerta.on { background: #B42318; border-color: #B42318; }

      .crm-faixa { background: var(--tinta); color: var(--tinta-texto); min-height: 62px; padding: 8px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .crm-faixa h3 { margin: 0; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; color: #FAF7F2; }
      .crm-faixa .crm-sub { color: var(--tinta-sub); }
      .crm-faixa-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 9px; border: 1px solid var(--tinta-borda); background: var(--tinta-2); color: var(--tinta-texto); font-family: inherit; font-weight: 700; font-size: 0.76rem; line-height: 1; cursor: pointer; white-space: nowrap; }
      .crm-faixa-btn:hover { background: #35302B; border-color: #57514A; }
      .crm-faixa-btn.claro { background: #F5F0E8; color: var(--tinta); border-color: #F5F0E8; }
      .crm-faixa-btn.claro:hover { background: #FFFFFF; }
      .crm-pilula { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px; background: var(--tinta-2); border: 1px solid var(--tinta-borda); color: var(--tinta-texto); font-size: 0.74rem; font-weight: 700; white-space: nowrap; }
      .crm-pilula i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .crm-pilula.verde i { background: #4ADE80; } .crm-pilula.ambar i { background: #FBBF24; }
      .crm-pilula.vermelho i { background: #F87171; } .crm-pilula.cinza i { background: #A8A29E; }

      .crm-lista { background: var(--creme); border-right: 1px solid var(--linha); display: flex; flex-direction: column; min-height: 0; }
      .crm-lista-topo { padding: 10px 12px 12px; border-bottom: 1px solid var(--linha); display: flex; flex-direction: column; gap: 9px; }
      .crm-busca { position: relative; }
      .crm-busca svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--texto-4); pointer-events: none; }
      .crm-busca .crm-input { padding-left: 36px; border-radius: 999px; }
      .crm-lista-itens { overflow-y: auto; flex: 1; }
      .crm-item { display: flex; gap: 11px; padding: 12px 14px; border-bottom: 1px solid var(--linha); cursor: pointer; align-items: flex-start; transition: background-color .12s ease-out; }
      .crm-item:hover { background: var(--creme-hover); }
      .crm-item.ativo { background: #FFFFFF; box-shadow: 0 8px 18px -12px rgba(60,45,25,.5); position: relative; z-index: 1; }
      .crm-avatar { flex-shrink: 0; border-radius: 50%; }
      .crm-item.ativo .crm-avatar { box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--laranja); }
      .crm-item-nome { font-weight: 700; font-size: 0.88rem; color: var(--texto); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .crm-item-hora { flex-shrink: 0; font-size: 0.68rem; color: var(--texto-4); font-variant-numeric: tabular-nums; }
      .crm-item-previa { color: var(--texto-3); font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
      .crm-item.nao-lida .crm-item-previa { color: var(--texto); font-weight: 600; }
      .crm-item.nao-lida .crm-item-hora { color: var(--laranja); font-weight: 800; }
      .crm-marca { display: inline-flex; align-items: center; gap: 3px; font-size: 0.64rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; }
      .crm-marca.loja { background: #EDE3D2; color: #57534E; }
      .crm-marca.pessoa { background: #FBE1DE; color: #9A2A12; }
      .crm-marca.pausa { background: #EFE6D6; color: #6B625A; }
      .crm-bolinha { min-width: 20px; height: 20px; border-radius: 10px; background: var(--laranja); color: #FFFFFF; font-size: 0.68rem; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; font-variant-numeric: tabular-nums; }

      .crm-conversa { display: flex; flex-direction: column; min-width: 0; min-height: 0; background-color: var(--areia); background-image: radial-gradient(rgba(110,86,52,.14) 1px, transparent 1.4px); background-size: 20px 20px; }
      .crm-conversa-quem { min-width: 0; flex: 1; }
      .crm-conversa-quem .crm-sub { font-size: 0.74rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .crm-faixa-conversa { flex-wrap: nowrap; }
      .crm-subfaixa { background: var(--tinta-2); border-top: 1px solid #3A352F; padding: 7px 14px; min-height: 46px; display: flex; align-items: center; gap: 8px; }
      .crm-subfaixa .crm-pilula { background: transparent; border: none; padding: 0; color: #E7E0D6; font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .crm-subfaixa .crm-faixa-btn { padding: 6px 11px; }
      .crm-conversa-quem b { display: block; font-size: 0.95rem; font-weight: 800; color: #FAF7F2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .crm-alerta { margin: 10px 14px 0; background: #FBE7E3; border: 1px solid #F1C3B8; color: #7A2413; border-radius: 12px; padding: 8px 10px 8px 12px; display: flex; align-items: center; gap: 10px; font-size: 0.8rem; font-weight: 600; }
      .crm-alerta .crm-btn { border-color: #E9B3A6; }
      .crm-mensagens { flex: 1; overflow-y: auto; padding: 14px 18px 10px; display: flex; flex-direction: column; gap: 5px; }
      .crm-balao { max-width: min(76%, 560px); padding: 7px 11px 5px; border-radius: 14px; font-size: 0.88rem; line-height: 1.42; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 1.5px rgba(60,45,25,.16); animation: crm-entra .22s cubic-bezier(.16,1,.3,1); }
      .crm-balao.entrada { align-self: flex-start; background: #FFFFFF; color: var(--texto); border-top-left-radius: 4px; }
      .crm-balao.saida { align-self: flex-end; border-top-right-radius: 4px; }
      .crm-balao.gente { background: #D7F2C4; color: #173A0C; }
      .crm-balao.robo { background: #E7E2FB; color: #231A55; }
      .crm-balao.aviso { background: #FBEFC6; color: #4A3606; }
      .crm-balao.falhou { box-shadow: inset 0 0 0 1.5px #D92D20, 0 1px 1.5px rgba(60,45,25,.16); }
      .crm-balao .quem { display: flex; align-items: center; gap: 4px; font-size: 0.7rem; font-weight: 800; margin-bottom: 2px; }
      .crm-balao.gente .quem { color: #2F6B1B; }
      .crm-balao.robo .quem { color: #5443B8; }
      .crm-balao.aviso .quem { color: #7F5D06; }
      .crm-balao .hora { display: flex; justify-content: flex-end; align-items: center; gap: 6px; font-size: 0.66rem; margin-top: 2px; opacity: .65; font-variant-numeric: tabular-nums; }
      .crm-balao .erro-envio { color: #B42318; font-weight: 800; opacity: 1; display: inline-flex; align-items: center; gap: 3px; }
      .crm-dia { align-self: center; background: var(--creme); color: var(--texto-2); font-size: 0.7rem; font-weight: 700; padding: 4px 12px; border-radius: 999px; margin: 10px 0 4px; box-shadow: 0 1px 1px rgba(60,45,25,.14); }
      .crm-dia::first-letter { text-transform: uppercase; }
      @keyframes crm-entra { from { transform: translateY(5px); } to { transform: none; } }
      @media (prefers-reduced-motion: reduce) { .crm-balao { animation: none; } }

      .crm-compor { background: var(--creme); border-top: 1px solid var(--linha); padding: 10px 14px 8px; }
      .crm-compor-linha { display: flex; gap: 10px; align-items: flex-end; }
      .crm-compor .crm-textarea { flex: 1; min-height: 46px; max-height: 160px; border-radius: 23px; padding: 12px 16px; resize: none; caret-color: var(--laranja); line-height: 1.4; }
      .crm-enviar { width: 46px; height: 46px; border-radius: 50%; border: none; background: var(--laranja); color: #FFFFFF; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; box-shadow: 0 6px 14px -6px rgba(232,54,12,.7); transition: transform .12s ease-out, background-color .12s ease-out; }
      .crm-enviar:hover:not(:disabled) { background: #C92E09; }
      .crm-enviar:active:not(:disabled) { transform: scale(.94); }
      .crm-enviar:disabled { background: #E3BFB0; box-shadow: none; cursor: default; }
      .crm-compor-dica { color: var(--texto-3); font-size: 0.72rem; margin-top: 7px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding-left: 6px; }

      .crm-ficha { border-left: 1px solid var(--linha); background: var(--creme); display: flex; flex-direction: column; min-height: 0; }
      .crm-ficha-corpo { overflow-y: auto; padding: 12px; flex: 1; }
      .crm-ficha-corpo .crm-bloco, .crm-ficha-corpo .crm-ficha-cabeca { background: #FFFFFF; border: 1px solid var(--linha); border-radius: 12px; padding: 12px; }
      .crm-ficha-corpo .crm-bloco h4 { color: #85684A; }
      .crm-bloco h4 { margin: 0 0 8px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .5px; color: #64748B; font-weight: 800; }
      .crm-linha { display: flex; justify-content: space-between; gap: 10px; font-size: 0.8rem; padding: 3px 0; }
      .crm-linha span:first-child { color: #64748B; }
      .crm-linha span:last-child { font-weight: 600; text-align: right; }
      .crm-ficha-corpo .crm-linha span:first-child { color: var(--texto-3); }
      .crm-vazio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; color: #64748B; padding: 30px; height: 100%; font-size: 0.86rem; }
      .crm-caixa .crm-vazio { color: var(--texto-3); }
      .crm-caixa .crm-vazio svg { color: #B9A88E; }
      .crm-caixa .crm-vazio b { color: var(--texto); font-size: 0.95rem; }
      .crm-voltar { display: none; }
      @media (max-width: 1280px) {
        .crm-caixa { grid-template-columns: minmax(0, 320px) minmax(0, 1fr); }
        .crm-ficha { display: none; position: absolute; top: 0; right: 0; bottom: 0; width: min(360px, 100%); z-index: 20; box-shadow: -18px 0 36px -12px rgba(28,25,23,.35); }
        .crm-caixa.ficha-aberta .crm-ficha { display: flex; }
      }
      @media (max-width: 760px) {
        .crm-caixa { grid-template-columns: minmax(0, 1fr); height: calc(100vh - 120px); border-radius: 14px; }
        .crm-caixa.com-conversa .crm-lista { display: none; }
        .crm-caixa:not(.com-conversa) .crm-conversa { display: none; }
        .crm-voltar { display: inline-flex; }
        .crm-so-largo { display: none; }
        .crm-balao { max-width: 88%; }
      }

      /* A barra da conexão (admin), acima da caixa: mesma tinta das faixas. */
      .crm-conexao { background: #1C1917; color: #F5F0E8; border-radius: 14px; padding: 10px 12px 10px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; box-shadow: 0 10px 24px -16px rgba(28,25,23,.6); }
      .crm-conexao .estado { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; font-size: 0.86rem; }
      .crm-conexao .estado i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .crm-conexao .estado span { color: #B5ADA5; font-weight: 500; }
      .crm-conexao .crm-faixa-btn { border-color: #45403A; background: #2A2622; color: #F5F0E8; }
      .crm-conexao .crm-faixa-btn:hover { background: #35302B; }
      .crm-conexao .crm-faixa-btn.primario { background: #E8360C; border-color: #E8360C; color: #FFFFFF; }
      .crm-conexao .crm-faixa-btn.primario:hover { background: #C92E09; }

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
