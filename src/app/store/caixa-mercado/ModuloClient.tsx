"use client";

/**
 * O módulo Caixa de mercado no painel: o que é, quanto custa (R$ 97 por
 * computador em uso no mês, à parte da mensalidade), o termo, os computadores
 * de caixa, o TEF de cada um (o motor do totem, com simulador) e a
 * configuração (etiqueta da balança, margem dos produtos novos, NFC-e).
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CheckCircle2, CreditCard, Monitor, Trash2 } from "lucide-react";
import {
  IlustracaoBalanca, IlustracaoDoCaixa, IlustracaoFiscal, IlustracaoLeitor, IlustracaoOperadores, IlustracaoPinpad, IlustracaoPix,
} from "./Ilustracoes";
import { CLAUSULAS_DO_TERMO_DO_CAIXA, TITULO_DO_TERMO_DO_CAIXA, VERSAO_DO_TERMO_DO_CAIXA } from "@/lib/caixa-mercado/termo";
import { DIAS_DE_TESTE_DO_CAIXA } from "@/lib/caixa-mercado/preco";
import { montarEtiqueta, type FormatoDaEtiqueta } from "@/lib/caixa-mercado/etiqueta";
import { fetchAssistente } from "@/lib/fetch-assistente";
import { PORTAS_DO_ASSISTENTE } from "@/lib/tef-no-assistente";

type Terminal = { id: string; numero: number; nome: string; ultimoSinal: string | null };
type Config = { etiqueta: FormatoDaEtiqueta; margemPadrao: number; emitirNfce: boolean };
type Estado = {
  ativo: boolean; emTeste: boolean; testeAte: string | null; jaTestou: boolean; isento: boolean; preco: number;
  desligaEm: string | null; computadoresCobradosEsteMes: number; valorEsteMes: number; config: Config;
};

// O que vem em cada computador de caixa (o cartão do preço): curto, para ler em 3 segundos.
const INCLUSO_POR_COMPUTADOR = [
  "Leitor de código de barras e balança no cabo",
  "Pix na tela sem taxa e TEF no pinpad USB",
  "Turno por operador: troco, sangria e fechamento",
  "Estoque, financeiro e NFC-e em cada venda",
];

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "");

async function acharAssistente(): Promise<number | null> {
  for (const porta of PORTAS_DO_ASSISTENTE) {
    try {
      const r = await fetchAssistente(`http://127.0.0.1:${porta}/status`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (r.ok) return porta;
    } catch { /* próxima */ }
  }
  return null;
}

