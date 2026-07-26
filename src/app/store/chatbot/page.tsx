import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChatbotHubClient from "./ChatbotHubClient";

export const dynamic = "force-dynamic";

export default async function ChatbotPage() {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    redirect("/login");
  }

  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") {
    redirect("/login");
  }

  return <ChatbotHubClient />;
}
