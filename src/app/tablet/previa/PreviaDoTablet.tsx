"use client";

/**
 * A prévia do tablet: o mesmo cardápio da mesa (CustomerStorePage com
 * `mesa.tablet`), com a vitrine que o painel manda a cada mudança
 * ({ tipo: "fh-vitrine-do-tablet", vitrine, foco }), antes de salvar.
 */
import { useEffect, useState, type ComponentProps } from "react";
import CustomerStorePage from "@/components/customer/CustomerStorePage";
import css from "@/components/customer/CardapioDoTablet.module.css";
import { limparVitrine, type VitrineDoTablet } from "@/lib/tablet-da-mesa/vitrine";

export default function PreviaDoTablet({ cardapio, vitrine: salva }: {
  cardapio: Omit<ComponentProps<typeof CustomerStorePage>, "mesa">;
  vitrine: VitrineDoTablet;
}) {
  const [vitrine, setVitrine] = useState(salva);
  const [foco, setFoco] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.tipo !== "fh-vitrine-do-tablet") return;
      setVitrine(limparVitrine(e.data.vitrine));
      setFoco(typeof e.data.foco === "number" ? e.data.foco : null);
      if (typeof e.data.foco === "number") window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("message", ouvir);
    // Pronta: o painel manda o rascunho que já tiver.
    window.parent?.postMessage({ tipo: "fh-previa-do-tablet-pronta" }, window.location.origin);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const acoes = (
    <>
      <button type="button" className={css.acao} onClick={() => setAviso("No tablet, este botão chama o garçom.")}>
        <span aria-hidden>🙋</span> Chamar garçom
      </button>
      <button type="button" className={`${css.acao} ${css.acaoContorno}`} onClick={() => setAviso("No tablet, aqui o cliente vê o que já consumiu e pede a conta.")}>
        <span aria-hidden>🧾</span> Minha conta
      </button>
    </>
  );

  return (
    <>
      <CustomerStorePage
        {...cardapio}
        mesa={{ codigo: "", mesaId: "previa", numero: 1, rotulo: null, mesas: [], tablet: { acoes, nomePadrao: "Mesa 1", vitrine, previa: true, bannerEmFoco: foco } }}
      />
      {aviso && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 10080, background: "#0F172A", color: "#fff", padding: "14px 22px", borderRadius: 14, fontSize: 18, fontWeight: 700 }}>
          {aviso}
        </div>
      )}
    </>
  );
}
