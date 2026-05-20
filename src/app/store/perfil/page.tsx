import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import ProfileClient from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      name: true,
      email: true,
      cpfCnpj: true,
      phone: true,
      city: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) redirect("/login");

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "1.5rem 1rem", paddingBottom: "4rem" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.75rem",
        marginBottom: "1.5rem", flexWrap: "wrap",
      }}>
        <Link href="/store/compras" style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 38, height: 38, borderRadius: "50%",
          border: "1.5px solid #E2E8F0", background: "#fff",
          color: "#475569", textDecoration: "none", flexShrink: 0,
        }}>
          ←
        </Link>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: "1.4rem", margin: 0, color: "#0F172A" }}>
            👤 Meu Perfil
          </h1>
          <p style={{ color: "#94A3B8", fontSize: "0.82rem", margin: "2px 0 0" }}>
            Gerencie suas informações e senha
          </p>
        </div>
      </div>

      {/* Info Card */}
      <div style={{
        background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0",
        padding: "1.25rem", marginBottom: "1rem",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}>
        <h2 style={{
          fontSize: "0.9rem", fontWeight: 700, color: "#0F172A",
          marginBottom: "1rem", paddingBottom: "0.6rem",
          borderBottom: "2px solid #E2E8F0",
        }}>
          Informações da Conta
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <InfoRow label="Nome" value={user.name || "—"} />
          <InfoRow label="E-mail" value={user.email} />
          <InfoRow label="CPF/CNPJ" value={user.cpfCnpj || "Não cadastrado"} />
          <InfoRow label="Telefone" value={user.phone || "Não cadastrado"} />
          <InfoRow label="Cidade" value={user.city || "Não cadastrada"} />
          <InfoRow label="Membro desde" value={
            new Date(user.createdAt).toLocaleDateString("pt-BR", {
              day: "2-digit", month: "long", year: "numeric",
              timeZone: "America/Sao_Paulo",
            })
          } />
        </div>
      </div>

      {/* Password Change */}
      <ProfileClient />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0.5rem 0", borderBottom: "1px solid #F8FAFC",
      gap: "0.5rem", flexWrap: "wrap",
    }}>
      <span style={{ color: "#64748B", fontSize: "0.85rem", fontWeight: 600 }}>{label}</span>
      <span style={{ color: "#0F172A", fontSize: "0.88rem", fontWeight: 500, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}
