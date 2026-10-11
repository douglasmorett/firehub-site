"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink, Eye, EyeOff, MessageCircle, QrCode, Save } from "lucide-react";
import { CORES_SUGERIDAS, type ConfigDaPaginaDoGrupo } from "@/lib/pagina-do-grupo-config";

/**
 * Minha Loja → "Página das suas lojas": o link único do grupo e o que o
 * cliente vê nele (/lojas/[slug]). Grava na principal pela
 * /api/store/pagina-do-grupo. Os BAIRROS não se editam aqui: cada loja usa a
 * área da própria aba Entrega — a página só junta.
 */

async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    // Clipboard API bloqueada (aba sem foco, navegador antigo): o jeito velho.
    const campo = document.createElement("textarea");
    campo.value = texto;
    document.body.appendChild(campo);
    campo.select();
    try { document.execCommand("copy"); } catch { /* sem cópia: o link fica visível na tela */ }
    campo.remove();
  }
}

type LojaDoPainel = {
  id: string;
  slug: string;
  nome: string;
  logo: string | null;
  capa: string | null;
  capaVideo: string | null;
  principal: boolean;
  area: string;
  semArea: boolean;
};

type Dados = {
  multiloja: boolean;
  caminho: string;
  config: ConfigDaPaginaDoGrupo;
  lojas: LojaDoPainel[];
  bairrosEmComum: string[];
};

const cartao: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.1rem 1.2rem", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" };
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.78rem", fontWeight: 800, color: "#334155", margin: "0 0 6px" };
const campo: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "0.65rem 0.8rem", border: "1.5px solid #E2E8F0", borderRadius: 10, fontSize: "0.9rem", fontFamily: "inherit" };
const botao: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.85rem", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#1E293B", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "none" };

