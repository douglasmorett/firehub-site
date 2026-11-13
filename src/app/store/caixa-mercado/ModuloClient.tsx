"use client";

/**
 * O módulo Caixa de mercado no painel: o que é, quanto custa (R$ 97 por
 * computador em uso no mês, à parte da mensalidade), o termo, os computadores
 * de caixa, o TEF de cada um (o motor do totem, com simulador) e a
 * configuração (etiqueta da balança, margem dos produtos novos, NFC-e).
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Barcode, Calculator, CreditCard, FileSpreadsheet, Monitor, QrCode, Scale, Trash2 } from "lucide-react";
import { CLAUSULAS_DO_TERMO_DO_CAIXA, TITULO_DO_TERMO_DO_CAIXA, VERSAO_DO_TERMO_DO_CAIXA } from "@/lib/caixa-mercado/termo";
import { PRECO_POR_COMPUTADOR, DIAS_DE_TESTE_DO_CAIXA } from "@/lib/caixa-mercado/preco";
import { montarEtiqueta, type FormatoDaEtiqueta } from "@/lib/caixa-mercado/etiqueta";
import { fetchAssistente } from "@/lib/fetch-assistente";
import { PORTAS_DO_ASSISTENTE } from "@/lib/tef-no-assistente";

type Terminal = { id: string; numero: number; nome: string; ultimoSinal: string | null };
type Config = { etiqueta: FormatoDaEtiqueta; margemPadrao: number; emitirNfce: boolean };
type Estado = {
  ativo: boolean; emTeste: boolean; testeAte: string | null; jaTestou: boolean; isento: boolean; preco: number;
  desligaEm: string | null; computadoresCobradosEsteMes: number; valorEsteMes: number; config: Config;
};

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
    { icone: <Barcode size={20} />, titulo: "Leitor de código de barras", texto: "Bipe e o item entra. Quantidade com 3* antes do código, busca por nome no F2." },
    { icone: <Scale size={20} />, titulo: "Balança e etiqueta", texto: "Produto por quilo lê a balança no cabo. Etiqueta da balança do açougue (código 2…) entra com o preço impresso." },
    { icone: <QrCode size={20} />, titulo: "Pix na tela, sem taxa", texto: "QR Code com o valor na chave Pix da loja. O operador confirma o recebido." },
    { icone: <CreditCard size={20} />, titulo: "TEF no cabo USB", texto: "O valor vai direto ao pinpad: o cliente aproxima ou digita a senha, sem digitar valor na maquininha." },
    { icone: <Calculator size={20} />, titulo: "Caixa por operador", texto: "Abertura com troco, sangria, suprimento e fechamento conferido por forma." },
    { icone: <FileSpreadsheet size={20} />, titulo: "Cadastro e fiscal em lote", texto: "Planilha do sistema antigo, XML das notas de compra e a planilha por NCM para o contador." },
  ];

  return (
    <div style={S.pagina}>
      {aviso && <div style={aviso.ok ? S.avisoOk : S.avisoErro} onClick={() => setAviso(null)}>{aviso.texto}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Caixa de mercado</h1>
        {estado.ativo && <span style={S.selo}>{estado.isento ? "Liberado" : estado.emTeste ? `Teste grátis até ${data(estado.testeAte)}` : "Ativo"}</span>}
      </div>
      <p style={S.sub}>Frente de caixa para mercado dentro do FireHub: cada venda dá baixa no estoque e cai no financeiro, nos relatórios e na NFC-e.</p>

      <div style={S.recursos}>
        {recursos.map((r) => (
          <div key={r.titulo} style={S.recurso}>
            <span style={S.icone}>{r.icone}</span>
            <div><strong>{r.titulo}</strong><p style={{ ...S.sub, fontSize: 14, marginTop: 4 }}>{r.texto}</p></div>
          </div>
        ))}
      </div>

      {!estado.ativo && (
        <div style={S.oferta}>
          <div style={{ flex: "1 1 320px" }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{reais(PRECO_POR_COMPUTADOR)} por computador de caixa, por mês</h2>
            <p style={S.sub}>Conta só o computador que vendeu ou abriu turno no mês. À parte da mensalidade do FireHub, que continua sendo 2% do faturamento (mínimo e teto de sempre). {estado.jaTestou ? "" : `A primeira ativação tem ${DIAS_DE_TESTE_DO_CAIXA} dias grátis.`}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
            {podeContratar
              ? <button style={S.cta} onClick={() => { setAceito(false); setTermoAberto(true); }}>{estado.jaTestou ? "Ativar" : `Ativar com ${DIAS_DE_TESTE_DO_CAIXA} dias grátis`}</button>
              : <span style={S.sub}>Só o dono da loja ativa.</span>}
          </div>
        </div>
      )}

      {estado.ativo && (
        <>
          <div style={S.cartao}>
            <h2 style={S.h2}><Monitor size={20} /> Este computador</h2>
            {daqui?.terminal ? (
              <>
                <p style={S.sub}>Este computador é o <strong>{daqui.terminal.nome}</strong>.</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                  <Link href="/store/caixa-mercado/caixa" style={{ ...S.cta, textDecoration: "none" }}>Abrir o caixa</Link>
                  <Link href="/store/caixa-mercado/importar" style={{ ...S.botaoLeve, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Importar produtos</Link>
                </div>
                {podeContratar && (
                  <div style={{ ...S.linha, marginTop: 14 }}>
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
              </>
            ) : (
              <>
                <p style={S.sub}>Este computador ainda não é um caixa. Registre no computador que fica no caixa (o leitor e a balança ficam nele). Cada computador registrado que for usado no mês conta {reais(estado.preco)}.</p>
                {podeContratar
                  ? <button style={{ ...S.cta, marginTop: 12 }} disabled={ocupado === "registrar"} onClick={registrar}>Registrar este computador como caixa</button>
                  : <p style={S.sub}>Peça ao dono da loja para registrar este computador.</p>}
              </>
            )}
          </div>

          <div style={S.cartao}>
            <h2 style={S.h2}>Computadores de caixa</h2>
            {terminais.length === 0 && <p style={S.sub}>Nenhum computador registrado ainda.</p>}
            {terminais.map((t) => (
              <div key={t.id} style={{ ...S.linha, marginTop: 8 }}>
                <Monitor size={18} />
                <span style={{ flex: 1 }}><strong>{t.nome}</strong> · último uso {t.ultimoSinal ? new Date(t.ultimoSinal).toLocaleString("pt-BR") : "nunca"}</span>
                {podeContratar && <button style={S.botaoIcone} title="Desativar" disabled={ocupado === t.id} onClick={() => desativar(t)}><Trash2 size={16} /></button>}
              </div>
            ))}
            {!estado.isento && (
              <p style={{ ...S.sub, marginTop: 12 }}>
                Este mês: {estado.computadoresCobradosEsteMes} computador(es) em uso fora do teste = <strong>{reais(estado.valorEsteMes)}</strong> no boleto.
              </p>
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
  cartao: { marginTop: 16, padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #E9E3DC" },
  linha: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: 12, borderRadius: 14, border: "1px solid #F1F5F9", background: "#FCFCFD" },
  icone: { width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "#FFF4EC", color: "#E8590C", flexShrink: 0 },
  oferta: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "stretch", marginTop: 18, padding: 22, borderRadius: 22, background: "linear-gradient(135deg,#FFF7ED,#FFFFFF)", border: "1px solid #FED7AA" },
  recursos: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 16 },
  recurso: { display: "flex", gap: 12, padding: 16, borderRadius: 16, background: "#fff", border: "1px solid #E9E3DC" },
  termoFundo: { position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,12,9,.55)", display: "grid", placeItems: "center", padding: 16 },
  termo: { background: "#fff", borderRadius: 20, width: "min(640px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,.35)" },
};
