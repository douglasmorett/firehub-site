import { Metadata } from "next";
import TextoDosTermos from "@/components/termos/TextoDosTermos";

export const metadata: Metadata = {
  title: "Termos de Uso — FireHub Food",
  description: "Termos de Uso e Condições Gerais do FireHub: cobrança, funcionamento, responsabilidades e dados.",
};

/**
 * O texto mora em components/termos/TextoDosTermos.tsx — o mesmo que o painel
 * mostra na tela de aceite. Esta página só dá a moldura.
 */
export default function TermosPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "2.5rem 1.25rem 4rem", fontFamily: "system-ui, sans-serif", color: "#1E293B" }}>
        <a href="/" style={{ color: "#C92E09", fontWeight: 800, textDecoration: "none", fontSize: "0.9rem" }}>🔥 FireHub</a>
        <h1 style={{ fontSize: "clamp(1.6rem, 5vw, 2.1rem)", fontWeight: 900, margin: "0.75rem 0 1rem", color: "#0F172A", lineHeight: 1.2 }}>
          Termos de Uso e Condições Gerais
        </h1>
        <TextoDosTermos />
        <p style={{ textAlign: "center", color: "#9CA3AF", fontSize: "0.82rem", marginTop: "3rem" }}>
          © {new Date().getFullYear()} GRUPO HAKIM LTDA · FireHub Food. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
