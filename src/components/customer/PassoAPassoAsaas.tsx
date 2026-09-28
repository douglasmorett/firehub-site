/**
 * O passo a passo VISUAL de Integrações → Asaas: um print ou desenho por
 * passo, quase nada para ler (o dono pediu em 28/09/2026 — "as pessoas não
 * gostam de ler").
 *
 * Passo 1 é print de verdade da página de chaves do Asaas (saldo e nomes de
 * chave borrados): public/images/asaas/passo-1-gerar-chave.webp. Os passos 2 e
 * 3 são desenhos esquemáticos, de propósito genéricos: o formulário do Asaas
 * muda de cara de vez em quando, e o que o lojista precisa é saber O QUE fazer
 * (nome, sem expiração, copiar), não achar um botão idêntico.
 */
import type { CSSProperties, ReactNode } from "react";
import { ExternalLink, KeyRound, Copy, MousePointerClick } from "lucide-react";

export const URL_DAS_CHAVES_NO_ASAAS = "https://www.asaas.com/customerApiAccessToken/index";

/** Etiqueta de "é aqui", apontando para o que clicar. */
function Destaque({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#E8360C", color: "#FFF", fontSize: 10.5, fontWeight: 900, padding: "3px 8px", borderRadius: 999, boxShadow: "0 3px 10px rgba(232,54,12,0.35)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const moldura: CSSProperties = {
  background: "#FFF",
  border: "1px solid #CBD5E1",
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
  width: "100%",
  maxWidth: 340,
  boxSizing: "border-box",
  textAlign: "left",
};

const campo: CSSProperties = {
  border: "1.5px solid #CBD5E1",
  borderRadius: 8,
  padding: "7px 9px",
  fontSize: 11,
  color: "#0F172A",
  background: "#FFF",
};

/** Passo 2: o formulário da chave — nome e SEM data de expiração. */
export function FormularioDaChave() {
  return (
    <div style={moldura}>
      <div style={{ fontWeight: 800, fontSize: 12, color: "#0F172A", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <KeyRound size={14} color="#0030B9" /> Gerar chave de API
      </div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#64748B", marginBottom: 3 }}>Nome da chave</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9 }}>
        <div style={{ ...campo, flex: 1, borderColor: "#0030B9" }}>FireHub</div>
        <Destaque>escreva FireHub</Destaque>
      </div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#64748B", marginBottom: 3 }}>Data de expiração</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 11 }}>
        <div style={{ ...campo, flex: 1, color: "#94A3B8" }}>dd/mm/aaaa</div>
        <Destaque>deixe vazio</Destaque>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        <Destaque>
          <MousePointerClick size={11} /> clique
        </Destaque>
        <span style={{ background: "#0030B9", color: "#FFF", fontWeight: 800, fontSize: 11, padding: "6px 12px", borderRadius: 8, outline: "3px solid #F59E0B", outlineOffset: 2 }}>
          Gerar chave
        </span>
      </div>
    </div>
  );
}

/** Passo 3: a chave aparece UMA vez — copiar. */
export function ChaveParaCopiar() {
  return (
    <div style={moldura}>
      <div style={{ fontWeight: 800, fontSize: 12, color: "#0F172A", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <KeyRound size={14} color="#0030B9" /> Sua chave de API
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ ...campo, flex: 1, fontFamily: "monospace", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>
          $aact_prod_••••••••••••••••
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#0030B9", color: "#FFF", fontWeight: 800, fontSize: 11, padding: "6px 10px", borderRadius: 8, outline: "3px solid #F59E0B", outlineOffset: 2, flexShrink: 0 }}>
          <Copy size={12} /> Copiar
        </span>
      </div>
      <div style={{ marginTop: 9, display: "flex", justifyContent: "flex-end" }}>
        <Destaque>aparece uma vez só</Destaque>
      </div>
    </div>
  );
}

/** Um passo: número grande, título curto, a imagem e (opcional) uma ação. */
export function Passo({ n, titulo, children, acao }: { n: number; titulo: ReactNode; children?: ReactNode; acao?: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 10, alignItems: "start", padding: "12px 0", borderTop: n > 1 ? "1px dashed #E2E8F0" : "none" }}>
      <div style={{ width: 30, height: 30, borderRadius: 999, background: "#0030B9", color: "#FFF", fontWeight: 900, fontSize: 15, display: "grid", placeItems: "center" }}>{n}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", marginBottom: children || acao ? 8 : 0, lineHeight: 1.35 }}>{titulo}</div>
        {acao && <div style={{ marginBottom: children ? 10 : 0 }}>{acao}</div>}
        {children}
      </div>
    </div>
  );
}

/** Os passos 1 a 3 (no Asaas). O 4 — colar e conectar — é o formulário da tela. */
export default function PassosNoAsaas() {
  return (
    <>
      <Passo
        n={1}
        titulo={<>No Asaas, clique em <span style={{ color: "#0030B9" }}>Gerar chave de API</span></>}
        acao={
          <a
            href={URL_DAS_CHAVES_NO_ASAAS}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: "#0030B9", color: "#FFF", fontWeight: 800, fontSize: "0.84rem", textDecoration: "none" }}
          >
            <ExternalLink size={15} /> Abrir a página no Asaas
          </a>
        }
      >
        {/* No celular a página inteira fica ilegível: lá vai o recorte do botão. */}
        <picture>
          <source media="(max-width: 640px)" srcSet="/images/asaas/passo-1-botao.webp" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/asaas/passo-1-gerar-chave.webp"
            alt="Página Chaves de API do Asaas, com o botão Gerar chave de API destacado"
            loading="lazy"
            style={{ width: "100%", maxWidth: 560, height: "auto", borderRadius: 10, border: "1px solid #E2E8F0", boxShadow: "0 8px 22px rgba(15,23,42,0.08)", display: "block" }}
          />
        </picture>
      </Passo>
      <Passo n={2} titulo="Nome: FireHub. Sem data de expiração. Gere a chave.">
        <FormularioDaChave />
        <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 6 }}>O Asaas pode pedir um código de segurança (SMS ou app) para confirmar.</div>
      </Passo>
      <Passo n={3} titulo="Copie a chave">
        <ChaveParaCopiar />
      </Passo>
    </>
  );
}
