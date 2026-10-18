"use client";

import { useCallback, useEffect, useState } from "react";
import { Tv, Copy, ExternalLink, RefreshCw, Shuffle, ListOrdered, AlertTriangle, Check, Loader2, MessageCircle } from "lucide-react";
import { CORES_DO_PAINEL, type ConfigDoPainel } from "@/lib/painel-de-senhas";
import PainelDeSenhasTV from "@/components/painel-de-senhas/PainelDeSenhasTV";

/**
 * Painel de senhas — a configuração da TV do salão (lib/painel-de-senhas.ts)
 * e a escolha da numeração dos pedidos (lib/senha-aleatoria.ts).
 */

type Dados = {
  lojaId: string;
  nome: string;
  logo: string | null;
  slug: string | null;
  config: ConfigDoPainel;
  numeracaoAleatoria: boolean;
  podeNumeracao: boolean;
};

type Aviso = { tipo: "ok" | "erro" | "atencao"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 5000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

const SITE = "firehubfood.com.br";

export default function PainelDeSenhasClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [mensagem, setMensagem] = useState("");
  const [confirmarNumeracao, setConfirmarNumeracao] = useState<boolean | null>(null);
  const [confirmarCodigo, setConfirmarCodigo] = useState(false);
  const [versaoDaPrevia, setVersaoDaPrevia] = useState(0);
  const fecharAviso = useCallback(() => setAviso(null), []);

  useEffect(() => {
    fetch("/api/store/painel-de-senhas", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || "Não deu para abrir a configuração.");
        setDados(d);
        setMensagem(d.config.mensagem || "");
      })
      .catch((e) => setErro(e.message));
  }, []);

  async function salvar(mudanca: Record<string, unknown>, ok?: Aviso) {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/painel-de-senhas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mudanca),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não deu para salvar.");
      setDados(d);
      setVersaoDaPrevia((v) => v + 1);
      setAviso(ok || { tipo: "ok", titulo: "Salvo", detalhe: "A TV muda sozinha em alguns segundos." });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não salvou", detalhe: e?.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={S.pagina}><p style={{ color: "#DC2626", fontWeight: 600 }}>{erro}</p></div>;
  if (!dados) {
    return (
      <div style={{ ...S.pagina, display: "flex", alignItems: "center", gap: 10, color: "#64748B" }}>
        <Loader2 size={18} className="animate-spin" /> Carregando…
      </div>
    );
  }

  const { config } = dados;
  const link = `https://${SITE}/tv/${config.codigo}`;
  const textoWhats = `Painel de senhas da ${dados.nome || "loja"}: abra ${link} na TV (ou abra ${SITE}/tv e digite o código ${config.codigo}).`;

  const Interruptor = ({ campo, titulo, ajuda }: { campo: keyof ConfigDoPainel; titulo: string; ajuda?: string }) => (
    <label style={S.opcao}>
      <input
        type="checkbox"
        checked={config[campo] as boolean}
        disabled={salvando}
        onChange={(e) => salvar({ [campo]: e.target.checked })}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: "#DC2626", flexShrink: 0 }}
      />
      <span>
        <span style={{ fontWeight: 700, color: "#0F172A" }}>{titulo}</span>
        {ajuda && <span style={{ display: "block", fontSize: 13, color: "#64748B", marginTop: 2 }}>{ajuda}</span>}
      </span>
    </label>
  );

  return (
    <div style={S.pagina}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 10, color: "#0F172A" }}>
          <Tv size={28} color="#DC2626" /> Painel de senhas
        </h1>
        <p style={{ color: "#64748B", margin: "6px 0 0", maxWidth: 720, lineHeight: 1.5 }}>
          Uma TV no salão ou na praça de alimentação mostrando quem está sendo preparado e quem já pode retirar —
          com a sua marca em destaque. Quando o pedido fica pronto, a senha aparece em tela cheia com som.
        </p>
      </header>

      <div style={S.duasColunas}>
        {/* ── Ligar na TV ── */}
        <section style={S.cartao}>
          <h2 style={S.titulo}>Ligar na TV</h2>
          <ol style={{ margin: "0 0 18px", paddingLeft: 20, color: "#334155", lineHeight: 1.7, fontSize: 15 }}>
            <li>Na TV (ou no computador ligado na TV), abra o navegador em <b>{SITE}/tv</b></li>
            <li>Digite o código abaixo</li>
            <li>Aperte <b>OK</b> no controle para ligar o som e a tela cheia</li>
          </ol>

          <div style={S.codigo} aria-label="Código da TV">{config.codigo}</div>
          <p style={{ fontSize: 13, color: "#64748B", margin: "8px 0 16px", textAlign: "center" }}>
            A TV guarda o código: se desligar, é só abrir {SITE}/tv de novo.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <a href={`/tv/${config.codigo}`} target="_blank" rel="noopener noreferrer" style={S.botaoPrincipal}>
              <ExternalLink size={16} /> Abrir o painel
            </a>
            <button
              style={S.botao}
              onClick={() => {
                navigator.clipboard?.writeText(link).then(
                  () => setAviso({ tipo: "ok", titulo: "Link copiado", detalhe: link }),
                  () => setAviso({ tipo: "erro", titulo: "Não deu para copiar", detalhe: link }),
                );
              }}
            >
              <Copy size={16} /> Copiar link
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(textoWhats)}`} target="_blank" rel="noopener noreferrer" style={S.botao}>
              <MessageCircle size={16} /> Enviar pelo WhatsApp
            </a>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
            {confirmarCodigo ? (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 14, color: "#334155" }}>
                As TVs ligadas com o código atual saem do ar. Trocar?
                <button style={S.botaoPerigo} disabled={salvando} onClick={() => { setConfirmarCodigo(false); salvar({ novoCodigo: true }, { tipo: "ok", titulo: "Código trocado", detalhe: "Digite o código novo nas TVs." }); }}>
                  Sim, trocar
                </button>
                <button style={S.botao} onClick={() => setConfirmarCodigo(false)}>Cancelar</button>
              </div>
            ) : (
              <button style={{ ...S.botao, border: "none", padding: 0, color: "#64748B" }} onClick={() => setConfirmarCodigo(true)}>
                <RefreshCw size={14} /> Trocar o código (desconecta as TVs)
              </button>
            )}
          </div>
        </section>

        {/* ── Prévia ── */}
        <section style={{ ...S.cartao, padding: 16 }}>
          <h2 style={{ ...S.titulo, marginBottom: 12 }}>Como fica na TV</h2>
          <div style={S.moldura} aria-label="Prévia do painel de senhas">
            <PainelDeSenhasTV key={`${config.codigo}:${versaoDaPrevia}`} lojaId={dados.lojaId} codigo={config.codigo} previa />
          </div>
          <p style={{ fontSize: 12, color: "#94A3B8", margin: "8px 0 0" }}>
            Quando a loja está sem pedido, a prévia mostra números de exemplo.
          </p>
        </section>
      </div>

      {/* ── O que aparece ── */}
      <section style={{ ...S.cartao, marginTop: 20 }}>
        <h2 style={S.titulo}>O que aparece na TV</h2>
        <div style={S.grade}>
          <div>
            <h3 style={S.subtitulo}>Quais pedidos</h3>
            <Interruptor campo="balcao" titulo="Balcão e retirada" ajuda="Venda no balcão, totem e pedido do site para retirar." />
            <Interruptor campo="mesa" titulo="Mesa" ajuda="Para quem busca o pedido no balcão mesmo comendo no salão." />
            <Interruptor campo="delivery" titulo="Delivery" ajuda="Útil para o motoboy ver o que está pronto." />
          </div>
          <div>
            <h3 style={S.subtitulo}>Chamada</h3>
            <Interruptor campo="som" titulo="Tocar som quando ficar pronto" />
            <Interruptor campo="voz" titulo="Falar a senha em voz alta" ajuda={`"Senha 347" — com a voz do navegador da TV.`} />
            <Interruptor campo="mostrarNome" titulo="Mostrar o primeiro nome do cliente" ajuda="Embaixo do número. Nome genérico (Cliente, Balcão) não aparece." />
            <label style={{ ...S.opcao, alignItems: "center" }}>
              <span style={{ fontWeight: 700, color: "#0F172A" }}>Pronto sai da tela depois de</span>
              <select
                value={config.prontoFicaMin}
                disabled={salvando}
                onChange={(e) => salvar({ prontoFicaMin: Number(e.target.value) })}
                style={S.select}
              >
                {[3, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <p style={{ fontSize: 13, color: "#64748B", margin: "-4px 0 0" }}>Ou na hora em que o pedido é finalizado.</p>
          </div>
          <div>
            <h3 style={S.subtitulo}>Sua marca</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              {dados.logo
                ? <img src={dados.logo} alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", border: "1px solid #E2E8F0" }} />
                : <div style={{ width: 48, height: 48, borderRadius: 12, background: "#F1F5F9" }} />}
              <span style={{ fontSize: 13, color: "#64748B" }}>
                Logo e nome vêm de <a href="/store/minha-loja#info" style={{ color: "#DC2626", fontWeight: 600 }}>Minha loja › Informações</a>.
              </span>
            </div>
            <div style={{ fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Cor do destaque</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {CORES_DO_PAINEL.map((c) => (
                <button
                  key={c}
                  aria-label={`Cor ${c}`}
                  disabled={salvando}
                  onClick={() => salvar({ cor: c })}
                  style={{
                    width: 34, height: 34, borderRadius: "50%", background: c, cursor: "pointer",
                    border: config.cor === c ? "3px solid #0F172A" : "3px solid #fff", boxShadow: "0 0 0 1px #E2E8F0",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
                  }}
                >
                  {config.cor === c && <Check size={16} />}
                </button>
              ))}
            </div>
            <Interruptor campo="qrDoCardapio" titulo="QR do cardápio no rodapé" ajuda={`"Peça pelo celular" — leva ao seu cardápio online.`} />
            <div style={{ fontWeight: 700, color: "#0F172A", margin: "6px 0 6px" }}>Recado no rodapé</div>
            <input
              value={mensagem}
              maxLength={120}
              onChange={(e) => setMensagem(e.target.value)}
              onBlur={() => { if (mensagem.trim() !== config.mensagem) salvar({ mensagem }); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="Ex.: Peça também pelo nosso site! 🍔"
              style={S.campo}
            />
          </div>
        </div>
      </section>

      {/* ── Numeração ── */}
      <section style={{ ...S.cartao, marginTop: 20 }}>
        <h2 style={S.titulo}>Numeração dos pedidos</h2>
        <p style={{ margin: "0 0 16px", color: "#64748B", lineHeight: 1.5, maxWidth: 760 }}>
          Com a numeração em sequência, quem vê a senha 184 às 21h sabe quanto a loja vendeu no dia.
          Na numeração sorteada, o número sai embaralhado e ninguém consegue contar.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, maxWidth: 760 }}>
          {[
            { valor: false, icone: <ListOrdered size={20} />, titulo: "Em sequência", exemplo: "1 · 2 · 3 · 4 · 5", ajuda: "Recomeça do 1 quando o caixa fecha." },
            { valor: true, icone: <Shuffle size={20} />, titulo: "Sorteada", exemplo: "347 · 812 · 129 · 560", ajuda: "3 dígitos, sem repetir até o caixa fechar." },
          ].map((o) => {
            const ativo = dados.numeracaoAleatoria === o.valor;
            return (
              <button
                key={String(o.valor)}
                disabled={salvando || !dados.podeNumeracao}
                onClick={() => { if (!ativo) setConfirmarNumeracao(o.valor); }}
                style={{
                  textAlign: "left", padding: 16, borderRadius: 14, cursor: ativo || !dados.podeNumeracao ? "default" : "pointer",
                  border: ativo ? "2px solid #DC2626" : "1px solid #E2E8F0", background: ativo ? "#FEF2F2" : "#fff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#0F172A", fontSize: 16 }}>
                  <span style={{ color: ativo ? "#DC2626" : "#64748B" }}>{o.icone}</span>
                  {o.titulo}
                  {ativo && <span style={S.selo}>em uso</span>}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#334155", margin: "8px 0 4px", fontVariantNumeric: "tabular-nums" }}>{o.exemplo}</div>
                <div style={{ fontSize: 13, color: "#64748B" }}>{o.ajuda}</div>
              </button>
            );
          })}
        </div>

        {!dados.podeNumeracao && (
          <p style={{ fontSize: 13, color: "#64748B", marginTop: 10 }}>Só o dono (ou quem tem a permissão Minha loja) muda a numeração.</p>
        )}

        {confirmarNumeracao !== null && (
          <div role="alertdialog" style={S.confirmacao}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <AlertTriangle size={22} color="#D97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 800, color: "#0F172A", fontSize: 16 }}>
                  {confirmarNumeracao ? "Mudar para a numeração sorteada?" : "Voltar para a numeração em sequência?"}
                </div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "#334155", lineHeight: 1.6, fontSize: 14 }}>
                  <li>
                    O número do pedido muda em <b>tudo</b>: quadro de pedidos, KDS, comanda impressa, painel de senhas,
                    app do motoboy, mensagens do WhatsApp para o cliente e relatórios.
                  </li>
                  <li>Vale a partir do <b>próximo pedido</b>. Os pedidos já feitos continuam com o número que têm.</li>
                  {confirmarNumeracao
                    ? <li>O número não se repete até o caixa fechar. Avise a equipe: a senha deixa de seguir a ordem (o 812 pode sair antes do 129).</li>
                    : <li>A contagem segue de onde parou e recomeça do 1 no próximo fechamento de caixa.</li>}
                </ul>
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    style={S.botaoPrincipal}
                    disabled={salvando}
                    onClick={() => {
                      const valor = confirmarNumeracao;
                      setConfirmarNumeracao(null);
                      salvar(
                        { numeracaoAleatoria: valor },
                        { tipo: "atencao", titulo: valor ? "Numeração sorteada ligada" : "Numeração em sequência ligada", detalhe: "Vale a partir do próximo pedido. Avise a equipe." },
                      );
                    }}
                  >
                    Sim, mudar a numeração
                  </button>
                  <button style={S.botao} onClick={() => setConfirmarNumeracao(null)}>Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  pagina: { padding: "28px 24px 60px", maxWidth: 1180, margin: "0 auto", fontFamily: "Inter, sans-serif", color: "#0F172A" },
  duasColunas: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, alignItems: "start" },
  cartao: { background: "#fff", borderRadius: 16, border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", padding: 24 },
  titulo: { fontSize: 18, fontWeight: 800, margin: "0 0 14px", color: "#0F172A" },
  subtitulo: { fontSize: 13, fontWeight: 800, margin: "0 0 10px", color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.6 },
  grade: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 },
  opcao: { display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 14, cursor: "pointer", fontSize: 15 },
  codigo: {
    fontSize: 46, fontWeight: 900, letterSpacing: 14, textAlign: "center", padding: "14px 10px 14px 24px", borderRadius: 14,
    background: "#0B0F17", color: "#fff", fontFamily: "ui-monospace, Menlo, Consolas, monospace",
  },
  botao: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, border: "1px solid #E2E8F0",
    background: "#fff", color: "#0F172A", fontWeight: 600, fontSize: 14, cursor: "pointer", textDecoration: "none",
  },
  botaoPrincipal: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "none",
    background: "#DC2626", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", textDecoration: "none",
  },
  botaoPerigo: {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none",
    background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  // container-type: a prévia mede tudo em `cqh` (1% da altura desta moldura).
  moldura: { position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 12, overflow: "hidden", background: "#0B0F17", border: "6px solid #1E293B", containerType: "size" },
  select: { marginLeft: "auto", padding: "6px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 14, background: "#fff" },
  campo: { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 14, boxSizing: "border-box" },
  selo: { marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#DC2626", background: "#fff", border: "1px solid #FECACA", borderRadius: 99, padding: "2px 8px", textTransform: "uppercase" },
  confirmacao: { marginTop: 16, maxWidth: 760, padding: 16, borderRadius: 14, background: "#FFFBEB", border: "1px solid #FDE68A" },
};
