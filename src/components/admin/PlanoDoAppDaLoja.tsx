"use client";

/**
 * Admin › Lojistas › "📱 App": liga, troca ou desliga o plano do aplicativo
 * próprio da loja (lib/app-da-loja/plano.ts). A ativação é manual de propósito
 * (Douglas, 17/10/2026): a loja chama no WhatsApp, a FireHub combina e ativa
 * aqui; o valor entra no boleto da mensalidade no fechamento do mês.
 */
import { useEffect, useState } from "react";

type Plataformas = "android" | "apple" | "ambos";
type Plano = { ativo: boolean; plataformas: Plataformas | null; valor: number; ativoDesde: string | null };
type Interesse = { plataformas: Plataformas; criadoEm: string };

const OPCOES: { p: Plataformas; rotulo: string }[] = [
  { p: "android", rotulo: "Só Android · R$ 149" },
  { p: "apple", rotulo: "Só Apple · R$ 149" },
  { p: "ambos", rotulo: "Android + Apple · R$ 197" },
];

export default function PlanoDoAppDaLoja({ userId, storeName, aoFechar }: { userId: string; storeName: string; aoFechar: () => void }) {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [interesses, setInteresses] = useState<Interesse[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/app-da-loja?userId=${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j.error) throw new Error(j.error); setPlano(j.plano); setInteresses(j.interesses || []); })
      .catch((e) => setMsg({ ok: false, texto: e.message }));
  }, [userId]);

  async function definir(plataformas: Plataformas | null) {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/app-da-loja", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, plataformas }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu certo.");
      setPlano(j.plano);
      setMsg({ ok: true, texto: plataformas ? "Plano ativo. Entra no boleto da mensalidade no fechamento do mês." : "Plano desligado. O mês seguinte não é cobrado." });
    } catch (e: any) {
      setMsg({ ok: false, texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Aplicativo da loja — ${storeName}`}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) aoFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "white", borderRadius: 14, width: "min(440px, 100%)", padding: 20, boxShadow: "0 24px 60px rgba(2,6,23,.35)" }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: "#0F172A" }}>📱 Aplicativo da loja</div>
        <div style={{ fontSize: 13, color: "#64748B", marginBottom: 14 }}>{storeName}</div>

        {!plano ? <div style={{ color: "#64748B", fontSize: 14 }}>Carregando…</div> : (
          <>
            <div style={{ fontSize: 14, marginBottom: 12, color: "#0F172A" }}>
              {plano.ativo
                ? <>Ativo: <b>{OPCOES.find((o) => o.p === plano.plataformas)?.rotulo.split(" · ")[0]}</b> · R$ {plano.valor.toFixed(2).replace(".", ",")}/mês, desde {new Date(plano.ativoDesde!).toLocaleDateString("pt-BR")}</>
                : <>Nenhum plano ativo.</>}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {OPCOES.map((o) => (
                <button key={o.p} disabled={salvando || plano.plataformas === o.p} onClick={() => definir(o.p)}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid", fontWeight: 700, fontSize: 14, cursor: "pointer",
                    borderColor: plano.plataformas === o.p ? "#059669" : "#CBD5E1", background: plano.plataformas === o.p ? "#ECFDF5" : "white", color: "#0F172A" }}>
                  {plano.plataformas === o.p ? "✓ " : plano.ativo ? "Trocar para " : "Ativar "}{o.rotulo}
                </button>
              ))}
              {plano.ativo && (
                <button disabled={salvando} onClick={() => definir(null)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #FCA5A5", background: "white", color: "#B91C1C", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                  Desligar o plano
                </button>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#64748B", margin: "12px 0 0" }}>
              Ativo em qualquer dia do mês = o mês inteiro no boleto. Trocou de plano no mês: vale o maior.
            </p>
            {interesses.length > 0 && (
              <p style={{ fontSize: 12, color: "#475569", margin: "8px 0 0" }}>
                Clicou em “quero o meu aplicativo”: {interesses.slice(0, 3).map((i) => `${OPCOES.find((o) => o.p === i.plataformas)?.rotulo.split(" · ")[0]} (${new Date(i.criadoEm).toLocaleDateString("pt-BR")})`).join(", ")}
              </p>
            )}
          </>
        )}
        {msg && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: msg.ok ? "#047857" : "#B91C1C" }}>{msg.texto}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={aoFechar} disabled={salvando} style={{ background: "#0F172A", color: "white", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 800, cursor: "pointer" }}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
