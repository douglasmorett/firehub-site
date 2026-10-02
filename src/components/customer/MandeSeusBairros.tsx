"use client";

/**
 * "Entrega por bairros? Manda a lista que a gente cadastra" — tarja da tela de
 * Configurações de Entrega.
 *
 * Cadastrar bairro por bairro com a taxa é o trabalho mais chato da loja nova,
 * e a equipe faz isso no mesmo dia (o robô do atendimento já conhece a oferta:
 * lib/atendimento/conhecimento.ts, "A gente monta a loja"). Mesmo desenho da
 * tarja do cardápio (CopiamosSeuCardapio).
 *
 * Sem área cadastrada a tarja fica; com área ela pode ser fechada de vez
 * (lembrado neste navegador).
 *
 * O botão só ABRE o WhatsApp do FireHub com a mensagem escrita — quem manda é
 * o lojista. O número do atendimento não envia nada sozinho.
 */

import { useEffect, useState } from "react";

const WHATSAPP_DO_FIREHUB = "5522981118514";

function linkDoWhatsApp(nomeDaLoja: string | null | undefined): string {
  const loja = nomeDaLoja?.trim() ? `a loja *${nomeDaLoja.trim()}*` : "uma loja";
  const texto =
    `Olá! Tenho ${loja} no FireHub e entrego por bairros. ` +
    `Segue a minha lista de bairros e taxas para cadastrar: `;
  return `https://wa.me/${WHATSAPP_DO_FIREHUB}?text=${encodeURIComponent(texto)}`;
}

export default function MandeSeusBairros({
  temAreaCadastrada,
  nomeDaLoja,
}: {
  temAreaCadastrada: boolean;
  nomeDaLoja?: string | null;
}) {
  const chave = "firehub_tarja_bairros_pelo_whatsapp";
  // null até ler o navegador: não pisca a tarja que o lojista já fechou.
  const [fechada, setFechada] = useState<boolean | null>(null);

  useEffect(() => {
    if (!temAreaCadastrada) return setFechada(false);
    try {
      setFechada(localStorage.getItem(chave) === "1");
    } catch {
      setFechada(false);
    }
  }, [temAreaCadastrada]);

  if (fechada !== false) return null;

  function fechar() {
    setFechada(true);
    try {
      localStorage.setItem(chave, "1");
    } catch {}
  }

  return (
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
        marginBottom: "0.8rem",
        fontSize: "0.85rem",
        color: "#065F46",
      }}
    >
      <span style={{ fontSize: "1.1rem" }}>🏙️</span>
      <span style={{ flex: "1 1 260px", lineHeight: 1.35 }}>
        <strong>Sua entrega é por bairros?</strong> Mande a sua lista de bairros e taxas no nosso WhatsApp e um
        atendente cadastra tudo para você, ainda hoje.
      </span>
      <a
        href={linkDoWhatsApp(nomeDaLoja)}
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
        Mandar a lista no WhatsApp
      </a>
      {temAreaCadastrada && (
        <button
          type="button"
          onClick={fechar}
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
  );
}
