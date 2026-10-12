"use client";
/**
 * O lanche dos motoboys no painel (Motoboys), só para as lojas que têm a tela
 * (lib/lanche-da-equipe.ts): ligar/desligar, o limite do dia,
 * o QR da parede para imprimir e os lanches do período, por motoboy.
 */
import { useCallback, useEffect, useState } from "react";

type Lanche = {
  pedidoId: string; numero: number | null; dia: string; em: string; levar: boolean;
  valor: number; coberto: number; excedente: number; cancelado: boolean;
  itens: { qtd: number; nome: string; opcoes: string[] }[];
  motoboyId: string; motoboyNome: string | null;
};
type Dados = { disponivel: boolean; ativo: boolean; limite: number; fuso: string; lanches: Lanche[] };

const reais = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;
const lerReais = (t: string) => Number(String(t).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));

export default function LancheDaEquipePainel({ slug, loja }: { slug: string; loja: string }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [ativo, setAtivo] = useState(false);
  const [limite, setLimite] = useState("22,90");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [qr, setQr] = useState("");

  // O endereço completo só no navegador (o servidor não sabe o domínio).
  const [link, setLink] = useState(`/loja/${slug}/equipe`);
  useEffect(() => { setLink(`${window.location.origin}/loja/${slug}/equipe`); }, [slug]);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/store/lanche-da-equipe", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return;
    setDados(d);
    setAtivo(Boolean(d.ativo));
    setLimite(Number(d.limite ?? 22.9).toFixed(2).replace(".", ","));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    (async () => {
      const QRCode = (await import("qrcode")).default;
      setQr(await QRCode.toDataURL(link, { errorCorrectionLevel: "Q", width: 220, margin: 1 }));
    })().catch(() => {});
  }, [link]);

  if (!dados?.disponivel) return null;

  const salvar = async (proximoAtivo = ativo) => {
    setSalvando(true);
    setAviso("");
    try {
      const r = await fetch("/api/store/lanche-da-equipe", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: proximoAtivo, limite: lerReais(limite) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Não deu para salvar.");
      setAviso("Salvo.");
      carregar();
    } catch (e: any) {
      setAviso(e?.message || "Não deu para salvar.");
    } finally {
      setSalvando(false);
    }
  };

  const imprimir = async () => {
    const janela = window.open("", "_blank");
    if (!janela) { setAviso("O navegador bloqueou a janela de impressão. Libere pop-ups e tente de novo."); return; }
    const QRCode = (await import("qrcode")).default;
    const svg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "Q", margin: 1 });
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    janela.document.open();
    janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR do lanche — ${esc(loja)}</title>
