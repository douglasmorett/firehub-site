// O app do painel também se instala da tela de login (src/app/store/layout.tsx).
export const metadata = { manifest: "/painel.webmanifest" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
