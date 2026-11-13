"use client";

/**
 * O material de divulgação do FireHub: o vídeo de apresentação, a apresentação
 * e o folder da gráfica JÁ com o QR e o contato de quem indica (montados por
 * /material/apresentacao e /material/folder, lib/materiais/rota-do-material.ts)
 * e, no portal do parceiro, os criativos para postar.
 *
 * A pessoa ajusta nome, WhatsApp e para onde o QR leva; a prévia muda na hora.
 * O que ela digitou fica só no navegador dela (localStorage) — o link que ela
 * manda leva os mesmos dados na URL (&n=, &w=, &q=).
 *
 * Aparece no Indique e ganhe (/store/indique-e-ganhe) e na aba "Material de
 * apoio de vendas" do portal do parceiro (/vendedor e /embaixador). As cores
 * leem as variáveis `--pp-*` dentro do portal e caem no laranja/creme da loja fora dele.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { telefoneFormatado, whatsappValido } from "@/lib/materiais/telefone";
import CriativosParaBaixar from "./CriativosParaBaixar";

/** Quem indica: o vendedor/embaixador (código do ?ref=) ou a loja (código do ?indicacao=). */
export type QuemIndica = { tipo: "parceiro" | "loja"; codigo: string; nome: string; whatsapp: string | null; linkDeCadastro: string };
type QrLeva = "whatsapp" | "cadastro";
type Documento = "apresentacao" | "folder";

const VIDEO = "/materiais/firehub-apresentacao.mp4";
const POSTER = "/materiais/firehub-apresentacao.jpg";

const LARANJA = "var(--pp-laranja, #e8590c)";
const TINTA = "var(--pp-tinta, #15120f)";
const TINTA_2 = "var(--pp-cinza, #57524c)";
const LINHA = "var(--pp-linha-forte, #e9e3dc)";
const PAPEL = "var(--pp-papel, #fff)";
const ERRO = "#B91C1C";

const cartao: CSSProperties = {
  background: PAPEL, border: `1px solid ${LINHA}`, borderRadius: 18, padding: "1.1rem",
  display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
};
const botao: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "10px 14px", borderRadius: 12, fontWeight: 800, fontSize: 14, textDecoration: "none",
  border: `1.5px solid ${LINHA}`, color: TINTA, background: PAPEL, cursor: "pointer", fontFamily: "inherit",
};
const botaoForte: CSSProperties = { ...botao, background: LARANJA, borderColor: "transparent", color: "#fff" };
const botaoWhats: CSSProperties = { ...botao, background: "#E6F6EB", borderColor: "#BCE3C8", color: "#14532D" };
const desligado: CSSProperties = { opacity: 0.45, pointerEvents: "none" };
const titulo: CSSProperties = { fontWeight: 900, fontSize: 17, margin: 0 };
const texto: CSSProperties = { color: TINTA_2, margin: 0, fontSize: 14, lineHeight: 1.5 };
const botoes: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const rotulo: CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 800, color: TINTA };
const campo: CSSProperties = {
  font: "inherit", fontSize: 15, fontWeight: 500, padding: "10px 12px", borderRadius: 10,
  border: `1.5px solid ${LINHA}`, background: "#fff", color: TINTA, width: "100%", minWidth: 0,
};

const guardado = (quem: QuemIndica) => `firehub-material:${quem.tipo}:${quem.codigo}`;

