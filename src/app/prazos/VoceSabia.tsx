import { DESTAQUE, GATILHOS, OUTRAS_FONTES, PICO } from "./gatilhos";

/**
 * A seção "Você sabia?" — os gatilhos de curiosidade da página.
 *
 * Três cartões, um por dor (posição, nota, cliente). Cada cartão é uma
 * pergunta na voz do lojista e a resposta é uma frase literal de quem manda:
 * o iFood, ou uma pesquisa com amostra declarada. A pergunta cria a
 * curiosidade; a citação com link fecha a dúvida sem a gente precisar
 * pedir confiança. A ponte no fim liga a recomendação do próprio iFood
 * ("ajuste… especialmente no horário de pico") ao que a extensão faz.
 *
 * O que sobra de citação fica dobrado em <details>: quem quer provas abre,
 * quem tem preguiça de ler não paga por elas.
 */
export default function VoceSabia() {
  const cartao: React.CSSProperties = {
    background: "#1E293B", border: "1px solid #334155", borderRadius: 16,
    padding: "1.2rem 1.25rem", display: "flex", flexDirection: "column", gap: 10,
  };

  return (
    <section style={{ background: "#0F172A", color: "#fff" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "3rem 1.25rem" }}>
        <div style={{ fontSize: ".74rem", fontWeight: 800, color: "#FF7A59", letterSpacing: ".5px", marginBottom: 10 }}>
          VOCÊ SABIA?
        </div>
        <h2 style={{ fontSize: "clamp(1.5rem, 3.4vw, 2rem)", fontWeight: 900, margin: "0 0 8px", lineHeight: 1.15, color: "#fff" }}>
          Prazo errado custa posição, nota e cliente.
        </h2>
        <p style={{ color: "#CBD5E1", lineHeight: 1.6, fontSize: "1.05rem", margin: "0 0 20px", maxWidth: 640 }}>
          Não é a gente que diz. É o iFood — e quem pesquisa o seu cliente.
        </p>

        {/* O destaque: a regra dos 10 minutos, com o número no tamanho de manchete.
            É a citação mais concreta da página e o dono pediu que ela mandasse
            na seção — o resto dos cartões vem embaixo dela. */}
        <div
          style={{
            display: "flex", flexWrap: "wrap", gap: "18px 32px", alignItems: "center",
            background: "linear-gradient(135deg, rgba(255,87,34,.22) 0%, rgba(255,87,34,.06) 100%)",
            border: "1px solid rgba(255,122,89,.55)", borderRadius: 20,
            padding: "1.5rem 1.6rem", marginBottom: 16,
          }}
        >
          <div style={{ minWidth: 200, flex: "0 0 auto" }}>
            <div style={{ fontSize: "clamp(3.2rem, 7vw, 4.8rem)", fontWeight: 900, lineHeight: 0.95, color: "#FF7A59", letterSpacing: "-1px" }}>
              {DESTAQUE.numero}
            </div>
            <div style={{ color: "#FFD9CF", fontWeight: 800, fontSize: "1rem", marginTop: 8, maxWidth: 220, lineHeight: 1.3 }}>
              {DESTAQUE.legenda}
            </div>
          </div>
          <div style={{ flex: "1 1 360px" }}>
            <blockquote style={{ margin: 0, fontSize: "clamp(1.15rem, 2.5vw, 1.5rem)", fontWeight: 800, lineHeight: 1.35, color: "#fff" }}>
              “{DESTAQUE.citacao}”
            </blockquote>
            <a href={DESTAQUE.url} target="_blank" rel="noopener" style={{ color: "#FF7A59", fontWeight: 700, fontSize: ".92rem", display: "inline-block", marginTop: 10 }}>
              {DESTAQUE.fonte} ↗
            </a>
            <p style={{ color: "#CBD5E1", lineHeight: 1.55, margin: "12px 0 0", fontSize: "1rem" }}>{DESTAQUE.ponte}</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {GATILHOS.map((g) => (
            <article key={g.chave} style={cartao}>
              <div style={{ fontSize: ".72rem", fontWeight: 800, color: "#FF7A59", letterSpacing: ".5px", textTransform: "uppercase" }}>
                {g.rotulo}
              </div>
              <div style={{ fontWeight: 900, fontSize: "1.08rem", lineHeight: 1.35 }}>{g.pergunta}</div>
              <blockquote style={{ margin: 0, color: "#CBD5E1", lineHeight: 1.55, fontSize: ".95rem", borderLeft: "3px solid #FF7A59", paddingLeft: 12 }}>
                “{g.citacao}”
              </blockquote>
              <a href={g.url} target="_blank" rel="noopener" style={{ color: "#FF7A59", fontWeight: 700, fontSize: ".88rem", marginTop: "auto" }}>
                {g.fonte} ↗
              </a>
            </article>
          ))}
        </div>

        <p style={{ color: "#CBD5E1", lineHeight: 1.6, maxWidth: 680, margin: "22px 0 0", fontSize: "1.05rem" }}>
          O iFood manda ajustar o tempo{" "}
          <a href={PICO.url} target="_blank" rel="noopener" style={{ color: "#FF7A59", fontWeight: 700 }}>
            “especialmente no horário de pico”
          </a>
          . A extensão ajusta a cada mudança na sua fila — sem você lembrar.
        </p>

        <details style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 16, marginTop: 16, padding: "0.9rem 1.2rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 800, color: "#CBD5E1", fontSize: "1rem" }}>
            Ver o que mais o iFood, o 99Food e as pesquisas publicam
          </summary>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {OUTRAS_FONTES.map((f) => (
              <div key={f.texto} style={{ color: "#CBD5E1", lineHeight: 1.55, fontSize: ".95rem" }}>
                {f.texto}{" "}
                <a href={f.url} target="_blank" rel="noopener" style={{ color: "#FF7A59", fontWeight: 700 }}>{f.fonte} ↗</a>
              </div>
            ))}
            <div style={{ color: "#94A3B8", fontSize: ".82rem" }}>
              Frases conferidas nas páginas oficiais em 08 e 09/09/2026. Se uma mudar, a gente troca aqui.
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
