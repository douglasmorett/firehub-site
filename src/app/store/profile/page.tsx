import { redirect } from "next/navigation";

export default function ProfilePage() {
  // Perfil foi integrado em Minha Loja → Minha Conta
  redirect("/store/minha-loja");
}
