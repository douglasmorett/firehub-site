"use client";

import { useState } from "react";

/**
 * O caminho pelo arquivo, enquanto a Chrome Web Store não libera a ficha.
 *
 * O dono pediu "o link do chrome://extensions para a pessoa só clicar". Não
 * existe: o Chrome bloqueia qualquer site de abrir endereço chrome://, por
 * segurança. O mais perto disso é copiar o endereço com um clique e a pessoa
 * colar na barra — então cada passo aqui tem UMA ação, com o texto exato que
 * aparece na tela do Chrome em negrito, e o endereço vem com botão de copiar.
 */

const ZIP = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";
const ENDERECO = "chrome://extensions";

export default function PassoAPasso() {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(ENDERECO);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sem permissão de área de transferência (raro): o endereço está
      // escrito ao lado, em texto selecionável, e a pessoa copia na mão.
    }
  }

  const passo: React.CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: "1px solid #E2E8F0" };
  const numero: React.CSSProperties = { width: 28, height: 28, borderRadius: 999, background: "#FF5722", color: "#fff", fontWeight: 900, display: "grid", placeItems: "center", flexShrink: 0, fontSize: ".9rem" };
  const texto: React.CSSProperties = { color: "#334155", lineHeight: 1.6, fontSize: ".97rem" };
  const chave: React.CSSProperties = { background: "#0F172A", color: "#fff", padding: "2px 8px", borderRadius: 6, fontWeight: 800, whiteSpace: "nowrap" };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={passo}>
        <div style={numero}>1</div>
        <div style={texto}>
          <a href={ZIP} style={{ color: "#C2410C", fontWeight: 800 }}>Baixe a extensão</a> (um arquivo .zip) e clique nele com o
          botão direito → <span style={chave}>Extrair tudo…</span>. Vai aparecer uma pasta.
        </div>
      </div>

      <div style={passo}>
        <div style={numero}>2</div>
        <div style={texto}>
          Cole este endereço na barra do Chrome e dê Enter:
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <code style={{ background: "#F1F5F9", border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 12px", fontSize: "1rem", fontWeight: 800, userSelect: "all" }}>{ENDERECO}</code>
            <button
              type="button"
              onClick={copiar}
              style={{ background: copiado ? "#15803D" : "#0F172A", color: "#fff", border: "none", borderRadius: 8, padding: "9px 14px", fontWeight: 800, cursor: "pointer", fontSize: ".92rem" }}
            >
              {copiado ? "✓ Copiado" : "Copiar endereço"}
            </button>
          </div>
          <div style={{ color: "#64748B", fontSize: ".85rem", marginTop: 6 }}>
            (o Chrome não deixa nenhum site abrir esse endereço com link — por isso é colar)
          </div>
        </div>
      </div>

      <div style={passo}>
        <div style={numero}>3</div>
        <div style={texto}>
          No canto de cima da tela que abriu, ligue <span style={chave}>Modo do desenvolvedor</span>.
        </div>
      </div>

      <div style={passo}>
        <div style={numero}>4</div>
        <div style={texto}>
          Clique em <span style={chave}>Carregar sem compactação</span> e escolha a pasta do passo 1. O ícone 🔥 aparece na barra.
        </div>
      </div>

      <div style={passo}>
        <div style={numero}>5</div>
        <div style={texto}>
          Volte ao e-mail da compra e clique em <b>2. Ativar minha conta</b>. A extensão entra sozinha.
        </div>
      </div>

      <div style={{ color: "#64748B", fontSize: ".88rem", marginTop: 10, lineHeight: 1.55 }}>
        Quando a loja do Google liberar, a gente te avisa para trocar pela instalação de um clique — essa se atualiza sozinha.
      </div>
    </div>
  );
}
