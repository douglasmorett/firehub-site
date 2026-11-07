"use client";

/**
 * As peças da tela da Cotação automática: cores, aviso no topo (nunca
 * alert() — Douglas, 30/09/2026), janela, campo de reais em texto (o
 * type="number" do Chrome pt-BR come a vírgula) e o fetch com erro legível.
 */

import { useEffect } from "react";
import { lerNumeroBr } from "@/lib/cmv/numero";

export const COR = "#4338CA";
export const COR_CLARA = "#EEF2FF";
export const VERDE = "#059669";
export const VERDE_CLARO = "#ECFDF5";
export const VERMELHO = "#DC2626";
export const AMBAR = "#B45309";

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const numero = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export const diaCurto = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
/** "hoje", "ontem", "há 3 dias". */
export function haQuanto(iso: string | null): string {
  if (!iso) return "nunca";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "hoje";
  if (d === 1) return "ontem";
  return `há ${d} dias`;
}
/** Reais digitados como texto: "42,90", "1.250", "R$ 7,5". Nulo = vazio ou ilegível. */
export function lerReais(t: string): number | null {
  const n = lerNumeroBr(String(t || "").replace(/[^\d,.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
export const reaisNoCampo = (v: number | null | undefined) => (v ? v.toFixed(2).replace(".", ",") : "");

export type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO = {
  ok: { cor: "#16A34A", fundo: "#F0FDF4" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: COR, fundo: COR_CLARA },
};

export function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6500);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div role={aviso.tipo === "erro" ? "alert" : "status"} onClick={onFechar} className="cot-sem-impressao" style={{
      position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 10100,
      width: "min(460px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
      borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
    }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2, whiteSpace: "pre-line" }}>{aviso.detalhe}</div>}
    </div>
  );
}

export function Janela({ titulo, subtitulo, onFechar, children, largura = 620, rodape }: {
  titulo: string; subtitulo?: string; onFechar: () => void; children: React.ReactNode; largura?: number; rodape?: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div role="dialog" aria-modal="true" aria-label={titulo} className="cot-sem-impressao"
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: largura, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0F172A" }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 13, color: "#64748B", marginTop: 2 }}>{subtitulo}</div>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ border: 0, background: "#F1F5F9", borderRadius: 10, width: 34, height: 34, fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>{children}</div>
        {rodape && <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #F1F5F9", display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>{rodape}</div>}
      </div>
    </div>
  );
}

export async function pedir<T = any>(url: string, metodo: "GET" | "POST" | "PUT" | "DELETE" = "GET", corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    cache: "no-store",
    headers: corpo !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Não deu certo. Tente de novo.");
  return j as T;
}

export const S: Record<string, React.CSSProperties> = {
  cartao: { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "16px 18px" },
  h2: { margin: 0, fontSize: 17, fontWeight: 800, color: "#0F172A" },
  texto: { margin: 0, fontSize: 14, color: "#475569", lineHeight: 1.6 },
  rotulo: { display: "block", fontSize: 12.5, fontWeight: 800, color: "#334155", marginBottom: 5 },
  campo: { width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 15, fontFamily: "inherit", background: "#fff", color: "#0F172A" },
  botao: { height: 42, padding: "0 18px", borderRadius: 11, border: 0, background: COR, color: "#fff", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  botaoLeve: { height: 42, padding: "0 16px", borderRadius: 11, border: "1.5px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  botaoPequeno: { height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" },
  chip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 800, padding: "3px 9px", borderRadius: 999 },
};

/** Os sete dias para marcar (agenda e entrega), na ordem da semana de trabalho. */
export const DIAS_DA_SEMANA: Array<[number, string, string]> = [
  [1, "Seg", "segunda"], [2, "Ter", "terça"], [3, "Qua", "quarta"], [4, "Qui", "quinta"], [5, "Sex", "sexta"], [6, "Sáb", "sábado"], [0, "Dom", "domingo"],
];

export function EscolherDias({ dias, onMudar, cor = COR }: { dias: number[]; onMudar: (d: number[]) => void; cor?: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {DIAS_DA_SEMANA.map(([d, curto, longo]) => {
        const marcado = dias.includes(d);
        return (
          <button key={d} type="button" aria-pressed={marcado} aria-label={longo}
            onClick={() => onMudar(marcado ? dias.filter((x) => x !== d) : [...dias, d].sort())}
            style={{
              minWidth: 46, height: 38, borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit",
              border: marcado ? `2px solid ${cor}` : "1.5px solid #CBD5E1", background: marcado ? cor : "#fff", color: marcado ? "#fff" : "#475569",
            }}>{curto}</button>
        );
      })}
    </div>
  );
}

/** Lê o arquivo escolhido como base64 (sem o "data:...;base64,"). */
export function arquivoEmBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = erro;
    r.readAsDataURL(arquivo);
  });
}

/** Foto do celular tem 4–8 MB: reduz para 1800 px em JPEG antes de mandar (a tabela continua legível). */
export async function fotoReduzida(arquivo: File): Promise<{ base64: string; mimeType: string }> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
    const escala = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/jpeg", 0.85));
    return { base64: await arquivoEmBase64(blob), mimeType: "image/jpeg" };
  } catch {
    return { base64: await arquivoEmBase64(arquivo), mimeType: arquivo.type || "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
