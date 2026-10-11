"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bike, Clock, Loader2, MapPin, Navigation, Phone, Search, Store, ChevronRight } from "lucide-react";
import type { LojaNaVitrine, VitrineDoGrupo } from "@/lib/vitrine-do-grupo";
import { TIPOS_DE_AREA_NO_MAPA, nomeDoBairroConfere, ordemPelaDistancia, type Escolha, type ResultadoDaLoja } from "@/lib/escolha-de-loja-do-grupo";
import { enderecoDoReverso } from "@/lib/entrega-no-checkout";
import { estadoDaLoja } from "@/lib/loja-aberta";
import s from "./EscolhaDaLojaDoGrupo.module.css";

/**
 * A tela da página das suas lojas (/lojas/[slug]). O cliente diz onde está —
 * bairro da lista, endereço/CEP ou GPS — e o servidor responde quais lojas
 * entregam ali (api/lojas/[slug]/qual-loja). Uma só: ela. Mais de uma: as
 * duas lado a lado e o cliente escolhe. Quem vai retirar escolhe direto.
 */

type Resposta = {
  escolha: Escolha;
  resultados: ResultadoDaLoja[];
  ondeTexto: string;
  via: "gps" | "bairro" | "endereco";
  /** Bairro da lista atendido por mais de uma loja: a ordem pelo centro do bairro, quando o mapa o conhece. */
  ordemPeloBairro?: { ids: string[]; km: Record<string, number> } | null;
};

type Ponto = { lat: number; lng: number };
const CHAVE_DO_BAIRRO = (nome: string, cidade: string) => `firehub-bairro-${sem(cidade)}-${sem(nome)}`;
const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;

/**
 * O centro de um bairro pelo mapa (Nominatim, no navegador, como o "Minha
 * localização" do checkout). Só área cujo nome confere — o mapa devolve rua,
 * praia, aeroporto e bairro vizinho com nome parecido. Guardado no aparelho
 * por 7 dias (também o "não achei"), para não perguntar ao mapa a cada toque.
 * Nulo = não conhece: a página mostra as lojas sem ordem por distância.
 */
