"use client";
/**
 * O menu de relatórios — a porta de entrada de /store/relatorios. Como o menu
 * da Saipos: seções, busca pelo nome ("vendidos", "pix", "motoboy") e os
 * favoritos do lojista no topo (guardados neste navegador).
 */
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Star } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { buscarRelatorios, SECOES, type RelatorioDoMenu } from "@/lib/relatorios/catalogo-de-relatorios";

const CHAVE_FAVORITOS = "fh-relatorios-favoritos";

function lerFavoritos(): string[] {
  try { return JSON.parse(localStorage.getItem(CHAVE_FAVORITOS) || "[]"); } catch { return []; }
}

export default function MenuDeRelatorios({ nomeDaLoja }: { nomeDaLoja: string }) {
  const [busca, setBusca] = useState("");
  const [favoritos, setFavoritos] = useState<string[]>([]);
  useEffect(() => { setFavoritos(lerFavoritos()); }, []);

  const alternarFavorito = (slug: string) => {
    setFavoritos((atual) => {
      const novo = atual.includes(slug) ? atual.filter((s) => s !== slug) : [...atual, slug];
      try { localStorage.setItem(CHAVE_FAVORITOS, JSON.stringify(novo)); } catch {}
      return novo;
    });
  };

  const achados = useMemo(() => buscarRelatorios(busca), [busca]);
  const favoritosAchados = achados.filter((r) => favoritos.includes(r.slug));

  const Cartao = ({ r }: { r: RelatorioDoMenu }) => {
    const fav = favoritos.includes(r.slug);
    if (r.emBreve) {
      return (
        <div aria-disabled="true" style={{ height: "100%", background: PALETA.areia, border: `1px dashed ${PALETA.areiaBorda}`, borderRadius: 14, padding: "0.9rem 1rem", color: PALETA.areiaTinta, boxSizing: "border-box" }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", color: PALETA.carvao2 }}>{r.titulo}</div>
          <div style={{ fontSize: "0.8rem", marginTop: 4, lineHeight: 1.35 }}>{r.emBreve}</div>
        </div>
      );
    }
    return (
      <div style={{ position: "relative" }}>
        <Link href={r.href} style={{
          display: "block", height: "100%", background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 14,
          padding: "0.9rem 2.4rem 0.9rem 1rem", textDecoration: "none", color: PALETA.carvao, boxSizing: "border-box",
        }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{r.titulo}</div>
          <div style={{ fontSize: "0.8rem", color: PALETA.areiaTinta, marginTop: 4, lineHeight: 1.35 }}>{r.descricao}</div>
        </Link>
        <button type="button" onClick={() => alternarFavorito(r.slug)} aria-pressed={fav}
          aria-label={fav ? `Tirar ${r.titulo} dos favoritos` : `Favoritar ${r.titulo}`}
          style={{ position: "absolute", top: 10, right: 10, border: "none", background: "none", cursor: "pointer", padding: 4 }}>
          <Star size={17} color={fav ? PALETA.atencao : PALETA.areiaBorda} fill={fav ? PALETA.atencao : "none"} />
        </button>
      </div>
    );
  };

  const grade: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.7rem" };

  return (
    <div style={{ padding: "1.5rem 1rem 3rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "1rem", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.7rem", fontWeight: 900 }}>Relatórios</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: PALETA.areiaTinta }}>{nomeDaLoja}</p>
        </div>
        <label style={{ position: "relative", minWidth: 280, flex: "0 1 380px" }}>
          <Search size={15} color={PALETA.areiaTinta} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procure um relatório pelo nome…" aria-label="Procurar relatório" autoFocus
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 34px", borderRadius: 12, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.9rem", fontFamily: "inherit" }} />
        </label>
      </div>

      {favoritosAchados.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "0.8rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: PALETA.atencao, margin: "0 0 0.6rem" }}>Favoritos</h2>
          <div style={grade}>{favoritosAchados.map((r) => <Cartao key={r.slug} r={r} />)}</div>
        </section>
      )}

      {SECOES.map((secao) => {
        const daSecao = achados.filter((r) => r.secao === secao);
        if (daSecao.length === 0) return null;
        return (
          <section key={secao} style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "0.8rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.05em", color: PALETA.areiaTinta, margin: "0 0 0.6rem" }}>{secao}</h2>
            <div style={grade}>{daSecao.map((r) => <Cartao key={r.slug} r={r} />)}</div>
          </section>
        );
      })}

      {achados.length === 0 && (
        <p style={{ color: PALETA.areiaTinta }}>Nenhum relatório com “{busca}”. Tente outra palavra — “vendidos”, “pix”, “motoboy”.</p>
      )}
    </div>
  );
}
