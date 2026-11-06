"use client";
import { useEffect, useState } from "react";
import BalcaoDeVenda from "@/components/balcao/BalcaoDeVenda";

/**
 * O lado de dentro da lateral do WhatsApp Web (ver page.tsx).
 *
 * ── O cliente vem da extensão, por postMessage ─────────────────────────────
 *
 * A extensão lê o contato aberto no WhatsApp Web e manda para esta moldura
 * `{ tipo: "firehub:contato", nome, telefone }`. Só se aceita mensagem:
 *   - da janela que emoldura esta (`event.source === window.parent`), e
 *   - vinda de uma página de extensão do Chrome (`chrome-extension://<id>`).
 * A extensão, do lado dela, só entrega para a origem do FireHub configurada
 * (targetOrigin). O que chega só PREENCHE nome e telefone — o atendente vê e
 * pode corrigir antes de finalizar; nada é gravado sem o clique dele.
 *
 * Sem a extensão (aberta direto no navegador), `?nome=` e `?telefone=` no
 * endereço fazem o mesmo — é como se testa no localhost.
 */

type Contato = { nome: string; telefone: string };

const ORIGEM_DA_EXTENSAO = /^chrome-extension:\/\/[a-p]{32}$/;

const limpar = (bruto: any): Contato | null => {
  if (!bruto || typeof bruto !== "object") return null;
  const nome = typeof bruto.nome === "string" ? bruto.nome.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const telefone = typeof bruto.telefone === "string" ? bruto.telefone.replace(/\D/g, "").slice(0, 15) : "";
  return nome || telefone ? { nome, telefone } : null;
};

const telefoneBonito = (t: string) => {
  const d = t.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
};

export default function PainelLateral({ estado }: { estado: "pronto" | "entrar" | "sem-permissao" }) {
  const [contato, setContato] = useState<Contato | null>(null);

  useEffect(() => {
    if (estado !== "pronto") return;
    const q = new URLSearchParams(window.location.search);
    const doEndereco = limpar({ nome: q.get("nome") || "", telefone: q.get("telefone") || "" });
    if (doEndereco) setContato(doEndereco);

    const aoReceber = (e: MessageEvent) => {
      if (e.source !== window.parent || !ORIGEM_DA_EXTENSAO.test(e.origin)) return;
      if (e.data?.tipo !== "firehub:contato") return;
      const novo = limpar(e.data);
      // Mesma pessoa de novo (o WhatsApp redesenha o cabeçalho o tempo todo):
      // não remonta o balcão, senão o carrinho piscaria a cada mensagem.
      setContato((atual) => (novo && atual && novo.nome === atual.nome && novo.telefone === atual.telefone ? atual : novo));
    };
    window.addEventListener("message", aoReceber);
    // Avisa a extensão que já dá para mandar o contato (a moldura carrega
    // depois de o WhatsApp já estar numa conversa). Sem dado nenhum dentro.
    if (window.parent !== window) window.parent.postMessage({ tipo: "firehub:pronto" }, "*");
    return () => window.removeEventListener("message", aoReceber);
  }, [estado]);

  if (estado !== "pronto") {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#F5F5F5", fontFamily: "'Inter', sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 14, padding: "22px 20px", textAlign: "center", maxWidth: 320, boxShadow: "0 4px 18px rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: "1.8rem" }}>🔥</div>
          {estado === "entrar" ? (
            <>
              <div style={{ fontWeight: 800, margin: "6px 0" }}>Entre no painel do FireHub</div>
              <div style={{ fontSize: "0.84rem", color: "#64748B", lineHeight: 1.5, marginBottom: 14 }}>
                O balcão usa o login do painel. Entre numa aba do Chrome e volte aqui.
              </div>
              <a href="/login?callbackUrl=/store" target="_blank" rel="noopener noreferrer"
                style={{ display: "block", padding: 11, borderRadius: 10, background: "#C92E09", color: "#fff", fontWeight: 800, textDecoration: "none", marginBottom: 8 }}>
                Entrar no painel ↗
              </a>
              <button type="button" onClick={() => window.location.reload()}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Já entrei — recarregar
              </button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, margin: "6px 0" }}>Sem acesso ao Balcão</div>
              <div style={{ fontSize: "0.84rem", color: "#64748B", lineHeight: 1.5 }}>
                O dono da loja libera em Configurações → Equipe, marcando o Balcão para você.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const chave = contato ? contato.telefone || contato.nome : "avulso";
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#fff", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ padding: "8px 12px", background: "#1C1917", color: "#fff", display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" }}>
        <span style={{ fontWeight: 900 }}>🔥 FireHub</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: contato ? "#BBF7D0" : "#A8A29E", fontWeight: 700 }}>
          {contato
            ? `📱 ${[contato.nome, contato.telefone ? telefoneBonito(contato.telefone) : ""].filter(Boolean).join(" · ")}`
            : "Abra uma conversa no WhatsApp"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <BalcaoDeVenda
          // Trocou de conversa no WhatsApp, troca o balcão: cada contato tem o
          // seu rascunho, e o carrinho de um não vai parar no pedido do outro.
          key={chave}
          modo="atendimento"
          cliente={contato}
          chaveDoRascunho={`firehub_lateral_rascunho:${chave}`}
        />
      </div>
    </div>
  );
}