async function centroDoBairro(nome: string, cidade: string): Promise<Ponto | null> {
  const chave = CHAVE_DO_BAIRRO(nome, cidade);
  try {
    const guardado = JSON.parse(localStorage.getItem(chave) || "null");
    if (guardado && Date.now() - guardado.em < SETE_DIAS) return guardado.ponto ?? null;
  } catch { /* sem armazenamento: pergunta ao mapa */ }
  try {
    const prazo = typeof (AbortSignal as any).timeout === "function" ? (AbortSignal as any).timeout(3500) as AbortSignal : undefined;
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&countrycodes=br&q=${encodeURIComponent(`${nome}, ${cidade}`)}`,
      { headers: { "Accept-Language": "pt-BR" }, signal: prazo },
    );
    if (!r.ok) return null;
    const lista: any[] = await r.json();
    const area = lista.find((x) =>
      TIPOS_DE_AREA_NO_MAPA.includes(String(x?.addresstype || "")) &&
      (nomeDoBairroConfere(nome, x?.name) || nomeDoBairroConfere(nome, enderecoDoReverso(x?.address).bairro)));
    const ponto = area && Number.isFinite(+area.lat) && Number.isFinite(+area.lon) ? { lat: +area.lat, lng: +area.lon } : null;
    try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), ponto })); } catch { /* idem */ }
    return ponto;
  } catch {
    return null; // mapa fora ou lento: segue sem a ordem por distância
  }
}

/** "Aberta agora, até as 23:40." — o mesmo texto que o servidor monta (vitrine-do-grupo.ts). */
function estadoAgora(l: LojaNaVitrine): { aberta: boolean; estado: string } {
  const e = estadoDaLoja({ storeHours: l.horario.storeHours, storePause: l.horario.storePause, storeOpen: l.horario.storeOpen, timezone: l.horario.timezone });
  return { aberta: e.aberta, estado: e.texto.replace(/^A loja está /, "").replace(/^./, (c) => c.toUpperCase()) };
}

const brl = (n: number) => (n === 0 ? "Grátis" : `R$ ${n.toFixed(2).replace(".", ",")}`);
const kmBr = (n: number) => `${String(n).replace(".", ",")} km`;
const sem = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");
const CHAVE_ULTIMA = (slug: string) => `firehub-grupo-${slug}`;

export default function EscolhaDaLojaDoGrupo({ slug, vitrine }: { slug: string; vitrine: VitrineDoGrupo }) {
  const fazRetirada = vitrine.lojas.some((l) => !l.soDelivery);
  const [modo, setModo] = useState<"entrega" | "retirada">("entrega");
  const [busca, setBusca] = useState("");
  const [endereco, setEndereco] = useState("");
  const [digitarEndereco, setDigitarEndereco] = useState(vitrine.bairros.length === 0);
  const [consultando, setConsultando] = useState<null | "gps" | "texto">(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [ultima, setUltima] = useState<LojaNaVitrine | null>(null);

  // A página vem do cache (até 60 s, ou mais numa página pouco visitada):
  // "Aberta/Fechada" é recalculado aqui, ao abrir e a cada minuto.
  const [lojas, setLojas] = useState(vitrine.lojas);
  useEffect(() => {
    const recalcular = () => setLojas(vitrine.lojas.map((l) => ({ ...l, ...estadoAgora(l) })));
    recalcular();
    const t = setInterval(recalcular, 60_000);
    return () => clearInterval(t);
  }, [vitrine.lojas]);
  const porId = useMemo(() => new Map(lojas.map((l) => [l.id, l])), [lojas]);

  useEffect(() => {
    try {
      const id = localStorage.getItem(CHAVE_ULTIMA(slug));
      if (id && porId.has(id)) setUltima(porId.get(id)!);
    } catch { /* sem armazenamento: segue sem o atalho */ }
  }, [slug, porId]);

  const variasCidades = useMemo(() => new Set(vitrine.bairros.map((b) => b.cidade)).size > 1, [vitrine.bairros]);
  const sugestoes = useMemo(() => {
    const q = sem(busca.trim());
    if (q.length < 2) return [];
    return vitrine.bairros.filter((b) => sem(b.nome).includes(q)).slice(0, 8);
  }, [busca, vitrine.bairros]);

  function lembrar(loja: LojaNaVitrine) {
    try { localStorage.setItem(CHAVE_ULTIMA(slug), loja.id); } catch { /* idem */ }
  }

  async function consultar(corpo: Record<string, unknown>, ondeTexto: string, via: Resposta["via"]) {
    setConsultando(via === "gps" ? "gps" : "texto");
    setErro(null);
    setResposta(null);
    try {
      const r = await fetch(`/api/lojas/${encodeURIComponent(slug)}/qual-loja`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(dados?.error || "Não deu para consultar agora.");
      // Duas lojas no bairro da lista e sem distância do cliente: a mais perto
      // do CENTRO DO BAIRRO vem primeiro. As duas continuam na tela.
      let ordemPeloBairro: Resposta["ordemPeloBairro"] = null;
      const e: Escolha = dados?.escolha;
      if (via === "bairro" && e?.tipo === "ATENDE" && e.tambemAtendem.length > 0 && !e.porDistancia) {
        const centro = await centroDoBairro(String(corpo.bairro || ""), String(corpo.cidade || ""));
        if (centro) {
          const pontos = Object.fromEntries(lojas.map((l) => [l.id, l.ponto]));
          ordemPeloBairro = ordemPelaDistancia([e.lojaId, ...e.tambemAtendem], pontos, centro);
        }
      }
      setResposta({ ...dados, ondeTexto, via, ordemPeloBairro });
      requestAnimationFrame(() => document.getElementById("resultado")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e: any) {
      setErro(e?.message || "Não deu para consultar agora. Tente de novo.");
    } finally {
      setConsultando(null);
    }
  }

  function usarLocalizacao() {
    if (!navigator.geolocation) {
      setErro("Este aparelho não informa a localização. Escolha o bairro ou digite o endereço.");
      return;
    }
    setConsultando("gps");
    setErro(null);
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        // Loja que entrega por BAIRRO não sabe o que fazer com uma coordenada:
        // o bairro sai do mapa, no navegador, igual ao "Minha localização" do
        // checkout (CustomerStorePage, preencherPeloPonto) — a mesma leitura
        // que o cardápio vai fazer depois. Mapa fora: segue só com o ponto.
        let bairro = "";
        let endereco = "";
        try {
          const prazo = typeof (AbortSignal as any).timeout === "function" ? (AbortSignal as any).timeout(4000) as AbortSignal : undefined;
          const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
            headers: { "Accept-Language": "pt-BR" },
            signal: prazo,
          });
          if (rev.ok) {
            const e = enderecoDoReverso((await rev.json())?.address);
            bairro = e.bairro;
            endereco = [[e.rua, e.numero].filter(Boolean).join(", "), e.bairro].filter(Boolean).join(" - ");
          }
        } catch { /* sem o bairro do mapa: o servidor decide pelo ponto */ }
        consultar({ lat, lng, bairro, endereco }, bairro || "sua localização", "gps");
      },
      () => {
        setConsultando(null);
        setErro("Não conseguimos sua localização. Escolha o bairro ou digite o endereço.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  function escolherBairro(nome: string, cidade: string) {
    setBusca(nome);
    // A cidade vai junto: "Centro" de uma cidade não é o de outra.
    consultar({ bairro: nome, cidade }, nome, "bairro");
  }

  const lojasDeRetirada = lojas.filter((l) => !l.soDelivery);
  const estiloDaCor = (vitrine.cor ? { "--cor": vitrine.cor } : {}) as CSSProperties;

  return (
    <div className={s.pagina} style={estiloDaCor}>
      <header className={s.topo}>
        <Capa imagem={vitrine.capa} video={vitrine.capaVideo} className={s.capa} tocar />
        <div className={s.veu} />
        <div className={s.topoConteudo}>
          {vitrine.logo ? (
            <img className={s.logo} src={vitrine.logo} alt={vitrine.nomeDoGrupo} />
          ) : (
            <div className={s.logoLetra}>{vitrine.nomeDoGrupo.slice(0, 1)}</div>
          )}
          <h1 className={s.titulo}>{vitrine.nomeDoGrupo}</h1>
          <p className={s.subtitulo}>
            {vitrine.frase || `${vitrine.lojas.length} lojas para te atender · peça na mais perto de você`}
          </p>
        </div>
      </header>

      <main className={s.conteudo}>
        {ultima && !resposta && (
          <a className={s.atalho} href={`/loja/${ultima.slug}`}>
            <span>
              <small>Da última vez você pediu na</small>
              <strong>{ultima.nome}</strong>
            </span>
            <span className={s.atalhoAcao}>Continuar <ChevronRight size={16} /></span>
          </a>
        )}

        <section className={s.painel} aria-label="Escolha da loja">
          {fazRetirada && (
            <div className={s.abas} role="tablist">
              <button role="tab" aria-selected={modo === "entrega"} className={modo === "entrega" ? s.abaAtiva : s.aba} onClick={() => setModo("entrega")}>
                <Bike size={16} /> Entrega
              </button>
              <button role="tab" aria-selected={modo === "retirada"} className={modo === "retirada" ? s.abaAtiva : s.aba} onClick={() => setModo("retirada")}>
                <Store size={16} /> Retirar na loja
              </button>
            </div>
          )}

          {modo === "entrega" ? (
            <div className={s.entrega}>
              <h2 className={s.pergunta}>Onde você está?</h2>
              <p className={s.ajuda}>A gente mostra a loja que entrega no seu endereço.</p>

              <button className={s.botaoGps} onClick={usarLocalizacao} disabled={!!consultando}>
                {consultando === "gps" ? <Loader2 size={18} className={s.gira} /> : <Navigation size={18} />}
                {consultando === "gps" ? "Procurando a loja…" : "Usar minha localização"}
              </button>

              <div className={s.ou}><span>ou</span></div>

              {!digitarEndereco ? (
                <div className={s.campoBairro}>
                  <label className={s.rotulo} htmlFor="bairro">Seu bairro</label>
                  <div className={s.campo}>
                    <Search size={18} />
                    <input
                      id="bairro"
                      value={busca}
                      onChange={(e) => { setBusca(e.target.value); setResposta(null); }}
                      placeholder="Comece a digitar o bairro"
                      autoComplete="off"
                    />
                  </div>
                  {sugestoes.length > 0 && !resposta && consultando !== "texto" && (
                    <ul className={s.sugestoes}>
                      {sugestoes.map((b) => (
                        <li key={`${b.cidade}|${b.nome}`}>
                          <button onClick={() => escolherBairro(b.nome, b.cidade)}>
                            <MapPin size={15} />
                            <span>{b.nome}</span>
                            {variasCidades && <small>{b.cidade}</small>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {busca.trim().length >= 2 && sugestoes.length === 0 && !resposta && !consultando && (
                    <p className={s.semBairro}>
                      Não achamos “{busca.trim()}” na lista.{" "}
                      <button className={s.link} onClick={() => { setDigitarEndereco(true); setEndereco(busca.trim()); }}>Digitar o endereço</button>
                    </p>
                  )}
                  {consultando === "texto" && <p className={s.carregando}><Loader2 size={16} className={s.gira} /> Procurando a loja…</p>}
                  <button className={s.link} onClick={() => setDigitarEndereco(true)}>Prefiro digitar o endereço ou CEP</button>
                </div>
              ) : (
                <form
                  className={s.campoBairro}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (endereco.trim().length >= 4) consultar({ endereco: endereco.trim() }, endereco.trim(), "endereco");
                  }}
                >
                  <label className={s.rotulo} htmlFor="endereco">Endereço ou CEP</label>
                  <div className={s.campo}>
                    <MapPin size={18} />
                    <input id="endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número e bairro" autoComplete="street-address" />
                  </div>
                  <button className={s.botaoBuscar} type="submit" disabled={!!consultando || endereco.trim().length < 4}>
                    {consultando === "texto" ? <><Loader2 size={16} className={s.gira} /> Procurando…</> : "Encontrar minha loja"}
                  </button>
                  {vitrine.bairros.length > 0 && (
                    <button type="button" className={s.link} onClick={() => setDigitarEndereco(false)}>Escolher o bairro na lista</button>
                  )}
                </form>
              )}

              {erro && <p className={s.erro}>{erro}</p>}

              {resposta && (
                <Resultado
                  resposta={resposta}
                  porId={porId}
                  onEscolher={lembrar}
                  onRetirar={fazRetirada ? () => setModo("retirada") : null}
                  temListaDeBairros={vitrine.bairros.length > 0}
                  onUsarLista={() => { setDigitarEndereco(false); setResposta(null); }}
                  lojas={lojas}
                  onEscolherLoja={lembrar}
                />
              )}
            </div>
          ) : (
            <div className={s.retirada}>
              <h2 className={s.pergunta}>Em qual loja você vai buscar?</h2>
              <div className={s.listaRetirada}>
                {lojasDeRetirada.map((l) => (
                  <a key={l.id} className={s.itemRetirada} href={`/loja/${l.slug}`} onClick={() => lembrar(l)}>
                    <div>
                      <strong>{l.nome}</strong>
                      {l.endereco && <span>{l.endereco}</span>}
                      <Situacao loja={l} />
                    </div>
                    <ChevronRight size={18} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={s.nossas}>
          <h2 className={s.secao}>Nossas lojas</h2>
          <div className={s.grade}>
            {lojas.map((l) => <CartaoDaLoja key={l.id} loja={l} onEscolher={lembrar} />)}
          </div>
        </section>

        <footer className={s.rodape}>Pedidos online por <a href="https://firehubfood.com.br" target="_blank" rel="noreferrer">FireHub</a></footer>
      </main>
    </div>
  );
}

/**
 * A capa de uma loja: a foto e, se houver, o vídeo. A Pizzaria 17 só tem o
 * vídeo. Mesmas regras do CapaDaLoja do cardápio: o vídeo só toca depois de
 * o React assumir (o `muted` precisa ir antes do play) e quem pediu menos
 * movimento ou economia de dados fica parado no primeiro quadro.
 * `tocar` = false (cartões) mostra só o quadro, sem baixar o vídeo inteiro.
 */
function Capa({ imagem, video, className, tocar = false }: { imagem: string | null; video: string | null; className: string; tocar?: boolean }) {
  const el = useRef<HTMLVideoElement>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    const v = el.current;
    if (!tocar || !v) return;
    const menosMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const economia = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (menosMovimento || economia) return;
    v.muted = true;
    v.play().catch(() => { /* autoplay recusado: fica o primeiro quadro */ });
  }, [tocar]);

  // Parado (cartões): salta para meio segundo para pintar um quadro de
  // verdade. O vídeo pode ter carregado ANTES de o React assumir a página —
  // aí o onLoadedData não dispara de novo, por isso a conferência do estado.
  useEffect(() => {
    const v = el.current;
    if (tocar || !v) return;
    const saltar = () => { try { if (v.currentTime < 0.5) v.currentTime = 0.5; } catch { /* fica o 1º quadro */ } };
    if (v.readyState >= 2) saltar();
    else v.addEventListener("loadeddata", saltar, { once: true });
    return () => v.removeEventListener("loadeddata", saltar);
  }, [tocar, video]);

  if (video && !falhou) {
    return (
      <video
        ref={el}
        className={className}
        src={video}
        poster={imagem || undefined}
        muted
        loop
        playsInline
        // Parado (cartões): o "#t=0.5" com preload de metadados não pinta o
        // quadro em todo navegador — o cartão da Aeroporto ficou em branco no
        // Chrome do Douglas. Carrega inteiro e salta (efeito acima).
        preload="auto"
        aria-hidden
        onError={() => setFalhou(true)}
      />
    );
  }
  if (imagem) return <img className={className} src={imagem} alt="" />;
  return null;
}

function Situacao({ loja }: { loja: LojaNaVitrine }) {
  return (
    <span className={loja.aberta ? s.aberta : s.fechada}>
      <i /> {loja.estado}
    </span>
  );
}

function Resultado({
  resposta, porId, onEscolher, onRetirar, temListaDeBairros, onUsarLista, lojas, onEscolherLoja,
}: {
  resposta: Resposta;
  porId: Map<string, LojaNaVitrine>;
  onEscolher: (l: LojaNaVitrine) => void;
  onRetirar: (() => void) | null;
  temListaDeBairros: boolean;
  onUsarLista: () => void;
  lojas: LojaNaVitrine[];
  onEscolherLoja: (l: LojaNaVitrine) => void;
}) {
  const { escolha, resultados } = resposta;
  // O nome do bairro como a loja cadastrou ("Aeroporto"), não como o mapa
  // escreveu ("bairro aeroporto").
  const ondeTexto = (escolha.tipo === "ATENDE" && resultados.find((r) => r.lojaId === escolha.lojaId)?.veredicto.bairro) || resposta.ondeTexto;
  // Não deu para confirmar (mapa fora, endereço que o mapa não achou): não é
  // "não entregamos". Pede o bairro da lista ou deixa escolher a loja.
  if (escolha.tipo === "DUVIDA") {
    return (
      <div id="resultado" className={s.resultadoVazio}>
        <strong>Não conseguimos confirmar a entrega em {ondeTexto} agora.</strong>
        <p>{temListaDeBairros ? "Escolha o seu bairro na lista, ou peça direto na loja mais perto de você:" : "Peça direto na loja mais perto de você:"}</p>
        {temListaDeBairros && resposta.via !== "bairro" && (
          <button className={s.botaoSecundario} onClick={onUsarLista} style={{ marginBottom: 10 }}><MapPin size={16} /> Escolher o bairro na lista</button>
        )}
        <div className={s.listaRetirada}>
          {lojas.map((l) => (
            <a key={l.id} className={s.itemRetirada} href={`/loja/${l.slug}`} onClick={() => onEscolherLoja(l)}>
              <div>
                <strong>{l.nome}</strong>
                {l.bairro && <span>Fica em {l.bairro}</span>}
              </div>
              <ChevronRight size={18} />
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (escolha.tipo === "NENHUMA") {
    return (
      <div id="resultado" className={s.resultadoVazio}>
        <strong>Ainda não entregamos em {ondeTexto}.</strong>
        {onRetirar ? (
          <>
            <p>Você pode retirar o pedido numa das lojas.</p>
            <button className={s.botaoSecundario} onClick={onRetirar}><Store size={16} /> Ver lojas para retirar</button>
          </>
        ) : resposta.via === "endereco" && temListaDeBairros ? (
          <>
            <p>Se o endereço não tinha o bairro, procure o seu bairro na lista.</p>
            <button className={s.botaoSecundario} onClick={onUsarLista}><MapPin size={16} /> Escolher o bairro na lista</button>
          </>
        ) : (
          <p>Confira o bairro ou digite o endereço completo. Se precisar, fale com a loja pelo WhatsApp lá embaixo.</p>
        )}
      </div>
    );
  }

  const peloBairro = escolha.tipo === "ATENDE" ? resposta.ordemPeloBairro : null;
  const ids = peloBairro ? peloBairro.ids : escolha.tipo === "ATENDE" ? [escolha.lojaId, ...escolha.tambemAtendem] : [escolha.lojaId];
  const opcoes = ids.map((id) => porId.get(id)).filter(Boolean) as LojaNaVitrine[];
  if (opcoes.length === 0) return null;
  const dado = (id: string) => resultados.find((x) => x.lojaId === id);

  // Selo da primeira só quando ele diz algo verdadeiro: a mais perto (com
  // distância de todas) ou a entrega mais barata (taxas diferentes).
  let selo: string | null = null;
  if (escolha.tipo === "ATENDE" && opcoes.length > 1) {
    const taxas = opcoes.map((o) => dado(o.id)?.veredicto.taxa);
    if (escolha.porDistancia) selo = "Mais perto de você";
    else if (peloBairro) selo = `Mais perto de ${ondeTexto}`;
    else if (taxas[0] != null && taxas.slice(1).every((t) => t != null && t > taxas[0]!)) selo = "Entrega mais barata";
  }

  const titulo =
    escolha.tipo === "MAIS_PERTO" ? "Loja mais perto de você"
    : opcoes.length > 1 ? `${opcoes.length} lojas entregam em ${ondeTexto}. Escolha uma:`
    : `Entrega em ${ondeTexto}`;

  return (
    <div id="resultado" className={s.resultadoBloco}>
      <span className={s.selo}>{titulo}</span>
      <div className={opcoes.length > 1 ? s.opcoes : undefined}>
        {opcoes.map((loja, i) => {
          const r = dado(loja.id);
          const v = r?.veredicto;
          return (
            <div key={loja.id} className={s.resultado}>
              {i === 0 && selo && <span className={s.seloOpcao}>{selo}</span>}
              <div className={s.resultadoLoja}>
                <div className={s.resultadoFoto}>
                  {/* A logo identifica a loja num quadrado pequeno; a capa só se não houver logo. */}
                  {loja.logo ? <img src={loja.logo} alt="" className={s.resultadoCapa} />
                    : loja.capa || loja.capaVideo ? <Capa imagem={loja.capa} video={loja.capaVideo} className={s.resultadoCapa} />
                    : <Store size={22} />}
                </div>
                <div>
                  <strong>{loja.nome}</strong>
                  {loja.bairro && <span className={s.ficaEm}><MapPin size={13} /> Fica em {loja.bairro}</span>}
                  <Situacao loja={loja} />
                </div>
              </div>
              {escolha.tipo === "ATENDE" && v && (
                <div className={s.numeros}>
                  {v.taxa != null && <span><Bike size={15} /> Entrega {brl(v.taxa)}</span>}
                  {v.tempoMin != null && <span><Clock size={15} /> {v.tempoMin}–{v.tempoMin + 15} min</span>}
                  {r?.distanciaRetaKm != null ? <span><MapPin size={15} /> {kmBr(r.distanciaRetaKm)}</span>
                    : peloBairro?.km[loja.id] != null && <span><MapPin size={15} /> ~{kmBr(peloBairro.km[loja.id])} do bairro</span>}
                </div>
              )}
              {escolha.tipo === "MAIS_PERTO" && (
                <p className={s.ajuda}>Confirme o endereço no cardápio: a loja calcula a taxa na hora de fechar o pedido.</p>
              )}
              <a className={i === 0 ? s.botaoCardapio : s.botaoCardapioOutra} href={`/loja/${loja.slug}`} onClick={() => onEscolher(loja)}>
                {opcoes.length > 1 ? "Pedir nesta loja" : "Ver cardápio e pedir"} <ChevronRight size={18} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CartaoDaLoja({ loja, onEscolher }: { loja: LojaNaVitrine; onEscolher: (l: LojaNaVitrine) => void }) {
  const zap = loja.telefone ? loja.telefone.replace(/\D/g, "") : "";
  // "Como chegar" só faz sentido em loja que recebe o cliente.
  const mapa = loja.soDelivery
    ? null
    : loja.ponto
      ? `https://www.google.com/maps/search/?api=1&query=${loja.ponto.lat},${loja.ponto.lng}`
      : loja.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loja.endereco)}` : null;
  return (
    <article className={s.cartao}>
      <div className={s.cartaoCapa}>
        {loja.capa || loja.capaVideo ? <Capa imagem={loja.capa} video={loja.capaVideo} className={s.cartaoImagem} /> : <div className={s.cartaoSemCapa} />}
        {loja.logo && <img className={s.cartaoLogo} src={loja.logo} alt="" />}
      </div>
      <div className={s.cartaoCorpo}>
        <strong>{loja.nome}</strong>
        <Situacao loja={loja} />
        {loja.endereco && <p className={s.cartaoEndereco}><MapPin size={14} /> {loja.endereco}</p>}
        {loja.soDelivery && <p className={s.cartaoEndereco}><Bike size={14} /> Só entrega</p>}
        <div className={s.cartaoAcoes}>
          <a className={s.botaoPequeno} href={`/loja/${loja.slug}`} onClick={() => onEscolher(loja)}>Cardápio</a>
          {zap.length >= 10 && (
            <a className={s.botaoIcone} href={`https://wa.me/${zap.length <= 11 ? "55" + zap : zap}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp da ${loja.nome}`}>
              <Phone size={16} />
            </a>
          )}
          {mapa && (
            <a className={s.botaoIcone} href={mapa} target="_blank" rel="noreferrer" aria-label={`Como chegar na ${loja.nome}`}>
              <Navigation size={16} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
