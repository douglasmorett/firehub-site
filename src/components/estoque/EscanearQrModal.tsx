"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, Keyboard, ArrowRight, ScanLine } from "lucide-react";

/**
 * O leitor de QR dentro do painel.
 *
 * Até aqui o único jeito de escanear era abrir o aplicativo de câmera do
 * celular e apontar — o que funciona, e é o caminho principal na cozinha. Só
 * que ninguém descobria isso: nenhuma tela do sistema dizia que a etiqueta
 * impressa vira entrada de estoque, e quem estava no computador do balcão com
 * a caixa na mão não tinha o que fazer.
 *
 * O campo de digitação fica SEMPRE visível, e não escondido atrás de "tive um
 * problema": câmera de tablet velho não foca em QR de 20 mm sujo de gordura, e
 * o código impresso embaixo do símbolo existe exatamente para esse caso.
 */

const ID_DA_CAIXA = "fh-leitor-qr";

export default function EscanearQrModal({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const [erroCamera, setErroCamera] = useState("");
  const [digitado, setDigitado] = useState("");
  const [ligando, setLigando] = useState(true);
  const leitorRef = useRef<any>(null);

  const irParaOLote = (codigo: string) => {
    const limpo = String(codigo || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!limpo) return;
    // Sempre em maiúsculo: é assim que o código é impresso e é assim que a rota
    // o normaliza. E `location.assign` em vez de router.push de propósito — a
    // tela do lote resolve o estado no servidor, e uma navegação de verdade
    // garante que ela nunca abra com dado velho de cache do cliente.
    window.location.assign(`/e/${limpo}`);
  };

  useEffect(() => {
    if (!aberto) return;

    let vivo = true;
    setErroCamera("");
    setLigando(true);

    // Rede de segurança: em alguns aparelhos o `start` nunca resolve e nunca
    // rejeita — a permissão fica pendurada, ou não existe câmera nenhuma. Sem
    // isto a tela ficava para sempre em "Abrindo a câmera...", e quem está com
    // a caixa na mão não tem como saber que existe outro caminho.
    const desistir = setTimeout(() => {
      if (!vivo) return;
      setLigando(false);
      setErroCamera("A câmera está demorando para abrir. Digite o código impresso embaixo do QR — funciona igual.");
    }, 6000);

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!vivo) return;

        const leitor = new Html5Qrcode(ID_DA_CAIXA);
        leitorRef.current = leitor;

        await leitor.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (texto: string) => {
            // O QR carrega a URL inteira (https://HOST/E/CODIGO). Pegar só o
            // que vem depois da última barra faz o leitor funcionar tanto com
            // a etiqueta nova quanto com um código digitado à mão.
            const pedaco = String(texto).trim().split("/").filter(Boolean).pop() || "";
            leitor.stop().catch(() => {});
            irParaOLote(pedaco);
          },
          () => {
            // Cada quadro sem QR chama isto. Silêncio de propósito: logar aqui
            // enche o console a 10 por segundo.
          },
        );
        clearTimeout(desistir);
        if (vivo) setLigando(false);
      } catch (e: any) {
        clearTimeout(desistir);
        if (!vivo) return;
        setLigando(false);
        // A causa quase sempre é uma destas três, e cada uma tem uma saída
        // diferente — por isso a mensagem não pode ser "erro ao abrir a câmera".
        setErroCamera(
          String(e?.message || "").toLowerCase().includes("permission") || String(e?.name || "").includes("NotAllowed")
            ? "A câmera está bloqueada para este site. Libere no cadeado ao lado do endereço e tente de novo — ou digite o código abaixo."
            : "Não consegui abrir a câmera deste aparelho. Use o campo abaixo para digitar o código que está impresso embaixo do QR.",
        );
      }
    })();

    return () => {
      vivo = false;
      clearTimeout(desistir);
      const l = leitorRef.current;
      // Sem parar o leitor, a luz da câmera fica acesa depois de fechar o modal
      // — e no tablet da cozinha isso come bateria a tarde inteira.
      if (l) l.stop().then(() => l.clear()).catch(() => {});
      leitorRef.current = null;
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div
      onClick={aoFechar}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)",
        display: "grid", placeItems: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fh-card"
        style={{ width: "min(480px, 100%)", maxHeight: "92vh", overflowY: "auto", boxShadow: "var(--fh-e-modal)" }}
      >
        <div className="fh-card__head" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ScanLine size={20} style={{ color: "var(--fh-marca)" }} />
            <h2 className="fh-h2">Escanear etiqueta</h2>
          </div>
          <button className="fh-btn fh-btn--fantasma fh-btn--icone" onClick={aoFechar} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="fh-card__body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p className="fh-corpo">
            Aponte para o QR impresso na etiqueta. A tela que abrir já diz o que fazer: se o produto ainda não
            entrou no estoque, ela oferece <strong>dar entrada</strong>; se já está lá, oferece <strong>dar
            baixa</strong>.
          </p>

          <div
            style={{
              position: "relative", borderRadius: "var(--fh-r4)", overflow: "hidden",
              background: "var(--fh-t1)", minHeight: 260, display: "grid", placeItems: "center",
            }}
          >
            <div id={ID_DA_CAIXA} style={{ width: "100%" }} />
            {(ligando || erroCamera) && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", gap: 8, padding: 20, textAlign: "center", color: "#FFF" }}>
                <Camera size={28} />
                <div style={{ font: "700 14px/1.5 Inter, system-ui, sans-serif" }}>
                  {erroCamera || "Abrindo a câmera…"}
                </div>
              </div>
            )}
          </div>

          {/* Sempre visível, nunca escondido atrás de "tive um problema": é o
              caminho que salva quando o QR está sujo de gordura ou molhado. */}
          <div className="fh-campo">
            <label htmlFor="codigo-digitado">
              <Keyboard size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Ou digite o código impresso embaixo do QR
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="codigo-digitado"
                value={digitado}
                onChange={(e) => setDigitado(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") irParaOLote(digitado); }}
                placeholder="Ex.: K7F2M9QX"
                autoComplete="off"
                spellCheck={false}
                style={{ flex: 1, fontFamily: "monospace", letterSpacing: "0.08em" }}
              />
              <button className="fh-btn fh-btn--primario" onClick={() => irParaOLote(digitado)} disabled={!digitado.trim()}>
                Abrir <ArrowRight size={18} />
              </button>
            </div>
            <span className="fh-campo__dica">
              São 8 caracteres. O código também sai escrito em letras logo abaixo do quadradinho.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
