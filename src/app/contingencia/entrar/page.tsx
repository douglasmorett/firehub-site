"use client";

/**
 * /contingencia/entrar — a porta de entrada no computador da loja durante uma
 * queda (Modo Contingência).
 *
 * A tela que estava na nuvem chega aqui com o bilhete DELA no fragmento do
 * endereço (#bilhete=...&volta=/store/...): o bilhete que a própria sessão
 * desta tela pediu à nuvem enquanto havia internet. Só reabre a mesma conta,
 * com as mesmas permissões. Fragmento porque não vai para servidor nenhum
 * nem fica em log: só este JavaScript lê, entrega ao FireHub local e apaga.
 *
 * A tela pode chegar uns segundos ANTES de o computador declarar a
 * contingência (cada lado conta as falhas no seu relógio): espera a porta da
 * loja confirmar; se ela disser que a nuvem está de pé, volta para a nuvem.
 */
import { useEffect, useState } from "react";

function destinoSeguro(volta: string | null): string {
  const v = String(volta || "");
  return v.startsWith("/") && !v.startsWith("//") ? v : "/store/pedidos-clientes";
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function EntrarNaContingencia() {
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("Sem conexão com o FireHub. Entrando no computador da loja…");

  useEffect(() => {
    const parametros = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const bilhete = parametros.get("bilhete") || "";
    const volta = destinoSeguro(parametros.get("volta"));
    history.replaceState(null, "", window.location.pathname);
    if (!bilhete) {
      setErro("Esta tela não trouxe a autorização da contingência.");
      return;
    }
    let vivo = true;
    (async () => {
      for (let i = 0; i < 45 && vivo; i++) {
        try {
          const e = await (await fetch("/__contingencia/estado", { cache: "no-store" })).json();
          if (e?.modo === "contingencia" || e?.modo === "voltando") break;
          if (e?.modo === "normal" && e?.nuvem) {
            setAviso("A conexão voltou. Voltando ao FireHub…");
            window.location.replace(`${e.nuvem}${volta}`);
            return;
          }
          setAviso("Conectando ao computador da loja…");
        } catch {
          /* a porta da loja respondendo devagar */
        }
        await espera(2000);
      }
      const r = await fetch("/api/contingencia/entrar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bilhete }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Não foi possível entrar.");
      window.location.replace(volta);
    })().catch((e) => vivo && setErro(e?.message || "Não foi possível entrar."));
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0f172a", color: "#f8fafc", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛟</div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Modo Contingência</h1>
        <p style={{ color: erro ? "#fca5a5" : "#cbd5e1", margin: 0 }}>{erro || aviso}</p>
      </div>
    </main>
  );
}
