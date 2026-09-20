import { CHEFS } from "./chefs";

/**
 * "Quem usa e indica" — a prova de uso.
 *
 * O que entra aqui é FATO informado pelo dono em 10/09/2026: quais lojas
 * usam a mesma lógica de prazo e desde quando. Logo real de cada loja (as
 * de `public/prazos/` vieram das páginas /loja/<slug> do próprio FireHub).
 *
 * Depoimento só entra com a frase que a própria pessoa escreveu ou falou,
 * com nome e data. Frase inventada em nome de gente de verdade é propaganda
 * enganosa (CDC art. 37) e, no primeiro cliente que ligar para a loja
 * perguntando, queima a loja, o produto e a página inteira. Por isso o campo
 * `frase` é OPCIONAL: o cartão existe sem ela, e ganha as aspas no dia em
 * que o dono colar o que a pessoa disse.
 *
 * ── Os dois chefs (19/09/2026) ────────────────────────────────────────────
 * O dono pediu para pôr o Rafa (@rafaschefe) e o Digão (@chefdigao)
 * indicando o produto, e confirmou as duas coisas que o cartão afirma:
 * autorizaram aparecer indicando, e usam a extensão de prazos — não só o
 * painel do FireHub. As fotos ficam em `public/prazos/`; enquanto não
 * chegam, o cartão mostra as iniciais, como já fazia com a Point Mix.
 * O Instagram não deixa ler perfil sem login, então nem o arroba nem a
 * foto puderam ser conferidos daqui: quem confere é o dono.
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
    <section id="quem-indica" style={{ background: "#fff", borderTop: "1px solid #E2E8F0", borderBottom: "1px solid #E2E8F0" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "3rem 1.25rem" }}>
        <h2 style={{ fontSize: "clamp(1.5rem, 3.4vw, 2rem)", fontWeight: 900, margin: "0 0 8px", lineHeight: 1.15 }}>
          Quem usa e indica
        </h2>
        <p style={{ color: "#475569", lineHeight: 1.6, fontSize: "1.05rem", margin: "0 0 20px", maxWidth: 640 }}>
          Chef não empresta o nome para software que atrapalha o serviço. Quem está aqui usa na
          cozinha e indica.
        </p>

        {/* Os chefs vêm antes das lojas: é cara e nome, que é o que faz
            alguém parar de rolar a página. Com um só, a grade não estica o
            cartão pela página inteira. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 30, maxWidth: CHEFS.length === 1 ? 760 : undefined }}>
          {CHEFS.map((c) => (
            <figure
              key={c.arroba}
              style={{
                margin: 0,
                background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff",
                border: "1.5px solid rgba(255,122,89,.55)", borderRadius: 22,
                padding: "1.5rem 1.6rem",
                boxShadow: "0 22px 50px rgba(255,87,34,.18), 0 10px 30px rgba(15,23,42,.25)",
              }}
            >
              {/* A aspa gigante faz a frase ser lida antes de qualquer texto
                  da página — é o que o dono pediu quando falou "destaca mais".
                  Quem ainda não mandou frase não ganha aspas: ganha a linha
                  de cima, que também é verdade e não põe palavra na boca de
                  ninguém. */}
              {c.frase ? (
                <>
                  <div aria-hidden style={{ color: "#FF5722", fontSize: "3rem", lineHeight: .7, fontWeight: 900, marginBottom: 6 }}>“</div>
                  <blockquote style={{ margin: "0 0 18px", color: "#fff", lineHeight: 1.45, fontSize: "clamp(1.15rem, 2.2vw, 1.45rem)", fontWeight: 800 }}>
                    {c.frase}
                  </blockquote>
                </>
              ) : (
                <div style={{ color: "#FFD9CF", fontWeight: 800, fontSize: "clamp(1.05rem, 2vw, 1.25rem)", lineHeight: 1.4, marginBottom: 18 }}>
                  Indica o FireHub Prazos para quem trabalha com motoboy próprio.
                </div>
              )}

              <figcaption style={{ display: "flex", gap: 16, alignItems: "center" }}>
                {c.foto ? (
                  <img src={c.foto} width={92} height={92} alt={`Foto de ${c.nome}`} loading="lazy" style={{ width: 92, height: 92, borderRadius: 999, objectFit: "cover", flexShrink: 0, border: "3px solid #FF5722", boxShadow: "0 0 0 4px rgba(255,87,34,.18)" }} />
                ) : (
                  <div aria-hidden style={{ width: 92, height: 92, borderRadius: 999, background: "linear-gradient(135deg,#FF5722,#E64A19)", display: "grid", placeItems: "center", fontWeight: 900, fontSize: "1.6rem", flexShrink: 0 }}>
                    {c.iniciais}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: "1.35rem", lineHeight: 1.15 }}>{c.nome}</div>
                  <a
                    href={`https://instagram.com/${c.arroba}`}
                    target="_blank"
                    rel="noopener"
                    style={{ color: "#FF7A59", fontWeight: 800, fontSize: "1rem", textDecoration: "none" }}
                  >
                    @{c.arroba}
                  </a>
                  {c.seguidores && (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,87,34,.16)", border: "1px solid rgba(255,122,89,.5)", color: "#FFD9CF", fontWeight: 900, fontSize: ".84rem", padding: "3px 10px", borderRadius: 999, marginTop: 6, marginLeft: 8 }}>
                      {c.seguidores}
                    </div>
                  )}
                  <div style={{ color: "#94A3B8", fontSize: ".9rem", marginTop: 6, lineHeight: 1.4 }}>
                    {c.detalhe}{c.quando ? ` · ${c.quando}` : ""}
                  </div>
                </div>
              </figcaption>

              <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(34,197,94,.14)", border: "1px solid rgba(34,197,94,.45)", color: "#4ADE80", fontWeight: 800, fontSize: ".85rem", padding: "7px 14px", borderRadius: 999 }}>
                ✓ Usa o FireHub Prazos na cozinha dele
              </div>
            </figure>
          ))}
        </div>

        <h3 style={{ fontSize: "1.1rem", fontWeight: 900, margin: "0 0 12px" }}>E roda todo dia nestas cozinhas</h3>

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
