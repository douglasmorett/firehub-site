"use client";

/**
 * Tablet na mesa — a tela do dono (/store/tablet-na-mesa).
 *
 * Desligado: o que é, como funciona, o preço por tablet com a conta pronta e o
 * termo (lib/tablet-da-mesa/termo.ts). Ligado: o liga/desliga com a regra da
 * cobrança, quanto o mês já deu, os tablets de cada mesa e o "Adicionar
 * tablet" (o número de 6 dígitos que o tablet digita em /tablet).
 */

import { useCallback, useEffect, useState } from "react";
import { BellRing, ChefHat, Plus, Receipt, TabletSmartphone, Trash2, Wifi, WifiOff } from "lucide-react";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { PRECO_POR_TABLET } from "@/lib/tablet-da-mesa/preco";
import { CLAUSULAS_DO_TERMO_DO_TABLET, TITULO_DO_TERMO_DO_TABLET, VERSAO_DO_TERMO_DO_TABLET } from "@/lib/tablet-da-mesa/termo";

type Estado = {
  ativo: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; preco: number;
  desligaEm: string | null; fimDoMes: string | null; tabletsCobradosEsteMes: number; valorEsteMes: number;
};
type Tablet = {
  id: string; tableId: string; mesaNumero: number | null; mesaRotulo: string | null; pareado: boolean;
  codigo: string | null; codigoAte: string | null; ultimoSinal: string | null; online: boolean; modelo: string | null;
};
type Mesa = { id: string; number: number; label: string | null; isActive: boolean };
type Dados = { estado: Estado; tablets: Tablet[]; mesas: Mesa[]; diasDeTeste: number };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const nomeDaMesa = (m: { number?: number | null; mesaNumero?: number | null; label?: string | null; mesaRotulo?: string | null }) =>
  m.label || m.mesaRotulo || `Mesa ${m.number ?? m.mesaNumero ?? "?"}`;
const PRECO_TEXTO = `${reais(PRECO_POR_TABLET)} por tablet usado no mês`;

function haQuanto(iso: string | null): string {
  if (!iso) return "nunca ligou";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `em ${dia(iso)}`;
}

