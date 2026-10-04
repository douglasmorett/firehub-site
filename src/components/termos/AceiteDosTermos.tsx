"use client";

/**
 * Tela de aceite dos Termos de Uso, por cima do painel inteiro. Aparece para o
 * DONO da conta enquanto ele não aceitar a versão em vigor (o layout decide,
 * ver lib/termos-de-uso.ts). Não fecha: ou aceita, ou sai da conta.
 *
 * O texto é o mesmo da página /termos (TextoDosTermos), inteiro e rolável —
 * aceite de contrato com o texto só "num link" é o mais fácil de contestar.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import TextoDosTermos from "@/components/termos/TextoDosTermos";
import { DATA_DOS_TERMOS, VERSAO_DOS_TERMOS } from "@/lib/termos-versao";

export default function AceiteDosTermos({ nomeDaLoja, primeiraVez }: { nomeDaLoja: string; primeiraVez: boolean }) {
  const router = useRouter();
  const [marcado, setMarcado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function aceitar() {
    if (!marcado || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/termos/aceite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versao: VERSAO_DOS_TERMOS }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(dados.error || "Não deu para registrar o aceite. Tente de novo.");
        setEnviando(false);
        return;
      }
      router.refresh();
    } catch {
      setErro("Sem conexão. Confira a internet e tente de novo.");
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="termos-titulo"
      className="fh-termos-fundo"
    >
      <div className="fh-termos-cartao">
        <header className="fh-termos-topo">
          <div style={{ fontSize: ".78rem", fontWeight: 800, color: "#C92E09", letterSpacing: ".04em", textTransform: "uppercase" }}>
            🔥 FireHub · {nomeDaLoja}
          </div>
          <h2 id="termos-titulo" style={{ margin: "6px 0 4px", fontSize: "1.35rem", fontWeight: 900, color: "#0F172A", lineHeight: 1.25 }}>
            {primeiraVez ? "Termos de Uso do FireHub" : "Atualizamos os Termos de Uso"}
          </h2>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#64748B", lineHeight: 1.5 }}>
            Para continuar usando o painel, leia e aceite a versão de {DATA_DOS_TERMOS}.
          </p>
        </header>

        <div className="fh-termos-texto" tabIndex={0}>
          <TextoDosTermos compacto />
        </div>

        <footer className="fh-termos-rodape">
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: ".88rem", color: "#0F172A", lineHeight: 1.45 }}>
            <input
              type="checkbox"
              checked={marcado}
              onChange={(e) => setMarcado(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 1, accentColor: "#C92E09", flexShrink: 0, cursor: "pointer" }}
            />
            <span>
              Li e aceito os <strong>Termos de Uso</strong> e a <strong>Política de Privacidade</strong> do FireHub em nome de <strong>{nomeDaLoja}</strong>.
            </span>
          </label>

          {erro && (
            <div role="alert" style={{ marginTop: 10, background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", borderRadius: 10, padding: "8px 12px", fontSize: ".84rem", fontWeight: 600 }}>
              {erro}
            </div>
          )}

          <div className="fh-termos-acoes">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="fh-termos-sair"
            >
              Sair da conta
            </button>
            <a href="/termos" target="_blank" rel="noopener noreferrer" className="fh-termos-link">
              Abrir em nova aba
            </a>
            <button
              type="button"
              onClick={aceitar}
              disabled={!marcado || enviando}
              className="fh-termos-aceitar"
            >
              {enviando ? "Registrando..." : "Aceitar e continuar"}
            </button>
          </div>
        </footer>
      </div>

      <style>{`
        .fh-termos-fundo {
          position: fixed; inset: 0; z-index: 10050; /* acima do widget de suporte (10000) */
          background: rgba(15, 23, 42, .78); backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center; padding: 16px;
        }
        .fh-termos-cartao {
          background: #fff; border-radius: 18px; width: 100%; max-width: 760px;
          max-height: calc(100dvh - 32px); display: flex; flex-direction: column;
          box-shadow: 0 25px 60px -15px rgba(0,0,0,.45); overflow: hidden;
        }
        .fh-termos-topo { padding: 20px 24px 14px; border-bottom: 1px solid #E2E8F0; }
        .fh-termos-texto { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 24px 16px; overscroll-behavior: contain; }
        .fh-termos-texto:focus-visible { outline: 2px solid #C92E09; outline-offset: -2px; }
        .fh-termos-rodape { padding: 14px 24px 18px; border-top: 1px solid #E2E8F0; background: #FAFAF9; }
        .fh-termos-acoes { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
        .fh-termos-sair, .fh-termos-link {
          background: none; border: none; padding: 0; min-height: 0; height: auto;
          color: #64748B; font-size: .84rem; font-weight: 600; text-decoration: underline; cursor: pointer;
        }
        .fh-termos-aceitar {
          margin-left: auto; background: #C92E09; color: #fff; border: none; border-radius: 12px;
          padding: 0 22px; height: 46px; min-height: 0; font-size: .95rem; font-weight: 800; cursor: pointer;
          transition: background-color .15s ease, transform .1s ease;
        }
        .fh-termos-aceitar:hover:not(:disabled) { background: #A82507; }
        .fh-termos-aceitar:active:not(:disabled) { transform: scale(.98); }
        .fh-termos-aceitar:disabled { background: #E7B4A6; cursor: not-allowed; }
        @media (max-width: 560px) {
          .fh-termos-fundo { padding: 0; }
          .fh-termos-cartao { max-height: 100dvh; height: 100dvh; border-radius: 0; }
          .fh-termos-topo { padding: 16px 16px 12px; }
          .fh-termos-texto { padding: 4px 16px 14px; }
          .fh-termos-rodape { padding: 12px 16px 16px; }
          .fh-termos-aceitar { width: 100%; margin-left: 0; order: -1; }
        }
      `}</style>
    </div>
  );
}
