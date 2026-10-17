"use client";

/**
 * Aplicativo da loja — a tela do dono: o que é o app próprio (Play Store e
 * App Store), o celular de demonstração com a marca DA LOJA (logo e nome que
 * ela já tem no FireHub), os preços e o pedido para a FireHub desenvolver.
 *
 * Douglas, 17/10/2026: "R$ 149 só Android, R$ 149 só Apple, R$ 197 os dois
 * (promoção, desconto); uma página na barra lateral para o pessoal solicitar
 * e a gente desenvolver". O app é o projeto apps/loja (um por marca).
 */

import { useCallback, useEffect, useState } from "react";
import { Smartphone, Bell, MapPin, UtensilsCrossed, ClipboardList, Store, CheckCircle2, BadgePercent, Sparkles, MessageCircle, Apple, Play } from "lucide-react";

type Plataformas = "android" | "apple" | "ambos";
type Solicitacao = { id: string; plataformas: Plataformas; nomeDoApp: string; contato: string; observacao: string | null; status: string; criadoEm: string; atualizadoEm: string };
type Dados = { loja: { nome: string; slug: string | null; logo: string | null; telefone: string }; precos: Record<Plataformas, number>; solicitacao: Solicitacao | null };
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

const fmtR = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const ROTULO: Record<Plataformas, string> = { android: "Só Android", apple: "Só Apple (iPhone)", ambos: "Android + Apple" };

