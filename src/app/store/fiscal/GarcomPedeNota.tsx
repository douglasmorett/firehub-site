"use client";

/**
 * "Permitir que o garçom peça a nota fiscal pela maquininha"
 * (Douglas, 13/11/2026 — lib/nota-pelo-garcom).
 *
 * Fica dentro de "Como a nota é emitida" e grava sozinho, num clique com
 * confirmação: é um liga/desliga do titular, com aviso de responsabilidade.
 * O servidor recusa o campo do funcionário (lib/fiscal-config) e carimba
 * quem ligou e quando.
 */
import { useState } from "react";

const ajuda = { display: "block", fontSize: "0.76rem", color: "#64748B", fontWeight: 400, lineHeight: 1.5, margin: "4px 0 0" } as const;

const AVISO_AO_LIGAR =
  "Permitir que o garçom peça a nota fiscal pela maquininha?\n\n" +
  "Ao cobrar a mesa, o garçom vai responder \"Emitir nota fiscal? Sim/Não\". Com Sim, a NFC-e da conta sai " +
  "quando a mesa fecha e imprime na impressora do caixa — mesmo nas formas de pagamento que hoje não têm nota automática.\n\n" +
  "Você, dono da loja, assume a responsabilidade pelas notas que o garçom pedir (inclusive as pedidas por engano). " +
  "Nota errada só se cancela em até 30 minutos.";

function quando(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function GarcomPedeNota({
  gravado,
  emissaoLigada,
  podeMudar,
  aoSalvar,
}: {
  gravado: { ligado?: boolean; por?: string | null; em?: string | null } | null | undefined;
  emissaoLigada: boolean;
  /** Só o dono da loja: o servidor recusa o campo do funcionário. */
  podeMudar: boolean;
  aoSalvar: (campos: Record<string, unknown>) => Promise<{ ok: boolean; dados: any }>;
}) {
  const ligado = gravado?.ligado === true;
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  const mudar = async () => {
    if (!podeMudar || salvando) return;
    const ligar = !ligado;
    if (ligar && !window.confirm(AVISO_AO_LIGAR)) return;
    setSalvando(true);
    setMensagem(null);
    try {
      const r = await aoSalvar({ notaPeloGarcom: ligar });
      if (!r.ok) setMensagem({ ok: false, texto: r.dados?.mensagem || r.dados?.error || "Não consegui salvar. Nada foi alterado." });
      else if (Array.isArray(r.dados?.camposIgnorados) && r.dados.camposIgnorados.includes("notaPeloGarcom")) {
        setMensagem({ ok: false, texto: "Só o dono da loja libera o garçom a pedir a nota — nada foi alterado." });
      } else {
        setMensagem({
          ok: true,
          texto: ligar
            ? "Liberado. Na maquininha, o garçom vê a pergunta na próxima vez que entrar no modo garçom."
            : "Desligado. A maquininha não pergunta mais e o FireHub recusa o pedido de nota pelo garçom.",
        });
      }
    } catch {
      setMensagem({ ok: false, texto: "Não consegui falar com o servidor. Nada foi alterado." });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ marginTop: 20, padding: "14px 16px", border: "1px solid #E2E8F0", borderRadius: 12, background: "#fff" }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: podeMudar ? "pointer" : "not-allowed" }}>
        <input
          type="checkbox"
          checked={ligado}
          disabled={!podeMudar || salvando}
          onChange={mudar}
          style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }}
        />
        <span>
          <span style={{ fontSize: "0.9rem", fontWeight: 800, color: "#1E293B" }}>
            Permitir que o garçom peça a nota fiscal pela maquininha
          </span>
          <span style={ajuda}>
            Ao cobrar a mesa na maquininha, o app do garçom pergunta &quot;Emitir nota fiscal?&quot;. Com Sim, a NFC-e da conta
            sai quando a mesa fecha e imprime na impressora do caixa, sem o caixa procurar o pedido. Desligado, a pergunta não
            aparece.
          </span>
          <span style={{ ...ajuda, color: "#92400E" }}>
            ⚠️ Você, dono da loja, assume a responsabilidade pelas notas que o garçom pedir — inclusive as pedidas por engano.
          </span>
        </span>
      </label>

      {ligado && gravado?.em && (
        <p style={{ ...ajuda, marginTop: 10 }}>
          Ligado por {gravado.por || "—"} em {quando(gravado.em)}.
        </p>
      )}
      {!ligado && gravado?.em && (
        <p style={{ ...ajuda, marginTop: 10 }}>
          Desligado por {gravado.por || "—"} em {quando(gravado.em)}.
        </p>
      )}
      {ligado && !emissaoLigada && (
        <p style={{ ...ajuda, marginTop: 10, color: "#92400E" }}>
          A emissão de NFC-e está desligada: a pergunta só aparece no garçom quando você ligar a emissão.
        </p>
      )}
      {!podeMudar && <p style={{ ...ajuda, marginTop: 10, color: "#92400E" }}>Só o dono da loja muda esta opção.</p>}
      {mensagem && (
        <p role="status" style={{ ...ajuda, marginTop: 10, color: mensagem.ok ? "#166534" : "#B91C1C", fontWeight: 600 }}>
          {mensagem.texto}
        </p>
      )}
    </div>
  );
}
