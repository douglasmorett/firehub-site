"use client";

/**
 * Aplicativo da loja — a página de venda do app próprio (Play Store e App Store).
 *
 * Douglas, 17/10/2026: "quero fotos (pode usar as da Hakim como exemplo);
 * destaque os planos, principalmente o premium; destaque muitos benefícios —
 * notificação push sem gastar nenhum real, base de clientes realmente sua,
 * controle total dos clientes, aumente suas vendas; uma página que converte,
 * que o cara deseja o aplicativo. O 'quero meu aplicativo' chama a gente no
 * WhatsApp; a ativação é manual e cobra no boleto, junto com a mensalidade."
 *
 * - As fotos são do cardápio da própria loja; sem foto suficiente, as da Hakim
 *   (GET /api/store/aplicativo → `fotos`, `fotosDeExemplo`).
 * - Os números de venda têm fonte escrita embaixo (estudos de fora, não do
 *   FireHub): não inventar porcentagem.
 * - O botão abre o WhatsApp de vendas com a mensagem pronta e anota o clique
 *   (lib/app-da-loja/solicitacao.ts). Quem ativa é o admin (plano.ts).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Bell, MapPin, UtensilsCrossed, ClipboardList, Store, CheckCircle2, Users, TrendingUp, ShieldCheck, Send, Apple, Play, MessageCircle, Crown, Calculator, Repeat, Gift } from "lucide-react";
import { PRECO_DO_MULTIMARCAS } from "@/lib/multimarcas/preco";

type Plataformas = "android" | "apple" | "ambos";
type Foto = { nome: string; preco: number; foto: string; categoria: string };
type Dados = {
  loja: { nome: string; slug: string | null; logo: string | null };
  fotos: Foto[];
  fotosDeExemplo: boolean;
  precos: Record<Plataformas, number>;
  plano: { ativo: boolean; plataformas: Plataformas | null; valor: number; ativoDesde: string | null };
  whatsapp: string;
};

const fmtR = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;
const fmtInt = (v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
const ROTULO: Record<Plataformas, string> = { android: "Só Android", apple: "Só Apple (iPhone)", ambos: "Android + Apple" };

export default function AplicativoClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/aplicativo", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  if (erro) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;

  const { loja, precos, plano } = dados;

  /** Abre o WhatsApp de vendas com a mensagem pronta e anota o clique (não segura o WhatsApp). */
  const quero = (p: Plataformas) => {
    const texto = `Oi! Quero o meu aplicativo próprio 📱\nLoja: ${loja.nome}\nPlano: ${ROTULO[p]} (${fmtR(precos[p])}/mês)`;
    window.open(`https://wa.me/${dados.whatsapp}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
    fetch("/api/store/aplicativo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plataformas: p }) }).catch(() => {});
  };
  const verPlanos = () => document.getElementById("al-planos")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="al" style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px" }}>
      <style>{CSS}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "#0F172A", display: "grid", placeItems: "center" }}><Smartphone size={24} color="#FACC15" /></span>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", margin: 0 }}>Aplicativo da loja</h1>
        {plano.ativo && <span className="al-selo-ativo">ATIVO · {ROTULO[plano.plataformas!].toUpperCase()}</span>}
      </div>

      {plano.ativo && (
        <div className="al-ativo">
          <CheckCircle2 size={22} />
          <div>
            <b>O seu aplicativo está contratado: {ROTULO[plano.plataformas!]}</b>
            <span>{fmtR(plano.valor)}/mês no boleto da mensalidade do FireHub, desde {new Date(plano.ativoDesde!).toLocaleDateString("pt-BR")}. Dúvidas ou mudança de plano: fale com o nosso time.</span>
          </div>
          <a className="al-btn-claro" href={`https://wa.me/${dados.whatsapp}?text=${encodeURIComponent(`Oi! Sou da ${loja.nome} e quero falar sobre o meu aplicativo.`)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> Falar com o time</a>
        </div>
      )}

      {/* ── Hero ── */}
      <section className="al-hero">
        <div className="al-hero-texto">
          <span className="al-selo">Play Store e App Store · com a sua marca</span>
          <h2>Seus clientes pedindo <span>direto de você</span>. Sem comissão. Com a sua marca.</h2>
          <p>
            O aplicativo da <b>{loja.nome}</b> no celular dos seus clientes: o ícone da sua loja na tela inicial, o seu cardápio
            e promoção chegando por notificação — sem pagar por mensagem e sem dividir o pedido com ninguém.
          </p>
          <div className="al-acoes">
            <button className="al-cta" onClick={() => quero("ambos")}><MessageCircle size={18} /> Quero o meu aplicativo</button>
            <button className="al-btn-claro" onClick={verPlanos}>Ver os planos</button>
          </div>
          <div className="al-numeros">
            <div><b>+65%</b><span>pedidos de quem instalou o app, em 6 meses¹</span></div>
            <div><b>10 dias</b><span>antes: o cliente do canal próprio volta mais rápido²</span></div>
            <div><b>R$ 0</b><span>por notificação enviada</span></div>
          </div>
        </div>
        <div className="al-hero-visual">
          <Celular loja={loja} fotos={dados.fotos} />
          <div className="al-flutua al-flutua-push">
            <span className="al-flutua-icone">{loja.logo ? <img src={loja.logo} alt="" /> : loja.nome.charAt(0)}</span>
            <div><b>{loja.nome}</b><small>🔥 Só hoje: frete grátis no app!</small></div>
          </div>
          <div className="al-flutua al-flutua-pedido"><TrendingUp size={16} /> <b>Novo pedido pelo app</b></div>
        </div>
      </section>

      {/* ── Planos (logo depois do hero, com o premium em destaque) ── */}
      <section id="al-planos">
        <div className="al-cab">
          <span className="al-sobre">Planos</span>
          <h3 className="al-titulo">Escolha onde a sua loja vai estar</h3>
          <p className="al-sub">Mensalidade fixa no mesmo boleto do FireHub. Sem taxa por pedido, sem comissão.</p>
        </div>
        <div className="al-planos">
          <Plano p="android" preco={precos.android} titulo="Só Android" sub="Google Play" icones={<Play size={20} />}
            itens={["App na Google Play com a sua marca", "Notificação push ilimitada", "Pedidos, rastreio e motoboy ao vivo"]} quero={quero} ativo={plano.plataformas === "android"} />
          <PlanoPremium precos={precos} quero={quero} ativo={plano.plataformas === "ambos"} />
          <Plano p="apple" preco={precos.apple} titulo="Só Apple" sub="App Store (iPhone)" icones={<Apple size={20} />}
            itens={["App na App Store com a sua marca", "Notificação push ilimitada", "Pedidos, rastreio e motoboy ao vivo"]} quero={quero} ativo={plano.plataformas === "apple"} />
        </div>
        {/* Douglas, 17/10/2026: quem assina os dois (Android + Apple) não paga o Multimarcas — dito aqui e na página do Multimarcas. */}
        <div className="al-bonus">
          <span className="al-bonus-icone"><Gift size={22} /></span>
          <div>
            <b>Bônus do Premium: o Multimarcas sai de cortesia.</b>
            <span>Assinando o aplicativo no Android <b>e</b> no iPhone ({fmtR(precos.ambos)}/mês), você não paga o Multimarcas ({fmtR(PRECO_DO_MULTIMARCAS)}/mês): todas as suas marcas numa página e no aplicativo, com uma sacola só. Com uma plataforma só, o Multimarcas é cobrado normalmente.</span>
          </div>
          <a className="al-btn-claro" href="/store/multimarcas">Conhecer o Multimarcas</a>
        </div>
      </section>

      {/* ── Benefícios ── */}
      <section>
        <div className="al-cab">
          <span className="al-sobre">Por que ter o seu</span>
          <h3 className="al-titulo">O cliente é seu. O lucro também.</h3>
        </div>
        <div className="al-beneficios">
          <Beneficio destaque icone={Send} titulo="Notificação push sem gastar nenhum real"
            texto="Promoção do dia, prato novo, cupom de aniversário: chega na tela do celular do cliente na hora. Sem pagar por disparo, sem limite de mensagens." />
          <Beneficio destaque icone={Users} titulo="Uma base de clientes realmente sua"
            texto="No marketplace o cliente é da plataforma. No seu aplicativo, cada cadastro, telefone e pedido fica com você." />
          <Beneficio destaque icone={ShieldCheck} titulo="Controle total dos seus clientes"
            texto="Quem pede, o quê, quanto e com que frequência. Você sabe quem sumiu e chama de volta." />
          <Beneficio destaque icone={TrendingUp} titulo="Aumente as suas vendas"
            texto="Quem tem o app no celular pede mais vezes: em estudo com 1.337 restaurantes, os pedidos subiram 65% em 6 meses e as vendas desses clientes, 129% em um ano.¹" />
          <Beneficio icone={Bell} titulo="Aviso de cada etapa" texto="“Pedido aceito”, “saiu para entrega” e “chegando” como notificação no celular do cliente." />
          <Beneficio icone={MapPin} titulo="Motoboy ao vivo" texto="O cliente acompanha o motoboy no mapa e recebe aviso a 500 m da porta." />
          <Beneficio icone={UtensilsCrossed} titulo="Cardápio sempre igual ao painel" texto="Mudou preço, foto ou pausou um sabor no FireHub: mudou no aplicativo na mesma hora." />
          <Beneficio icone={Repeat} titulo="Cliente que volta mais rápido" texto="Quem pede pelo canal próprio volta a cada 33 dias; pelo marketplace, a cada 43.²" />
          <Beneficio icone={Store} titulo="Uma marca, várias unidades" texto="Um aplicativo só: o cliente escolhe a unidade pelo bairro ou pela cidade." />
        </div>
      </section>

      {/* ── Galeria: o cardápio de verdade ── */}
      {dados.fotos.length > 0 && (
        <section>
          <div className="al-cab">
            <span className="al-sobre">O seu cardápio, no bolso do cliente</span>
            <h3 className="al-titulo">Foto grande, preço certo e o botão de pedir</h3>
            {dados.fotosDeExemplo && <p className="al-sub">Fotos de exemplo de uma loja FireHub. No seu aplicativo entram as fotos do seu cardápio.</p>}
          </div>
          <div className="al-galeria">
            {dados.fotos.slice(0, 6).map((f) => (
              <figure key={f.nome}>
                <img src={f.foto} alt={f.nome} loading="lazy" />
                <figcaption><b>{f.nome}</b><span>{fmtR(f.preco)}</span></figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* ── Calculadora ── */}
      <Calculadora precoPremium={precos.ambos} />

      {/* ── Como funciona ── */}
      <section>
        <div className="al-cab">
          <span className="al-sobre">Como funciona</span>
          <h3 className="al-titulo">Você chama, a gente faz</h3>
        </div>
        <ol className="al-passos">
          <li><span>1</span><div><b>Chame o nosso time</b>Toque em “Quero o meu aplicativo” e fale com a gente no WhatsApp.</div></li>
          <li><span>2</span><div><b>A gente monta</b>Com a sua logo, as suas cores e o seu cardápio, do jeito que já está no painel.</div></li>
          <li><span>3</span><div><b>Publicado no seu nome</b>O app sai no nome da sua loja. A gente te guia na conta do Google e da Apple e cuida do resto.</div></li>
          <li><span>4</span><div><b>No boleto de sempre</b>A mensalidade entra no mesmo boleto do FireHub. Nada de cartão novo.</div></li>
        </ol>
      </section>

      {/* ── Chamada final ── */}
      <section className="al-final">
        <Crown size={30} color="#FACC15" />
        <h3>Seus clientes já têm o celular na mão. Coloque a sua loja nele.</h3>
        <p>Android + Apple por {fmtR(precos.ambos)}/mês — {fmtR(precos.android + precos.apple - precos.ambos)} a menos que os dois separados, e com o Multimarcas de cortesia.</p>
        <button className="al-cta" onClick={() => quero("ambos")}><MessageCircle size={18} /> Quero o meu aplicativo</button>
      </section>

      {/* ── Dúvidas ── */}
      <section>
        <h3 className="al-titulo">Dúvidas</h3>
        <Duvidas />
      </section>

      <p className="al-fontes">
        ¹ UpMenu, estudo com 72.468 clientes de 1.337 restaurantes, antes e depois de instalar o aplicativo do restaurante (+65% de pedidos em 6 meses; +129% em vendas desses clientes em 12 meses). A UpMenu vende aplicativo para restaurantes.
        ² Paytronix, 2023: clientes de pedido próprio voltam em média a cada 33 dias; de marketplace, a cada 43,1. Resultados de estudos de fora do FireHub; cada loja tem o seu.
      </p>
    </div>
  );
}

function Plano({ p, preco, titulo, sub, icones, itens, quero, ativo }: {
  p: Plataformas; preco: number; titulo: string; sub: string; icones: React.ReactNode; itens: string[]; quero: (p: Plataformas) => void; ativo: boolean;
}) {
  return (
    <div className={`al-plano${ativo ? " seu" : ""}`}>
      <span className="al-plano-icones">{icones}</span>
      <b className="al-plano-nome">{titulo}</b>
      <span className="al-plano-sub">{sub}</span>
      <span className="al-plano-preco">{fmtInt(preco)}<small>/mês</small></span>
      <ul>{itens.map((i) => <li key={i}><CheckCircle2 size={15} /> {i}</li>)}</ul>
      <button className="al-btn-plano" onClick={() => quero(p)}>{ativo ? "Seu plano atual" : "Quero esse"}</button>
    </div>
  );
}

function PlanoPremium({ precos, quero, ativo }: { precos: Record<Plataformas, number>; quero: (p: Plataformas) => void; ativo: boolean }) {
  const separado = precos.android + precos.apple;
  return (
    <div className={`al-plano al-premium${ativo ? " seu" : ""}`}>
      <span className="al-faixa"><Crown size={14} /> Premium · mais escolhido</span>
      <span className="al-plano-icones"><Play size={20} /><Apple size={20} /></span>
      <b className="al-plano-nome">Android + Apple</b>
      <span className="al-plano-sub">Google Play e App Store: 100% dos seus clientes</span>
      <span className="al-de">de <s>{fmtInt(separado)}</s></span>
      <span className="al-plano-preco">{fmtInt(precos.ambos)}<small>/mês</small></span>
      <span className="al-economia">Economize {fmtInt(separado - precos.ambos)} por mês · sai {fmtR(precos.ambos / 2)} por sistema</span>
      <ul>
        <li><CheckCircle2 size={15} /> Na Google Play <b>e</b> na App Store</li>
        <li><CheckCircle2 size={15} /> Notificação push ilimitada nos dois</li>
        <li><CheckCircle2 size={15} /> Pedidos, rastreio e motoboy ao vivo</li>
        <li><CheckCircle2 size={15} /> Ninguém fica de fora: Android e iPhone</li>
        <li className="al-bonus-item"><Gift size={15} /> <span><b>Multimarcas de cortesia</b> (economia de {fmtR(PRECO_DO_MULTIMARCAS)}/mês)</span></li>
      </ul>
      <button className="al-cta al-cta-cheio" onClick={() => quero("ambos")}>{ativo ? "Seu plano atual" : <><MessageCircle size={18} /> Quero o Premium</>}</button>
    </div>
  );
}

function Beneficio({ icone: Icone, titulo, texto, destaque }: { icone: typeof Bell; titulo: string; texto: string; destaque?: boolean }) {
  return (
    <div className={`al-beneficio${destaque ? " destaque" : ""}`}>
      <span className="al-beneficio-icone"><Icone size={destaque ? 24 : 20} /></span>
      <b>{titulo}</b>
      <span>{texto}</span>
    </div>
  );
}

/** Quanto a loja deixa no marketplace e quantos pedidos pagam o plano. Os números são do lojista; nada é afirmado. */
function Calculadora({ precoPremium }: { precoPremium: number }) {
  const [pedidos, setPedidos] = useState(400);
  const [ticket, setTicket] = useState(60);
  const [comissao, setComissao] = useState(20);
  const [migram, setMigram] = useState(20);
  const r = useMemo(() => {
    const pagaHoje = pedidos * ticket * (comissao / 100);
    const economia = pedidos * (migram / 100) * ticket * (comissao / 100);
    const porPedido = ticket * (comissao / 100);
    return { pagaHoje, economia, pagaOPlano: porPedido > 0 ? Math.ceil(precoPremium / porPedido) : 0, sobra: economia - precoPremium };
  }, [pedidos, ticket, comissao, migram, precoPremium]);
  return (
    <section className="al-calc">
      <div className="al-cab">
        <span className="al-sobre" style={{ color: "#FACC15" }}><Calculator size={14} /> Faça a conta</span>
        <h3 className="al-titulo" style={{ color: "white" }}>Quanto você deixa de comissão todo mês?</h3>
        <p className="al-sub" style={{ color: "#94A3B8" }}>Mexa nos números da sua loja.</p>
      </div>
      <div className="al-calc-grade">
        <div className="al-calc-campos">
          <Faixa rotulo="Pedidos por mês no marketplace" valor={pedidos} min={50} max={3000} passo={50} mostra={`${pedidos}`} onChange={setPedidos} />
          <Faixa rotulo="Ticket médio" valor={ticket} min={20} max={200} passo={5} mostra={fmtInt(ticket)} onChange={setTicket} />
          <Faixa rotulo="Comissão + taxas que você paga" valor={comissao} min={5} max={35} passo={1} mostra={`${comissao}%`} onChange={setComissao} />
          <Faixa rotulo="Clientes que passam a pedir pelo seu app" valor={migram} min={5} max={60} passo={5} mostra={`${migram}%`} onChange={setMigram} />
        </div>
        <div className="al-calc-resultado">
          <div><small>Você paga hoje de comissão</small><b className="al-vermelho">{fmtInt(r.pagaHoje)}<em>/mês</em></b></div>
          <div><small>Fica com você se {migram}% pedirem pelo app</small><b className="al-verde">{fmtInt(r.economia)}<em>/mês</em></b></div>
          <div className="al-calc-linha">
            {r.pagaOPlano > 0 && <>O Premium se paga com <b>{r.pagaOPlano} pedidos</b> por mês pelo app.</>}
            {r.sobra > 0 && <> Depois disso, sobram <b>{fmtInt(r.sobra)}</b> por mês.</>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Faixa({ rotulo, valor, min, max, passo, mostra, onChange }: { rotulo: string; valor: number; min: number; max: number; passo: number; mostra: string; onChange: (v: number) => void }) {
  return (
    <label className="al-faixa-campo">
      <span>{rotulo}<b>{mostra}</b></span>
      <input type="range" min={min} max={max} step={passo} value={valor} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** O celular de demonstração com a marca e as fotos da loja. As abas são as do app de verdade. */
function Celular({ loja, fotos }: { loja: Dados["loja"]; fotos: Foto[] }) {
  const [aba, setAba] = useState<"cardapio" | "pedidos" | "loja">("cardapio");
  const [etapa, setEtapa] = useState(0);
  const AVISOS = ["Pedido aceito! Já estamos preparando 👨‍🍳", "Seu pedido saiu para entrega 🛵", "Chegando! O motoboy está a 300 m 📍"];
  useEffect(() => {
    const t = setInterval(() => setEtapa((e) => (e + 1) % (AVISOS.length + 2)), 3000);
    return () => clearInterval(t);
  }, [AVISOS.length]);
  const inicial = (loja.nome || "L").trim().charAt(0).toUpperCase();
  const destaque = fotos[0];
  const lista = fotos.slice(1, 4);
  const categorias = Array.from(new Set(fotos.map((f) => f.categoria))).slice(0, 4);
  return (
    <div className="al-celular" aria-label="Demonstração do aplicativo">
      <div className="al-cel-status"><span>9:41</span><span>●●● ▲ ▮</span></div>
      <div className="al-cel-topo">
        {loja.logo ? <img src={loja.logo} alt="" /> : <span className="al-cel-logo">{inicial}</span>}
        <div><b>{loja.nome}</b><small>Aberto · entrega e retirada</small></div>
      </div>
      <div className={`al-cel-aviso${etapa > 0 && etapa <= AVISOS.length ? " on" : ""}`}>
        <span className="al-cel-aviso-icone">{loja.logo ? <img src={loja.logo} alt="" /> : inicial}</span>
        <div><b>{loja.nome}</b><span>{AVISOS[Math.min(AVISOS.length, Math.max(1, etapa)) - 1]}</span></div>
      </div>
      <div className="al-cel-corpo">
        {aba === "cardapio" && (
          <>
            {destaque && (
              <div className="al-cel-banner" style={{ backgroundImage: `linear-gradient(180deg, transparent 35%, rgba(2,6,23,.85)), url(${JSON.stringify(destaque.foto)})` }}>
                <span>Destaque</span><b>{destaque.nome}</b><em>{fmtR(destaque.preco)}</em>
              </div>
            )}
            <div className="al-cel-cats">{(categorias.length ? categorias : ["Destaques", "Lanches", "Bebidas"]).map((c, i) => <span key={c} className={i === 0 ? "on" : ""}>{c}</span>)}</div>
            {lista.map((f) => (
              <div key={f.nome} className="al-cel-item">
                <img className="al-cel-foto" src={f.foto} alt="" loading="lazy" />
                <div><b>{f.nome}</b><em>{fmtR(f.preco)}</em></div>
                <span className="al-cel-mais">+</span>
              </div>
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
    ["Como eu contrato?", "Toque em “Quero o meu aplicativo”: abre o WhatsApp do nosso time com a sua loja e o plano escolhido. A gente conversa, monta o aplicativo e ativa o plano para você."],
    ["Como é cobrado?", "A mensalidade do plano entra no mesmo boleto da mensalidade do FireHub, a partir do mês em que o aplicativo é ativado. Sem taxa por pedido e sem comissão."],
    ["Preciso de CNPJ?", "Para publicar na Play Store e na App Store, sim: o aplicativo sai no nome da sua loja, e as lojas de aplicativos pedem a conta da empresa. A gente te guia no cadastro e entra como administradora."],
    ["Tem custo nas lojas de aplicativos?", "O Google cobra uma taxa única e a Apple uma taxa anual, pagas direto a eles. A gente te passa os valores atuais no WhatsApp."],
    ["O cardápio do aplicativo é separado?", "Não. É o mesmo do painel: preço, foto, pausa e promoção mudam no aplicativo na hora."],
    ["Tenho várias marcas na mesma cozinha. O Multimarcas vem junto?", `Vem de cortesia no plano Android + Apple: quem assina os dois não paga o Multimarcas (${fmtR(PRECO_DO_MULTIMARCAS)}/mês). O aplicativo já mostra todas as suas marcas, com uma sacola só. Com um plano de uma plataforma só, o Multimarcas é cobrado à parte.`],
    ["Os pedidos caem onde?", "No mesmo painel de pedidos, com o mesmo robô, impressão e caixa."],
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
.al { color: #0F172A; display: grid; gap: 44px; }
.al section { min-width: 0; }
.al-selo-ativo { font-size: 12px; font-weight: 800; color: #059669; background: #ECFDF5; padding: 4px 10px; border-radius: 999px; }
.al-ativo { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: #ECFDF5; border: 1px solid #A7F3D0; color: #065F46; border-radius: 14px; padding: 14px 16px; margin-top: -24px; }
.al-ativo > div { flex: 1; min-width: 220px; display: grid; gap: 2px; font-size: 13.5px; }
.al-ativo b { font-size: 15px; }

.al-hero { display: grid; grid-template-columns: minmax(0,1.1fr) minmax(0,.9fr); gap: 28px; align-items: center; margin-top: -20px;
  background: radial-gradient(110% 130% at 0% 0%, #9A3412 0%, #431407 30%, #0B1220 62%); color: white; border-radius: 24px; padding: 40px 36px; overflow: hidden; position: relative; }
.al-selo { display: inline-block; font-size: 12px; font-weight: 800; color: #FDE68A; background: rgba(250,204,21,.14); border: 1px solid rgba(250,204,21,.35); padding: 5px 11px; border-radius: 999px; }
.al-hero h2 { font-size: clamp(28px, 4.2vw, 44px); line-height: 1.05; font-weight: 900; margin: 16px 0 14px; letter-spacing: -.025em; }
.al-hero h2 span { color: #FACC15; }
.al-hero p { font-size: 16px; line-height: 1.55; opacity: .9; margin: 0; max-width: 540px; }
.al-acoes { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 24px; }
.al-cta { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #FACC15; color: #0F172A; border: 0; border-radius: 12px; padding: 15px 24px; font-weight: 900; font-size: 16px; cursor: pointer;
  box-shadow: 0 10px 28px rgba(250,204,21,.38); transition: transform .15s ease, box-shadow .15s ease; text-decoration: none; }
.al-cta:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(250,204,21,.5); }
.al-cta:active { transform: translateY(0) scale(.98); }
.al-btn-claro { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.1); color: white; border: 1px solid rgba(255,255,255,.25); border-radius: 12px; padding: 14px 20px; font-weight: 800; font-size: 15px; cursor: pointer; text-decoration: none; }
.al-ativo .al-btn-claro { background: #059669; border-color: #059669; padding: 10px 14px; font-size: 14px; }
.al-numeros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 28px; max-width: 560px; }
.al-numeros div { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 12px; display: grid; gap: 2px; }
.al-numeros b { font-size: 26px; font-weight: 900; color: #FACC15; letter-spacing: -.02em; }
.al-numeros span { font-size: 12px; opacity: .85; line-height: 1.3; }

.al-hero-visual { position: relative; display: grid; justify-items: center; }
.al-flutua { position: absolute; z-index: 4; display: flex; align-items: center; gap: 8px; background: white; color: #0F172A; border-radius: 14px; padding: 10px 12px; box-shadow: 0 16px 36px rgba(0,0,0,.35); font-size: 13px; }
.al-flutua-push { left: -28px; top: 110px; max-width: 230px; animation: al-flutuar 4.5s ease-in-out infinite; }
.al-flutua-push b { display: block; font-size: 12.5px; }
.al-flutua-push small { font-size: 12.5px; color: #334155; }
.al-flutua-icone { width: 32px; height: 32px; border-radius: 9px; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; overflow: hidden; flex: none; }
.al-flutua-icone img { width: 100%; height: 100%; object-fit: cover; }
.al-flutua-pedido { right: -14px; bottom: 90px; color: #047857; animation: al-flutuar 5s ease-in-out .8s infinite; }
@keyframes al-flutuar { 50% { transform: translateY(-8px); } }

.al-celular { background: #F8FAFC; color: #0F172A; border-radius: 34px; border: 8px solid #111827; box-shadow: 0 34px 70px rgba(0,0,0,.5); overflow: hidden;
  width: 100%; max-width: 300px; position: relative; display: grid; grid-template-rows: auto auto 1fr auto; height: 560px; }
.al-cel-status { display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; padding: 8px 18px 0; }
.al-cel-topo { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
.al-cel-topo img, .al-cel-logo { width: 38px; height: 38px; border-radius: 11px; object-fit: cover; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; font-size: 17px; }
.al-cel-topo b { display: block; font-size: 14.5px; }
.al-cel-topo small { font-size: 11px; color: #059669; font-weight: 700; }
.al-cel-aviso { position: absolute; left: 8px; right: 8px; top: 8px; z-index: 3; display: flex; gap: 10px; align-items: center; background: rgba(255,255,255,.97); border-radius: 16px; padding: 10px 12px;
  box-shadow: 0 12px 30px rgba(2,6,23,.28); opacity: 0; transform: translateY(-24px); transition: opacity .35s, transform .35s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.al-cel-aviso.on { opacity: 1; transform: none; }
.al-cel-aviso-icone { width: 32px; height: 32px; border-radius: 9px; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; overflow: hidden; flex: none; }
.al-cel-aviso-icone img { width: 100%; height: 100%; object-fit: cover; }
.al-cel-aviso b { display: block; font-size: 12px; }
.al-cel-aviso span { font-size: 12px; color: #334155; }
.al-cel-corpo { padding: 0 10px 10px; overflow: hidden; }
.al-cel-banner { height: 130px; border-radius: 14px; background-size: cover; background-position: center; color: white; display: flex; flex-direction: column; justify-content: flex-end; padding: 10px 12px; margin-bottom: 10px; }
.al-cel-banner span { align-self: flex-start; font-size: 10px; font-weight: 900; background: #FACC15; color: #0F172A; padding: 2px 8px; border-radius: 999px; margin-bottom: auto; }
.al-cel-banner b { font-size: 14px; line-height: 1.2; }
.al-cel-banner em { font-style: normal; font-weight: 900; font-size: 13px; color: #FDE68A; }
.al-cel-cats { display: flex; gap: 6px; margin-bottom: 8px; overflow: hidden; }
.al-cel-cats span { font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: white; border: 1px solid #E2E8F0; white-space: nowrap; }
.al-cel-cats span.on { background: #0F172A; color: #FACC15; border-color: #0F172A; }
.al-cel-item { display: flex; gap: 10px; align-items: center; background: white; border: 1px solid #E2E8F0; border-radius: 12px; padding: 7px; margin-bottom: 7px; }
.al-cel-foto { width: 50px; height: 50px; border-radius: 10px; object-fit: cover; flex: none; background: #E2E8F0; }
.al-cel-item div { flex: 1; min-width: 0; }
.al-cel-item b { display: block; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.al-cel-item em { font-style: normal; font-weight: 800; font-size: 12.5px; color: #059669; }
.al-cel-mais { width: 26px; height: 26px; border-radius: 999px; background: #0F172A; color: #FACC15; display: grid; place-items: center; font-weight: 900; flex: none; }
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
.al-cel-abas button { background: none; border: 0; padding: 9px 4px 11px; display: grid; justify-items: center; gap: 3px; font: inherit; font-size: 11px; font-weight: 700; color: #94A3B8; cursor: pointer; }
.al-cel-abas button.on { color: #0F172A; }

.al-cab { margin-bottom: 18px; }
.al-sobre { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; color: #C2410C; }
.al-titulo { font-size: clamp(22px, 3vw, 30px); font-weight: 900; margin: 4px 0 4px; letter-spacing: -.02em; }
.al-sub { margin: 0; color: #64748B; font-size: 15px; }

.al-planos { display: grid; grid-template-columns: 1fr 1.18fr 1fr; gap: 16px; align-items: center; }
.al-bonus { margin-top: 18px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; padding: 16px 18px; border-radius: 16px; background: linear-gradient(135deg, #F3F0FF, #fff); border: 1px solid #D0BFFF; }
.al-bonus > div { flex: 1 1 320px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.al-bonus > div > b { color: #5F3DC4; font-size: 16px; }
.al-bonus > div > span { color: #475569; font-size: 14px; line-height: 1.5; }
.al-bonus-icone { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; background: #7048E8; color: #fff; flex-shrink: 0; }
.al-bonus-item { color: #5F3DC4; }
.al-bonus-item svg { color: #7048E8; }
.al-plano { position: relative; display: grid; gap: 6px; background: white; border: 2px solid #E2E8F0; border-radius: 20px; padding: 24px 20px 20px; transition: transform .2s ease, box-shadow .2s ease; }
.al-plano:hover { transform: translateY(-3px); box-shadow: 0 16px 36px rgba(15,23,42,.1); }
.al-plano.seu { border-color: #059669; }
.al-plano-icones { display: flex; gap: 6px; color: #64748B; }
.al-plano-nome { font-size: 18px; }
.al-plano-sub { font-size: 13px; color: #64748B; }
.al-plano-preco { font-size: 38px; font-weight: 900; letter-spacing: -.03em; margin-top: 6px; }
.al-plano-preco small { font-size: 14px; font-weight: 700; opacity: .65; margin-left: 2px; }
.al-plano ul { list-style: none; padding: 0; margin: 8px 0 12px; display: grid; gap: 7px; font-size: 13.5px; color: #334155; }
.al-plano li { display: flex; gap: 7px; align-items: flex-start; }
.al-plano li svg { color: #059669; flex: none; margin-top: 2px; }
.al-btn-plano { background: #0F172A; color: white; border: 0; border-radius: 12px; padding: 12px; font-weight: 800; font-size: 15px; cursor: pointer; }
.al-btn-plano:hover { background: #1E293B; }
.al-premium { background: linear-gradient(160deg, #1E293B 0%, #0B1220 70%); color: white; border: 2px solid #FACC15; padding: 34px 24px 24px;
  box-shadow: 0 0 0 6px rgba(250,204,21,.16), 0 30px 60px rgba(15,23,42,.35); transform: scale(1.03); }
.al-premium:hover { transform: scale(1.03) translateY(-3px); box-shadow: 0 0 0 6px rgba(250,204,21,.22), 0 34px 70px rgba(15,23,42,.4); }
.al-premium .al-plano-icones { color: #FACC15; }
.al-premium .al-plano-nome { font-size: 22px; }
.al-premium .al-plano-sub { color: #A5F3FC; }
.al-premium .al-plano-preco { font-size: 52px; color: #FACC15; margin-top: 0; }
.al-premium ul { color: #E2E8F0; }
.al-premium li svg { color: #FACC15; }
.al-de { font-size: 14px; color: #94A3B8; margin-top: 4px; }
.al-economia { font-size: 13px; font-weight: 800; color: #0F172A; background: #FACC15; border-radius: 999px; padding: 5px 12px; justify-self: start; }
.al-faixa { position: absolute; top: -15px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  font-size: 12.5px; font-weight: 900; background: #FACC15; color: #0F172A; padding: 6px 14px; border-radius: 999px; box-shadow: 0 8px 20px rgba(250,204,21,.4); }
.al-cta-cheio { width: 100%; }

.al-beneficios { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.al-beneficio { display: grid; gap: 6px; align-content: start; background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 18px; }
.al-beneficio b { font-size: 15.5px; }
.al-beneficio > span:last-child { font-size: 13.5px; color: #64748B; line-height: 1.45; }
.al-beneficio-icone { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: #FEF3C7; color: #B45309; }
.al-beneficio.destaque { grid-column: span 2; background: linear-gradient(135deg, #FFF7ED, #FFFFFF 60%); border-color: #FED7AA; padding: 22px; }
.al-beneficio.destaque b { font-size: 19px; }
.al-beneficio.destaque > span:last-child { font-size: 14.5px; color: #475569; }
.al-beneficio.destaque .al-beneficio-icone { width: 48px; height: 48px; background: #0F172A; color: #FACC15; }

.al-galeria { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.al-galeria figure { margin: 0; position: relative; border-radius: 18px; overflow: hidden; aspect-ratio: 4 / 3; background: #E2E8F0; }
.al-galeria img { width: 100%; height: 100%; object-fit: cover; transition: transform .4s ease; }
.al-galeria figure:hover img { transform: scale(1.05); }
.al-galeria figcaption { position: absolute; inset: auto 0 0 0; padding: 26px 14px 12px; background: linear-gradient(180deg, transparent, rgba(2,6,23,.85)); color: white; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }
.al-galeria figcaption b { font-size: 14px; line-height: 1.2; }
.al-galeria figcaption span { font-weight: 900; color: #FACC15; white-space: nowrap; }

.al-calc { background: #0B1220; color: white; border-radius: 24px; padding: 30px 28px; }
.al-calc-grade { display: grid; grid-template-columns: 1.1fr .9fr; gap: 24px; align-items: center; }
.al-calc-campos { display: grid; gap: 16px; }
.al-faixa-campo { display: grid; gap: 6px; font-size: 13.5px; color: #CBD5E1; }
.al-faixa-campo span { display: flex; justify-content: space-between; gap: 10px; }
.al-faixa-campo span b { color: white; font-size: 15px; }
.al-faixa-campo input { width: 100%; accent-color: #FACC15; }
.al-calc-resultado { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; padding: 20px; display: grid; gap: 14px; }
.al-calc-resultado small { display: block; font-size: 13px; color: #94A3B8; }
.al-calc-resultado b { font-size: 34px; font-weight: 900; letter-spacing: -.02em; }
.al-calc-resultado em { font-style: normal; font-size: 14px; opacity: .7; margin-left: 3px; }
.al-vermelho { color: #FB7185; }
.al-verde { color: #4ADE80; }
.al-calc-linha { font-size: 14px; color: #E2E8F0; line-height: 1.5; border-top: 1px solid rgba(255,255,255,.12); padding-top: 12px; }
.al-calc-linha b { font-size: 14px; color: #FACC15; letter-spacing: 0; }

.al-passos { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.al-passos li { display: grid; gap: 10px; align-content: start; background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 18px; font-size: 13.5px; color: #475569; }
.al-passos li b { display: block; color: #0F172A; font-size: 15.5px; margin-bottom: 2px; }
.al-passos li > span { width: 34px; height: 34px; border-radius: 999px; background: #0B1220; color: #FACC15; font-weight: 900; display: grid; place-items: center; }

.al-final { text-align: center; display: grid; justify-items: center; gap: 10px; background: radial-gradient(120% 140% at 50% 0%, #9A3412, #0B1220 65%); color: white; border-radius: 24px; padding: 38px 24px; }
.al-final h3 { font-size: clamp(22px, 3.2vw, 32px); font-weight: 900; margin: 0; max-width: 640px; letter-spacing: -.02em; }
.al-final p { margin: 0 0 8px; color: #FDE68A; font-size: 15px; }

.al-faq { display: grid; gap: 8px; margin-top: 10px; }
.al-faq-item { border: 1px solid #E2E8F0; border-radius: 12px; background: white; overflow: hidden; }
.al-faq-item button { width: 100%; display: flex; justify-content: space-between; gap: 12px; background: none; border: 0; padding: 14px 16px; font: inherit; font-weight: 800; font-size: 14.5px; color: #0F172A; text-align: left; cursor: pointer; }
.al-faq-item button span { color: #B45309; font-size: 18px; line-height: 1; }
.al-faq-item p { margin: 0; padding: 0 16px 14px; font-size: 14px; color: #475569; line-height: 1.5; }
.al-fontes { margin: -20px 0 0; font-size: 11.5px; color: #94A3B8; line-height: 1.5; }

@media (prefers-reduced-motion: reduce) { .al-flutua-push, .al-flutua-pedido { animation: none; } .al-cta, .al-plano, .al-galeria img { transition: none; } }
@media (max-width: 900px) {
  .al-planos { grid-template-columns: 1fr; gap: 26px; }
  .al-premium { transform: none; order: -1; }
  .al-premium:hover { transform: translateY(-3px); }
  .al-passos { grid-template-columns: 1fr 1fr; }
  .al-calc-grade { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .al-hero { grid-template-columns: 1fr; padding: 26px 18px; }
  .al-flutua-push { left: 0; top: 40px; }
  .al-flutua-pedido { right: 0; }
  .al-numeros { grid-template-columns: 1fr 1fr 1fr; }
  .al-numeros b { font-size: 20px; }
  .al-beneficio.destaque { grid-column: auto; }
  .al-galeria { grid-template-columns: 1fr 1fr; }
  .al-passos { grid-template-columns: 1fr; }
  .al-calc { padding: 24px 18px; }
  .al-cta { width: 100%; }
}
`;
