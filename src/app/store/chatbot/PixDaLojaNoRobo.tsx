"use client";

/**
 * A chave Pix da loja que o robô manda ao cliente (lib/pix-da-loja.ts).
 * Grava só `pixDaLoja` em /api/chatbot/config — a rota confere de novo e
 * devolve `erroDoPix` quando recusa.
 */
import { useEffect, useState } from "react";
import { reconhecerChavePix, nomeDoTipoDeChave, type PixDaLoja } from "@/lib/pix-da-loja";

type Props = {
  valor: PixDaLoja | null | undefined;
  onSalvo: (pix: PixDaLoja | null) => void;
  avisar: (mensagem: string, cor: string) => void;
};

const campo: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: "8px",
  border: "1px solid #CBD5E1", fontSize: "0.85rem", boxSizing: "border-box", background: "#fff",
};
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.76rem", fontWeight: 700, color: "#475569", marginBottom: "4px" };

export default function PixDaLojaNoRobo({ valor, onSalvo, avisar }: Props) {
  const [chave, setChave] = useState(valor?.chave || "");
  const [titular, setTitular] = useState(valor?.titular || "");
  const [banco, setBanco] = useState(valor?.banco || "");
  const [salvando, setSalvando] = useState(false);

  // A config chega depois do primeiro render (fetch da tela).
  useEffect(() => {
    setChave(valor?.chave || "");
    setTitular(valor?.titular || "");
    setBanco(valor?.banco || "");
  }, [valor?.chave, valor?.titular, valor?.banco]);

  const reconhecida = chave.trim() ? reconhecerChavePix(chave) : null;
  const mudou = chave !== (valor?.chave || "") || titular !== (valor?.titular || "") || banco !== (valor?.banco || "");

  const gravar = async (pix: { chave: string; titular: string; banco: string } | null) => {
    setSalvando(true);
    try {
      const res = await fetch("/api/chatbot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pixDaLoja: pix }),
      });
      const retorno = await res.json().catch(() => ({}));
      if (!res.ok || retorno?.erroDoPix) {
        avisar(`⚠️ ${retorno?.erroDoPix || retorno?.error || "Não foi possível salvar a chave Pix"}`, "#C92E09");
        return;
      }
      const salvo: PixDaLoja | null = retorno?.config?.pixDaLoja || null;
      onSalvo(salvo);
      avisar(salvo ? "✅ Chave Pix salva! O robô já passa a enviar." : "Chave Pix removida do robô.", "#0F766E");
    } catch {
      avisar("⚠️ Falha ao salvar a chave Pix", "#C92E09");
    } finally {
      setSalvando(false);
    }
  };

  const salvar = () => {
    if (!reconhecida || "erro" in reconhecida) {
      avisar(`⚠️ ${reconhecida && "erro" in reconhecida ? reconhecida.erro : "Digite a chave Pix."}`, "#C92E09");
      return;
    }
    if (!titular.trim()) {
      avisar("⚠️ Digite o nome que aparece no banco (titular da conta).", "#C92E09");
      return;
    }
    gravar({ chave, titular, banco });
  };

  return (
    <div style={{ marginBottom: "1.25rem", padding: "14px", background: "#F0FDFA", borderRadius: "14px", border: "1.5px solid #99F6E4" }}>
      <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0F172A" }}>
        💠 Chave Pix da loja no robô
      </div>
      <p style={{ fontSize: "0.76rem", color: "#334155", marginTop: "4px", lineHeight: 1.45 }}>
        Quando o cliente pedir a chave, ou fechar o pedido pagando no Pix, o robô manda a <strong>sua</strong> chave
        numa mensagem separada, pronta para copiar e colar. O dinheiro cai direto na sua conta, sem taxa.
        <br />
        <strong>Quem confere o pagamento é você</strong>, no app do banco: o robô pede o comprovante e nunca diz que o Pix foi recebido.
      </p>

      <div style={{ display: "grid", gap: "10px", marginTop: "12px" }}>
        <div>
          <label style={rotulo} htmlFor="pix-chave">Chave Pix</label>
          <input
            id="pix-chave"
            type="text"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória"
            autoComplete="off"
            style={campo}
          />
          {reconhecida && (
            <div style={{ fontSize: "0.72rem", marginTop: "4px", fontWeight: 600, color: "erro" in reconhecida ? "#C92E09" : "#0F766E" }}>
              {"erro" in reconhecida
                ? reconhecida.erro
                : `✓ Reconhecida como ${nomeDoTipoDeChave(reconhecida.tipo)}: ${reconhecida.chave}`}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
          <div>
            <label style={rotulo} htmlFor="pix-titular">Nome do titular (como aparece no banco)</label>
            <input id="pix-titular" type="text" value={titular} onChange={(e) => setTitular(e.target.value)} placeholder="Ex: Pizzaria do João LTDA" maxLength={80} autoComplete="off" style={campo} />
          </div>
          <div>
            <label style={rotulo} htmlFor="pix-banco">Banco (opcional)</label>
            <input id="pix-banco" type="text" value={banco} onChange={(e) => setBanco(e.target.value)} placeholder="Ex: Nubank" maxLength={40} autoComplete="off" style={campo} />
          </div>
        </div>
      </div>

      {/* O que o cliente recebe, para o lojista não ter que adivinhar. */}
      {reconhecida && !("erro" in reconhecida) && (
        <div style={{ marginTop: "12px", padding: "10px", background: "#E7F0E9", borderRadius: "10px", display: "grid", gap: "6px" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#475569" }}>O cliente recebe, ao fechar o pedido no Pix:</div>
          <div style={{ background: "#fff", borderRadius: "8px", padding: "8px 10px", fontSize: "0.76rem", color: "#1C1917", whiteSpace: "pre-line", maxWidth: "320px" }}>
            {`💠 Pagamento no Pix: R$ 45,90\nA chave (${nomeDoTipoDeChave(reconhecida.tipo)}) vai na mensagem abaixo, é só copiar e colar.\nEm nome de: ${titular.trim() || "…"}${banco.trim() ? ` · ${banco.trim()}` : ""}\nDepois de pagar, manda o comprovante aqui, por favor 😊`}
          </div>
          <div style={{ background: "#fff", borderRadius: "8px", padding: "8px 10px", fontSize: "0.8rem", fontWeight: 700, color: "#1C1917", width: "fit-content", maxWidth: "100%", overflowWrap: "anywhere" }}>
            {reconhecida.chave}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
        <button
          onClick={salvar}
          disabled={salvando || !mudou}
          style={{
            padding: "8px 16px", borderRadius: "8px", border: "none",
            background: salvando || !mudou ? "#CBD5E1" : "#0F766E", color: "#fff",
            fontWeight: 800, fontSize: "0.8rem", cursor: salvando || !mudou ? "default" : "pointer",
          }}
        >
          {salvando ? "Salvando..." : valor ? "Salvar alteração" : "Salvar chave Pix"}
        </button>
        {valor && (
          <button
            onClick={() => gravar(null)}
            disabled={salvando}
            style={{
              padding: "8px 16px", borderRadius: "8px", border: "1px solid #E2E8F0",
              background: "#fff", color: "#C92E09", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer",
            }}
          >
            Remover chave
          </button>
        )}
      </div>
    </div>
  );
}
