import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FireAccess — Suporte FireHub no seu computador",
  description: "Baixe o FireAccess para o atendente do FireHub resolver no seu computador: impressora, Assistente, iFood e 99.",
  robots: { index: false },
};

/**
 * /fireaccess — onde o lojista baixa o FireAccess (acesso remoto do suporte).
 * O link é mandado pelo atendimento; o projeto fica em fireaccess/ (PLANO.md).
 * O .exe não é assinado: o passo 2 ensina a passar pelo aviso do Windows.
 */
const passos = [
  { t: "Baixe e abra", d: "Clique no botão acima e abra o arquivo FireAccess.exe que baixou." },
  {
    t: "Se o Windows avisar",
    d: "Na tela “O Windows protegeu o computador”, clique em Mais informações e depois em Executar assim mesmo.",
  },
  {
    t: "Passe o código e permita",
    d: "Mande para o atendente o código de 6 números que aparece e clique em Permitir suporte FireHub. Fique perto do computador.",
  },
];

export default function Pagina() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fff",
        color: "#1a1a1a",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        padding: "48px 16px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <p style={{ color: "#e5372b", fontWeight: 700, margin: 0 }}>Suporte FireHub</p>
        <h1 style={{ fontSize: 28, margin: "8px 0 12px" }}>O atendente resolve direto no seu computador</h1>
        <p style={{ color: "#555", margin: "0 0 28px", lineHeight: 1.5 }}>
          Impressora, Assistente de Impressão, iFood, 99: você só acompanha pela tela.
        </p>
        <a
          href="/downloads/FireAccess.exe"
          download
          style={{
            display: "inline-block",
            background: "#e5372b",
            color: "#fff",
            fontWeight: 700,
            textDecoration: "none",
            borderRadius: 10,
            padding: "14px 28px",
            fontSize: 17,
          }}
        >
          Baixar o FireAccess
        </a>
        <p style={{ color: "#888", fontSize: 13, margin: "8px 0 0" }}>Para Windows · não precisa instalar</p>

        <ol style={{ listStyle: "none", padding: 0, margin: "40px 0 0", textAlign: "left" }}>
          {passos.map((p, i) => (
            <li key={p.t} style={{ display: "flex", gap: 14, marginBottom: 20 }}>
              <span
                style={{
                  flex: "0 0 32px",
                  height: 32,
                  borderRadius: "50%",
                  background: "#fdeceb",
                  color: "#e5372b",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <div>
                <strong>{p.t}</strong>
                <p style={{ margin: "4px 0 0", color: "#555", lineHeight: 1.5 }}>{p.d}</p>
              </div>
            </li>
          ))}
        </ol>

        <p
          style={{
            marginTop: 28,
            padding: 16,
            background: "#f6f6f6",
            borderRadius: 10,
            color: "#555",
            fontSize: 14,
            lineHeight: 1.5,
            textAlign: "left",
          }}
        >
          Enquanto o suporte estiver conectado, uma faixa vermelha fica no topo da tela. Para cortar o acesso, clique em
          Encerrar ou feche o programa. Senhas quem digita é sempre você.
        </p>
      </div>
    </main>
  );
}