export default function AplicativoClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState(false);

  const [plataformas, setPlataformas] = useState<Plataformas>("ambos");
  const [nomeDoApp, setNomeDoApp] = useState("");
  const [contato, setContato] = useState("");
  const [observacao, setObservacao] = useState("");

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/aplicativo", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
      const s: Solicitacao | null = j.solicitacao;
      setPlataformas(s?.plataformas || "ambos");
      setNomeDoApp(s?.nomeDoApp || j.loja.nome || "");
      setContato(s?.contato || j.loja.telefone || "");
      setObservacao(s?.observacao || "");
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function pedir() {
    setSalvando(true);
    try {
      const r = await fetch("/api/store/aplicativo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plataformas, nomeDoApp, contato, observacao }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu certo.");
      setAviso({ tipo: "ok", titulo: "Pedido enviado!", detalhe: "A FireHub recebeu. A gente te chama no WhatsApp para combinar logo, cores e os próximos passos." });
      setEditando(false);
      await carregar();
      document.getElementById("al-pedido")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;

  const { loja, precos, solicitacao } = dados;
  const pedidoAberto = solicitacao && !editando;
  const irAoPedido = () => document.getElementById("al-pedido")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="al" style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 60px" }}>
      <style>{CSS}</style>
      {aviso && (
        <div role="status" onClick={() => setAviso(null)} style={{
          position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          width: "min(460px, calc(100vw - 24px))", background: aviso.tipo === "ok" ? "#ECFDF5" : "#FEF2F2",
          borderLeft: `4px solid ${aviso.tipo === "ok" ? "#059669" : "#DC2626"}`, borderRadius: 12, padding: "12px 14px",
          boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
        }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
          {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "#0F172A", display: "grid", placeItems: "center" }}><Smartphone size={24} color="#FACC15" /></span>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", margin: 0 }}>Aplicativo da loja</h1>
        {solicitacao && <span className="al-selo-pedido">PEDIDO ENVIADO</span>}
      </div>

      {/* ── Hero: a promessa + o celular com a marca da loja ── */}
      <section className="al-hero">
        <div>
          <span className="al-selo">Play Store e App Store</span>
          <h2>O aplicativo da <span>{loja.nome}</span>, no celular dos seus clientes.</h2>
          <p>
            Seu nome, sua logo e seu cardápio na loja de aplicativos. O cliente baixa, pede em dois toques e recebe aviso no celular
            quando o pedido sai e quando o motoboy está chegando. Sem taxa por pedido.
          </p>
          <div className="al-acoes">
            <button className="al-cta" onClick={irAoPedido}>{solicitacao ? "Ver o meu pedido" : "Quero o meu aplicativo"}</button>
            <div className="al-preco-curto">A partir de <b>{fmtR(precos.android)}/mês</b> · os dois sistemas por <b>{fmtR(precos.ambos)}</b></div>
          </div>
          <ul className="al-garantias">
            <li><CheckCircle2 size={15} /> Mesmo cardápio do painel</li>
            <li><CheckCircle2 size={15} /> Aviso no celular do cliente</li>
            <li><CheckCircle2 size={15} /> Motoboy ao vivo no mapa</li>
          </ul>
        </div>
        <Celular loja={loja} />
      </section>

      {/* ── Benefícios ── */}
      <section>
        <h3 className="al-titulo">O que o seu cliente ganha (e você também)</h3>
        <div className="al-cards">
          {[
            { icone: Store, titulo: "Sua marca na tela inicial", texto: "O ícone da sua loja fica no celular do cliente. Ele não precisa procurar você num aplicativo de terceiros." },
            { icone: Bell, titulo: "Aviso de cada etapa", texto: "“Pedido aceito”, “saiu para entrega” e “chegando” aparecem como notificação no celular dele." },
            { icone: MapPin, titulo: "Motoboy ao vivo", texto: "Quando o pedido sai, o cliente acompanha o motoboy no mapa e recebe aviso a 500 m da porta." },
            { icone: UtensilsCrossed, titulo: "Cardápio sempre igual", texto: "O cardápio é o do painel: mudou o preço ou pausou um sabor, mudou no aplicativo na hora." },
            { icone: BadgePercent, titulo: "Sem taxa por pedido", texto: "Pedido pelo seu aplicativo é pedido direto: sem comissão de marketplace, com o seu robô e o seu caixa." },
            { icone: Sparkles, titulo: "Mais de uma unidade?", texto: "Um aplicativo só para a marca: o cliente escolhe a unidade pelo bairro ou cidade." },
          ].map((b) => (
            <div key={b.titulo} className="al-card">
              <span className="al-card-icone"><b.icone size={20} /></span>
              <b>{b.titulo}</b>
              <span>{b.texto}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Preços ── */}
      <section id="al-planos">
        <h3 className="al-titulo">Escolha onde o aplicativo vai estar</h3>
        <p className="al-sub">Mensalidade fixa, sem taxa por pedido. Toque num plano.</p>
        <div className="al-planos">
          {(["android", "apple", "ambos"] as Plataformas[]).map((p) => (
            <button key={p} className={`al-plano${plataformas === p ? " on" : ""}${p === "ambos" ? " destaque" : ""}`}
              onClick={() => { setPlataformas(p); if (solicitacao && !editando) setEditando(true); }} aria-pressed={plataformas === p}>
              {p === "ambos" && <span className="al-faixa">Promoção · mais escolhido</span>}
              <span className="al-plano-icones">
                {(p === "android" || p === "ambos") && <Play size={18} />}
                {(p === "apple" || p === "ambos") && <Apple size={18} />}
              </span>
              <b>{ROTULO[p]}</b>
              <span className="al-plano-preco">{fmtR(precos[p])}<small>/mês</small></span>
              {p === "ambos"
                ? <span className="al-plano-nota">Em vez de {fmtR(precos.android + precos.apple)}: economia de {fmtR(precos.android + precos.apple - precos.ambos)} por mês</span>
                : <span className="al-plano-nota">{p === "android" ? "Google Play, para celulares Android" : "App Store, para iPhone"}</span>}
            </button>
          ))}
        </div>
      </section>

      {/* ── Como funciona ── */}
      <section>
        <h3 className="al-titulo">Como funciona</h3>
        <ol className="al-passos">
          <li><span>1</span><div><b>Você pede aqui</b>Escolhe o plano e manda o pedido. A FireHub te chama no WhatsApp.</div></li>
          <li><span>2</span><div><b>A gente monta o aplicativo</b>Com a sua logo, suas cores e o seu cardápio, do jeito que já está no painel.</div></li>
          <li><span>3</span><div><b>Conta nas lojas de aplicativos</b>O aplicativo é publicado no nome da sua loja. A gente te guia na conta do Google (taxa única) e da Apple (taxa anual) — a FireHub entra como administradora.</div></li>
          <li><span>4</span><div><b>Publicado</b>Seus clientes baixam na Play Store e na App Store. Cada atualização do cardápio já aparece lá.</div></li>
        </ol>
      </section>

      {/* ── O pedido ── */}
      <section id="al-pedido" className="al-pedido">
        {pedidoAberto ? (
          <div className="al-pedido-feito">
            <div className="al-pedido-cabeca">
              <CheckCircle2 size={22} color="#059669" />
              <div>
                <b>Pedido enviado em {new Date(solicitacao.criadoEm).toLocaleDateString("pt-BR")}</b>
                <small>A FireHub vai te chamar no WhatsApp <b>{solicitacao.contato}</b> para combinar os próximos passos.</small>
              </div>
            </div>
            <dl>
              <div><dt>Aplicativo</dt><dd>{solicitacao.nomeDoApp}</dd></div>
              <div><dt>Plano</dt><dd>{ROTULO[solicitacao.plataformas]} · {fmtR(precos[solicitacao.plataformas])}/mês</dd></div>
              {solicitacao.observacao && <div><dt>Observação</dt><dd>{solicitacao.observacao}</dd></div>}
            </dl>
            <button className="al-link" onClick={() => setEditando(true)}>Mudar o pedido</button>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); pedir(); }}>
            <h3 className="al-titulo" style={{ color: "white" }}>{solicitacao ? "Mudar o meu pedido" : "Pedir o meu aplicativo"}</h3>
            <p className="al-sub" style={{ color: "#A5F3FC" }}>Sem compromisso: a gente conversa antes de começar.</p>
            <div className="al-campos">
              <label>Nome do aplicativo
                <input value={nomeDoApp} onChange={(e) => setNomeDoApp(e.target.value)} maxLength={60} placeholder={loja.nome} required />
                <small>Como vai aparecer na loja de aplicativos e embaixo do ícone.</small>
              </label>
              <label>WhatsApp para a gente falar com você
                <input value={contato} onChange={(e) => setContato(e.target.value)} maxLength={40} placeholder="(22) 99999-9999" inputMode="tel" required />
              </label>
              <label className="al-campo-largo">Plano
                <div className="al-plano-escolhido">
                  {(["android", "apple", "ambos"] as Plataformas[]).map((p) => (
                    <button type="button" key={p} className={plataformas === p ? "on" : ""} onClick={() => setPlataformas(p)}>{ROTULO[p]} · {fmtR(precos[p])}</button>
                  ))}
                </div>
              </label>
              <label className="al-campo-largo">Alguma observação? <span style={{ fontWeight: 400, opacity: .7 }}>(opcional)</span>
                <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={600} rows={3} placeholder="Ex.: tenho duas unidades; quero a cor vermelha da logo; já tenho conta na Google Play…" />
              </label>
            </div>
            <div className="al-acoes" style={{ marginTop: 16 }}>
              <button className="al-cta" type="submit" disabled={salvando}>{salvando ? "Enviando…" : solicitacao ? "Salvar o pedido" : "Quero o meu aplicativo"}</button>
              {solicitacao && <button type="button" className="al-link" onClick={() => { setEditando(false); carregar(); }}>Cancelar</button>}
              <div className="al-preco-curto">{ROTULO[plataformas]} · <b>{fmtR(precos[plataformas])}/mês</b></div>
            </div>
          </form>
        )}
      </section>

      {/* ── Dúvidas ── */}
      <section>
        <h3 className="al-titulo">Dúvidas</h3>
        <Duvidas />
      </section>
    </div>
  );
}

/** O celular de demonstração com a marca da loja. As abas são as do app de verdade (Cardápio, Pedidos, Loja). */
function Celular({ loja }: { loja: Dados["loja"] }) {
  const [aba, setAba] = useState<"cardapio" | "pedidos" | "loja">("cardapio");
  const [etapa, setEtapa] = useState(0);
  const AVISOS = ["Pedido aceito! Já estamos preparando 👨‍🍳", "Seu pedido saiu para entrega 🛵", "Chegando! O motoboy está a 300 m 📍"];
  useEffect(() => {
    const t = setInterval(() => setEtapa((e) => (e + 1) % (AVISOS.length + 1)), 3200);
    return () => clearInterval(t);
  }, [AVISOS.length]);
  const inicial = (loja.nome || "L").trim().charAt(0).toUpperCase();
  return (
    <div className="al-celular" aria-label="Demonstração do aplicativo">
      <div className="al-cel-status"><span>9:41</span><span>●●● ▲ ▮</span></div>
      <div className="al-cel-topo">
        {loja.logo ? <img src={loja.logo} alt="" /> : <span className="al-cel-logo">{inicial}</span>}
        <div><b>{loja.nome}</b><small>Aberto · entrega e retirada</small></div>
      </div>
      <div className={`al-cel-aviso${etapa > 0 ? " on" : ""}`} key={etapa}>
        <span className="al-cel-aviso-icone">{loja.logo ? <img src={loja.logo} alt="" /> : inicial}</span>
        <div><b>{loja.nome}</b><span>{AVISOS[Math.max(0, etapa - 1)]}</span></div>
      </div>
      <div className="al-cel-corpo">
        {aba === "cardapio" && (
          <>
            <div className="al-cel-busca">🔍 Buscar no cardápio</div>
            <div className="al-cel-cats"><span className="on">Destaques</span><span>Lanches</span><span>Pizzas</span><span>Bebidas</span></div>
            {["Combo da casa", "Clássico da loja", "Mais pedido da semana"].map((n, i) => (
              <div key={n} className="al-cel-item"><span className="al-cel-foto" /><div><b>{n}</b><small>Seu cardápio, igual ao painel</small><em>R$ {[49.9, 34.9, 29.9][i].toFixed(2).replace(".", ",")}</em></div><span className="al-cel-mais">+</span></div>
            ))}
          </>
        )}
        {aba === "pedidos" && (
          <div className="al-cel-pedido">
            <b>Pedido #1042 · hoje</b>
            <ol>
              <li className="ok">Recebido</li><li className="ok">Em preparo</li><li className={etapa >= 2 ? "ok" : ""}>Saiu para entrega</li><li className={etapa >= 3 ? "ok" : ""}>Chegando</li>
            </ol>
            <div className="al-cel-mapa"><MapPin size={16} /> Acompanhar o motoboy no mapa</div>
          </div>
        )}
        {aba === "loja" && (
          <div className="al-cel-loja">
            <button><MessageCircle size={15} /> Falar no WhatsApp</button>
            <button><MapPin size={15} /> Como chegar</button>
            <button><Bell size={15} /> Avisos da loja</button>
          </div>
        )}
      </div>
      <div className="al-cel-abas">
        <button className={aba === "cardapio" ? "on" : ""} onClick={() => setAba("cardapio")}><UtensilsCrossed size={16} />Cardápio</button>
        <button className={aba === "pedidos" ? "on" : ""} onClick={() => setAba("pedidos")}><ClipboardList size={16} />Pedidos</button>
        <button className={aba === "loja" ? "on" : ""} onClick={() => setAba("loja")}><Store size={16} />Loja</button>
      </div>
    </div>
  );
}

function Duvidas() {
  const [aberta, setAberta] = useState<number | null>(0);
  const P: [string, string][] = [
    ["Preciso de CNPJ?", "Para publicar na Play Store e na App Store, sim: o aplicativo sai no nome da sua loja, e as lojas de aplicativos pedem a conta da empresa. A FireHub te guia no cadastro e entra como administradora."],
    ["Quanto custa a conta nas lojas de aplicativos?", "É cobrado pelo Google e pela Apple, não pela FireHub: o Google cobra uma taxa única e a Apple uma taxa anual. A gente te passa os valores atuais no WhatsApp."],
    ["O cardápio do aplicativo é separado?", "Não. É o mesmo cardápio do painel: preço, foto, pausa e promoção mudam no aplicativo na hora."],
    ["Os pedidos caem onde?", "No mesmo painel de pedidos, com o mesmo robô, impressão e caixa. Pedido pelo aplicativo é pedido direto da loja, sem comissão."],
    ["E a mensalidade?", "É fixa, pelo plano escolhido, sem taxa por pedido. A FireHub combina o início com você quando o aplicativo estiver publicado."],
  ];
  return (
    <div className="al-faq">
      {P.map(([p, r], i) => (
        <div key={p} className={`al-faq-item${aberta === i ? " on" : ""}`}>
          <button aria-expanded={aberta === i} onClick={() => setAberta(aberta === i ? null : i)}>{p}<span>{aberta === i ? "−" : "+"}</span></button>
          {aberta === i && <p>{r}</p>}
        </div>
      ))}
    </div>
  );
}

const CSS = `
.al { color: #0F172A; display: grid; gap: 36px; }
.al section { min-width: 0; }
.al-selo-pedido { font-size: 12px; font-weight: 800; color: #059669; background: #ECFDF5; padding: 4px 10px; border-radius: 999px; }
.al-hero { display: grid; grid-template-columns: minmax(0,1.15fr) minmax(0,.85fr); gap: 28px; align-items: center;
  background: radial-gradient(120% 140% at 0% 0%, #7C2D12 0%, #0B1220 55%); color: white; border-radius: 22px; padding: 32px; overflow: hidden; }
.al-selo { display: inline-block; font-size: 12px; font-weight: 800; color: #FDE68A; background: rgba(250,204,21,.14); border: 1px solid rgba(250,204,21,.35); padding: 5px 11px; border-radius: 999px; }
.al-hero h2 { font-size: clamp(26px, 4vw, 38px); line-height: 1.08; font-weight: 900; margin: 14px 0 12px; letter-spacing: -.02em; }
.al-hero h2 span { color: #FACC15; }
.al-hero p { font-size: 15.5px; line-height: 1.55; opacity: .9; margin: 0; max-width: 520px; }
.al-acoes { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 22px; }
.al-cta { background: #FACC15; color: #0F172A; border: 0; border-radius: 12px; padding: 14px 22px; font-weight: 900; font-size: 15.5px; cursor: pointer;
  box-shadow: 0 8px 24px rgba(250,204,21,.35); transition: transform .15s ease, box-shadow .15s ease; }
.al-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 28px rgba(250,204,21,.45); }
.al-cta:disabled { opacity: .7; cursor: wait; }
.al-link { background: none; border: 0; color: #67E8F9; font-weight: 700; cursor: pointer; font-size: 14px; padding: 8px 4px; }
.al-preco-curto { font-size: 13px; opacity: .9; }
.al-garantias { list-style: none; padding: 0; margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; opacity: .92; }
.al-garantias li { display: inline-flex; align-items: center; gap: 6px; }
.al-garantias svg { color: #34D399; }

.al-celular { background: #F8FAFC; color: #0F172A; border-radius: 30px; border: 7px solid #1E293B; box-shadow: 0 30px 60px rgba(0,0,0,.45); overflow: hidden;
  width: 100%; max-width: 320px; justify-self: center; position: relative; display: grid; grid-template-rows: auto auto 1fr auto; min-height: 520px; }
.al-cel-status { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; padding: 8px 16px 0; color: #0F172A; }
.al-cel-topo { display: flex; align-items: center; gap: 10px; padding: 10px 14px 12px; }
.al-cel-topo img, .al-cel-logo { width: 40px; height: 40px; border-radius: 12px; object-fit: cover; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; font-size: 18px; }
.al-cel-topo b { display: block; font-size: 15px; }
.al-cel-topo small { font-size: 11.5px; color: #059669; font-weight: 700; }
.al-cel-aviso { position: absolute; left: 10px; right: 10px; top: 8px; z-index: 3; display: flex; gap: 10px; align-items: center; background: rgba(255,255,255,.96); border-radius: 16px; padding: 10px 12px;
  box-shadow: 0 12px 30px rgba(2,6,23,.25); opacity: 0; transform: translateY(-20px); transition: opacity .35s, transform .35s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.al-cel-aviso.on { opacity: 1; transform: none; }
.al-cel-aviso-icone { width: 34px; height: 34px; border-radius: 9px; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; overflow: hidden; flex: none; }
.al-cel-aviso-icone img { width: 100%; height: 100%; object-fit: cover; }
.al-cel-aviso b { display: block; font-size: 12.5px; }
.al-cel-aviso span { font-size: 12.5px; color: #334155; }
.al-cel-corpo { padding: 0 12px 12px; overflow: hidden; }
.al-cel-busca { background: white; border: 1px solid #E2E8F0; border-radius: 10px; padding: 8px 10px; font-size: 12px; color: #94A3B8; margin-bottom: 10px; }
.al-cel-cats { display: flex; gap: 6px; margin-bottom: 10px; overflow: hidden; }
.al-cel-cats span { font-size: 11.5px; font-weight: 700; padding: 5px 10px; border-radius: 999px; background: white; border: 1px solid #E2E8F0; white-space: nowrap; }
.al-cel-cats span.on { background: #0F172A; color: #FACC15; border-color: #0F172A; }
.al-cel-item { display: flex; gap: 10px; align-items: center; background: white; border: 1px solid #E2E8F0; border-radius: 12px; padding: 8px; margin-bottom: 8px; }
.al-cel-foto { width: 52px; height: 52px; border-radius: 10px; background: linear-gradient(135deg, #FDE68A, #F97316); flex: none; }
.al-cel-item div { flex: 1; min-width: 0; }
.al-cel-item b { display: block; font-size: 13px; }
.al-cel-item small { display: block; font-size: 11px; color: #64748B; }
.al-cel-item em { font-style: normal; font-weight: 800; font-size: 12.5px; color: #059669; }
.al-cel-mais { width: 28px; height: 28px; border-radius: 999px; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; }
.al-cel-pedido { background: white; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px; font-size: 13px; }
.al-cel-pedido ol { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 8px; }
.al-cel-pedido li { display: flex; align-items: center; gap: 8px; color: #94A3B8; }
.al-cel-pedido li::before { content: ""; width: 10px; height: 10px; border-radius: 999px; background: #E2E8F0; }
.al-cel-pedido li.ok { color: #0F172A; font-weight: 700; }
.al-cel-pedido li.ok::before { background: #059669; }
.al-cel-mapa { display: flex; align-items: center; gap: 6px; background: #ECFDF5; color: #065F46; font-weight: 700; border-radius: 10px; padding: 8px 10px; font-size: 12.5px; }
.al-cel-loja { display: grid; gap: 8px; }
.al-cel-loja button { display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px; font: inherit; font-size: 13px; font-weight: 700; color: #0F172A; }
.al-cel-abas { display: grid; grid-template-columns: repeat(3, 1fr); background: white; border-top: 1px solid #E2E8F0; }
.al-cel-abas button { background: none; border: 0; padding: 10px 4px 12px; display: grid; justify-items: center; gap: 3px; font: inherit; font-size: 11px; font-weight: 700; color: #94A3B8; cursor: pointer; }
.al-cel-abas button.on { color: #0F172A; }

.al-titulo { font-size: 22px; font-weight: 900; margin: 0 0 4px; letter-spacing: -.01em; }
.al-sub { margin: 0 0 14px; color: #64748B; font-size: 14px; }
.al-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.al-card { display: grid; gap: 6px; background: white; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; }
.al-card b { font-size: 15px; }
.al-card > span:last-child { font-size: 13px; color: #64748B; line-height: 1.4; }
.al-card-icone { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: #FEF3C7; color: #B45309; }

.al-planos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.al-plano { position: relative; text-align: left; display: grid; gap: 6px; background: white; border: 2px solid #E2E8F0; border-radius: 16px; padding: 20px 16px 16px; cursor: pointer; font: inherit; color: inherit;
  transition: border-color .15s, box-shadow .15s, transform .15s; }
.al-plano:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(15,23,42,.08); }
.al-plano.on { border-color: #0F172A; box-shadow: 0 0 0 3px rgba(250,204,21,.45); }
.al-plano.destaque { background: #0F172A; color: white; border-color: #0F172A; }
.al-plano.destaque.on { box-shadow: 0 0 0 3px #FACC15; }
.al-faixa { position: absolute; top: -11px; left: 14px; font-size: 11px; font-weight: 900; background: #FACC15; color: #0F172A; padding: 3px 10px; border-radius: 999px; }
.al-plano-icones { display: flex; gap: 6px; color: #64748B; }
.al-plano.destaque .al-plano-icones { color: #FACC15; }
.al-plano b { font-size: 15px; }
.al-plano-preco { font-size: 28px; font-weight: 900; letter-spacing: -.02em; }
.al-plano-preco small { font-size: 13px; font-weight: 700; opacity: .7; margin-left: 2px; }
.al-plano-nota { font-size: 12.5px; color: #64748B; line-height: 1.35; }
.al-plano.destaque .al-plano-nota { color: #A5F3FC; }

.al-passos { list-style: none; padding: 0; margin: 12px 0 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.al-passos li { display: flex; gap: 12px; align-items: flex-start; background: white; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; font-size: 13.5px; color: #475569; }
.al-passos li b { display: block; color: #0F172A; font-size: 15px; margin-bottom: 2px; }
.al-passos li > span { flex: none; width: 30px; height: 30px; border-radius: 999px; background: #0B1220; color: #FACC15; font-weight: 900; display: grid; place-items: center; }

.al-pedido { background: #0B1220; color: white; border-radius: 20px; padding: 24px 28px; }
.al-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.al-campos label { display: grid; gap: 6px; align-content: start; font-size: 13.5px; font-weight: 700; }
.al-campos small { font-weight: 400; color: #94A3B8; font-size: 12px; }
.al-campos input, .al-campos textarea { font: inherit; font-size: 15px; border-radius: 10px; border: 1px solid #334155; background: #0F172A; color: white; padding: 11px 12px; width: 100%; box-sizing: border-box; }
.al-campos input:focus, .al-campos textarea:focus { outline: 2px solid #FACC15; border-color: transparent; }
.al-campo-largo { grid-column: 1 / -1; }
.al-plano-escolhido { display: flex; gap: 8px; flex-wrap: wrap; }
.al-plano-escolhido button { font: inherit; font-size: 13px; font-weight: 700; border-radius: 999px; padding: 8px 14px; border: 1px solid #334155; background: #0F172A; color: #CBD5E1; cursor: pointer; }
.al-plano-escolhido button.on { background: #FACC15; color: #0F172A; border-color: #FACC15; }
.al-pedido-feito dl { display: grid; gap: 8px; margin: 16px 0 6px; }
.al-pedido-feito dl div { display: grid; grid-template-columns: 110px 1fr; gap: 10px; font-size: 14px; }
.al-pedido-feito dt { color: #94A3B8; }
.al-pedido-feito dd { margin: 0; }
.al-pedido-cabeca { display: flex; gap: 12px; align-items: flex-start; }
.al-pedido-cabeca > div > b { display: block; font-size: 17px; }
.al-pedido-cabeca small { display: block; font-size: 13.5px; color: #CBD5E1; margin-top: 2px; }

.al-faq { display: grid; gap: 8px; margin-top: 10px; }
.al-faq-item { border: 1px solid #E2E8F0; border-radius: 12px; background: white; overflow: hidden; }
.al-faq-item button { width: 100%; display: flex; justify-content: space-between; gap: 12px; background: none; border: 0; padding: 14px 16px; font: inherit; font-weight: 800; font-size: 14.5px; color: #0F172A; text-align: left; cursor: pointer; }
.al-faq-item button span { color: #B45309; font-size: 18px; line-height: 1; }
.al-faq-item p { margin: 0; padding: 0 16px 14px; font-size: 14px; color: #475569; line-height: 1.5; }

@media (max-width: 760px) {
  .al-hero { grid-template-columns: 1fr; padding: 22px 18px; }
  .al-planos, .al-passos, .al-campos { grid-template-columns: 1fr; }
  .al-planos { padding-top: 6px; }
  .al-pedido { padding: 22px 18px; }
  .al-cta { width: 100%; }
}
`;