export default function ModuloClient() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [podeContratar, setPodeContratar] = useState(false);
  const [terminais, setTerminais] = useState<Terminal[]>([]);
  const [daqui, setDaqui] = useState<{ terminal: Terminal | null; tef: { ligado: boolean } } | null>(null);
  const [erroGeral, setErroGeral] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [termoAberto, setTermoAberto] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [motorTef, setMotorTef] = useState<"simulador" | "paygo">("simulador");

  const avisar = (ok: boolean, texto: string) => { setAviso({ ok, texto }); setTimeout(() => setAviso(null), 6000); };

  const carregar = useCallback(async () => {
    const r = await fetch("/api/store/caixa-mercado/modulo", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErroGeral(d?.error || "Não deu para abrir."); return; }
    setEstado(d.estado);
    setConfig(d.estado.config);
    setPodeContratar(Boolean(d.podeContratar));
    setTerminais(d.terminais || []);
    if (d.estado.ativo) {
      const t = await fetch("/api/store/caixa-mercado/terminal", { cache: "no-store" });
      const td = await t.json().catch(() => ({}));
      setDaqui(t.ok ? { terminal: td.terminal, tef: td.tef } : null);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function ligar(l: boolean) {
    setOcupado("modulo");
    const r = await fetch("/api/store/caixa-mercado/modulo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(l ? { ligar: true, aceite: { versao: VERSAO_DO_TERMO_DO_CAIXA } } : { ligar: false }),
    });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "Não deu certo.");
    setTermoAberto(false);
    avisar(true, l ? "Caixa de mercado ativado. Registre este computador como caixa." : "Caixa de mercado desativado.");
    await carregar();
  }

  async function registrar() {
    setOcupado("registrar");
    const r = await fetch("/api/store/caixa-mercado/terminal", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "Não deu para registrar.");
    avisar(true, `Este computador agora é o "${d.terminal.nome}".`);
    await carregar();
  }

  async function desativar(t: Terminal) {
    setOcupado(t.id);
    const r = await fetch("/api/store/caixa-mercado/terminal", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminalId: t.id }) });
    setOcupado("");
    if (!r.ok) return avisar(false, "Não deu para desativar.");
    avisar(true, `"${t.nome}" desativado.`);
    await carregar();
  }

  async function ligarTef() {
    setOcupado("tef");
    try {
      const porta = await acharAssistente();
      if (!porta) throw new Error("Não achei o Assistente FireHub neste computador. Abra o Assistente e tente de novo.");
      const r = await fetch("/api/store/caixa-mercado/tef", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Não deu para ligar o TEF.");
      const p = await fetchAssistente(`http://127.0.0.1:${porta}/tef/parear`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ licencaId: d.licencaId, chave: d.chave, segredoLocal: d.segredoLocal, nuvem: d.nuvem, motor: motorTef }),
      });
      if (!p.ok) {
        const e = (await p.json().catch(() => ({})))?.error;
        throw new Error(p.status === 404 ? "O Assistente deste computador é antigo e não tem TEF. Atualize o Assistente (1.2.38 ou mais novo)." : e || "O Assistente não aceitou o pareamento.");
      }
      avisar(true, motorTef === "simulador" ? "TEF ligado no modo SIMULADOR (não cobra de verdade)." : "TEF ligado com a PayGo.");
      await carregar();
    } catch (e: any) {
      avisar(false, e?.message || "Não deu para ligar o TEF.");
    } finally {
      setOcupado("");
    }
  }

  async function desligarTef() {
    setOcupado("tef");
    await fetch("/api/store/caixa-mercado/tef", { method: "DELETE" });
    const porta = await acharAssistente();
    if (porta) await fetchAssistente(`http://127.0.0.1:${porta}/tef/desparear`, { method: "POST" }).catch(() => null);
    setOcupado("");
    avisar(true, "TEF desligado neste computador: o caixa usa a maquininha manual.");
    await carregar();
  }

  async function salvarConfig() {
    if (!config) return;
    setOcupado("config");
    const r = await fetch("/api/store/caixa-mercado/modulo", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
    setOcupado("");
    avisar(r.ok, r.ok ? "Configuração salva." : "Não deu para salvar.");
  }

  if (erroGeral) return <div style={S.pagina}><p style={S.sub}>{erroGeral}</p></div>;
  if (!estado) return <div style={S.pagina}><p style={S.sub}>Carregando…</p></div>;

  const recursos = [
    { Arte: IlustracaoLeitor, titulo: "Leitor de código de barras", texto: "Bipe e o item entra. Quantidade com 3* antes do código, busca por nome no F2." },
    { Arte: IlustracaoBalanca, titulo: "Balança e etiqueta", texto: "Produto por quilo lê a balança no cabo. Etiqueta da balança do açougue (código 2…) entra com o preço impresso." },
    { Arte: IlustracaoPix, titulo: "Pix na tela, sem taxa", texto: "QR Code com o valor na chave Pix da loja. O operador confirma o recebido." },
    { Arte: IlustracaoPinpad, titulo: "TEF no cabo USB", texto: "O valor vai direto ao pinpad: o cliente aproxima ou digita a senha, sem digitar valor na maquininha." },
    { Arte: IlustracaoOperadores, titulo: "Caixa por operador", texto: "Abertura com troco, sangria, suprimento e fechamento conferido por forma." },
    { Arte: IlustracaoFiscal, titulo: "Cadastro e fiscal em lote", texto: "Planilha do sistema antigo, XML das notas de compra e a planilha por NCM para o contador." },
  ];
  const preco = reais(estado.preco);
  // O que a tela já sabe da cobrança: liberada, em teste ou o valor do mês (lib/caixa-mercado/assinatura).
  const notaDaCobranca = estado.isento
    ? <p className="cm-nota cm-nota-ok">Sua loja está liberada: não paga pelos computadores de caixa.</p>
    : estado.emTeste
      ? <p className="cm-nota">Teste grátis até {data(estado.testeAte)}: até lá nenhum computador é cobrado.</p>
      : null;

  return (
    <div style={S.pagina}>
      <style>{CSS_DA_TELA}</style>
      {aviso && <div style={aviso.ok ? S.avisoOk : S.avisoErro} onClick={() => setAviso(null)}>{aviso.texto}</div>}

      <div className="cm-ct">
        <div className="cm-cabeca">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1>Caixa de mercado</h1>
            {estado.ativo && <span style={S.selo}>{estado.isento ? "Liberado" : estado.emTeste ? `Teste grátis até ${data(estado.testeAte)}` : "Ativo"}</span>}
          </div>
          <p className="cm-lead">Bipou, pesou, recebeu. Frente de caixa para mercado dentro do FireHub: cada venda dá baixa no estoque e cai no financeiro, nos relatórios e na NFC-e.</p>
        </div>

        {/* O protagonista: o preço por computador e o botão de ativar/registrar (Douglas, 16/11: "destaca mais essa parte"). */}
        <section className="cm-destaque">
          <div className="cm-destaque-texto">
            <span className="cm-destaque-selo"><Monitor size={15} /> Cobrado por computador de caixa</span>
            <div className="cm-preco">
              <span className="cm-preco-valor">{preco}</span>
              <span className="cm-preco-unidade">por computador<br />por mês</span>
            </div>
            <p className="cm-destaque-regra">Cada computador de caixa conta separado e só paga no mês em que vendeu ou abriu turno: registrado e parado não paga. À parte da mensalidade do FireHub (2% do faturamento, mínimo e teto de sempre).</p>
            <ul className="cm-incluso">
              {INCLUSO_POR_COMPUTADOR.map((t) => <li key={t}><CheckCircle2 size={18} /> {t}</li>)}
            </ul>
            {notaDaCobranca}
            {estado.ativo && !estado.isento && (
              <p className="cm-mes">Este mês: {estado.computadoresCobradosEsteMes} computador(es) em uso fora do teste = <strong>{reais(estado.valorEsteMes)}</strong></p>
            )}

            {estado.ativo && daqui?.terminal && <p className="cm-mes">Este computador é o <strong>{daqui.terminal.nome}</strong>.</p>}
            <div className="cm-acoes">
              {!estado.ativo ? (
                podeContratar ? (
                  <>
                    <button className="cm-botao" onClick={() => { setAceito(false); setTermoAberto(true); }}>{estado.jaTestou ? "Ativar" : `Ativar com ${DIAS_DE_TESTE_DO_CAIXA} dias grátis`}</button>
                    {!estado.jaTestou && <span className="cm-acoes-nota">{DIAS_DE_TESTE_DO_CAIXA} dias grátis na primeira ativação. Depois, {preco} por computador usado no mês.</span>}
                  </>
                ) : <span className="cm-acoes-nota">Só o dono da loja ativa.</span>
              ) : daqui?.terminal ? (
                <>
                  <Link href="/store/caixa-mercado/caixa" className="cm-botao">Abrir o caixa</Link>
                  <Link href="/store/caixa-mercado/importar" className="cm-botao-leve">Importar produtos</Link>
                </>
              ) : podeContratar ? (
                <>
                  <button className="cm-botao" disabled={ocupado === "registrar"} onClick={registrar}>Registrar este computador como caixa</button>
                  <span className="cm-acoes-nota">Faça no computador que fica no caixa (o leitor e a balança ficam nele).</span>
                </>
              ) : <span className="cm-acoes-nota">Este computador ainda não é um caixa. Peça ao dono da loja para registrar.</span>}
            </div>

            {estado.ativo && daqui?.terminal && podeContratar && (
              <div style={{ ...S.linha, marginTop: 16, color: "#15120F" }}>
                <CreditCard size={18} />
                <span style={{ flex: 1, minWidth: 200 }}>
                  <strong>TEF (pinpad no cabo USB)</strong>{" "}
                  {daqui.tef.ligado ? "ligado neste computador." : "desligado: o caixa usa a maquininha manual."}
                </span>
                {!daqui.tef.ligado && (
                  <select style={S.select} value={motorTef} onChange={(e) => setMotorTef(e.target.value as any)}>
                    <option value="simulador">Simulador (não cobra)</option>
                    <option value="paygo">PayGo (kit homologado)</option>
                  </select>
                )}
                {daqui.tef.ligado
                  ? <button style={S.botaoLeve} disabled={ocupado === "tef"} onClick={desligarTef}>Desligar TEF</button>
                  : <button style={S.botaoLeve} disabled={ocupado === "tef"} onClick={ligarTef}>{ocupado === "tef" ? "Ligando…" : "Ligar TEF neste computador"}</button>}
              </div>
            )}
          </div>
          <div className="cm-destaque-arte"><IlustracaoDoCaixa /></div>
        </section>

        <h2 className="cm-titulo">Tudo o que o caixa do mercado precisa</h2>
        <p style={{ ...S.sub, marginTop: 4 }}>Leitor, balança e pinpad no mesmo computador, Pix na tela, e o estoque e o fiscal do FireHub por trás de cada venda.</p>
        <div className="cm-recursos">
          {recursos.map((r) => (
            <article key={r.titulo} className="cm-recurso">
              <div className="cm-recurso-arte"><r.Arte /></div>
              <div className="cm-recurso-corpo"><h3>{r.titulo}</h3><p>{r.texto}</p></div>
            </article>
          ))}
        </div>
      </div>

      {estado.ativo && (
        <>

          <div style={S.cartao} className="cm-ct">
            <h2 style={S.h2}>Computadores de caixa</h2>
            {terminais.length === 0 && <p style={S.sub}>Nenhum computador registrado ainda.</p>}
            {terminais.map((t) => (
              <div key={t.id} style={{ ...S.linha, marginTop: 8 }}>
                <Monitor size={18} />
                <span style={{ flex: 1 }}><strong>{t.nome}</strong> · último uso {t.ultimoSinal ? new Date(t.ultimoSinal).toLocaleString("pt-BR") : "nunca"}</span>
                {podeContratar && <button style={S.botaoIcone} title="Desativar" disabled={ocupado === t.id} onClick={() => desativar(t)}><Trash2 size={16} /></button>}
              </div>
            ))}
            {estado.isento ? notaDaCobranca : (
              <>
                <div className="cm-conta">
                  <div><small>Registrados</small><b>{terminais.length}</b></div>
                  <div><small>Em uso este mês, fora do teste</small><b>{estado.computadoresCobradosEsteMes}</b></div>
                  <div className="cm-conta-total"><small>No boleto deste mês</small><b>{reais(estado.valorEsteMes)}</b></div>
                </div>
                {terminais.length > 0 && (
                  <p style={{ ...S.sub, fontSize: 14 }}>
                    Se os {terminais.length} computador(es) registrados venderem no mês: {terminais.length} × {preco} = <strong>{reais(terminais.length * estado.preco)}</strong>.
                  </p>
                )}
              </>
            )}
          </div>

          {config && (
            <div style={S.cartao}>
              <h2 style={S.h2}>Configuração</h2>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 8 }}>
                <label style={S.rotulo}>Etiqueta da balança: o valor é
                  <select style={S.select} value={config.etiqueta.tipo} onChange={(e) => setConfig({ ...config, etiqueta: { ...config.etiqueta, tipo: e.target.value as any } })}>
                    <option value="preco">o preço total</option><option value="peso">o peso (gramas)</option>
                  </select>
                </label>
                <label style={S.rotulo}>Dígitos do código (PLU)
                  <select style={S.select} value={config.etiqueta.codigoTamanho} onChange={(e) => setConfig({ ...config, etiqueta: { ...config.etiqueta, codigoTamanho: Number(e.target.value) as any } })}>
                    <option value={4}>4</option><option value={5}>5</option><option value={6}>6</option>
                  </select>
                </label>
                <label style={S.rotulo}>Dígitos do valor
                  <select style={S.select} value={config.etiqueta.valorTamanho} onChange={(e) => setConfig({ ...config, etiqueta: { ...config.etiqueta, valorTamanho: Number(e.target.value) as any } })}>
                    <option value={5}>5</option><option value={6}>6</option>
                  </select>
                </label>
                <label style={S.rotulo}>Margem para produto novo do XML (%)
                  <input style={S.select} type="number" min={0} max={500} value={config.margemPadrao} onChange={(e) => setConfig({ ...config, margemPadrao: Number(e.target.value) || 0 })} />
                </label>
              </div>
              <p style={{ ...S.sub, fontSize: 13 }}>Exemplo de etiqueta neste formato (PLU 123, valor 15,90): <code>{montarEtiqueta(123, 1590, config.etiqueta)}</code>. Margem 0 = produto novo do XML entra sem preço e inativo, para você preencher.</p>
              <label style={{ ...S.rotulo, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input type="checkbox" checked={config.emitirNfce} onChange={(e) => setConfig({ ...config, emitirNfce: e.target.checked })} />
                O caixa já abre com "Emitir NFC-e" marcado
              </label>
              {podeContratar && <button style={{ ...S.cta, marginTop: 12 }} disabled={ocupado === "config"} onClick={salvarConfig}>Salvar configuração</button>}
            </div>
          )}

          {podeContratar && !estado.isento && (
            <div style={S.cartao}>
              {estado.desligaEm
                ? <p style={S.sub}>Desativado: o módulo fica liberado até {data(estado.desligaEm)} e desliga sozinho. <button style={S.botaoLeve} onClick={() => ligar(true)}>Manter ativo</button></p>
                : <button style={S.botaoLeve} disabled={ocupado === "modulo"} onClick={() => ligar(false)}>Desativar o Caixa de mercado</button>}
            </div>
          )}
        </>
      )}

      {termoAberto && (
        <div style={S.termoFundo} onClick={() => setTermoAberto(false)}>
          <div style={S.termo} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: 22 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{TITULO_DO_TERMO_DO_CAIXA}</h2>
              <ol style={{ paddingLeft: 20, color: "#3F3A35", fontSize: 14, lineHeight: 1.55 }}>
                {CLAUSULAS_DO_TERMO_DO_CAIXA.map((c, i) => <li key={i} style={{ marginBottom: 8 }}>{c}</li>)}
              </ol>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} /> Li e aceito o termo
              </label>
              <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
                <button style={S.botaoLeve} onClick={() => setTermoAberto(false)}>Voltar</button>
                <button style={{ ...S.cta, opacity: aceito ? 1 : 0.5 }} disabled={!aceito || ocupado === "modulo"} onClick={() => ligar(true)}>Ativar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  pagina: { maxWidth: 1240, margin: "0 auto", padding: "20px 16px 72px", color: "#15120F", fontFamily: "Inter, system-ui, sans-serif" },
  sub: { color: "#57524C", margin: "6px 0 0", fontSize: 15, lineHeight: 1.5 },
  h2: { margin: 0, fontSize: 18, display: "flex", gap: 8, alignItems: "center" },
  selo: { fontSize: 12, fontWeight: 800, color: "#2B8A3E", background: "#EBFBEE", padding: "5px 12px", borderRadius: 999 },
  avisoOk: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10060, width: "min(520px, calc(100% - 32px))", padding: "12px 16px", borderRadius: 14, background: "#ECFDF3", border: "1px solid #A6E9BD", color: "#14532D", fontSize: 14, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,0,.15)", cursor: "pointer" },
  avisoErro: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10060, width: "min(520px, calc(100% - 32px))", padding: "12px 16px", borderRadius: 14, background: "#FEF2F2", border: "1px solid #FECACA", color: "#7F1D1D", fontSize: 14, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,0,.15)", cursor: "pointer" },
  cta: { display: "inline-flex", alignItems: "center", gap: 6, height: 44, padding: "0 18px", border: 0, borderRadius: 12, background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  botaoLeve: { height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid #D6D3D1", background: "#fff", color: "#57524C", fontWeight: 700, cursor: "pointer" },
  botaoIcone: { width: 40, height: 40, borderRadius: 10, border: "1px solid #E2E8F0", background: "#fff", color: "#B91C1C", display: "grid", placeItems: "center", cursor: "pointer" },
  select: { height: 40, borderRadius: 10, border: "1px solid #CBD5E1", padding: "0 10px", background: "#fff", fontSize: 14, maxWidth: "100%" },
  rotulo: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 700, color: "#3F3A35" },
  cartao: { marginTop: 16, padding: 20, borderRadius: 20, background: "#fff", border: "1px solid #E9E3DC", boxShadow: "0 1px 2px rgba(21,18,15,.04)" },
  linha: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 12, borderRadius: 14, border: "1px solid #F1F5F9", background: "#FCFCFD" },
  termoFundo: { position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,12,9,.55)", display: "grid", placeItems: "center", padding: 16 },
  termo: { background: "#fff", borderRadius: 20, width: "min(640px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.35)" },
};

