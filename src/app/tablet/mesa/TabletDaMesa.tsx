"use client";

/**
 * O tablet preso à mesa: o cardápio da mesa (CustomerStorePage no modo mesa,
 * que desenha o CardapioDoTablet) com "Chamar garçom" e "Minha conta" no topo
 * — e o que um aparelho que fica na mesa precisa:
 *  - sinal a cada 20 s (/api/tablet-mesa/estado): é também o uso cobrado;
 *  - conta fechou (o garçom fechou a mesa): limpa a sacola e recarrega, para o
 *    próximo cliente não ver o pedido do anterior;
 *  - tela de descanso depois de 3 min sem toque;
 *  - tela sempre acesa (Wake Lock, quando o navegador deixa);
 *  - tablet tirado no painel ou módulo desligado: sai do cardápio.
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import CustomerStorePage from "@/components/customer/CustomerStorePage";
import css from "@/components/customer/CardapioDoTablet.module.css";
import type { VitrineDoTablet } from "@/lib/tablet-da-mesa/vitrine";

type PropsDoCardapio = Omit<ComponentProps<typeof CustomerStorePage>, "mesa">;
type Conta = { aberta: boolean; total: number; itens: { nome: string; quantidade: number; valor: number }[] };
type Chamado = { motivo: "GARCOM" | "CONTA"; em: string } | null;

const SINAL_MS = 20_000;
const DESCANSO_MS = 3 * 60_000;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function TabletDaMesa({ cardapio, mesa, nomeDaLoja, logo, vitrine: vitrineInicial }: {
  cardapio: PropsDoCardapio;
  mesa: { codigo: string; mesaId: string; numero: number; rotulo: string | null };
  nomeDaLoja: string;
  logo: string | null;
  vitrine: VitrineDoTablet;
}) {
  const nomeDaMesa = mesa.rotulo || `Mesa ${mesa.numero}`;
  const [conta, setConta] = useState<Conta | null>(null);
  const [chamado, setChamado] = useState<Chamado>(null);
  const [verConta, setVerConta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [descanso, setDescanso] = useState(false);
  // A loja mexeu na vitrine no painel: chega no próximo sinal, sem recarregar.
  const [vitrine, setVitrine] = useState(vitrineInicial);
  const contaAbertaRef = useRef<boolean | null>(null);

  const limparParaOProximo = useCallback(() => {
    try {
      const chave = `fh_cart_mesa_${cardapio.franchisee.slug || cardapio.franchisee.id}`;
      localStorage.removeItem(chave);
    } catch { /* sem storage */ }
    window.location.reload();
  }, [cardapio.franchisee.slug, cardapio.franchisee.id]);

  const sinal = useCallback(async () => {
    try {
      const r = await fetch("/api/tablet-mesa/estado", { cache: "no-store" });
      if (r.status === 401) { window.location.replace("/tablet"); return; }
      const d = await r.json();
      if (d?.ligado === false) { window.location.reload(); return; }
      setConta(d.conta);
      setChamado(d.chamado ?? null);
      if (d.vitrine) setVitrine((v) => (JSON.stringify(v) === JSON.stringify(d.vitrine) ? v : d.vitrine));
      // A conta estava aberta e fechou: o próximo cliente começa do zero.
      if (contaAbertaRef.current === true && d.conta?.aberta === false) limparParaOProximo();
      contaAbertaRef.current = Boolean(d.conta?.aberta);
    } catch { /* sem internet: tenta no próximo */ }
  }, [limparParaOProximo]);

  useEffect(() => {
    void sinal();
    const i = setInterval(sinal, SINAL_MS);
    return () => clearInterval(i);
  }, [sinal]);

  // Tela sempre acesa.
  useEffect(() => {
    let trava: any = null;
    const pedir = async () => {
      try { trava = await (navigator as any).wakeLock?.request("screen"); } catch { /* navegador não deixa */ }
    };
    void pedir();
    const volta = () => { if (document.visibilityState === "visible") void pedir(); };
    document.addEventListener("visibilitychange", volta);
    return () => { document.removeEventListener("visibilitychange", volta); trava?.release?.().catch?.(() => {}); };
  }, []);

  // Tela de descanso.
  useEffect(() => {
    let timer = setTimeout(() => setDescanso(true), DESCANSO_MS);
    const mexeu = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setDescanso(true), DESCANSO_MS);
    };
    window.addEventListener("pointerdown", mexeu, { passive: true });
    window.addEventListener("keydown", mexeu);
    return () => { clearTimeout(timer); window.removeEventListener("pointerdown", mexeu); window.removeEventListener("keydown", mexeu); };
  }, []);

  async function chamar(motivo: "GARCOM" | "CONTA") {
    try {
      const r = await fetch("/api/tablet-mesa/chamar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ motivo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(d?.error || "Não deu para chamar agora. Acene para o garçom."); return; }
      setChamado({ motivo, em: new Date().toISOString() });
      setAviso(motivo === "CONTA" ? "Pronto! O garçom já vai trazer a sua conta." : "Pronto! O garçom já foi chamado.");
      setVerConta(false);
    } catch {
      setAviso("Sem internet. Acene para o garçom.");
    }
  }

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const acoes = (
    <>
      <button type="button" className={`${css.acao} ${chamado?.motivo === "GARCOM" ? css.acaoFeita : ""}`} onClick={() => void chamar("GARCOM")}>
        <span aria-hidden>🙋</span> {chamado?.motivo === "GARCOM" ? "Garçom a caminho" : "Chamar garçom"}
      </button>
      <button type="button" className={`${css.acao} ${css.acaoContorno}`} onClick={() => setVerConta(true)}>
        <span aria-hidden>🧾</span>
        <span className={css.acaoLinhas}>
          Minha conta
          {conta?.aberta && conta.total > 0 && <small>{reais(conta.total)}</small>}
        </span>
      </button>
    </>
  );

  return (
    <>
      <CustomerStorePage
        {...cardapio}
        mesa={{
          codigo: mesa.codigo,
          mesaId: mesa.mesaId,
          numero: mesa.numero,
          rotulo: mesa.rotulo,
          mesas: [],
          tablet: { acoes, nomePadrao: nomeDaMesa, vitrine, depoisDoPedido: () => void sinal() },
        }}
      />

      {aviso && <div role="status" style={S.aviso}>{aviso}</div>}

      {verConta && (
        <div role="dialog" aria-modal="true" aria-label="Minha conta" style={S.fundo} onClick={(e) => { if (e.target === e.currentTarget) setVerConta(false); }}>
          <div style={S.janela}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 22, color: "#0F172A" }}>Conta da {nomeDaMesa}</h2>
              <button type="button" onClick={() => setVerConta(false)} style={S.fechar} aria-label="Fechar">✕</button>
            </div>
            {!conta?.aberta || conta.itens.length === 0 ? (
              <p style={{ color: "#475569", margin: "16px 0" }}>Nenhum pedido nesta mesa ainda. Escolha no cardápio e envie: vai direto para a cozinha.</p>
            ) : (
              <div style={{ margin: "14px 0", maxHeight: "50vh", overflowY: "auto" }}>
                {conta.itens.map((i, k) => (
                  <div key={k} style={S.linha}>
                    <span>{i.quantidade}× {i.nome}</span>
                    <b style={{ whiteSpace: "nowrap" }}>{reais(i.valor)}</b>
                  </div>
                ))}
                <div style={{ ...S.linha, borderTop: "2px solid #0F172A", fontSize: 19, fontWeight: 900, marginTop: 6, paddingTop: 10 }}>
                  <span>Consumo até agora</span>
                  <span>{reais(conta.total)}</span>
                </div>
                <p style={{ fontSize: 13, color: "#64748B", margin: "8px 0 0" }}>Taxa de serviço e forma de pagamento são acertadas no fechamento com o garçom.</p>
              </div>
            )}
            <button type="button" style={{ ...S.botaoGrande, opacity: conta?.aberta ? 1 : 0.5 }} disabled={!conta?.aberta} onClick={() => void chamar("CONTA")}>
              {chamado?.motivo === "CONTA" ? "Conta já pedida · pedir de novo" : "Pedir a conta"}
            </button>
          </div>
        </div>
      )}

      {descanso && (
        <button type="button" style={S.descanso} onClick={() => { setDescanso(false); window.scrollTo({ top: 0 }); }} aria-label="Toque para ver o cardápio">
          {logo ? <img src={logo} alt="" style={{ width: 140, height: 140, borderRadius: 28, objectFit: "cover", background: "#fff" }} /> : <div style={{ fontSize: 80 }} aria-hidden>🍽️</div>}
          <div style={{ fontSize: 32, fontWeight: 900, marginTop: 18 }}>{nomeDaLoja}</div>
          <div style={{ fontSize: 22, opacity: 0.9, marginTop: 8 }}>Toque para ver o cardápio e pedir</div>
          <div style={{ fontSize: 16, opacity: 0.7, marginTop: 24 }}>{nomeDaMesa}</div>
        </button>
      )}
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  aviso: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 10080, background: "#0F172A", color: "#fff", padding: "14px 22px", borderRadius: 14, fontSize: 18, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,.3)", maxWidth: "90vw", textAlign: "center" },
  fundo: { position: "fixed", inset: 0, zIndex: 10070, background: "rgba(15,23,42,.6)", display: "grid", placeItems: "center", padding: 16 },
  janela: { background: "#fff", borderRadius: 22, width: "min(560px, 100%)", padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,.35)" },
  fechar: { width: 44, height: 44, borderRadius: 12, border: "1px solid #E2E8F0", background: "#fff", fontSize: 18, cursor: "pointer" },
  linha: { display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #F1F5F9", fontSize: 17, color: "#0F172A" },
  botaoGrande: { width: "100%", minHeight: 60, borderRadius: 16, border: 0, background: "#EA580C", color: "#fff", fontSize: 20, fontWeight: 900, cursor: "pointer" },
  descanso: { position: "fixed", inset: 0, zIndex: 10090, border: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg,#0B1220,#7C2D12)", color: "#fff", cursor: "pointer", fontFamily: "system-ui, sans-serif" },
};
