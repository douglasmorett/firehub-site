/**
 * "Roda todo dia em loja de verdade" — a prova de uso.
 *
 * O que entra aqui é FATO informado pelo dono em 10/09/2026: quais lojas
 * usam a mesma lógica de prazo e desde quando. Logo real de cada loja (as
 * de `public/prazos/` vieram das páginas /loja/<slug> do próprio FireHub).
 *
 * Depoimento só entra com a frase que a própria loja escreveu, com nome de
 * quem disse e data — e a lista `DEPOIMENTOS` fica VAZIA até isso chegar.
 * Frase inventada em nome de loja de verdade é propaganda enganosa (CDC
 * art. 37) e, no primeiro cliente que ligar para a loja perguntando, queima
 * a loja, o produto e a página inteira. O dono pediu depoimentos; ficou
 * combinado que ele pede aos parceiros pelo WhatsApp e cola o que vier.
 */

type Loja = {
  nome: string;
  /** Uma linha: papel dessa loja na história. */
  detalhe: string;
  desde: string;
  /** Caminho em /public. Sem logo ainda, mostra as iniciais. */
  logo?: string;
  iniciais: string;
};

const LOJAS: Loja[] = [
  // O dono pediu para tratar o Hakim como cliente comum na página — sem
  // "loja de quem fez o produto".
  { nome: "Franquias Hakim", detalhe: "rede de franquias, várias lojas", desde: "março de 2026", logo: "/prazos/logo-hakim.webp", iniciais: "HK" },
  { nome: "Brasa Burguer", detalhe: "hamburgueria, motoboy próprio", desde: "maio de 2026", logo: "/prazos/logo-brasa-burguer.webp", iniciais: "BB" },
  { nome: "Point Mix", detalhe: "parceira FireHub", desde: "julho de 2026", iniciais: "PM" },
];

/** Só frase literal da loja, com quem disse e quando. Vazio até chegar. */
const DEPOIMENTOS: { frase: string; quem: string; loja: string; data: string }[] = [];

export default function QuemJaUsa() {
  return (
    <section style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "3rem 1.25rem" }}>
        <h2 style={{ fontSize: "clamp(1.5rem, 3.4vw, 2rem)", fontWeight: 900, margin: "0 0 8px", lineHeight: 1.15 }}>
          Roda todo dia em loja de verdade
        </h2>
        <p style={{ color: "#475569", lineHeight: 1.6, fontSize: "1.05rem", margin: "0 0 20px", maxWidth: 640 }}>
          A mesma lógica de prazo que você vai assinar já trabalha nestas cozinhas, todo dia.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {LOJAS.map((l) => (
            <div key={l.nome} style={{ display: "flex", gap: 14, alignItems: "center", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1rem 1.1rem" }}>
              {l.logo ? (
                <img src={l.logo} width={64} height={64} alt={`Logo ${l.nome}`} loading="lazy" style={{ width: 64, height: 64, borderRadius: 14, objectFit: "cover", flexShrink: 0, border: "1px solid #E2E8F0" }} />
              ) : (
                <div aria-hidden style={{ width: 64, height: 64, borderRadius: 14, background: "#0F172A", color: "#fff", display: "grid", placeItems: "center", fontWeight: 900, fontSize: "1.2rem", flexShrink: 0 }}>
                  {l.iniciais}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", lineHeight: 1.2 }}>{l.nome}</div>
                <div style={{ color: "#64748B", fontSize: ".9rem", marginTop: 3 }}>{l.detalhe}</div>
                <div style={{ color: "#15803D", fontWeight: 800, fontSize: ".9rem", marginTop: 4 }}>usa desde {l.desde}</div>
              </div>
            </div>
          ))}
        </div>

        {DEPOIMENTOS.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 16 }}>
            {DEPOIMENTOS.map((d) => (
              <blockquote key={d.quem + d.data} style={{ margin: 0, background: "#fff", border: "1px solid #E2E8F0", borderLeft: "4px solid #FF5722", borderRadius: 14, padding: "1rem 1.1rem", color: "#334155", lineHeight: 1.55 }}>
                “{d.frase}”
                <footer style={{ color: "#64748B", fontSize: ".88rem", marginTop: 8, fontWeight: 700 }}>
                  {d.quem} · {d.loja} · {d.data}
                </footer>
              </blockquote>
            ))}
          </div>
        )}

        <p style={{ color: "#64748B", fontSize: ".85rem", margin: "14px 0 0" }}>
          Tempo de uso informado pelos donos das lojas em setembro de 2026.
        </p>
      </div>
    </section>
  );
}
