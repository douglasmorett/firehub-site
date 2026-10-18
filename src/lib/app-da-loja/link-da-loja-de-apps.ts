/** O link do app no Google Play ou na App Store (lib/app-da-loja/links.ts). Sem banco, para o teste. */

/** Só o link de verdade da loja de cada sistema. */
export function linkDaLojaDeApps(v: unknown, sistema: "android" | "ios"): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    if (sistema === "android") return u.hostname === "play.google.com" && u.searchParams.get("id") ? u.toString() : null;
    return u.hostname === "apps.apple.com" && /\/id\d+/.test(u.pathname) ? u.toString() : null;
  } catch {
    return null;
  }
}
