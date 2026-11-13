/**
 * /escala/<código>/minha/<token> — a escala de UMA pessoa: aceitar os turnos
 * e baixar o PDF do mês. É o link que o WhatsApp da loja manda quando o
 * gerente escala a pessoa ou ela escolhe a vaga (lib/escala-da-equipe/aviso.ts).
 * Os dados vêm da API (/api/escala/<código>/minha/<token>), que confere o token.
 */
import MinhaEscalaClient from "./MinhaEscalaClient";

export const dynamic = "force-dynamic";

export const metadata = { title: "Minha escala", robots: { index: false, follow: false } };

export default async function MinhaEscalaPage({ params }: { params: Promise<{ codigo: string; token: string }> }) {
  const { codigo, token } = await params;
  return <MinhaEscalaClient codigo={codigo} token={token} />;
}
