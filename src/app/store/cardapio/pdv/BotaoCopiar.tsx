"use client";
import { useState } from "react";

/**
 * Copia o Código PDV para colar no campo do iFood. `navigator.clipboard` só
 * existe em HTTPS/localhost e em aba com foco; fora disso cai no
 * `execCommand("copy")` com um textarea escondido, que o Chrome antigo do
 * balcão ainda aceita.
 */
export default function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        const ta = document.createElement("textarea");
        ta.value = texto;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      window.prompt("Copie o código:", texto);
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      className="btn btn-outline"
      style={{ fontSize: "0.8rem", padding: "4px 10px", fontWeight: 700, color: copiado ? "#15803D" : "#334155", borderColor: copiado ? "#86EFAC" : "#CBD5E1", minWidth: 84 }}
    >
      {copiado ? "Copiado ✓" : "Copiar"}
    </button>
  );
}
