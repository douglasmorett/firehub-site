"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

/**
 * O botão de sair do FireHub.
 *
 * Antes era `<a href="/api/auth/signout">` em todos os cantos do painel. Esse
 * endereço é a página que o próprio NextAuth serve quando ninguém fez uma:
 * fundo cinza, sem a marca, escrita em inglês — "Are you sure you want to sign
 * out?" — e com um segundo clique obrigatório. Quem estava no meio do
 * movimento clicava em "Sair", caía numa tela estrangeira e ficava em dúvida se
 * tinha saído, se tinha quebrado, ou se aquilo era o sistema.
 *
 * A confirmação em si vale a pena e fica: no balcão, com o dedo molhado e a
 * fila andando, sair sem querer significa perder o caixa aberto e voltar a
 * digitar senha. O que muda é a tela — esta aqui é em português, tem o nome da
 * loja e avisa quando o caixa ainda está aberto, que é a única saída de fato
 * arriscada.
 *
 * `signOut()` do next-auth/react faz o POST com o token de CSRF e redireciona
 * sozinho. É o caminho que o link cru pulava.
 */
export default function SairDaConta({
  children,
  className,
  style,
  callbackUrl = "/login",
  caixaAberto = false,
  nomeDaLoja,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  callbackUrl?: string;
  /** Quando true, o modal avisa que o caixa do dia ficará aberto. */
  caixaAberto?: boolean;
  nomeDaLoja?: string;
}) {
  const [perguntando, setPerguntando] = useState(false);
  const [saindo, setSaindo] = useState(false);

  const sair = async () => {
    setSaindo(true);
    try {
      await signOut({ callbackUrl });
    } catch {
      // Se o POST falhar (rede caiu no meio), o botão volta a ficar clicável em
      // vez de deixar a pessoa presa num modal que gira para sempre.
      setSaindo(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setPerguntando(true)}
        className={className}
        style={{ cursor: "pointer", font: "inherit", ...style }}
      >
        {children}
      </button>

      {perguntando && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sair da conta"
          onClick={() => !saindo && setPerguntando(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1.25rem",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 18, padding: "1.75rem",
              width: "100%", maxWidth: 380, textAlign: "center",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)",
              fontFamily: "inherit", color: "#0F172A",
            }}
          >
            <div style={{ fontSize: "2.5rem", lineHeight: 1, marginBottom: "0.75rem" }}>👋</div>
            <h2 style={{ margin: "0 0 0.4rem", fontSize: "1.2rem", fontWeight: 900 }}>
              Sair da conta{nomeDaLoja ? ` de ${nomeDaLoja}` : ""}?
            </h2>
            <p style={{ margin: "0 0 1.25rem", fontSize: "0.88rem", color: "#64748B", lineHeight: 1.55 }}>
              Você vai precisar entrar de novo com e-mail e senha para voltar ao painel.
            </p>

            {caixaAberto && (
              <div style={{
                background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12,
                padding: "0.8rem 0.9rem", marginBottom: "1.25rem",
                fontSize: "0.82rem", color: "#92400E", textAlign: "left", lineHeight: 1.5,
              }}>
                <strong>O caixa continua aberto.</strong> Sair não fecha o caixa — os pedidos
                seguem entrando no turno de hoje. Feche o caixa antes se o expediente acabou.
              </div>
            )}

            <div style={{ display: "flex", gap: "0.6rem" }}>
              <button
                type="button"
                onClick={() => setPerguntando(false)}
                disabled={saindo}
                style={{
                  flex: 1, padding: "12px", borderRadius: 12, border: "1.5px solid #E2E8F0",
                  background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.9rem",
                  cursor: saindo ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                Ficar
              </button>
              <button
                type="button"
                onClick={sair}
                disabled={saindo}
                autoFocus
                style={{
                  flex: 1, padding: "12px", borderRadius: 12, border: "none",
                  background: "#DC2626", color: "#fff", fontWeight: 800, fontSize: "0.9rem",
                  cursor: saindo ? "wait" : "pointer", fontFamily: "inherit",
                  opacity: saindo ? 0.75 : 1,
                }}
              >
                {saindo ? "Saindo..." : "Sair"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
