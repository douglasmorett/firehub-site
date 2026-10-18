"use client";

/**
 * "Baixe o app e ganhe descontos exclusivos" — o convite do site da loja que
 * tem o aplicativo próprio (lib/app-da-loja/links.ts).
 *
 * Douglas, 18/10/2026: "de uma forma que não atrapalha a tela… não ficar na
 * frente de nada, mas que a pessoa veja com facilidade, chama atenção."
 * Por isso: entra no fluxo da página logo abaixo do topo da loja (nada fixo
 * por cima do cardápio ou da sacola), escuro para destacar no fundo claro, e
 * fecha no X por 7 dias. Celular vê só o botão da loja dele; o computador vê
 * os dois e um QR para apontar a câmera.
 */
import { useEffect, useState } from "react";
import { X, Smartphone } from "lucide-react";

type Sistema = "android" | "ios" | "computador";
const DIAS_FECHADO = 7;

const CSS = `
.fh-convite { position: relative; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 40px 12px 14px;
  border-radius: 16px; color: #fff; background: linear-gradient(120deg,#0F172A 0%,#1E293B 60%,#334155 100%); box-shadow: 0 6px 18px rgba(15,23,42,.18); }
.fh-convite-x { position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border-radius: 99px; border: 0;
  background: rgba(255,255,255,.12); color: #fff; display: grid; place-items: center; cursor: pointer; }
.fh-convite-logo { width: 44px; height: 44px; border-radius: 12px; background: #fff; flex-shrink: 0; overflow: hidden; display: grid; place-items: center; }
.fh-convite-logo img { width: 100%; height: 100%; object-fit: cover; }
.fh-convite-texto { flex: 1 1 200px; min-width: 0; line-height: 1.3; }
.fh-convite-selo { display: inline-block; font-size: .66rem; font-weight: 900; letter-spacing: .06em; text-transform: uppercase;
  background: #F5B301; color: #0F172A; border-radius: 6px; padding: 2px 7px; margin-bottom: 4px; }
.fh-convite-titulo { display: block; font-size: 1rem; font-weight: 900; }
.fh-convite-sub { display: block; font-size: .78rem; opacity: .75; margin-top: 1px; }
.fh-convite-link { display: flex; align-items: center; gap: 10px; color: #fff; text-decoration: none; flex-wrap: nowrap; }
.fh-convite-link .fh-convite-titulo { flex: 1; min-width: 0; font-size: .92rem; line-height: 1.25; }
.fh-convite-acao { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 10px; background: #F5B301;
  color: #0F172A; font-weight: 900; font-size: .82rem; white-space: nowrap; flex-shrink: 0; }
.fh-convite-acao svg[fill="#fff"] { fill: #0F172A; }
@media (max-width: 600px) { .fh-convite { padding: 10px 38px 10px 10px; gap: 10px; flex-wrap: nowrap; } .fh-convite-logo { width: 40px; height: 40px; } }
`;

function sistemaDoAparelho(): Sistema {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "computador";
}

function IconeDaPlay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#34A853" d="M3.6 1.8 13.5 12l-9.9 10.2c-.4-.2-.6-.7-.6-1.2V3c0-.5.2-1 .6-1.2Z" />
      <path fill="#FBBC04" d="m16.8 15.3-3.3-3.3 3.3-3.3 3.7 2.1c1 .6 1 1.9 0 2.4l-3.7 2.1Z" />
      <path fill="#4285F4" d="M16.8 15.3 13.5 12l-9.9 10.2c.4.2.9.2 1.4-.1l11.8-6.8Z" />
      <path fill="#EA4335" d="M16.8 8.7 5 1.9c-.5-.3-1-.3-1.4-.1L13.5 12l3.3-3.3Z" />
    </svg>
  );
}

function IconeDaApple() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="#fff">
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z" />
    </svg>
  );
}

const botao: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 10,
  background: "#000", color: "#fff", textDecoration: "none", fontWeight: 800, fontSize: "0.8rem",
  border: "1px solid rgba(255,255,255,.25)", whiteSpace: "nowrap",
};

