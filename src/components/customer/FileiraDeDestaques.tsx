"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * DESTAQUES — a fileira que rola para o lado, como no CardápioWeb.
 *
 * Era uma grade de cartões grandes (180 px de foto + botão), um por linha no
 * celular: com três destaques o cliente rolava uma tela e meia antes de ver a
 * primeira categoria. Na fileira cabem dois cartões e meio — o meio cartão
 * cortado na borda é o que diz "tem mais, arraste".
 *
 * No computador a roda do mouse não rola para o lado, então aparecem as setas
 * (só quando há para onde ir).
 */

export type ProdutoEmDestaque = {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  isCombo?: boolean;
  tags?: string | null;
};

/** As etiquetas que viram selo no cartão, na ordem em que valem. "⭐ Destaque" não: é o que põe o item aqui. */
const SELOS = ["🔥 Mais Vendido", "✨ Novo", "🎉 Especial do Dia", "🏷️ Promoção", "🌶️ Picante", "🌱 Vegano", "❄️ Gelado"];

export function seloDoDestaque(p: Pick<ProdutoEmDestaque, "tags" | "isCombo">): string | null {
  let tags: unknown = [];
  try {
    tags = p.tags ? JSON.parse(p.tags) : [];
  } catch {
    tags = [];
  }
  const lista = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
  const selo = SELOS.find((s) => lista.includes(s));
  if (selo) return selo;
  return p.isCombo ? "📦 Combo" : null;
}

export default function FileiraDeDestaques({
  produtos,
  quantidade,
  abrir,
  preco,
}: {
  produtos: ProdutoEmDestaque[];
  quantidade: (id: string) => number;
  abrir: (p: ProdutoEmDestaque) => void;
  preco: (p: ProdutoEmDestaque) => ReactNode;
}) {
  const fileira = useRef<HTMLDivElement>(null);
  const [lados, setLados] = useState({ antes: false, depois: false });

  useEffect(() => {
    const el = fileira.current;
    if (!el) return;
    const medir = () => {
      const max = el.scrollWidth - el.clientWidth;
      setLados({ antes: el.scrollLeft > 4, depois: el.scrollLeft < max - 4 });
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [produtos.length]);

  const rolar = (sentido: 1 | -1) => {
    const el = fileira.current;
    if (el) el.scrollBy({ left: sentido * el.clientWidth * 0.8, behavior: "smooth" });
  };

  if (produtos.length === 0) return null;

  return (
    <section className="destaques" aria-label="Destaques">
      <h2 className="destaques-titulo">Destaques</h2>
      <div className="destaques-moldura">
        {lados.antes && (
          <button type="button" className="destaques-seta antes" aria-label="Ver destaques anteriores" onClick={() => rolar(-1)}>
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="destaques-fileira" ref={fileira}>
          {produtos.map((p) => {
            const q = quantidade(p.id);
            const selo = seloDoDestaque(p);
            return (
              <div
                key={`destaque_${p.id}`}
                role="button"
                tabIndex={0}
                className={`destaque-card${q > 0 ? " no-carrinho" : ""}`}
                onClick={() => abrir(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    abrir(p);
                  }
                }}
              >
                <div className="destaque-foto">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" />
                  ) : (
                    <span className="destaque-sem-foto" aria-hidden>🍽️</span>
                  )}
                  {q > 0 && <span className="destaque-qtd" aria-label={`${q} na sacola`}>{q}</span>}
                </div>
                <div className="destaque-corpo">
                  {selo && <span className="destaque-selo">{selo}</span>}
                  <span className="destaque-nome">{p.name}</span>
                  {p.description && <span className="destaque-desc">{p.description}</span>}
                  <span className="destaque-preco">{preco(p)}</span>
                </div>
              </div>
            );
          })}
        </div>
        {lados.depois && (
          <button type="button" className="destaques-seta depois" aria-label="Ver mais destaques" onClick={() => rolar(1)}>
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}