<style>@page{size:A4;margin:14mm}body{font-family:system-ui,sans-serif;text-align:center;color:#0F172A}
.t{font-size:44px;font-weight:900;margin:10px 0 4px}.l{font-size:22px;color:#475569;margin:0 0 18px}
svg{width:120mm;height:120mm}.r{font-size:20px;line-height:1.5;margin-top:16px;text-align:left;display:inline-block}</style></head>
<body><div class="t">🍔 LANCHE DOS MOTOBOYS</div><div class="l">${esc(loja)}</div>${svg}
<div class="r">1. Aponte a câmera e entre com o telefone e a senha do app do motoboy.<br>
2. Lanche do dia: até <b>${esc(reais(lerReais(limite)))}</b>. Comer na loja ou levar.<br>
3. O que passar é descontado no acerto. <b>A cozinha só faz lanche que chegou pelo sistema.</b></div>
<script>setTimeout(()=>window.print(),300)</script></body></html>`);
    janela.document.close();
  };

  // Por motoboy no período: lanches, total, descontado.
  const porMotoboy = new Map<string, { nome: string; qtd: number; total: number; descontado: number }>();
  for (const l of dados.lanches.filter((x) => !x.cancelado)) {
    const atual = porMotoboy.get(l.motoboyId) || { nome: l.motoboyNome || "Motoboy", qtd: 0, total: 0, descontado: 0 };
    atual.qtd++; atual.total += l.valor; atual.descontado += l.excedente;
    porMotoboy.set(l.motoboyId, atual);
  }

  return (
    <section style={{ background: "#fff", border: "1.5px solid #FED7AA", borderRadius: 16, padding: 16, marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.2rem" }}>🍔 Lanche dos motoboys</h2>
          <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: "0.88rem" }}>
            O motoboy pede pelo QR da parede com o login dele. Até o limite do dia é por conta da loja; o que passar é descontado no acerto.
          </p>
        </div>
        <button
          onClick={() => { setAtivo(!ativo); salvar(!ativo); }}
          disabled={salvando}
          style={{ padding: "9px 14px", borderRadius: 10, border: "none", fontWeight: 800, cursor: "pointer", background: ativo ? "#059669" : "#E2E8F0", color: ativo ? "#fff" : "#334155" }}
        >
          {ativo ? "● Ligado" : "○ Desligado"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, marginTop: 14 }}>
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <label style={{ display: "grid", gap: 4, fontSize: "0.8rem", fontWeight: 700, color: "#475569" }}>
            Limite por dia, por motoboy (preço do site)
            <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="decimal" style={campo} />
          </label>
          <div style={{ fontSize: "0.78rem", color: "#64748B" }}>A "Promoção do Dia" não aparece para eles. O dia vira às 5h.</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => salvar()} disabled={salvando} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "#C2410C", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              {salvando ? "Salvando…" : "Salvar"}
            </button>
            {aviso && <span style={{ fontSize: "0.82rem", color: "#475569" }}>{aviso}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {qr && <img src={qr} alt="QR do lanche dos motoboys" width={130} height={130} style={{ border: "1px solid #E2E8F0", borderRadius: 10 }} />}
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <button onClick={imprimir} style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: "#0F172A", color: "#fff", fontWeight: 800, cursor: "pointer" }}>🖨️ Imprimir o QR da parede</button>
            <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: "0.8rem", color: "#C2410C", wordBreak: "break-all" }}>{link}</a>
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: "1rem", margin: "18px 0 8px" }}>Lanches deste mês</h3>
      {porMotoboy.size === 0 ? (
        <p style={{ color: "#64748B", fontSize: "0.88rem" }}>Nenhum lanche pedido ainda.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {[...porMotoboy.entries()].map(([id, m]) => (
            <div key={id} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontWeight: 800 }}>{m.nome}</div>
              <div style={{ fontSize: "0.82rem", color: "#475569" }}>{m.qtd} lanche(s) · {reais(m.total)}</div>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: m.descontado > 0 ? "#B91C1C" : "#047857" }}>
                {m.descontado > 0 ? `Descontar no acerto: ${reais(m.descontado)}` : "Tudo no combinado"}
              </div>
            </div>
          ))}
        </div>
      )}
      {dados.lanches.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: "0.88rem" }}>Ver cada lanche ({dados.lanches.length})</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {dados.lanches.map((l) => (
              <div key={l.pedidoId} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.82rem", borderBottom: "1px dashed #E2E8F0", paddingBottom: 6, opacity: l.cancelado ? 0.5 : 1 }}>
                <span>
                  <b>{l.motoboyNome}</b> · {new Date(l.em).toLocaleString("pt-BR", { timeZone: dados.fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {l.numero ? ` · #${l.numero}` : ""} · {l.itens.map((i) => `${i.qtd}× ${i.nome}`).join(", ")}{l.levar ? " · levar" : ""}{l.cancelado ? " · CANCELADO" : ""}
                </span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 700, color: l.excedente > 0 && !l.cancelado ? "#B91C1C" : "#475569" }}>
                  {reais(l.valor)}{l.excedente > 0 ? ` (− ${reais(l.excedente)})` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

const campo: React.CSSProperties = { padding: "9px 11px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.95rem", fontFamily: "inherit", maxWidth: 200 };