/**
 * Topo, preço e recursos ilustrados: classes porque precisam de @container (celular, iPad, painel com menu).
 * O container (.cm-ct) não envolve o aviso nem o termo: ele vira bloco de contenção do position: fixed.
 */
const CSS_DA_TELA = `
.cm-ct { container-type: inline-size; }
.cm-cabeca h1 { margin: 0; font-size: 34px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; }
.cm-lead { margin: 8px 0 0; font-size: 16px; line-height: 1.5; color: #57524C; max-width: 760px; }

.cm-destaque { position: relative; overflow: hidden; margin-top: 18px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr); gap: 28px;
  align-items: center; padding: 32px; border-radius: 28px; color: #fff;
  background: radial-gradient(circle at 92% 8%, rgba(255, 255, 255, .22) 0, transparent 38%), linear-gradient(135deg, #F97316 0%, #EA580C 45%, #DC2626 100%);
  box-shadow: 0 24px 50px rgba(220, 38, 38, .25); }
.cm-destaque-selo { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
  padding: 6px 12px; border-radius: 999px; background: rgba(255, 255, 255, .18); border: 1px solid rgba(255, 255, 255, .35); }
.cm-preco { margin-top: 14px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.cm-preco-valor { font-size: 68px; font-weight: 900; letter-spacing: -.035em; line-height: .95; white-space: nowrap; text-shadow: 0 2px 0 rgba(0, 0, 0, .08); }
.cm-preco-unidade { font-size: 21px; font-weight: 800; line-height: 1.15; }
.cm-destaque-regra { margin: 12px 0 0; font-size: 14.5px; line-height: 1.5; color: rgba(255, 255, 255, .92); max-width: 560px; }
.cm-incluso { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; font-size: 15px; font-weight: 700; }
.cm-incluso li { display: flex; gap: 8px; align-items: flex-start; line-height: 1.35; }
.cm-incluso svg { flex: none; margin-top: 1px; color: #FEF3C7; }
.cm-nota { margin: 14px 0 0; padding: 10px 14px; border-radius: 12px; font-size: 14px; font-weight: 700; background: #FFF4EC; color: #9A3412; }
.cm-nota-ok { background: #EBFBEE; color: #2B8A3E; }
.cm-mes { margin: 12px 0 0; font-size: 15px; }
.cm-mes strong { font-size: 18px; }
.cm-acoes { margin-top: 22px; display: flex; gap: 12px 16px; align-items: center; flex-wrap: wrap; }
.cm-acoes-nota { font-size: 14px; line-height: 1.4; color: rgba(255, 255, 255, .92); max-width: 360px; }
.cm-botao { display: inline-flex; align-items: center; justify-content: center; min-height: 58px; padding: 10px 28px; border: 0; border-radius: 16px; text-align: center; background: #fff;
  color: #C2410C; font-size: 18px; font-weight: 900; text-decoration: none; cursor: pointer; box-shadow: 0 12px 26px rgba(124, 45, 18, .3);
  transition: transform .15s ease, box-shadow .15s ease; }
.cm-botao:hover { transform: translateY(-2px); box-shadow: 0 16px 30px rgba(124, 45, 18, .35); }
.cm-botao:disabled { opacity: .7; cursor: default; transform: none; }
.cm-botao-leve { display: inline-flex; align-items: center; height: 48px; padding: 0 20px; border-radius: 14px; border: 1.5px solid rgba(255, 255, 255, .7);
  color: #fff; font-weight: 800; font-size: 15px; text-decoration: none; }
.cm-destaque-arte { align-self: stretch; display: grid; place-items: center; border-radius: 22px; background: rgba(255, 255, 255, .94); padding: 16px; }
.cm-destaque-arte svg { display: block; width: 100%; height: auto; max-width: 480px; }
.cm-laser { animation: cm-laser 1.8s ease-in-out infinite; }

.cm-titulo { margin: 36px 0 0; font-size: 22px; font-weight: 900; letter-spacing: -.01em; }
.cm-recursos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.cm-recurso { background: #fff; border: 1px solid #E9E3DC; border-radius: 20px; overflow: hidden; transition: transform .15s ease, box-shadow .15s ease; }
.cm-recurso:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(21, 18, 15, .08); }
.cm-recurso-arte { padding: 14px 18px 6px; background: linear-gradient(180deg, #FFF7ED, #FFF1E6); border-bottom: 1px solid #FDE6D2; }
.cm-recurso-arte svg { display: block; width: 100%; height: 132px; }
.cm-recurso-corpo { padding: 14px 18px 18px; }
.cm-recurso-corpo h3 { margin: 0; font-size: 16.5px; font-weight: 800; }
.cm-recurso-corpo p { margin: 6px 0 0; font-size: 14px; line-height: 1.5; color: #57524C; }

.cm-conta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.cm-conta > div { padding: 14px 16px; border-radius: 14px; background: #FAF8F6; border: 1px solid #F0EBE5; }
.cm-conta small { display: block; font-size: 12.5px; font-weight: 700; color: #78716C; }
.cm-conta b { display: block; margin-top: 4px; font-size: 26px; font-weight: 900; }
.cm-conta .cm-conta-total { background: #FFF4EC; border-color: #FED7AA; }
.cm-conta .cm-conta-total b { color: #EA580C; }

@keyframes cm-laser { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cm-laser { animation: none; } .cm-recurso, .cm-botao { transition: none; } }
@container (max-width: 860px) {
  .cm-destaque { grid-template-columns: 1fr; padding: 24px; }
  .cm-destaque-arte svg { max-width: 380px; }
  .cm-recursos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 560px) {
  .cm-cabeca h1 { font-size: 28px; }
  .cm-destaque { padding: 18px; border-radius: 22px; }
  .cm-preco-valor { font-size: 52px; }
  .cm-preco-unidade { font-size: 18px; }
  .cm-incluso, .cm-recursos, .cm-conta { grid-template-columns: 1fr; }
  .cm-botao { width: 100%; }
}
`;
