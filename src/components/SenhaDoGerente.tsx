"use client";
/**
 * O PEDIDO DA SENHA DO GERENTE na tela (regra em lib/senha-do-gerente-regras.ts).
 *
 * Quem decide se a senha é pedida é o SERVIDOR: a tela tenta a ação; se a rota
 * responde "pede a senha do gerente" (403 SENHA_DO_GERENTE_PEDIDA) ou "senha
 * errada", este modal abre, o gerente digita e a mesma requisição vai de novo
 * com a senha no cabeçalho. Assim nenhuma tela precisa saber de antemão o que
 * está ligado — e uma aba velha, aberta antes de o dono ligar o interruptor,
 * também cai no pedido em vez de passar direto.
 *
 *   const { pedirSenha, modalDaSenha } = useSenhaDoGerente();
 *   const res = await comSenhaDoGerente((cab) => fetch(url, { headers: cab, ... }), pedirSenha);
 *   if (!res) return;                       // o gerente cancelou
 *   ...                                      // segue como qualquer Response
 *   return <>{...}{modalDaSenha}</>;
 *
 * Nada de prompt(): o campo é de senha (com olhinho), o erro aparece no próprio
 * modal e o teclado do tablet abre no campo.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CABECALHO_DA_SENHA, CODIGO_SENHA_ERRADA, CODIGO_SENHA_PEDIDA,
} from "@/lib/senha-do-gerente-regras";

export type PedidoDeSenha = { titulo: string; detalhe?: string; erro?: string };
export type PedirSenha = (pedido: PedidoDeSenha) => Promise<string | null>;

/**
 * Faz a requisição e, se o servidor pedir a senha do gerente, pede e repete.
 * Devolve a resposta final (inclusive a de erro, para quem chama mostrar) ou
 * null se o gerente cancelou. `fazer` recebe os cabeçalhos a juntar.
 */
export async function comSenhaDoGerente(
  fazer: (cabecalhos: Record<string, string>) => Promise<Response>,
  pedirSenha: PedirSenha,
): Promise<Response | null> {
  let res = await fazer({});
  // Volta enquanto o servidor recusar a senha; trancada (429) ou qualquer
  // outro erro sai do laço e vai para quem chamou, com a mensagem do servidor.
  for (let voltas = 0; voltas < 10 && res.status === 403; voltas++) {
    const dados = await res.clone().json().catch(() => null);
    if (dados?.codigo !== CODIGO_SENHA_PEDIDA && dados?.codigo !== CODIGO_SENHA_ERRADA) break;
    const senha = await pedirSenha({
      titulo: "🔒 Senha do gerente",
      detalhe: dados?.codigo === CODIGO_SENHA_PEDIDA ? String(dados?.error || "Esta ação pede a senha do gerente.") : undefined,
      erro: dados?.codigo === CODIGO_SENHA_ERRADA ? String(dados?.error || "Senha errada.") : undefined,
    });
    if (senha === null) return null;
    res = await fazer({ [CABECALHO_DA_SENHA]: encodeURIComponent(senha) });
  }
  return res;
}

/** O modal e a função que o abre (e espera a senha). */
export function useSenhaDoGerente(): { pedirSenha: PedirSenha; modalDaSenha: ReactNode } {
  const [pedido, setPedido] = useState<(PedidoDeSenha & { responder: (s: string | null) => void }) | null>(null);
  const pedirSenha = useCallback<PedirSenha>(
    (p) => new Promise<string | null>((responder) => setPedido({ ...p, responder })),
    [],
  );
  const responder = (s: string | null) => {
    pedido?.responder(s);
    setPedido(null);
  };
  const modalDaSenha = pedido ? <ModalDaSenha pedido={pedido} onResponder={responder} /> : null;
  return { pedirSenha, modalDaSenha };
}

function ModalDaSenha({ pedido, onResponder }: { pedido: PedidoDeSenha; onResponder: (s: string | null) => void }) {
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => { campo.current?.focus(); }, []);
  const confirmar = () => { if (senha.length > 0) onResponder(senha); };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={pedido.titulo}
      onClick={() => onResponder(null)}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 22, width: "100%", maxWidth: 380, boxShadow: "0 20px 60px rgba(0,0,0,.3)", fontFamily: "inherit" }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 900, color: "#0F172A" }}>{pedido.titulo}</h3>
        {pedido.detalhe && <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "#475569", lineHeight: 1.45 }}>{pedido.detalhe}</p>}
        {pedido.erro && (
          <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", padding: "8px 12px", borderRadius: 10, fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
            {pedido.erro}
          </div>
        )}
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input
            ref={campo}
            type={ver ? "text" : "password"}
            value={senha}
            autoComplete="off"
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmar(); if (e.key === "Escape") onResponder(null); }}
            placeholder="Digite a senha do gerente"
            aria-label="Senha do gerente"
            style={{ width: "100%", boxSizing: "border-box", padding: "12px 44px 12px 14px", borderRadius: 12, border: "1.5px solid #CBD5E1", fontSize: 16, fontFamily: "inherit", outline: "none" }}
          />
          <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: 6 }}>
            {ver ? "🙈" : "👁️"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => onResponder(null)}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1.5px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={senha.length === 0}
            style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: senha.length ? "#C92E09" : "#CBD5E1", color: "#fff", fontWeight: 800, fontSize: 14, cursor: senha.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
            Autorizar
          </button>
        </div>
      </div>
    </div>
  );
}
