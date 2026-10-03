"use client";

/**
 * "A gente copia o seu cardápio" — a oferta da equipe na tela do cardápio.
 *
 * Quem acabou de entrar encontra a tela vazia e desiste antes de lançar o
 * primeiro produto. A equipe copia o cardápio antigo (link do iFood, Anota AI,
 * site ou foto do impresso) de graça — o robô do atendimento já conhece a
 * oferta (lib/atendimento/conhecimento.ts, "A gente monta a loja").
 *
 *   • Cardápio vazio: a janela abre toda vez que a tela abre, até existir o
 *     primeiro produto. Fechar vale só para esta visita.
 *   • Sempre: um cartão verde no topo — é a única oferta da tela, então tem
 *     de aparecer. Com produtos ele pode ser fechado de vez (lembrado neste
 *     navegador); vazia, fica.
 *
 * O botão só ABRE o WhatsApp do FireHub com a mensagem escrita — quem manda é
 * o lojista. O número do atendimento não envia nada sozinho.
 */

import { useEffect, useState } from "react";

const WHATSAPP_DO_FIREHUB = "5522981118514";

function linkDoWhatsApp(nomeDaLoja: string | null): string {
  const loja = nomeDaLoja?.trim() ? `a loja *${nomeDaLoja.trim()}*` : "uma loja";
  const texto =
    `Olá! Tenho ${loja} no FireHub e quero que a equipe copie o meu cardápio. ` +
    `O cardápio que uso hoje está aqui: `;
  return `https://wa.me/${WHATSAPP_DO_FIREHUB}?text=${encodeURIComponent(texto)}`;
}

