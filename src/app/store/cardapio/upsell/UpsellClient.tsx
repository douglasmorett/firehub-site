"use client";
import { useMemo, useState } from "react";
import { Save, Search, ArrowUp, ArrowDown, X } from "lucide-react";
import {
  CHAMADA_PADRAO_DO_UPSELL,
  DESCONTO_MAXIMO_DO_UPSELL,
  MAXIMO_DE_ITENS_NO_UPSELL,
  precoNoUpsell,
  type UpsellConfig,
} from "@/lib/upsell-config";

type Product = { id: string; name: string; price: number; imageUrl: string | null; category: string; temOpcoes: boolean };

function fmtR(v: number) { return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

const cartao = { background: "#fff", borderRadius: "14px", padding: "16px 20px", marginBottom: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" } as const;

export default function UpsellClient({ products, inicial }: { products: Product[]; inicial: UpsellConfig }) {
  const porId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [chamada, setChamada] = useState(inicial.chamada);
  // Produto que saiu do cardápio (apagado, pausado, tirado do delivery) some
  // da lista: o site também não o ofereceria.
  const [itens, setItens] = useState(inicial.itens.filter((i) => porId.has(i.produtoId)));
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; texto: string } | null>(null);

  const cheio = itens.length >= MAXIMO_DE_ITENS_NO_UPSELL;
  const encontrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return products
      .filter((p) => !itens.some((i) => i.produtoId === p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
      .slice(0, 40);
  }, [products, itens, busca]);

  const mudou = () => setStatus(null);
  const mover = (idx: number, para: number) => {
    if (para < 0 || para >= itens.length) return;
    const nova = [...itens];
    [nova[idx], nova[para]] = [nova[para], nova[idx]];
    setItens(nova); mudou();
  };

  const salvar = async () => {
    setSalvando(true); setStatus(null);
    try {
      const res = await fetch("/api/store-settings/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo, chamada, itens }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Não consegui salvar agora.");
      setAtivo(d.ativo); setChamada(d.chamada); setItens(d.itens);
      setStatus({ ok: true, texto: d.ativo ? "Salvo. O site já oferece estes itens (peça F5 a quem está com o cardápio aberto)." : "Salvo. O upsell está desligado." });
    } catch (e: any) {
      setStatus({ ok: false, texto: e?.message || "Não consegui salvar agora." });
    }
    setSalvando(false);
  };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8FAFC", minHeight: "100vh", padding: "1.5rem" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>

        <a href="/store/cardapio" style={{ fontSize: "0.8rem", color: "#64748B", textDecoration: "none", fontWeight: 600 }}>← Voltar ao cardápio</a>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", margin: "8px 0 1.5rem" }}>
          <div>
            <h1 style={{ fontWeight: 900, fontSize: "1.5rem", color: "#0F172A", margin: 0 }}>🛒 Upsell da sacola</h1>
            <p style={{ fontSize: "0.82rem", color: "#64748B", margin: "4px 0 0", maxWidth: 560 }}>
              Até {MAXIMO_DE_ITENS_NO_UPSELL} produtos oferecidos quando o cliente clica em <strong>Continuar pedido</strong> no site.
              Aparece uma vez por compra, só com o que ainda não está na sacola.
            </p>
          </div>
          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              background: salvando ? "#94A3B8" : "#0F172A", color: "#fff",
              border: "none", borderRadius: "12px", padding: "12px 24px",
              fontWeight: 800, fontSize: "0.9rem", cursor: salvando ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}>
            <Save size={16} />
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>

        {status && (
          <div role={status.ok ? "status" : "alert"} style={{ ...cartao, padding: "12px 16px", borderLeft: `4px solid ${status.ok ? "#0F766E" : "#C92E09"}`, background: status.ok ? "#F0FDFA" : "#FEF2F2", fontSize: "0.85rem", fontWeight: 600, color: "#0F172A" }}>
            {status.texto}
          </div>
        )}

        {/* Liga/desliga e chamada */}
        <div style={cartao}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>Oferecer no site</div>
              <div style={{ fontSize: "0.78rem", color: "#64748B" }}>{ativo ? "Ligado: a janela aparece ao continuar o pedido." : "Desligado: o site não mostra a janela."}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={ativo}
              onClick={() => { setAtivo((v) => !v); mudou(); }}
              style={{ padding: "8px 18px", borderRadius: "999px", border: "none", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", background: ativo ? "#0F766E" : "#E2E8F0", color: ativo ? "#fff" : "#475569" }}
            >
              {ativo ? "● Ligado" : "○ Desligado"}
            </button>
          </div>
          <label style={{ display: "block", marginTop: "14px" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>Chamada (título da janela)</span>
            <input
              value={chamada}
              maxLength={80}
              onChange={(e) => { setChamada(e.target.value); mudou(); }}
              placeholder={CHAMADA_PADRAO_DO_UPSELL}
              style={{ display: "block", width: "100%", marginTop: "6px", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
            />
          </label>
        </div>

        {/* Itens ofertados */}
        <div style={cartao}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" }}>
            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>Itens oferecidos</span>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: cheio ? "#B45309" : "#64748B" }}>{itens.length} de {MAXIMO_DE_ITENS_NO_UPSELL}</span>
          </div>
          {itens.length === 0 && (
            <p style={{ fontSize: "0.82rem", color: "#94A3B8", margin: "6px 0" }}>Nenhum item ainda. Escolha abaixo os produtos que combinam com o pedido (bebida, sobremesa, porção).</p>
          )}
          {itens.map((it, idx) => {
            const p = porId.get(it.produtoId)!;
            const semBase = p.price <= 0;
            return (
              <div key={it.produtoId} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderTop: idx ? "1px solid #F1F5F9" : "none", flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <button type="button" aria-label="Subir" disabled={idx === 0} onClick={() => mover(idx, idx - 1)} style={{ border: "none", background: "#F1F5F9", borderRadius: 6, padding: 2, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.35 : 1 }}><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Descer" disabled={idx === itens.length - 1} onClick={() => mover(idx, idx + 1)} style={{ border: "none", background: "#F1F5F9", borderRadius: 6, padding: 2, cursor: idx === itens.length - 1 ? "default" : "pointer", opacity: idx === itens.length - 1 ? 0.35 : 1 }}><ArrowDown size={14} /></button>
                </div>
                {p.imageUrl
                  ? <img src={p.imageUrl} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
                  : <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center" }}>🍽️</div>}
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0F172A" }}>{p.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                    {it.desconto > 0 && !semBase
                      ? <><span style={{ textDecoration: "line-through" }}>{fmtR(p.price)}</span> → <strong style={{ color: "#DC2626" }}>{fmtR(precoNoUpsell(p.price, it.desconto))}</strong></>
                      : <>{fmtR(p.price)} · sem desconto</>}
                  </div>
                  {p.temOpcoes && (
                    <div style={{ fontSize: "0.7rem", color: "#92400E", marginTop: 2 }}>
                      {semBase ? "Preço nas opções: entra sem desconto (o cliente escolhe as opções)." : "Tem opções: o cliente escolhe nelas; o desconto vale sobre o preço base."}
                    </div>
                  )}
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.8rem", color: "#475569", fontWeight: 600 }}>
                  Desconto
                  <input
                    type="number"
                    min={0}
                    max={DESCONTO_MAXIMO_DO_UPSELL}
                    step={1}
                    disabled={semBase}
                    value={semBase ? 0 : it.desconto}
                    onChange={(e) => {
                      const v = Math.min(DESCONTO_MAXIMO_DO_UPSELL, Math.max(0, Math.round(Number(e.target.value) || 0)));
                      setItens((l) => l.map((x) => (x.produtoId === it.produtoId ? { ...x, desconto: v } : x))); mudou();
                    }}
                    style={{ width: 60, padding: "5px 8px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", fontFamily: "inherit" }}
                  />
                  %
                </label>
                <button type="button" aria-label={`Tirar ${p.name}`} onClick={() => { setItens((l) => l.filter((x) => x.produtoId !== it.produtoId)); mudou(); }}
                  style={{ border: "none", background: "#FEF2F2", color: "#C92E09", borderRadius: 8, padding: 6, cursor: "pointer" }}><X size={16} /></button>
              </div>
            );
          })}
        </div>

        {/* Escolher produtos */}
        <div style={cartao}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", marginBottom: "10px" }}>Adicionar produto</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#fff", borderRadius: "10px", border: "1.5px solid #E2E8F0", padding: "8px 12px", marginBottom: "8px" }}>
            <Search size={15} color="#94A3B8" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto pelo nome..."
              style={{ border: "none", outline: "none", background: "transparent", fontSize: "0.83rem", width: "100%", fontFamily: "inherit" }} />
          </div>
          {cheio && <p style={{ fontSize: "0.78rem", color: "#B45309", fontWeight: 600, margin: "4px 0 8px" }}>Já são {MAXIMO_DE_ITENS_NO_UPSELL} itens. Tire um para pôr outro.</p>}
          {encontrados.length === 0 && <p style={{ fontSize: "0.8rem", color: "#94A3B8" }}>Nenhum produto ativo no delivery com esse nome.</p>}
          {encontrados.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 0", borderTop: "1px solid #F8FAFC" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "#0F172A" }}>{p.name}</span>
                <span style={{ fontSize: "0.72rem", color: "#94A3B8", marginLeft: 6 }}>{p.category}</span>
              </div>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F766E" }}>{fmtR(p.price)}</span>
              <button type="button" disabled={cheio} onClick={() => { setItens((l) => [...l, { produtoId: p.id, desconto: 0 }]); mudou(); }}
                style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: cheio ? "#E2E8F0" : "#0F172A", color: cheio ? "#94A3B8" : "#fff", fontWeight: 700, fontSize: "0.78rem", cursor: cheio ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                + Adicionar
              </button>
            </div>
          ))}
        </div>

        <p style={{ fontSize: "0.75rem", color: "#94A3B8", textAlign: "center" }}>
          💡 Item pausado, esgotado ou fora do horário não aparece na janela. O desconto é conferido na hora do pedido: se você mudar a oferta, quem já tinha o item na sacola é avisado.
        </p>
      </div>
    </div>
  );
}
