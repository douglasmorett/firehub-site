"use client";

import { usePathname } from "next/navigation";

export default function HideOnCompras({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hide = pathname?.startsWith("/store/compras") || pathname?.startsWith("/store/orders");
  if (hide) return null;
  return <>{children}</>;
}