export default function CopiamosSeuCardapio({
  cardapioVazio,
  lojaId,
  nomeDaLoja,
}: {
  cardapioVazio: boolean;
  lojaId: string;
  nomeDaLoja: string | null;
}) {
  const link = linkDoWhatsApp(nomeDaLoja);
  const chave = `firehub_tarja_copia_cardapio_${lojaId}`;

  const [janelaAberta, setJanelaAberta] = useState(cardapioVazio);
  // null até ler o navegador: não pisca a tarja que o lojista já fechou.
  const [tarjaFechada, setTarjaFechada] = useState<boolean | null>(null);

  useEffect(() => {
    if (cardapioVazio) return setTarjaFechada(false);
    try {
      setTarjaFechada(localStorage.getItem(chave) === "1");
    } catch {
      setTarjaFechada(false);
    }
  }, [cardapioVazio, chave]);

  useEffect(() => {
    if (!janelaAberta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setJanelaAberta(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [janelaAberta]);

  function fecharTarja() {
    setTarjaFechada(true);
    try {
      localStorage.setItem(chave, "1");
    } catch {}
  }

  return (
    <>
      {tarjaFechada === false && (
        <div
          className="copiamos-tarja"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
            background: "linear-gradient(135deg, #065F46 0%, #047857 55%, #059669 100%)",
            borderRadius: 16,
            padding: cardapioVazio ? "18px 20px" : "18px 44px 18px 20px",
            marginBottom: "1.5rem",
            color: "#fff",
            boxShadow: "0 6px 20px rgba(4, 120, 87, 0.22)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: "rgba(255,255,255,0.16)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.7rem",
              flexShrink: 0,
            }}
          >
            🎁
          </div>

          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <span
              style={{
                display: "inline-block",
                background: "#FDE047",
                color: "#713F12",
                fontWeight: 800,
                fontSize: "0.68rem",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                padding: "3px 9px",
                borderRadius: 20,
                marginBottom: 6,
              }}
            >
              Grátis · pronto em até 24 h
            </span>
            <h3 style={{ margin: "0 0 4px", fontSize: "1.15rem", fontWeight: 800, lineHeight: 1.25 }}>
              Já tem cardápio em outro lugar?
            </h3>
            <p style={{ margin: 0, fontSize: "0.88rem", lineHeight: 1.45, color: "rgba(255,255,255,0.92)" }}>
              Mande o link (iFood, Anota AI, site) ou uma foto do cardápio impresso. A nossa equipe{" "}
              <strong style={{ color: "#fff" }}>copia tudo para você</strong>, sem custo.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {["Produtos, preços e fotos", "Adicionais e combos", "Bairros e taxas de entrega"].map((t) => (
                <span
                  key={t}
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 20,
                    padding: "3px 10px",
                    fontSize: "0.76rem",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  ✓ {t}
                </span>
              ))}
            </div>
          </div>

          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="copiamos-botao"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "#fff",
              color: "#047857",
              fontWeight: 800,
              fontSize: "0.92rem",
              padding: "12px 20px",
              borderRadius: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Pedir a cópia no WhatsApp
          </a>

          {!cardapioVazio && (
            <button
              type="button"
              onClick={fecharTarja}
              aria-label="Fechar aviso"
              title="Fechar aviso"
              style={{
                position: "absolute",
                top: 8,
                right: 10,
                background: "none",
                border: "none",
                color: "rgba(255,255,255,0.75)",
                fontSize: "1rem",
                cursor: "pointer",
                padding: "4px 6px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}

          <style>{`
            .copiamos-botao { transition: transform 0.15s ease, box-shadow 0.15s ease; }
            .copiamos-botao:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.2) !important; }
            @media (max-width: 640px) {
              .copiamos-tarja .copiamos-botao { width: 100%; }
            }
          `}</style>
        </div>
      )}

      {janelaAberta && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="copiamos-titulo"
          onClick={(e) => {
            if (e.target === e.currentTarget) setJanelaAberta(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 460,
              maxHeight: "calc(100vh - 32px)",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 20,
              boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
              padding: "28px 24px 22px",
              textAlign: "center",
            }}
          >
            <button
              type="button"
              onClick={() => setJanelaAberta(false)}
              aria-label="Fechar"
              style={{
                position: "absolute",
                top: 10,
                right: 12,
                background: "none",
                border: "none",
                fontSize: "1.2rem",
                color: "#94A3B8",
                cursor: "pointer",
              }}
            >
              ✕
            </button>

            <div style={{ fontSize: "2.6rem", lineHeight: 1 }}>👋</div>
            <span
              style={{
                display: "inline-block",
                marginTop: 12,
                background: "#DCFCE7",
                color: "#166534",
                fontWeight: 800,
                fontSize: "0.72rem",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: 20,
              }}
            >
              Sem custo nenhum
            </span>
            <h2
              id="copiamos-titulo"
              style={{ fontSize: "1.35rem", fontWeight: 800, color: "#0F172A", margin: "10px 0 8px", lineHeight: 1.25 }}
            >
              Vimos que você é novo por aqui!
            </h2>
            <p style={{ color: "#475569", fontSize: "0.95rem", lineHeight: 1.5, margin: "0 0 16px" }}>
              Não precisa cadastrar tudo na mão. A nossa equipe <strong>copia o seu cardápio antigo</strong> e te
              entrega a loja <strong>prontinha em até 24 horas</strong>.
            </p>

            <ul
              style={{
                listStyle: "none",
                padding: "12px 16px",
                margin: "0 0 18px",
                background: "#F8FAFC",
                borderRadius: 12,
                textAlign: "left",
                fontSize: "0.9rem",
                color: "#1E293B",
                display: "grid",
                gap: 6,
              }}
            >
              <li>✅ Produtos, preços e fotos</li>
              <li>✅ Adicionais e combos</li>
              <li>✅ Bairros, taxas e tempo de entrega</li>
              <li>✅ Horários de funcionamento</li>
            </ul>

            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: "#16A34A",
                color: "#fff",
                fontWeight: 800,
                fontSize: "1rem",
                padding: "14px 18px",
                borderRadius: 12,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(22, 163, 74, 0.35)",
              }}
            >
              💬 Falar com um atendente no WhatsApp
            </a>
            <p style={{ color: "#64748B", fontSize: "0.8rem", margin: "10px 0 0", lineHeight: 1.4 }}>
              Tenha em mãos o link do cardápio que você usa hoje (iFood, Anota AI, site) ou uma foto do cardápio
              impresso.
            </p>

            <button
              type="button"
              onClick={() => setJanelaAberta(false)}
              style={{
                marginTop: 14,
                background: "none",
                border: "none",
                color: "#64748B",
                fontSize: "0.85rem",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Prefiro cadastrar eu mesmo
            </button>
          </div>
        </div>
      )}
    </>
  );
}
