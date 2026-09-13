"use client";

/**
 * A tela em que a loja monta a Trilha Premiada.
 *
 * Desenho: o MAPA em cima, a configuração embaixo. A loja digita "libera no 3º
 * pedido" e vê o prêmio mudar de lugar na trilha no mesmo instante — é a tela
 * se explicando sozinha, sem tutorial. O prêmio se escolhe pela FOTO do
 * cardápio, não por um nome numa lista: quem monta reconhece o produto do
 * mesmo jeito que o cliente vai reconhecer.
 *
 * Nada aqui salva sozinho. O estado sobe para o LoyaltyConfigForm e vai junto
 * no "Salvar Programa de Fidelidade" — um botão de salvar por tela.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_PARADAS,
  avisosDaTrilha,
  nomeDoPremio,
  problemasDaTrilha,
  regrasDaTrilha,
  type ParadaDaTrilha,
  type TipoDePremio,
  type TrilhaPremiada,
} from "@/lib/trilha-premiada";
import MapaDaTrilha from "./MapaDaTrilha";

type Produto = { id: string; name: string; price: number; imageUrl: string | null; category: string | null };

const PRAZOS = [
  { dias: 15, texto: "15 dias" },
  { dias: 30, texto: "30 dias" },
  { dias: 45, texto: "45 dias" },
  { dias: 60, texto: "60 dias" },
  { dias: 90, texto: "90 dias" },
  { dias: 0, texto: "Sem prazo" },
];

const fmt = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export default function TrilhaPremiadaEditor({
  trilha,
  onChange,
}: {
  trilha: TrilhaPremiada;
  onChange: (t: TrilhaPremiada) => void;
}) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregandoProdutos, setCarregandoProdutos] = useState(true);
  const [editando, setEditando] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  // O campo do número enquanto está sendo digitado: sem isto, apagar para
  // trocar "10" por "4" vira "1" no meio do caminho e o mapa pula sozinho.
  const [digitando, setDigitando] = useState<Record<number, string>>({});
  const mapaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/store/trilha-produtos")
      .then((r) => (r.ok ? r.json() : { produtos: [] }))
      .then((d) => setProdutos(Array.isArray(d?.produtos) ? d.produtos : []))
      .catch(() => setProdutos([]))
      .finally(() => setCarregandoProdutos(false));
  }, []);

  const porId = useMemo(() => {
    const m = new Map<string, Produto>();
    for (const p of produtos) m.set(p.id, p);
    return m;
  }, [produtos]);

  const paradas = trilha.paradas;
  const problemas = problemasDaTrilha(trilha);
  const avisos = avisosDaTrilha(trilha);

  const mudar = (patch: Partial<TrilhaPremiada>) => onChange({ ...trilha, ...patch });
  const mudarParada = (i: number, patch: Partial<ParadaDaTrilha>) =>
    mudar({ paradas: paradas.map((p, k) => (k === i ? { ...p, ...patch } : p)) });

  const adicionar = () => {
    const ultimo = paradas.length ? Math.max(...paradas.map((p) => p.pedidos)) : 0;
    mudar({ paradas: [...paradas, { pedidos: ultimo + 3 || 3, tipo: "frete" }] });
  };
  const remover = (i: number) => mudar({ paradas: paradas.filter((_, k) => k !== i) });

  const trocarTipo = (i: number, tipo: TipoDePremio) => {
    const limpo: ParadaDaTrilha = { pedidos: paradas[i].pedidos, tipo };
    if (tipo === "desconto") limpo.valor = paradas[i].valor || 10;
    if (tipo === "produto") {
      limpo.produtoId = paradas[i].produtoId;
      limpo.produtoNome = paradas[i].produtoNome;
    }
    mudar({ paradas: paradas.map((p, k) => (k === i ? limpo : p)) });
  };

  const escolherProduto = (i: number, p: Produto) =>
    mudarParada(i, { tipo: "produto", produtoId: p.id, produtoNome: p.name });

  const fotoDoProduto = (id?: string) => (id ? porId.get(id)?.imageUrl || undefined : undefined);

  // Ordenadas só para DESENHAR. A lista de edição fica na ordem em que a loja
  // criou — reordenar a lista embaixo do dedo de quem digita é desorientador.
  const paradasOrdenadas = useMemo(
    () => [...paradas].sort((a, b) => a.pedidos - b.pedidos),
    [paradas],
  );

  const produtosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return produtos;
    return produtos.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q),
    );
  }, [produtos, busca]);

  const paradaEditada = editando === null ? null : paradas[editando];

  return (
    <div>
      <style>{ESTILO}</style>

      {/* ── Liga/desliga + o que é ──────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 560 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#0F172A" }}>
            🥾 Trilha Premiada
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#64748B", lineHeight: 1.45 }}>
            Cada pedido do cliente é um passo. Você escolhe em quais pedidos ficam os prêmios, o que é cada
            um e em quanto tempo a trilha precisa ser percorrida. O cliente vê o mapa no seu cardápio e
            quantos pedidos faltam para o próximo prêmio.
          </p>
        </div>
        <button
          type="button"
          onClick={() => mudar({ ativa: !trilha.ativa })}
          className="fh-liga"
          style={{
            background: trilha.ativa ? "#DCFCE7" : "#F1F5F9",
            color: trilha.ativa ? "#15803D" : "#475569",
            borderColor: trilha.ativa ? "#86EFAC" : "#CBD5E1",
          }}
        >
          {trilha.ativa ? "✅ Trilha ligada" : "Ligar trilha"}
        </button>
      </div>

      {/* ── O MAPA ──────────────────────────────────────────────────────── */}
      <div ref={mapaRef} style={{ marginBottom: 8 }}>
        <MapaDaTrilha paradas={paradasOrdenadas} fotoDoProduto={fotoDoProduto} onEscolher={(i) => {
          // O mapa recebe a lista ordenada; a edição trabalha na original.
          const alvo = paradasOrdenadas[i];
          setEditando(paradas.indexOf(alvo));
          setBusca("");
        }} />
      </div>
      <p style={{ margin: "0 0 18px", fontSize: "0.75rem", color: "#94A3B8", textAlign: "center" }}>
        É isto que o seu cliente vê. Clique num prêmio do mapa para trocar.
      </p>

      {/* ── AS PARADAS ──────────────────────────────────────────────────── */}
      <div className="fh-caixa">
        <header>
          <b>As paradas</b>
          <span>Digite em qual pedido o prêmio libera e clique na foto para escolher o prêmio.</span>
        </header>
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
          {paradas.length === 0 && (
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#64748B" }}>
              Nenhuma parada ainda. Adicione a primeira abaixo.
            </p>
          )}

          {paradas.map((p, i) => {
            const prod = p.tipo === "produto" && p.produtoId ? porId.get(p.produtoId) : null;
            const foto = prod?.imageUrl || undefined;
            return (
              <div key={i} className="fh-linha">
                <label className="fh-frase">
                  Libera no
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={digitando[i] ?? String(p.pedidos)}
                    onChange={(e) => {
                      setDigitando((d) => ({ ...d, [i]: e.target.value }));
                      const n = parseInt(e.target.value, 10);
                      if (Number.isFinite(n) && n >= 1) mudarParada(i, { pedidos: Math.min(30, n) });
                    }}
                    onBlur={() => setDigitando((d) => { const c = { ...d }; delete c[i]; return c; })}
                  />
                  <span>º pedido</span>
                </label>

                <button type="button" className="fh-escolher" onClick={() => { setEditando(i); setBusca(""); }}>
                  <span className="mini">
                    {foto ? <img src={foto} alt="" /> : <i>{p.tipo === "frete" ? "🛵" : p.tipo === "desconto" ? "🏷️" : "＋"}</i>}
                  </span>
                  <span className="txt">
                    <b>{p.tipo === "produto" && !p.produtoId ? "Escolher o prêmio" : nomeDoPremio(p)}</b>
                    <span>{p.tipo === "produto" && !p.produtoId ? "nenhum produto escolhido" : "trocar prêmio"}</span>
                  </span>
                </button>

                <button type="button" className="fh-remover" onClick={() => remover(i)} title="Remover esta parada">
                  ✕
                </button>
              </div>
            );
          })}

          {paradas.length < MAX_PARADAS && (
            <button type="button" className="fh-add" onClick={adicionar}>
              + Adicionar parada
            </button>
          )}
        </div>
      </div>

      {/* ── O PRAZO ─────────────────────────────────────────────────────── */}
      <div className="fh-caixa">
        <header>
          <b>Em quanto tempo a trilha precisa ser percorrida</b>
          <span>
            O prazo conta do primeiro pedido. Vencido, a contagem volta ao começo — e o prêmio que o
            cliente já ganhou continua sendo dele.
          </span>
        </header>
        <div style={{ padding: "12px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>
          {PRAZOS.map((x) => (
            <button
              key={x.dias}
              type="button"
              className="fh-prazo"
              aria-pressed={trilha.janelaDias === x.dias}
              onClick={() => mudar({ janelaDias: x.dias })}
            >
              {x.texto}
            </button>
          ))}
        </div>
      </div>

      {/* ── O QUE O CLIENTE LÊ ──────────────────────────────────────────── */}
      <div className="fh-caixa">
        <header>
          <b>O que o cliente lê</b>
          <span>Escrito a partir do que você configurou: mudou aqui, mudou lá.</span>
        </header>
        <div style={{ padding: "12px 14px" }}>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {regrasDaTrilha(trilha).map((r, i) => (
              <li key={i} style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.5 }}>{r}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Avisos ──────────────────────────────────────────────────────── */}
      {problemas.length > 0 && (
        <div className="fh-alerta erro">
          <b>Falta resolver antes de ligar:</b>
          <ul>{problemas.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {avisos.length > 0 && (
        <div className="fh-alerta aviso">
          <ul>{avisos.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      {/* ── ESCOLHA DO PRÊMIO ───────────────────────────────────────────── */}
      {paradaEditada && editando !== null && (
        <div className="fh-cortina" onClick={() => setEditando(null)}>
          <div className="fh-folha" onClick={(e) => e.stopPropagation()}>
            <div className="fh-folha-topo">
              <div>
                <b>Prêmio do {paradaEditada.pedidos}º pedido</b>
                <span>O que o cliente ganha ao chegar nesta parada</span>
              </div>
              <button type="button" onClick={() => setEditando(null)} title="Fechar">✕</button>
            </div>

            <div className="fh-tipos">
              {([
                { t: "produto", r: "🍽️ Produto do cardápio" },
                { t: "frete", r: "🛵 Frete grátis" },
                { t: "desconto", r: "🏷️ Desconto" },
              ] as { t: TipoDePremio; r: string }[]).map((x) => (
                <button
                  key={x.t}
                  type="button"
                  aria-pressed={paradaEditada.tipo === x.t}
                  onClick={() => trocarTipo(editando, x.t)}
                >
                  {x.r}
                </button>
              ))}
            </div>

            <div className="fh-folha-corpo">
              {paradaEditada.tipo === "produto" && (
                <>
                  <input
                    className="fh-busca"
                    placeholder="Buscar no cardápio…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                  {carregandoProdutos ? (
                    <p className="fh-nota">Carregando o cardápio…</p>
                  ) : produtosFiltrados.length === 0 ? (
                    <p className="fh-nota">
                      {produtos.length === 0
                        ? "Nenhum produto ativo no cardápio para dar de prêmio."
                        : "Nada com esse nome no cardápio."}
                    </p>
                  ) : (
                    <div className="fh-grelha">
                      {produtosFiltrados.map((x) => (
                        <button
                          key={x.id}
                          type="button"
                          className="fh-item"
                          aria-pressed={paradaEditada.produtoId === x.id}
                          onClick={() => { escolherProduto(editando, x); setEditando(null); }}
                        >
                          {x.imageUrl ? <img src={x.imageUrl} alt="" /> : <div className="sem-foto">🍽️</div>}
                          <div className="txt">
                            <b>{x.name}</b>
                            <span>{fmt(x.price)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {paradaEditada.tipo === "frete" && (
                <p className="fh-nota">
                  O cliente não paga a entrega no pedido seguinte ao que fechou esta parada. Vale para o
                  endereço dele, dentro da sua área de entrega. Se ele escolher retirada, o prêmio fica
                  guardado para o próximo pedido com entrega.
                </p>
              )}

              {paradaEditada.tipo === "desconto" && (
                <div style={{ padding: "4px 2px 8px" }}>
                  <label className="fh-frase" style={{ marginBottom: 10 }}>
                    Desconto de
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={paradaEditada.valor || 10}
                      onChange={(e) => mudarParada(editando, { valor: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
                    />
                    <span>% no pedido</span>
                  </label>
                  <p className="fh-nota" style={{ margin: 0 }}>
                    O desconto incide sobre os itens do pedido — nunca sobre a taxa de entrega.
                  </p>
                </div>
              )}
            </div>

            <div className="fh-folha-pe">
              <button type="button" className="fh-pronto" onClick={() => setEditando(null)}>Pronto</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ESTILO = `
.fh-liga{padding:9px 16px;border-radius:10px;border:1.5px solid;font-size:.84rem;font-weight:800;
  cursor:pointer;font-family:inherit;white-space:nowrap}
.fh-caixa{border:1.5px solid #E2E8F0;border-radius:14px;background:#fff;margin-bottom:14px;overflow:hidden}
.fh-caixa>header{padding:11px 14px;border-bottom:1px solid #F1F5F9;background:#F8FAFC}
.fh-caixa>header b{display:block;font-size:.86rem;font-weight:800;color:#0F172A}
.fh-caixa>header span{display:block;margin-top:3px;font-size:.75rem;color:#64748B;line-height:1.45}

.fh-linha{display:grid;grid-template-columns:176px 1fr 32px;gap:10px;align-items:center;
  padding:9px 11px;border:1px solid #E2E8F0;border-radius:12px;background:#F8FAFC}
.fh-frase{display:flex;align-items:center;gap:6px;font-size:.82rem;font-weight:700;color:#0F172A;white-space:nowrap}
.fh-frase input{width:58px;text-align:center;padding:6px 4px;border-radius:8px;border:1.5px solid #CBD5E1;
  font-size:.9rem;font-weight:800;font-family:inherit;color:#0F172A}
.fh-frase>span{color:#64748B;font-weight:600}

.fh-escolher{display:flex;align-items:center;gap:9px;padding:5px 9px 5px 5px;border:1.5px solid #E2E8F0;
  border-radius:11px;background:#fff;cursor:pointer;text-align:left;font-family:inherit;min-width:0}
.fh-escolher:hover{border-color:#A78BFA}
.fh-escolher .mini{width:42px;height:42px;border-radius:9px;overflow:hidden;background:#F1F5F9;
  display:flex;align-items:center;justify-content:center;flex-shrink:0}
.fh-escolher .mini img{width:100%;height:100%;object-fit:cover}
.fh-escolher .mini i{font-style:normal;font-size:1.15rem;color:#94A3B8}
.fh-escolher .txt{display:flex;flex-direction:column;min-width:0}
.fh-escolher .txt b{font-size:.82rem;font-weight:800;color:#0F172A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fh-escolher .txt span{font-size:.68rem;color:#94A3B8}

.fh-remover{width:30px;height:30px;border-radius:8px;border:1.5px solid #E2E8F0;background:#fff;
  color:#94A3B8;cursor:pointer;font-weight:800;font-family:inherit}
.fh-remover:hover{border-color:#FCA5A5;color:#DC2626;background:#FEF2F2}
.fh-add{padding:9px;border-radius:10px;border:1.5px dashed #CBD5E1;background:#fff;color:#6D28D9;
  font-size:.82rem;font-weight:800;cursor:pointer;font-family:inherit}
.fh-add:hover{border-color:#A78BFA;background:#F5F3FF}

.fh-prazo{padding:8px 14px;border-radius:999px;border:1.5px solid #E2E8F0;background:#fff;
  font-size:.8rem;font-weight:700;color:#475569;cursor:pointer;font-family:inherit}
.fh-prazo[aria-pressed="true"]{border-color:#6D28D9;background:#F5F3FF;color:#6D28D9}

.fh-alerta{border-radius:12px;padding:11px 14px;margin-bottom:14px;font-size:.78rem;line-height:1.5}
.fh-alerta ul{margin:4px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.fh-alerta.erro{background:#FEF2F2;border:1.5px solid #FECACA;color:#B91C1C}
.fh-alerta.aviso{background:#FFFBEB;border:1.5px solid #FDE68A;color:#92400E}

.fh-cortina{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;
  align-items:flex-end;justify-content:center;padding:0}
.fh-folha{background:#fff;width:100%;max-width:560px;max-height:88vh;border-radius:18px 18px 0 0;
  display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.25)}
.fh-folha-topo{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;
  padding:14px 16px;border-bottom:1px solid #F1F5F9}
.fh-folha-topo b{display:block;font-size:.95rem;font-weight:800;color:#0F172A}
.fh-folha-topo span{display:block;font-size:.74rem;color:#64748B;margin-top:2px}
.fh-folha-topo button{width:30px;height:30px;border-radius:50%;border:none;background:#F1F5F9;
  cursor:pointer;font-weight:800;flex-shrink:0;font-family:inherit}
.fh-tipos{display:flex;gap:6px;padding:12px 16px 0;flex-wrap:wrap}
.fh-tipos button{padding:8px 12px;border-radius:999px;border:1.5px solid #E2E8F0;background:#fff;
  font-size:.78rem;font-weight:700;color:#475569;cursor:pointer;font-family:inherit}
.fh-tipos button[aria-pressed="true"]{border-color:#6D28D9;background:#F5F3FF;color:#6D28D9}
.fh-folha-corpo{padding:12px 16px;overflow-y:auto;flex:1}
.fh-folha-pe{padding:10px 16px 14px;border-top:1px solid #F1F5F9}
.fh-pronto{width:100%;padding:11px;border-radius:11px;border:none;background:#6D28D9;color:#fff;
  font-size:.86rem;font-weight:800;cursor:pointer;font-family:inherit}
.fh-busca{width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid #E2E8F0;margin-bottom:10px;
  font-size:.84rem;font-family:inherit;outline:none}
.fh-busca:focus{border-color:#A78BFA}
.fh-grelha{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:9px}
.fh-item{border:2px solid #E2E8F0;border-radius:12px;overflow:hidden;background:#fff;padding:0;
  cursor:pointer;text-align:left;font-family:inherit}
.fh-item:hover{border-color:#A78BFA}
.fh-item[aria-pressed="true"]{border-color:#6D28D9;box-shadow:0 0 0 3px rgba(109,40,217,.18)}
.fh-item img{width:100%;height:88px;object-fit:cover;display:block}
.fh-item .sem-foto{height:88px;display:flex;align-items:center;justify-content:center;
  background:#F1F5F9;font-size:1.6rem}
.fh-item .txt{padding:7px 9px 9px}
.fh-item .txt b{display:block;font-size:.78rem;font-weight:800;color:#0F172A;line-height:1.3}
.fh-item .txt span{display:block;font-size:.72rem;color:#64748B;margin-top:2px}
.fh-nota{font-size:.8rem;color:#64748B;line-height:1.55;margin:0}

@media (min-width:560px){
  .fh-cortina{align-items:center;padding:20px}
  .fh-folha{border-radius:18px}
}
@media (max-width:620px){
  .fh-linha{grid-template-columns:1fr 32px;row-gap:9px}
  .fh-escolher{grid-column:1/-1}
}
`;
