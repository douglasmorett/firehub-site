"use client";
/**
 * A aba "QR Code" do ⚙️ Gerenciar Mesas: o QR de cada mesa e o geral, para
 * baixar ou imprimir e colar na mesa.
 *
 * O cliente escaneia, abre o cardápio do salão e o pedido cai na conta da
 * mesa (app/loja/[slug]/mesa/[codigo], api/loja/mesa/pedido). Os links vêm
 * assinados do servidor (api/store/tables/qr): o QR de uma mesa não serve em
 * outra, nem em outra loja.
 *
 * O desenho é feito aqui, no navegador, com a lib `qrcode` (a mesma das
 * etiquetas): o PNG para baixar leva o nome da loja, "MESA 34" e a instrução;
 * "Imprimir todas" monta uma folha com um cartão por mesa.
 */
import { useEffect, useState } from "react";

type LinkDaMesa = { id: string; numero: number; rotulo: string | null; ativa: boolean; caminho: string };
type Links = { loja: string; geral: string; mesas: LinkDaMesa[] };

const INSTRUCAO = "Aponte a câmera do celular e peça por aqui";

async function qrLib() {
  return (await import("qrcode")).default;
}

/** O cartão em PNG: nome da loja, o QR, "MESA 34" e a instrução. */
async function cartaoEmPng(url: string, titulo: string, loja: string): Promise<string> {
  const QRCode = await qrLib();
  const L = 1200, A = 1560;
  const canvas = document.createElement("canvas");
  canvas.width = L; canvas.height = A;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, L, A);
  ctx.fillStyle = "#0F172A";
  ctx.textAlign = "center";
  ctx.font = "700 56px system-ui, sans-serif";
  ctx.fillText(loja.slice(0, 32), L / 2, 110);
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, { errorCorrectionLevel: "Q", width: 1000, margin: 2 });
  ctx.drawImage(qr, (L - 1000) / 2, 160, 1000, 1000);
  ctx.font = "900 120px system-ui, sans-serif";
  ctx.fillText(titulo.toUpperCase(), L / 2, 1320);
  ctx.font = "500 44px system-ui, sans-serif";
  ctx.fillStyle = "#475569";
  ctx.fillText(INSTRUCAO, L / 2, 1420);
  return canvas.toDataURL("image/png");
}