export default function MateriaisDeDivulgacao({
  quem,
  criativos = false,
  titulo: tituloDaSecao = "Material de apoio de vendas",
  subtitulo = "O vídeo, a apresentação e o folder com o SEU QR e o seu contato. Quem se cadastrar pelo QR fica marcado como indicação sua.",
}: {
  /** Sem ele (ex.: funcionário sem acesso ao Financeiro), sai o material genérico do FireHub. */
  quem: QuemIndica | null;
  /** Os criativos do FireHub para postar (portal do parceiro). */
  criativos?: boolean;
  titulo?: string;
  subtitulo?: string;
}) {
  const [nome, setNome] = useState("");
  const [whats, setWhats] = useState("");
  const [qr, setQr] = useState<QrLeva>("whatsapp");
  const [doc, setDoc] = useState<Documento>("apresentacao");
  const [origem, setOrigem] = useState("");
  const [previa, setPrevia] = useState("");

  // Os dados da conta (no Indique e ganhe chegam depois do 1º desenho) e, por
  // cima, o que a pessoa já tinha digitado neste navegador.
  useEffect(() => {
    setOrigem(window.location.origin);
    if (!quem) return;
    const daConta = whatsappValido(quem.whatsapp);
    setNome(quem.nome);
    setWhats(daConta ? telefoneFormatado(daConta) : "");
    try {
      const salvo = JSON.parse(localStorage.getItem(guardado(quem)) || "null");
      if (salvo && typeof salvo === "object") {
        if (typeof salvo.nome === "string" && salvo.nome.trim()) setNome(salvo.nome);
        if (typeof salvo.whats === "string") setWhats(salvo.whats);
        if (salvo.qr === "whatsapp" || salvo.qr === "cadastro") setQr(salvo.qr);
      }
    } catch { /* navegador sem localStorage: fica com os dados da conta */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quem?.tipo, quem?.codigo]);

  const w = whatsappValido(whats);
  const parametros = (() => {
    if (!quem) return "";
    const p = new URLSearchParams();
    p.set(quem.tipo === "parceiro" ? "ref" : "indicacao", quem.codigo);
    const n = nome.replace(/\s+/g, " ").trim();
    if (n && n !== quem.nome) p.set("n", n);
    p.set("w", w ?? "");
    p.set("q", qr);
    return p.toString();
  })();
  const url = (d: Documento, extra = "") => {
    const q = [parametros, extra].filter(Boolean).join("&");
    return `/material/${d}${q ? `?${q}` : ""}`;
  };

  // Guarda e atualiza a prévia meio segundo depois da última tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setPrevia(url(doc, "previa=1"));
      if (quem) {
        try { localStorage.setItem(guardado(quem), JSON.stringify({ nome, whats, qr })); } catch { /* sem localStorage */ }
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametros, doc]);

  const whatsIncompleto = !!quem && whats.trim() !== "" && !w;
  const folderSemWhats = !!quem && !w;
  const bloqueado = doc === "folder" && folderSemWhats;

  const mensagem =
    `Conheça o FireHub, o sistema para restaurante: cardápio digital, pedidos, iFood e caixa num lugar só. Veja a apresentação: ${origem}${url("apresentacao")}` +
    (quem ? `\n\nPara testar 15 dias grátis: ${quem.linkDeCadastro}` : "");

  return (
    <div style={{ color: TINTA, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 24, margin: "0 0 4px", fontWeight: 900 }}>{tituloDaSecao}</h2>
        {subtitulo && <p style={texto}>{subtitulo}</p>}
      </div>

      {/* 1. Vídeo */}
      <div style={{ ...cartao, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(300px,100%),1fr))", gap: 14, alignItems: "center" }}>
        <video
          controls
          preload="none"
          playsInline
          poster={POSTER}
          src={VIDEO}
          style={{ width: "100%", aspectRatio: "16 / 9", borderRadius: 12, background: "#000", display: "block" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h3 style={titulo}>🎬 Vídeo de apresentação (4 min)</h3>
          <p style={texto}>O FireHub explicado do começo ao fim. Assista aqui ou baixe para mandar no WhatsApp.</p>
          <div style={botoes}>
            <a href={VIDEO} download="FireHub - apresentação.mp4" style={botaoForte}>⬇ Baixar o vídeo</a>
          </div>
        </div>
      </div>

      {/* 2. Apresentação e folder com o QR de quem indica */}
      <div id="material-personalizado" style={{ ...cartao, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <h3 style={titulo}>🧾 Apresentação e folder com o seu QR</h3>
          {quem ? (
            <>
              <p style={texto}>Confira os seus dados. A imagem ao lado muda na hora; depois é só baixar o PDF.</p>
              <label style={rotulo}>
                Nome que aparece em "Indicado por"
                <input style={campo} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder={quem.nome} />
              </label>
              <label style={rotulo}>
                Seu WhatsApp
                <input
                  style={{ ...campo, borderColor: whatsIncompleto ? ERRO : undefined }}
                  value={whats}
                  inputMode="tel"
                  placeholder="(22) 98111-8514"
                  onChange={(e) => setWhats(e.target.value)}
                  onBlur={() => w && setWhats(telefoneFormatado(w))}
                />
                {whatsIncompleto && <span style={{ color: ERRO, fontWeight: 600 }}>Número incompleto: DDD + número, ex.: (22) 98111-8514.</span>}
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <legend style={{ ...rotulo, marginBottom: 5 }}>O QR leva para</legend>
                {([
                  ["whatsapp", "Meu WhatsApp", "A pessoa aponta a câmera e cai na sua conversa."],
                  ["cadastro", "Cadastro com o meu código", "Ela mesma se cadastra no teste grátis, já marcada para você."],
                ] as const).map(([valor, nomeDaOpcao, explica]) => (
                  <label key={valor} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${qr === valor ? LARANJA : LINHA}`, background: qr === valor ? "var(--pp-papel-2, #fff4ec)" : "#fff" }}>
                    <input type="radio" name="qr-leva" value={valor} checked={qr === valor} onChange={() => setQr(valor)} style={{ marginTop: 3, accentColor: "#e8590c" }} />
                    <span><b style={{ fontSize: 14 }}>{nomeDaOpcao}</b><br /><span style={{ ...texto, fontSize: 13 }}>{explica}</span></span>
                  </label>
                ))}
              </fieldset>
              {qr === "whatsapp" && !w && <p style={{ ...texto, fontSize: 13 }}>Sem WhatsApp preenchido, o QR leva para o cadastro com o seu código.</p>}
              <p style={{ ...texto, fontSize: 12.5, overflowWrap: "anywhere" }}>Seu link de cadastro: <b style={{ color: TINTA }}>{quem.linkDeCadastro.replace(/^https?:\/\//, "")}</b></p>
            </>
          ) : (
            <p style={texto}>Este é o material com o contato do FireHub. O link de indicação aparece para quem tem acesso ao Financeiro da loja.</p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div role="tablist" aria-label="Qual material" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["apresentacao", "📄 Apresentação"], ["folder", "🖨️ Folder para gráfica"]] as const).map(([d, r]) => (
              <button key={d} type="button" role="tab" aria-selected={doc === d} onClick={() => setDoc(d)}
                style={{ ...botao, padding: "8px 12px", fontSize: 13.5, ...(doc === d ? { background: TINTA, color: "#fff", borderColor: "transparent" } : {}) }}>
                {r}
              </button>
            ))}
          </div>
          <iframe
            key={doc}
            title={doc === "apresentacao" ? "Prévia da apresentação" : "Prévia do folder"}
            src={previa || undefined}
            style={{ width: "100%", height: doc === "apresentacao" ? 560 : 440, border: `1px solid ${LINHA}`, borderRadius: 12, background: "#D6D3D1" }}
          />
          {doc === "apresentacao" ? (
            <p style={{ ...texto, fontSize: 13 }}>9 páginas para ler no celular. Mande o link pelo WhatsApp ou baixe o PDF.</p>
          ) : (
            <p style={{ ...texto, fontSize: 13 }}>
              A4 deitado, 2 dobras (folder de 3 painéis), frente e verso, já com 3 mm de sangria.
              Peça à gráfica: <b style={{ color: TINTA }}>folder A4 2 dobras, papel couché 115 g ou 150 g.</b>
            </p>
          )}
          {bloqueado && <p style={{ margin: 0, color: ERRO, fontWeight: 700, fontSize: 13.5 }}>Para o folder, preencha o seu WhatsApp: ele sai impresso no verso.</p>}
          <div style={botoes}>
            <a href={url(doc)} target="_blank" rel="noreferrer" style={{ ...botao, ...(bloqueado ? desligado : {}) }} aria-disabled={bloqueado}>Abrir</a>
            <a href={url(doc, "imprimir=1")} target="_blank" rel="noreferrer" style={{ ...botaoForte, ...(bloqueado ? desligado : {}) }} aria-disabled={bloqueado}>
              ⬇ {doc === "apresentacao" ? "Baixar PDF" : "Baixar PDF da gráfica"}
            </a>
            {doc === "apresentacao" && (
              <a href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noreferrer" style={botaoWhats}>Mandar no WhatsApp</a>
            )}
          </div>
          <p style={{ ...texto, fontSize: 12 }}>O PDF sai pela janela de impressão: escolha “Salvar como PDF”.</p>
        </div>
      </div>

      {/* 3. Criativos */}
      {criativos && <CriativosParaBaixar linkDeCadastro={quem?.linkDeCadastro} />}
    </div>
  );
}