export default function TabletNaMesaClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [pareando, setPareando] = useState<{ codigo: string; ate: string; mesa: string } | null>(null);

  const chamar = useCallback(async (metodo: string, corpo?: unknown) => {
    const r = await fetch("/api/store/tablet-na-mesa", {
      method: metodo,
      cache: "no-store",
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Não deu certo.");
    return j;
  }, []);

  const carregar = useCallback(async () => {
    try { setDados(await chamar("GET")); } catch (e: any) { setErro(e.message); }
  }, [chamar]);
  useEffect(() => { void carregar(); }, [carregar]);
  // Tablet pareando ou ligado: a lista se atualiza sozinha (o tablet entrou, ficou online).
  useEffect(() => {
    if (!dados?.estado.ativo) return;
    const i = setInterval(carregar, pareando ? 4000 : 20000);
    return () => clearInterval(i);
  }, [dados?.estado.ativo, pareando, carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);
  // O código some da tela quando o tablet entra (ele sai da lista de pendentes).
  useEffect(() => {
    if (pareando && dados && !dados.tablets.some((t) => t.codigo === pareando.codigo)) {
      setPareando(null);
      setAviso({ tipo: "ok", texto: `Tablet da ${pareando.mesa} pronto! Ele já mostra o cardápio.` });
    }
  }, [dados, pareando]);

  async function ligar(ligar: boolean) {
    setSalvando(true);
    try {
      const j = await chamar("POST", ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DO_TABLET } } : { ligar });
      setDados(j);
      setTermoAberto(false);
      const e: Estado = j.estado;
      setAviso({ tipo: "ok", texto: ligar
        ? e.emTeste && e.testeAte ? `Tablet na mesa ligado! Grátis até ${dia(e.testeAte)}. Agora adicione os tablets das mesas.` : "Tablet na mesa ligado! Agora adicione os tablets das mesas."
        : e.ativo && e.desligaEm ? `Desliga em ${dia(e.desligaEm)}: até lá os tablets continuam funcionando.` : "Tablet na mesa desligado. Os tablets passam a mostrar \"chame o garçom\"." });
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  async function adicionar(tableId: string) {
    const mesa = dados?.mesas.find((m) => m.id === tableId);
    if (!mesa) return;
    try {
      const j = await chamar("POST", { acao: "parear", tableId });
      setPareando({ codigo: j.codigo, ate: j.ate, mesa: nomeDaMesa(mesa) });
      void carregar();
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    }
  }

  async function trocarMesa(tabletId: string, tableId: string) {
    try { setDados(await chamar("PATCH", { tabletId, tableId })); } catch (e: any) { setAviso({ tipo: "erro", texto: e.message }); }
  }

  async function remover(t: Tablet) {
    if (!confirm(`Tirar o tablet da ${nomeDaMesa(t)}? Ele volta para a tela do código.`)) return;
    try { setDados(await chamar("DELETE", { tabletId: t.id })); } catch (e: any) { setAviso({ tipo: "erro", texto: e.message }); }
  }

  if (erro) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;
  const { estado } = dados;

  return (
    <div style={S.pagina}>
      {aviso && <div role="status" onClick={() => setAviso(null)} style={aviso.tipo === "ok" ? S.avisoOk : S.avisoErro}>{aviso.texto}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: "-0.02em" }}>Tablet na mesa</h1>
        {estado.ativo && <span style={S.selo}>{estado.isento ? "LIBERADO" : estado.emTeste && estado.testeAte ? `ATIVO · grátis até ${dia(estado.testeAte)}` : "ATIVO"}</span>}
      </div>
      <p style={S.sub}>O cliente pede sozinho pelo tablet da mesa. O pedido cai direto na cozinha, já com o número da mesa, sem precisar do garçom.</p>

      {!estado.ativo ? (
        <Oferta diasDeTeste={dados.diasDeTeste} jaTestou={estado.jaTestou} mesas={dados.mesas.length} onAtivar={() => setTermoAberto(true)} />
      ) : (
        <>
          <InterruptorDoModulo nome="o Tablet na mesa" preco={estado.preco} precoTexto={PRECO_TEXTO} estado={{ ...estado, cortesia: false }}
            salvando={salvando} onLigar={() => setTermoAberto(true)} onDesligar={() => ligar(false)} onContinuar={() => ligar(true)} />

          {!estado.isento && (
            <div style={S.mes}>
              <Receipt size={20} color="#EA580C" />
              <div>
                <b>Este mês: {estado.tabletsCobradosEsteMes} {estado.tabletsCobradosEsteMes === 1 ? "tablet ativo" : "tablets ativos"} = {reais(estado.valorEsteMes)}</b>
                <div style={{ fontSize: 13, color: "#64748B" }}>
                  {estado.emTeste && estado.testeAte ? `Nos dias grátis (até ${dia(estado.testeAte)}) nada conta. ` : ""}
                  Conta o tablet que ficou ligado com o cardápio em pelo menos um dia do mês. Tablet guardado não paga.
                </div>
              </div>
            </div>
          )}

          <section style={S.cartao}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 19 }}>Tablets das mesas</h2>
              <AdicionarTablet mesas={dados.mesas} onEscolher={adicionar} />
            </div>

            {pareando && (
              <div style={S.codigo}>
                <div style={{ fontSize: 14, color: "#7C2D12", fontWeight: 700 }}>Tablet da {pareando.mesa}: no tablet, abra</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0F172A", margin: "4px 0" }}>firehubfood.com.br/tablet</div>
                <div style={{ fontSize: 13, color: "#7C2D12" }}>(ou o app FireHub › Tablet da mesa) e digite:</div>
                <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: 10, color: "#EA580C", margin: "6px 0" }}>{pareando.codigo.replace(/(\d{3})(\d{3})/, "$1 $2")}</div>
                <div style={{ fontSize: 13, color: "#7C2D12" }}>Vale até {new Date(pareando.ate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Esta tela avisa quando o tablet entrar.</div>
                <button type="button" style={{ ...S.botaoLeve, marginTop: 10 }} onClick={() => setPareando(null)}>Fechar</button>
              </div>
            )}

            {dados.tablets.filter((t) => t.pareado).length === 0 && !pareando ? (
              <p style={{ color: "#64748B", margin: "14px 0 0" }}>Nenhum tablet ainda. Toque em <b>Adicionar tablet</b>, escolha a mesa e digite o número no tablet.</p>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {dados.tablets.filter((t) => t.pareado).map((t) => (
                  <div key={t.id} style={S.linha}>
                    <span style={{ ...S.icone, background: t.online ? "#DCFCE7" : "#F1F5F9", color: t.online ? "#15803D" : "#94A3B8" }}>
                      {t.online ? <Wifi size={18} /> : <WifiOff size={18} />}
                    </span>
                    <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>{nomeDaMesa(t)}</div>
                      <div style={{ fontSize: 13, color: "#64748B" }}>{t.online ? "Ligado agora" : `Desligado · último sinal ${haQuanto(t.ultimoSinal)}`}</div>
                    </div>
                    <select aria-label="Mudar de mesa" value={t.tableId} onChange={(e) => void trocarMesa(t.id, e.target.value)} style={S.select}>
                      {dados.mesas.map((m) => <option key={m.id} value={m.id}>{nomeDaMesa(m)}</option>)}
                    </select>
                    <button type="button" onClick={() => void remover(t)} style={S.botaoIcone} aria-label={`Tirar o tablet da ${nomeDaMesa(t)}`}><Trash2 size={17} /></button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ComoDeixarPronto />
        </>
      )}

      {termoAberto && (
        <Termo diasDeTeste={dados.diasDeTeste} comTeste={!estado.jaTestou && !estado.isento} salvando={salvando}
          onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />
      )}
    </div>
  );
}

function AdicionarTablet({ mesas, onEscolher }: { mesas: Mesa[]; onEscolher: (tableId: string) => void }) {
  const [aberto, setAberto] = useState(false);
  if (mesas.length === 0) return <span style={{ fontSize: 13, color: "#B45309" }}>Cadastre as mesas em Mesas primeiro.</span>;
  if (!aberto) return <button type="button" style={S.cta} onClick={() => setAberto(true)}><Plus size={17} /> Adicionar tablet</button>;
  return (
    <select autoFocus defaultValue="" style={{ ...S.select, height: 44, fontWeight: 700 }} onChange={(e) => { if (e.target.value) { onEscolher(e.target.value); setAberto(false); } }}>
      <option value="" disabled>Qual mesa?</option>
      {mesas.filter((m) => m.isActive).map((m) => <option key={m.id} value={m.id}>{nomeDaMesa(m)}</option>)}
    </select>
  );
}

function Oferta({ diasDeTeste, jaTestou, mesas, onAtivar }: { diasDeTeste: number; jaTestou: boolean; mesas: number; onAtivar: () => void }) {
  const [quantos, setQuantos] = useState(Math.max(1, Math.min(mesas || 10, 40)));
  const recursos = [
    { icone: <ChefHat size={20} />, titulo: "Pedido direto na cozinha", texto: "Sai na impressora e no KDS como o pedido do garçom, já com o número da mesa e o preço do salão." },
    { icone: <BellRing size={20} />, titulo: "Chamar garçom e pedir a conta", texto: "Um toque no tablet: a mesa aparece marcada na tela de Mesas e toca no celular da loja (app FireHub)." },
    { icone: <Receipt size={20} />, titulo: "A conta na tela do cliente", texto: "O cliente vê o que já consumiu. Quando o garçom fecha a mesa, o tablet limpa tudo para o próximo." },
    { icone: <TabletSmartphone size={20} />, titulo: "O tablet é seu", texto: "Qualquer tablet Android ou iPad com internet. Sem aluguel de aparelho e sem fidelidade." },
  ];
  return (
    <>
      <div style={S.oferta}>
        <div style={{ flex: "1 1 320px" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#EA580C", letterSpacing: ".04em" }}>MÓDULO NOVO</div>
          <div style={{ fontSize: 26, fontWeight: 900, margin: "4px 0 8px", lineHeight: 1.2 }}>A mesa pede sozinha.<br />Seu garçom só leva o prato.</div>
          <p style={{ margin: 0, color: "#57534E", lineHeight: 1.55 }}>
            Um tablet em cada mesa com o seu cardápio, fotos e combos. O cliente escolhe, manda, e o pedido entra na conta da mesa na hora. Ninguém espera o garçom passar para pedir a segunda rodada.
          </p>
          <button type="button" style={{ ...S.cta, marginTop: 16, height: 52, fontSize: 16 }} onClick={onAtivar}>
            {jaTestou ? "Ativar o Tablet na mesa" : `Testar ${diasDeTeste} dias grátis`}
          </button>
        </div>
        <div style={S.preco}>
          <div style={{ fontSize: 14, color: "#57534E" }}>Por tablet ativo</div>
          <div style={{ fontSize: 40, fontWeight: 900, color: "#0F172A" }}>{reais(PRECO_POR_TABLET)}<span style={{ fontSize: 16, color: "#57534E" }}>/mês</span></div>
          <label style={{ display: "block", fontSize: 14, color: "#57534E", marginTop: 10 }}>
            Quantos tablets? <b>{quantos}</b>
            <input type="range" min={1} max={40} value={quantos} onChange={(e) => setQuantos(Number(e.target.value))} style={{ width: "100%", accentColor: "#EA580C" }} />
          </label>
          <div style={{ fontSize: 15, marginTop: 4 }}>{quantos} × {reais(PRECO_POR_TABLET)} = <b>{reais(quantos * PRECO_POR_TABLET)}/mês</b></div>
          <div style={{ fontSize: 12.5, color: "#78716C", marginTop: 8, lineHeight: 1.45 }}>Só paga o tablet que funcionou no mês. À parte da mensalidade. {diasDeTeste} dias grátis na primeira ativação.</div>
        </div>
      </div>
      <div style={S.recursos}>
        {recursos.map((r) => (
          <div key={r.titulo} style={S.recurso}>
            <span style={S.icone}>{r.icone}</span>
            <div><b>{r.titulo}</b><div style={{ fontSize: 14, color: "#57534E", lineHeight: 1.5, marginTop: 2 }}>{r.texto}</div></div>
          </div>
        ))}
      </div>
    </>
  );
}

function ComoDeixarPronto() {
  return (
    <section style={S.cartao}>
      <h2 style={{ margin: "0 0 8px", fontSize: 19 }}>Como deixar o tablet pronto na mesa</h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, color: "#334155", lineHeight: 1.5, fontSize: 14.5 }}>
        <li>Suporte de mesa com o carregador ligado (o tablet fica com a tela acesa o tempo todo).</li>
        <li>No tablet, instale o app <b>FireHub</b> e escolha <b>Tablet da mesa</b>, ou abra <b>firehubfood.com.br/tablet</b> no Chrome/Safari.</li>
        <li>Toque em <b>Adicionar tablet</b> aqui, escolha a mesa e digite o número no tablet.</li>
        <li>Prenda a tela para o cliente não sair do cardápio: no Android, <b>Fixar app</b> (Configurações › Segurança); no iPad, <b>Acesso Guiado</b> (Ajustes › Acessibilidade).</li>
      </ol>
    </section>
  );
}

function Termo({ diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_TABLET} style={S.termoFundo}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}>
      <div style={S.termo}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "18px 20px", borderBottom: "1px solid #E9E3DC" }}>
          <span style={S.icone}><TabletSmartphone size={20} /></span>
          <div>
            <strong style={{ fontSize: 17 }}>{TITULO_DO_TERMO_DO_TABLET}</strong>
            <div style={{ fontSize: 13, color: "#57524C" }}>{PRECO_TEXTO} · versão de {VERSAO_DO_TERMO_DO_TABLET.split("-").reverse().join("/")}</div>
          </div>
        </div>
        <ResumoDaCobranca preco={PRECO_POR_TABLET} precoTexto={PRECO_TEXTO} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: 0, padding: "16px 20px 4px 40px", display: "grid", gap: 10, fontSize: 14, lineHeight: 1.5, color: "#292524" }}>
          {CLAUSULAS_DO_TERMO_DO_TABLET.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "12px 20px 0", padding: 12, background: "#FAF8F6", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0 }} />
          Li e concordo com o termo e autorizo a cobrança de {PRECO_TEXTO} no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "16px 20px 20px", flexWrap: "wrap" }}>
          <button type="button" style={S.botaoLeve} onClick={onCancelar} disabled={salvando}>Agora não</button>
          <button type="button" style={{ ...S.cta, opacity: !concordo || salvando ? 0.5 : 1 }} onClick={onAceitar} disabled={!concordo || salvando}>{salvando ? "Ativando…" : "Concordo e ativar"}</button>
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  pagina: { maxWidth: 1000, margin: "0 auto", padding: "20px 16px 72px", color: "#15120F", fontFamily: "Inter, system-ui, sans-serif" },
  sub: { color: "#57524C", margin: "6px 0 0", fontSize: 15, lineHeight: 1.5 },
  selo: { fontSize: 12, fontWeight: 800, color: "#2B8A3E", background: "#EBFBEE", padding: "5px 12px", borderRadius: 999 },
  avisoOk: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10060, width: "min(520px, calc(100% - 32px))", padding: "12px 16px", borderRadius: 14, background: "#ECFDF3", border: "1px solid #A6E9BD", color: "#14532D", fontSize: 14, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,0,.15)", cursor: "pointer" },
  avisoErro: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10060, width: "min(520px, calc(100% - 32px))", padding: "12px 16px", borderRadius: 14, background: "#FEF2F2", border: "1px solid #FECACA", color: "#7F1D1D", fontSize: 14, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,0,.15)", cursor: "pointer" },
  cta: { display: "inline-flex", alignItems: "center", gap: 6, height: 44, padding: "0 18px", border: 0, borderRadius: 12, background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  botaoLeve: { height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid #D6D3D1", background: "#fff", color: "#57524C", fontWeight: 700, cursor: "pointer" },
  botaoIcone: { width: 40, height: 40, borderRadius: 10, border: "1px solid #E2E8F0", background: "#fff", color: "#B91C1C", display: "grid", placeItems: "center", cursor: "pointer" },
  select: { height: 40, borderRadius: 10, border: "1px solid #CBD5E1", padding: "0 10px", background: "#fff", fontSize: 14, maxWidth: "100%" },
  cartao: { marginTop: 16, padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #E9E3DC" },
  mes: { display: "flex", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 14, background: "#FFF7ED", border: "1px solid #FED7AA" },
  linha: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 12, borderRadius: 14, border: "1px solid #F1F5F9", background: "#FCFCFD" },
  icone: { width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "#FFF4EC", color: "#E8590C", flexShrink: 0 },
  codigo: { marginTop: 14, padding: 18, borderRadius: 16, background: "#FFF7ED", border: "2px dashed #FDBA74", textAlign: "center" },
  oferta: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "stretch", marginTop: 18, padding: 22, borderRadius: 22, background: "linear-gradient(135deg,#FFF7ED,#FFFFFF)", border: "1px solid #FED7AA" },
  preco: { flex: "0 1 300px", padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #E9E3DC", boxShadow: "0 8px 24px rgba(234,88,12,.08)" },
  recursos: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 16 },
  recurso: { display: "flex", gap: 12, padding: 16, borderRadius: 16, background: "#fff", border: "1px solid #E9E3DC" },
  termoFundo: { position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,12,9,.55)", display: "grid", placeItems: "center", padding: 16 },
  termo: { background: "#fff", borderRadius: 20, width: "min(600px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.35)" },
};