function baixar(dataUrl: string, arquivo: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const tituloDaMesa = (m: LinkDaMesa) => `Mesa ${m.numero}`;
const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export default function QrDasMesas() {
  const [links, setLinks] = useState<Links | null>(null);
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<string>("");
  const [ocupado, setOcupado] = useState<string>("");

  useEffect(() => {
    fetch("/api/store/tables/qr")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "Não deu para carregar os QR Codes.");
        setLinks(d);
        const QRCode = await qrLib();
        setPrevia(await QRCode.toDataURL(`${window.location.origin}${d.geral}`, { errorCorrectionLevel: "Q", width: 240, margin: 1 }));
      })
      .catch((e) => setErro(e.message || "Não deu para carregar os QR Codes."));
  }, []);

  const url = (caminho: string) => `${window.location.origin}${caminho}`;

  const baixarCartao = async (chave: string, caminho: string, titulo: string, arquivo: string) => {
    if (!links) return;
    setOcupado(chave);
    try {
      baixar(await cartaoEmPng(url(caminho), titulo, links.loja), arquivo);
    } finally {
      setOcupado("");
    }
  };

  const imprimirTodas = async () => {
    if (!links) return;
    // A janela abre já no clique (senão o navegador bloqueia como pop-up) e
    // recebe a folha quando os QRs ficam prontos.
    const janela = window.open("", "_blank");
    if (!janela) { setErro("O navegador bloqueou a janela de impressão. Libere pop-ups deste site e tente de novo."); return; }
    janela.document.write("<p style='font-family:sans-serif'>Montando os QR Codes…</p>");
    setOcupado("todas");
    try {
      const QRCode = await qrLib();
      const ativas = links.mesas.filter((m) => m.ativa);
      const cartoes = await Promise.all(ativas.map(async (m) => {
        const svg = await QRCode.toString(url(m.caminho), { type: "svg", errorCorrectionLevel: "Q", margin: 1 });
        return `<div class="c"><div class="l">${escapar(links.loja)}</div>${svg}<div class="m">${escapar(tituloDaMesa(m).toUpperCase())}</div><div class="i">${INSTRUCAO}</div></div>`;
      }));
      janela.document.open();
      janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Codes das mesas — ${escapar(links.loja)}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #0F172A; }
  .g { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .c { border: 1px dashed #94A3B8; border-radius: 4mm; padding: 6mm; text-align: center; break-inside: avoid; }
  .c svg { width: 62mm; height: 62mm; display: block; margin: 3mm auto; }
  .l { font-weight: 700; font-size: 13pt; }
  .m { font-weight: 900; font-size: 26pt; letter-spacing: 0.5pt; }
  .i { font-size: 10pt; color: #475569; margin-top: 1mm; }
</style></head><body><div class="g">${cartoes.join("")}</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };<\/script></body></html>`);
      janela.document.close();
    } catch {
      janela.close();
      setErro("Não deu para montar a folha de impressão.");
    } finally {
      setOcupado("");
    }
  };

  if (erro) return <p style={{ color: "#B91C1C", fontSize: 14, padding: "10px 0" }}>{erro}</p>;
  if (!links) return <p style={{ color: "#64748B", fontSize: 14, padding: "10px 0" }}>Carregando os QR Codes…</p>;

  const botao = (cor: "escuro" | "claro"): React.CSSProperties => ({
    padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
    border: cor === "escuro" ? "none" : "1px solid #E2E8F0",
    background: cor === "escuro" ? "#334155" : "#F8FAFC",
    color: cor === "escuro" ? "#fff" : "#475569",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 0 14px" }}>
      <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
        O cliente escaneia, escolhe no cardápio e o pedido cai <strong>na conta da mesa</strong>, como se o garçom tivesse lançado: vai para a cozinha e é cobrado no fechamento. Preço e produtos são os do salão. Mesa fechada abre sozinha no nome de quem pediu. Só funciona com o caixa aberto.
      </p>

      {/* QR geral */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12 }}>
        {previa && <img src={previa} alt="QR Code geral das mesas" width={96} height={96} style={{ borderRadius: 6, background: "#fff", flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>QR geral do salão</div>
          <div style={{ fontSize: 12, color: "#64748B", margin: "2px 0 8px" }}>Um QR só para todas as mesas: o cliente escolhe o número da mesa na tela.</div>
          <button type="button" style={botao("claro")} disabled={ocupado === "geral"}
            onClick={() => baixarCartao("geral", links.geral, "Peça pelo celular", "qrcode-mesas-geral.png")}>
            {ocupado === "geral" ? "Gerando…" : "⬇️ Baixar QR geral"}
          </button>
        </div>
      </div>

      {/* Um por mesa */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Um QR para cada mesa</div>
        <button type="button" style={botao("escuro")} disabled={ocupado === "todas" || !links.mesas.some((m) => m.ativa)} onClick={imprimirTodas}>
          {ocupado === "todas" ? "Montando…" : "🖨️ Imprimir todas"}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#64748B", marginTop: -8 }}>Quem escaneia já entra na mesa certa. Apagar ou desativar a mesa desliga o QR dela.</div>
      {links.mesas.length === 0 ? (
        <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>Cadastre as mesas na aba 🪑 Mesas para gerar o QR de cada uma.</p>
      ) : links.mesas.map((m) => (
        <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{tituloDaMesa(m)}</span>
            {m.rotulo && <span style={{ color: "#94A3B8", fontSize: 13, marginLeft: 8 }}>({m.rotulo})</span>}
            {!m.ativa && <span style={{ color: "#B45309", fontSize: 12, marginLeft: 8, fontWeight: 700 }}>desativada: o QR não aceita pedido</span>}
          </div>
          <button type="button" style={botao("claro")} disabled={ocupado === m.id}
            onClick={() => baixarCartao(m.id, m.caminho, tituloDaMesa(m), `qrcode-mesa-${m.numero}.png`)}>
            {ocupado === m.id ? "Gerando…" : "⬇️ Baixar"}
          </button>
        </div>
      ))}
    </div>
  );
}
