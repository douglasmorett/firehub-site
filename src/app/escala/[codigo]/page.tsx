/**
 * /escala/<código> — o link de inscrição da Escala da equipe, SEM login
 * (lib/escala-da-equipe). A loja manda no grupo do WhatsApp; motoboy,
 * funcionário e freelancer entram com o próprio WhatsApp e escolhem o turno.
 * Não é o app do motoboy de propósito (Douglas, 11/11/2026): freelancer não
 * tem login, e o link precisa abrir em qualquer celular.
 */
import { prisma } from "@/lib/prisma";
import { lojaPeloCodigo } from "@/lib/escala-da-equipe/banco";
import EscalaPublicaClient from "./EscalaPublicaClient";

export const dynamic = "force-dynamic";

async function lojaDoCodigo(codigo: string) {
  const achada = await lojaPeloCodigo(codigo).catch(() => null);
  if (!achada) return null;
  const loja = await prisma.user.findUnique({ where: { id: achada.lojaId }, select: { storeName: true, name: true, storeLogo: true } }).catch(() => null);
  return { nome: loja?.storeName || loja?.name || "Loja", logo: loja?.storeLogo || null };
}

export async function generateMetadata({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const loja = await lojaDoCodigo(codigo);
  return {
    title: loja ? `Escala — ${loja.nome}` : "Escala da equipe",
    description: loja ? `Escolha o seu turno na ${loja.nome}.` : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function EscalaPublicaPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const loja = await lojaDoCodigo(codigo);
  if (!loja) {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#F0FDFA", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 18, padding: "28px 22px", maxWidth: 380, textAlign: "center", boxShadow: "0 10px 30px rgba(15,23,42,.08)" }}>
          <div style={{ fontSize: 40 }}>🔗</div>
          <h1 style={{ fontSize: 20, margin: "8px 0 6px" }}>Este link de escala não existe mais</h1>
          <p style={{ color: "#475569", fontSize: 15, lineHeight: 1.5, margin: 0 }}>A loja pode ter gerado um link novo. Peça o link atualizado no grupo da equipe.</p>
        </div>
      </main>
    );
  }
  return <EscalaPublicaClient codigo={codigo} loja={loja} />;
}
