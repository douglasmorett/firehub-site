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
 *   • Sempre: uma tarja pequena no topo. Com produtos ela pode ser fechada de
 *     vez (lembrado neste navegador); vazia, fica.
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            background: "#ECFDF5",
            border: "1px solid #A7F3D0",
            borderRadius: 12,
            padding: "8px 12px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            color: "#065F46",
          }}
        >
          <span style={{ fontSize: "1.1rem" }}>🎁</span>
          <span style={{ flex: "1 1 240px", lineHeight: 1.35 }}>
            <strong>Já tem cardápio em outro lugar?</strong> A nossa equipe copia tudo para você em até 24 h, sem custo.
          </span>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: "#16A34A",
              color: "#fff",
              fontWeight: 700,
              fontSize: "0.8rem",
              padding: "6px 12px",
              borderRadius: 8,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Falar no WhatsApp
          </a>
          {!cardapioVazio && (
            <button
              type="button"
              onClick={fecharTarja}
              aria-label="Fechar aviso"
              title="Fechar aviso"
              style={{
                background: "none",
                border: "none",
                color: "#047857",
                fontSize: "1rem",
                cursor: "pointer",
                padding: "2px 4px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
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
