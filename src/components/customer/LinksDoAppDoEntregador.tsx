"use client";
import { useState } from "react";
import { copiarTexto } from "@/lib/copiar-texto";

/** As páginas do FireHub Entregador nas lojas (no ar desde 16/10/2026). */
export const APP_DO_ENTREGADOR_IPHONE = "https://apps.apple.com/br/app/firehub-entregador/id6821206920";
export const APP_DO_ENTREGADOR_ANDROID = "https://play.google.com/store/apps/details?id=br.com.firehub.entregador";

/**
 * Os links para baixar o app do entregador, no Portal de Acesso dos Motoboys
 * (Douglas, 17/10/2026: "colocar aqui também a opção com os links para baixar
 * o app no Apple e no Android"). O "Copiar mensagem" junta os dois links e o
 * link da loja num texto pronto para mandar ao motoboy no WhatsApp.
 */
export default function LinksDoAppDoEntregador({ linkDaLoja }: { linkDaLoja: () => string }) {
  const [copiado, setCopiado] = useState(false);

  const botao = (fundo: string): React.CSSProperties => ({
    flex: "1 1 160px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "10px 12px", borderRadius: 10, background: fundo, color: "#FFFFFF",
    fontWeight: 800, fontSize: "0.86rem", textDecoration: "none", fontFamily: "inherit",
  });

  async function copiarMensagem() {
    const texto = [
      "Baixe o app FireHub Entregador:",
      `📱 iPhone: ${APP_DO_ENTREGADOR_IPHONE}`,
      `🤖 Android: ${APP_DO_ENTREGADOR_ANDROID}`,
      "",
      `Depois é só entrar pela nossa loja: ${linkDaLoja()}`,
    ].join("\n");
    if (!(await copiarTexto(texto))) return;
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  }

  return (
    <div style={{
      background: "#F8FAFC", border: "1.5px solid #CBD5E1", borderRadius: "10px",
      padding: "1rem", marginBottom: "1.25rem",
    }}>
      <label style={{ fontSize: "0.76rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", display: "block", marginBottom: 4 }}>
        Baixar o app do entregador
      </label>
      <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "#64748B" }}>
        Com o app, a localização continua sendo enviada com a tela apagada ou o celular no bolso.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a href={APP_DO_ENTREGADOR_IPHONE} target="_blank" rel="noopener noreferrer" style={botao("#0F172A")}>
          🍎 App Store (iPhone)
        </a>
        <a href={APP_DO_ENTREGADOR_ANDROID} target="_blank" rel="noopener noreferrer" style={botao("#15803D")}>
          ▶ Google Play (Android)
        </a>
      </div>
      <button
        type="button"
        onClick={copiarMensagem}
        style={{
          width: "100%", marginTop: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
          border: `1.5px solid ${copiado ? "#0F766E" : "#CBD5E1"}`, background: copiado ? "#F0FDFA" : "#FFFFFF",
          color: copiado ? "#0F766E" : "#334155", fontWeight: 800, fontSize: "0.82rem",
        }}
      >
        {copiado ? "✅ Mensagem copiada — é só colar no WhatsApp do motoboy" : "📋 Copiar mensagem com os links do app"}
      </button>
    </div>
  );
}
