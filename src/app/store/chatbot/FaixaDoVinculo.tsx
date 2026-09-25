"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import type { SaudeDoVinculoNaTela } from "./saude-do-vinculo-na-tela";

/**
 * Faixa "conectado, mas o vínculo está com problema" da tela do robô.
 *
 * Existe porque "conectado" não é "funcionando": a Divinos ficou verde no
 * painel a noite de 24/09 inteira com os clientes recebendo "Aguardando
 * mensagem" em tudo que o robô mandava. Cada aviso diz o que aconteceu com as
 * palavras do lojista e o passo a passo; o texto técnico do servidor fica
 * atrás de "ver detalhe", para o suporte.
 *
 * Mesmas cores da faixa de "robô fora do ar" (e não âmbar/vermelho): no painel
 * âmbar é cobrança e vermelho é bloqueio, e isto é problema do robô.
 */
export default function FaixaDoVinculo({
  saude,
  ocupado,
  onRelerQr,
  onNumeroComumEhDaLoja,
}: {
  saude: SaudeDoVinculoNaTela;
  /** Desconectando/gerando QR: o botão não pode disparar duas vezes. */
  ocupado: boolean;
  onRelerQr: () => void;
  /** Sem número conectado conhecido não há o que lembrar: aí o botão nem aparece. */
  onNumeroComumEhDaLoja?: () => void;
}) {
  if (saude.problemas.length === 0) return null;

  const clientesSemLer = saude.problemas.some((p) => p.tipo === "vinculo-doente");
  const hora = saude.vistoEm
    ? new Date(saude.vistoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <section
      aria-label="Problema no vínculo do WhatsApp"
      style={{
        background: "#F0FDFA",
        border: "1px solid #99F6E4",
        borderLeft: "6px solid #0F766E",
        borderRadius: 12,
        padding: "0.9rem 1.1rem",
        marginBottom: "1rem",
        color: "#134E4A",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.7rem" }}>
        <AlertCircle size={22} color="#0F766E" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <div style={{ fontWeight: 800, color: "#0F766E", fontSize: "1rem", lineHeight: 1.35 }}>
          {clientesSemLer
            ? "Seu robô aparece como conectado, mas não está funcionando para os clientes"
            : "Seu robô está conectado, mas o vínculo com o WhatsApp precisa de atenção"}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
        {saude.problemas.map((p) => (
          <div
            key={p.tipo}
            style={{ background: "#fff", border: "1px solid #CCFBF1", borderRadius: 10, padding: "0.75rem 0.9rem" }}
          >
            <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", lineHeight: 1.45 }}>{p.titulo}</div>
            <ol style={{ margin: "0.45rem 0 0", paddingLeft: "1.2rem", fontSize: "0.84rem", color: "#334155", lineHeight: 1.55 }}>
              {p.passos.map((passo, i) => (
                <li key={i}>{passo}</li>
              ))}
            </ol>
            {p.detalhes.length > 0 && (
              <details style={{ marginTop: "0.45rem", fontSize: "0.78rem", color: "#475569" }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Ver detalhe do servidor de WhatsApp</summary>
                {p.detalhes.map((d, i) => (
                  <p key={i} style={{ margin: "0.35rem 0 0", lineHeight: 1.5 }}>{d}</p>
                ))}
              </details>
            )}
            {p.dispensavel && onNumeroComumEhDaLoja && (
              <button
                type="button"
                onClick={onNumeroComumEhDaLoja}
                style={{
                  marginTop: "0.5rem", padding: 0, border: "none", background: "none",
                  color: "#0F766E", fontWeight: 700, fontSize: "0.78rem", textDecoration: "underline", cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Este é o número da loja mesmo (usamos o WhatsApp comum) — não avisar mais
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.85rem" }}>
        <button
          type="button"
          onClick={onRelerQr}
          disabled={ocupado}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: ocupado ? "#5EAAA3" : "#0F766E", color: "#fff", border: "none",
            fontWeight: 800, fontSize: "0.9rem", padding: "0.6rem 1.1rem", borderRadius: 10,
            cursor: ocupado ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={15} className={ocupado ? "spin" : ""} aria-hidden />
          {ocupado ? "Desconectando..." : "Desconectar e ler o QR de novo"}
        </button>
        {hora && (
          <span style={{ fontSize: "0.75rem", color: "#0F766E" }}>
            Informação do servidor de WhatsApp das {hora}.
          </span>
        )}
      </div>
    </section>
  );
}
