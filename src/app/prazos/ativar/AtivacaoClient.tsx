"use client";

import { useEffect, useState } from "react";

/**
 * A tela que o lojista vê ao clicar no link do e-mail da compra.
 *
 * Ela não ativa nada sozinha: quem ativa é o content script da extensão
 * (scripts/ativar.js), que lê o código da URL, chama a API e avisa aqui por
 * postMessage. Esta página só conta a história para o lojista.
 *
 * O caso que mais acontece na vida real é o primeiro: ele compra no celular,
 * clica no link no celular, e a extensão não está lá — nem poderia. Por isso
 * o estado inicial não é "erro", é "instale primeiro", com o botão da loja.
 */

const LOJA = "https://chromewebstore.google.com/detail/pkkcnkbkacfiojiapodplkbkmdhhnjag";

type Estado = "procurando" | "sem-extensao" | "ativando" | "ativada" | "ja-ativa" | "erro" | "sem-codigo";

export default function AtivacaoClient() {
  const [estado, setEstado] = useState<Estado>("procurando");
  const [detalhe, setDetalhe] = useState("");

  useEffect(() => {
    // Se em 2,5 s nenhum content script falou, é porque a extensão não está
    // neste navegador. Esperar mais que isso é deixar o lojista olhando para
    // uma tela vazia sem saber o que fazer.
    const relogio = setTimeout(() => setEstado((e) => (e === "procurando" ? "sem-extensao" : e)), 2500);

    function ouvir(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || d.fonte !== "firehub-prazos") return;
      clearTimeout(relogio);
      if (d.estado === "extensao-presente") { setEstado((e) => (e === "procurando" ? "ativando" : e)); return; }
      setEstado(d.estado as Estado);
      setDetalhe(String(d.texto || ""));
    }

    window.addEventListener("message", ouvir);
    return () => { clearTimeout(relogio); window.removeEventListener("message", ouvir); };
  }, []);

  const caixa: React.CSSProperties = {
    background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18,
    padding: "2rem 1.8rem", maxWidth: 560, margin: "0 auto",
    boxShadow: "0 10px 34px rgba(15,23,42,.07)", textAlign: "center",
  };
  const botao: React.CSSProperties = {
    display: "inline-block", marginTop: 18, background: "linear-gradient(135deg,#FF5722,#E64A19)",
    color: "#fff", fontWeight: 900, padding: "15px 30px", borderRadius: 12,
    textDecoration: "none", fontSize: "1.05rem",
  };
  const p: React.CSSProperties = { color: "#475569", lineHeight: 1.65, margin: "10px 0 0" };

  const telas: Record<Estado, { emoji: string; titulo: string; corpo: React.ReactNode }> = {
    procurando: {
      emoji: "⏳",
      titulo: "Procurando a extensão…",
      corpo: <p style={p}>Um segundo.</p>,
    },
    ativando: {
      emoji: "🔥",
      titulo: "Ativando sua conta…",
      corpo: <p style={p}>Achei a extensão neste navegador. Já conecto.</p>,
    },
    ativada: {
      emoji: "✅",
      titulo: "Pronto, está ativa",
      corpo: (
        <>
          <p style={p}>
            {detalhe ? <><b>{detalhe}</b> está conectada. </> : null}
            Você não precisa digitar senha nenhuma.
          </p>
          <p style={p}>
            Agora abra o <b>painel de pedidos do seu sistema</b> numa aba, clique no ícone 🔥 e depois em{" "}
            <b>Marcar coluna</b>. Clique na coluna que mostra os pedidos que estão na cozinha. É o único passo que
            depende de você, porque só você sabe qual coluna é.
          </p>
        </>
      ),
    },
    "ja-ativa": {
      emoji: "👍",
      titulo: "Já estava conectada",
      corpo: <p style={p}>Esta extensão já está ligada na sua conta neste computador. Não precisa fazer nada.</p>,
    },
    "sem-extensao": {
      emoji: "🧩",
      titulo: "Falta instalar a extensão",
      corpo: (
        <>
          <p style={p}>
            Ela funciona no <b>Chrome do computador da loja</b>. Se você abriu este link no celular, mande-o para
            você mesmo e abra no computador — é lá que a extensão trabalha.
          </p>
          <p style={p}>Instale e clique neste mesmo link de novo: a conta entra sozinha.</p>
          <a href={LOJA} target="_blank" rel="noopener" style={botao}>Instalar no Chrome</a>
        </>
      ),
    },
    "sem-codigo": {
      emoji: "🔗",
      titulo: "Link incompleto",
      corpo: <p style={p}>Falta o código no endereço. Abra o link exatamente como ele chegou no e-mail da compra.</p>,
    },
    erro: {
      emoji: "⚠️",
      titulo: "Não consegui ativar",
      corpo: (
        <>
          <p style={p}>{detalhe || "Tente de novo em alguns segundos."}</p>
          <p style={p}>
            Se continuar, entre pelo ícone 🔥 com o e-mail e a senha que chegaram na compra, ou{" "}
            <a href="https://wa.me/5522981118514" target="_blank" rel="noopener" style={{ color: "#15803D", fontWeight: 800 }}>
              chame no WhatsApp
            </a>{" "}
            que a gente resolve com você.
          </p>
        </>
      ),
    },
  };

  const t = telas[estado];

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", background: "#F8FAFC", minHeight: "100vh", color: "#0F172A", padding: "3rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 26 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center", fontSize: "1.1rem" }}>🔥</div>
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>FireHub Prazos</div>
      </div>

      <div style={caixa}>
        <div style={{ fontSize: "2.6rem", lineHeight: 1 }}>{t.emoji}</div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "12px 0 0" }}>{t.titulo}</h1>
        {t.corpo}
      </div>

      <div style={{ textAlign: "center", color: "#64748B", fontSize: ".85rem", marginTop: 22 }}>
        <a href="/prazos" style={{ color: "#64748B" }}>Voltar para a página do FireHub Prazos</a>
      </div>
    </main>
  );
}