export default function ConviteDoApp({
  lojaId,
  slug,
  nomeDaLoja,
  logo,
  android,
  ios,
}: {
  lojaId: string;
  slug: string;
  nomeDaLoja: string;
  logo?: string | null;
  android: string | null;
  ios: string | null;
}) {
  const [sistema, setSistema] = useState<Sistema | null>(null);
  const [fechado, setFechado] = useState(true);
  const [qr, setQr] = useState<string | null>(null);
  const chave = `fh_convite_app_fechado:${lojaId}`;

  useEffect(() => {
    // Dentro do próprio app não faz sentido convidar a baixar.
    if (/\bFireHubApp\/\d/.test(navigator.userAgent) || (window as any).ReactNativeWebView) return;
    setSistema(sistemaDoAparelho());
    try {
      const quando = Number(localStorage.getItem(chave) || 0);
      setFechado(quando > 0 && Date.now() - quando < DIAS_FECHADO * 86_400_000);
    } catch {
      setFechado(false);
    }
  }, [chave]);

  useEffect(() => {
    if (sistema !== "computador" || fechado) return;
    let vivo = true;
    import("qrcode")
      .then((m) => m.toDataURL(`${window.location.origin}/baixe-o-app/${slug}`, { margin: 1, width: 168 }))
      .then((url) => { if (vivo) setQr(url); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [sistema, fechado, slug]);

  if (!sistema || fechado) return null;
  const mostrarAndroid = !!android && sistema !== "ios";
  const mostrarIos = !!ios && sistema !== "android";
  if (!mostrarAndroid && !mostrarIos) return null;

  const fechar = () => {
    setFechado(true);
    try { localStorage.setItem(chave, String(Date.now())); } catch {}
  };

  // No celular há um botão só (o da loja do aparelho): o cartão inteiro vira o
  // link e fica baixo (~70 px). No computador, os dois botões e o QR.
  const linkDoCelular = sistema === "android" ? android : sistema === "ios" ? ios : null;

  return (
    <div style={{ maxWidth: 1200, margin: "12px auto 0", padding: "0 12px", boxSizing: "border-box" }}>
      <style>{CSS}</style>
      <div className="fh-convite">
        <button type="button" onClick={fechar} aria-label="Fechar o convite do aplicativo" className="fh-convite-x">
          <X size={14} />
        </button>
        <span className="fh-convite-logo">
          {logo ? <img src={logo} alt="" /> : <Smartphone size={22} color="#0F172A" />}
        </span>
        {linkDoCelular ? (
          <a href={linkDoCelular} target="_blank" rel="noopener noreferrer" className="fh-convite-texto fh-convite-link">
            <span className="fh-convite-titulo">Baixe o app e ganhe descontos exclusivos</span>
            <span className="fh-convite-acao">{sistema === "android" ? <IconeDaPlay /> : <IconeDaApple />} Baixar</span>
          </a>
        ) : (
          <>
            <span className="fh-convite-texto">
              <span className="fh-convite-selo">Novo · app {nomeDaLoja}</span>
              <span className="fh-convite-titulo">Baixe o app e ganhe descontos exclusivos</span>
              <span className="fh-convite-sub">Peça mais rápido e acompanhe a entrega no celular.</span>
            </span>
            <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {mostrarAndroid && (
                <a href={android!} target="_blank" rel="noopener noreferrer" style={botao}>
                  <IconeDaPlay /> Google Play
                </a>
              )}
              {mostrarIos && (
                <a href={ios!} target="_blank" rel="noopener noreferrer" style={botao}>
                  <IconeDaApple /> App Store
                </a>
              )}
              {qr && (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <img src={qr} alt="QR para baixar o aplicativo" width={64} height={64} style={{ borderRadius: 8, background: "#fff", padding: 3 }} />
                  <span style={{ fontSize: "0.72rem", opacity: 0.75, maxWidth: 92, lineHeight: 1.25 }}>Aponte a câmera do celular</span>
                </span>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