export default function PaginaDasLojasEditor() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigDaPaginaDoGrupo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [verComum, setVerComum] = useState(false);

  useEffect(() => {
    fetch("/api/store/pagina-do-grupo")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error || "Não deu para abrir a página das lojas.");
        setDados(d);
        setConfig(d.config);
      })
      .catch((e) => setErro(e.message));
  }, []);

  const link = dados && typeof window !== "undefined" ? `${window.location.origin}${dados.caminho}` : "";

  const lojasNaOrdem = useMemo(() => {
    if (!dados || !config) return [];
    const pos = (id: string) => (config.ordem.indexOf(id) === -1 ? 999 : config.ordem.indexOf(id));
    return [...dados.lojas].sort((a, b) => pos(a.id) - pos(b.id));
  }, [dados, config]);

  if (erro) return <div style={{ ...cartao, color: "#9B1C1C" }}>{erro}</div>;
  if (!dados || !config) return <div style={cartao}>Carregando…</div>;
  if (!dados.multiloja) {
    return (
      <div style={cartao}>
        <p style={{ margin: 0, fontWeight: 800 }}>Esta página é para quem tem mais de uma loja.</p>
        <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: "0.85rem" }}>
          Quando você abrir a segunda loja em “Suas Lojas”, aparece aqui um link único para divulgar as duas.
        </p>
      </div>
    );
  }

  const mudar = (parcial: Partial<ConfigDaPaginaDoGrupo>) => { setConfig({ ...config, ...parcial }); setSalvo(false); };
  const mudarLoja = (id: string, parcial: Partial<{ nome: string; oculta: boolean }>) =>
    mudar({ lojas: { ...config.lojas, [id]: { nome: config.lojas[id]?.nome || "", oculta: config.lojas[id]?.oculta || false, ...parcial } } });
  const mover = (id: string, delta: number) => {
    const ids = lojasNaOrdem.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    mudar({ ordem: ids });
  };
  const visiveis = lojasNaOrdem.filter((l) => !config.lojas[l.id]?.oculta).length;

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/pagina-do-grupo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Não deu para salvar.");
      setConfig(d.config);
      setSalvo(true);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  }

  async function baixarQr() {
    const QRCode = (await import("qrcode")).default;
    const png = await QRCode.toDataURL(link, { errorCorrectionLevel: "Q", width: 2000, margin: 4 });
    const a = document.createElement("a");
    a.href = png;
    a.download = `qrcode-${dados!.caminho.split("/").filter(Boolean).join("-")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const textoDoZap = encodeURIComponent(`Peça na ${config.titulo || lojasNaOrdem[0]?.nome || "nossa loja"}: escolha seu bairro e a gente leva você para a loja mais perto 👉 ${link}`);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "1rem" }} className="pagina-das-lojas-grade">
      <style>{`@media (min-width: 1000px) { .pagina-das-lojas-grade { grid-template-columns: minmax(0, 1fr) 390px !important; align-items: start; } .pagina-das-lojas-previa { position: sticky; top: 1rem; } }`}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {/* O LINK — o motivo de a tela existir, então vem primeiro */}
        <div style={{ ...cartao, background: "linear-gradient(135deg, #FFF7ED 0%, #FFFFFF 70%)", borderColor: "#FED7AA" }}>
          <p style={{ margin: 0, fontWeight: 900, fontSize: "1.05rem", color: "#0F172A" }}>🔗 O link de todas as suas lojas</p>
          <p style={{ margin: "4px 0 12px", color: "#64748B", fontSize: "0.85rem", lineHeight: 1.5 }}>
            Divulgue um link só no Instagram, no Google e nos anúncios. O cliente diz o bairro e cai no cardápio da loja que entrega para ele.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.7rem 0.9rem", background: "#fff", border: "1.5px dashed #FDBA74", borderRadius: 12, fontWeight: 800, fontSize: "0.92rem", color: "#9A3412", wordBreak: "break-all" }}>
            {link.replace(/^https?:\/\//, "")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={async () => { await copiarTexto(link); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
              style={{ ...botao, background: copiado ? "#F0FDFA" : "#C2410C", color: copiado ? "#0F766E" : "#fff", borderColor: copiado ? "#99F6E4" : "#C2410C" }}
            >
              {copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? "Link copiado!" : "Copiar link"}
            </button>
            <button type="button" onClick={baixarQr} style={botao}><QrCode size={15} /> Baixar QR Code</button>
            <a href={`https://wa.me/?text=${textoDoZap}`} target="_blank" rel="noreferrer" style={botao}><MessageCircle size={15} /> Mandar no WhatsApp</a>
            <a href={dados.caminho} target="_blank" rel="noreferrer" style={botao}><ExternalLink size={15} /> Abrir</a>
          </div>
        </div>

        {/* BAIRROS EM COMUM — o que mais gera dúvida no cliente */}
        {dados.bairrosEmComum.length > 0 && (
          <div style={{ ...cartao, background: "#FFFBEB", borderColor: "#FDE68A" }}>
            <p style={{ margin: 0, fontWeight: 800, color: "#92400E" }}>
              ⚠️ {dados.bairrosEmComum.length} {dados.bairrosEmComum.length === 1 ? "bairro é atendido" : "bairros são atendidos"} por mais de uma loja
            </p>
            <p style={{ margin: "4px 0 0", color: "#78350F", fontSize: "0.83rem", lineHeight: 1.5 }}>
              Nesses bairros o cliente vê as lojas lado a lado e escolhe. Se cada bairro deve ir para uma loja só, tire o bairro da aba <b>Entrega</b> da outra loja.
            </p>
            <button type="button" onClick={() => setVerComum((v) => !v)} style={{ ...botao, marginTop: 8, padding: "0.35rem 0.7rem", background: "transparent", borderColor: "#FCD34D" }}>
              {verComum ? "Esconder a lista" : "Ver quais são"}
            </button>
            {verComum && <p style={{ margin: "8px 0 0", fontSize: "0.82rem", color: "#78350F", lineHeight: 1.6 }}>{dados.bairrosEmComum.join(" · ")}</p>}
          </div>
        )}

        {/* COMO APARECE */}
        <div style={cartao}>
          <p style={{ margin: "0 0 12px", fontWeight: 900, color: "#0F172A" }}>Como aparece para o cliente</p>
          <label style={rotulo} htmlFor="pg-titulo">Nome no topo</label>
          <input id="pg-titulo" style={campo} value={config.titulo} maxLength={60} placeholder={lojasNaOrdem.find((l) => l.principal)?.nome || ""} onChange={(e) => mudar({ titulo: e.target.value })} />
          <label style={{ ...rotulo, marginTop: 12 }} htmlFor="pg-frase">Frase embaixo do nome</label>
          <input id="pg-frase" style={campo} value={config.frase} maxLength={120} placeholder={`${visiveis} lojas para te atender · peça na mais perto de você`} onChange={(e) => mudar({ frase: e.target.value })} />

          <span style={{ ...rotulo, marginTop: 14 }}>Cor dos botões</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {CORES_SUGERIDAS.map((c) => {
              const ativa = (config.cor || CORES_SUGERIDAS[0]) === c;
              return (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => mudar({ cor: c === CORES_SUGERIDAS[0] ? "" : c })}
                  style={{ width: 34, height: 34, borderRadius: "50%", background: c, border: ativa ? "3px solid #0F172A" : "3px solid #fff", boxShadow: "0 0 0 1px #CBD5E1", cursor: "pointer" }} />
              );
            })}
            <label style={{ ...botao, padding: "0.35rem 0.6rem", gap: 6 }}>
              Outra
              <input type="color" value={config.cor || CORES_SUGERIDAS[0]} onChange={(e) => mudar({ cor: e.target.value })} style={{ width: 26, height: 22, border: "none", padding: 0, background: "none" }} />
            </label>
          </div>

          <span style={{ ...rotulo, marginTop: 14 }}>Foto ou vídeo do topo</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {lojasNaOrdem.map((l) => {
              const ativa = (config.capaDaLoja || lojasNaOrdem.find((x) => x.principal)?.id) === l.id;
              return (
                <button key={l.id} type="button" onClick={() => mudar({ capaDaLoja: l.principal ? "" : l.id })}
                  style={{ ...botao, borderColor: ativa ? "#C2410C" : "#CBD5E1", background: ativa ? "#FFF7ED" : "#fff" }}>
                  {ativa && <Check size={14} />} A capa da {l.nome}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#64748B" }}>A logo, a capa e o endereço vêm do cadastro de cada loja (Minha Loja → Informações).</p>
        </div>

        {/* AS LOJAS */}
        <div style={cartao}>
          <p style={{ margin: "0 0 4px", fontWeight: 900, color: "#0F172A" }}>Suas lojas na página</p>
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "#64748B" }}>A ordem vale para a lista “Nossas lojas”. Quem decide a loja do cliente é a área de entrega de cada uma.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {lojasNaOrdem.map((l, i) => {
              const oculta = !!config.lojas[l.id]?.oculta;
              return (
                <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "0.75rem", border: "1px solid #E2E8F0", borderRadius: 12, opacity: oculta ? 0.55 : 1 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => mover(l.id, -1)} style={{ ...botao, padding: 4, opacity: i === 0 ? 0.35 : 1 }}><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Descer" disabled={i === lojasNaOrdem.length - 1} onClick={() => mover(l.id, 1)} style={{ ...botao, padding: 4, opacity: i === lojasNaOrdem.length - 1 ? 0.35 : 1 }}><ArrowDown size={14} /></button>
                  </div>
                  {l.logo ? <img src={l.logo} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} /> : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A" }}>
                      {l.nome} {l.principal && <span style={{ fontSize: "0.68rem", fontWeight: 800, color: "#C2410C", background: "#FFF7ED", padding: "2px 6px", borderRadius: 6 }}>Principal</span>}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: l.semArea ? "#B91C1C" : "#64748B", margin: "2px 0 8px" }}>
                      {l.semArea ? "⚠️ Sem área de entrega: a página não manda cliente para esta loja." : `Entrega: ${l.area}`}
                    </div>
                    <input style={{ ...campo, padding: "0.5rem 0.7rem", fontSize: "0.85rem" }} value={config.lojas[l.id]?.nome || ""} maxLength={60}
                      placeholder={`Nome na página (ex.: ${l.nome})`} onChange={(e) => mudarLoja(l.id, { nome: e.target.value })} aria-label={`Nome da ${l.nome} na página`} />
                  </div>
                  <button type="button" onClick={() => mudarLoja(l.id, { oculta: !oculta })} disabled={!oculta && visiveis <= 1}
                    title={!oculta && visiveis <= 1 ? "A página precisa de pelo menos uma loja" : undefined}
                    style={{ ...botao, padding: "0.45rem 0.6rem", flexShrink: 0, opacity: !oculta && visiveis <= 1 ? 0.4 : 1 }}>
                    {oculta ? <><EyeOff size={14} /> Fora</> : <><Eye size={14} /> Aparece</>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <button type="button" onClick={salvar} disabled={salvando}
          style={{ ...botao, justifyContent: "center", padding: "0.85rem", fontSize: "0.95rem", background: salvo ? "#F0FDF4" : "#0F172A", color: salvo ? "#15803D" : "#fff", borderColor: salvo ? "#BBF7D0" : "#0F172A", position: "sticky", bottom: 12 }}>
          {salvo ? <><Check size={16} /> Salvo — a página já mudou</> : <><Save size={16} /> {salvando ? "Salvando…" : "Salvar a página"}</>}
        </button>
      </div>

      {/* PRÉVIA — o topo da página, mudando enquanto o dono edita. A página
          inteira não entra num iframe: o site responde X-Frame-Options DENY
          em toda rota, de propósito (proxy.ts). */}
      <Previa config={config} lojas={lojasNaOrdem} caminho={dados.caminho} visiveis={visiveis} />
    </div>
  );
}

function Previa({ config, lojas, caminho, visiveis }: { config: ConfigDaPaginaDoGrupo; lojas: LojaDoPainel[]; caminho: string; visiveis: number }) {
  const principal = lojas.find((l) => l.principal) || lojas[0];
  const temCapa = (l?: LojaDoPainel) => !!(l && (l.capa || l.capaVideo));
  const daCapa = (config.capaDaLoja ? lojas.find((l) => l.id === config.capaDaLoja && temCapa(l)) : null) || (temCapa(principal) ? principal : lojas.find(temCapa));
  const cor = config.cor || CORES_SUGERIDAS[0];
  const titulo = config.titulo || principal?.nome || "";
  const frase = config.frase || `${visiveis} lojas para te atender · peça na mais perto de você`;
  return (
    <div className="pagina-das-lojas-previa" style={{ ...cartao, padding: 12 }}>
      <p style={{ margin: "0 0 8px 2px", fontWeight: 800, fontSize: "0.8rem", color: "#64748B" }}>Como o cliente vê</p>
      <div style={{ borderRadius: 22, overflow: "hidden", border: "6px solid #0F172A", background: "#f7f3ef" }}>
        <div style={{ position: "relative", height: 230, background: "radial-gradient(120% 90% at 50% 0%, #4a2a1d 0%, #1b120e 70%)" }}>
          {daCapa?.capaVideo ? (
            <video src={daCapa.capaVideo} poster={daCapa.capa || undefined} muted loop playsInline autoPlay style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : daCapa?.capa ? (
            <img src={daCapa.capa} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(20,12,8,.35) 0%, rgba(20,12,8,.92) 100%)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, textAlign: "center", color: "#fff", padding: "0 14px" }}>
            {principal?.logo && <img src={principal.logo} alt="" style={{ width: 62, height: 62, borderRadius: "50%", border: "3px solid #fff", objectFit: "cover", background: "#fff" }} />}
            <div style={{ fontWeight: 900, fontSize: "1.3rem", marginTop: 6 }}>{titulo}</div>
            <div style={{ fontSize: "0.75rem", opacity: 0.85, marginTop: 2 }}>{frase}</div>
          </div>
        </div>
        <div style={{ margin: "-22px 12px 14px", position: "relative", background: "#fff", borderRadius: 16, padding: 14, boxShadow: "0 10px 30px rgba(40,20,10,.15)" }}>
          <div style={{ fontWeight: 900, fontSize: "1rem" }}>Onde você está?</div>
          <div style={{ marginTop: 10, background: cor, color: "#fff", borderRadius: 12, padding: 11, textAlign: "center", fontWeight: 800, fontSize: "0.85rem" }}>Usar minha localização</div>
          <div style={{ marginTop: 8, border: "1.5px solid #ebe5df", borderRadius: 12, padding: 10, color: "#94a3b8", fontSize: "0.8rem" }}>Comece a digitar o bairro</div>
        </div>
        <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontWeight: 900, fontSize: "0.85rem" }}>Nossas lojas</div>
          {lojas.filter((l) => !config.lojas[l.id]?.oculta).map((l) => (
            <div key={l.id} style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", fontSize: "0.78rem", fontWeight: 700 }}>{config.lojas[l.id]?.nome || l.nome}</div>
          ))}
        </div>
      </div>
      <a href={caminho} target="_blank" rel="noreferrer" style={{ ...botao, marginTop: 10, width: "100%", justifyContent: "center", boxSizing: "border-box" }}>
        <ExternalLink size={15} /> Abrir a página inteira
      </a>
      <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#94a3b8", textAlign: "center" }}>A página aberta mostra o que está salvo.</p>
    </div>
  );
}
