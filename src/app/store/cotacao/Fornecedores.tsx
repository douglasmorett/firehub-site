"use client";

/**
 * Os fornecedores — cadastro rápido e completo (Douglas, 07/11/2026: "tem que
 * conseguir cadastrar tudo desse fornecedor: nome, pedido mínimo, dias de
 * entrega"). O WhatsApp é a chave: é por ele que a loja reconhece quem
 * escreveu. "Colar lista" cadastra vários de uma vez.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { lerListaDeFornecedores } from "@/lib/cotacao/leitura";
import { COR, COR_CLARA, DIAS_DA_SEMANA, EscolherDias, Janela, S, VERMELHO, lerReais, pedir, reais, reaisNoCampo, type Aviso } from "./ui";

export type FornecedorDaTela = {
  id: string; nome: string; telefone: string | null; contato: string | null; categorias: string[]; pedidoMinimo: number | null;
  diasDeEntrega: number[]; prazoEntregaDias: number | null; horarioLimite: string | null; pagamento: string | null; observacoes: string | null; ativo: boolean;
};

const PRAZOS: Array<[string, string]> = [["", "Não sei"], ["0", "No mesmo dia"], ["1", "No dia seguinte"], ["2", "Em 2 dias"], ["3", "Em 3 dias"], ["5", "Em 5 dias"], ["7", "Em 7 dias"]];
const PAGAMENTOS = ["Pix na entrega", "Dinheiro na entrega", "Boleto 7 dias", "Boleto 14 dias", "Boleto 28 dias", "Cartão"];

/** "5522999998888" → "(22) 99999-8888". */
export function telefoneBonito(t: string | null): string {
  const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || "";
}
const diasEmTexto = (dias: number[]) => (dias.length === 7 ? "todo dia" : DIAS_DA_SEMANA.filter(([d]) => dias.includes(d)).map(([, c]) => c).join(", "));

export default function Fornecedores({ onAviso, onMudou }: { onAviso: (a: Aviso) => void; onMudou: () => void }) {
  const [lista, setLista] = useState<FornecedorDaTela[] | null>(null);
  const [editando, setEditando] = useState<FornecedorDaTela | "novo" | null>(null);
  const [colando, setColando] = useState(false);
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    try {
      setLista((await pedir<{ fornecedores: FornecedorDaTela[] }>("/api/store/cotacao/fornecedores")).fornecedores);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não carregou os fornecedores", detalhe: e.message });
    }
  }, [onAviso]);
  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista || []).filter((f) => !q || f.nome.toLowerCase().includes(q) || f.categorias.some((c) => c.toLowerCase().includes(q)));
  }, [lista, busca]);
  const categoriasUsadas = useMemo(() => [...new Set((lista || []).flatMap((f) => f.categorias))].sort(), [lista]);

  async function apagar(f: FornecedorDaTela) {
    if (!window.confirm(`Apagar ${f.nome}? Os preços dele saem do comparativo. Os pedidos já feitos ficam no histórico.`)) return;
    try {
      const j = await pedir<{ fornecedores: FornecedorDaTela[] }>(`/api/store/cotacao/fornecedores?id=${encodeURIComponent(f.id)}`, "DELETE");
      setLista(j.fornecedores);
      onAviso({ tipo: "ok", titulo: `${f.nome} apagado.` });
      onMudou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para apagar", detalhe: e.message });
    }
  }

  async function alternar(f: FornecedorDaTela) {
    try {
      const j = await pedir<{ fornecedores: FornecedorDaTela[] }>("/api/store/cotacao/fornecedores", "PUT", { ...f, ativo: !f.ativo });
      setLista(j.fornecedores);
      onAviso({ tipo: "ok", titulo: f.ativo ? `${f.nome} pausado: não recebe mais pedido de cotação.` : `${f.nome} voltou para a cotação.` });
      onMudou();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    }
  }

  if (!lista) return <div style={{ ...S.cartao, color: "#64748B" }}>Carregando…</div>;

  return (
    <>
      <section style={{ ...S.cartao, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 240px" }}>
          <h2 style={S.h2}>Fornecedores <span style={{ color: "#94A3B8", fontWeight: 700 }}>· {lista.filter((f) => f.ativo).length} ativos</span></h2>
          <p style={{ ...S.texto, fontSize: 13 }}>O WhatsApp é como a loja reconhece cada um quando ele manda a tabela de preços.</p>
        </div>
        {lista.length > 4 && <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔎 Buscar" aria-label="Buscar fornecedor" style={{ ...S.campo, width: 180, height: 40, padding: "0 12px" }} />}
        <button type="button" style={S.botaoLeve} onClick={() => setColando(true)}>📋 Colar lista</button>
        <button type="button" style={S.botao} onClick={() => setEditando("novo")}>+ Novo fornecedor</button>
      </section>

      {lista.length === 0 ? (
        <section style={{ ...S.cartao, marginTop: 12, textAlign: "center", padding: "30px 16px" }}>
          <div style={{ fontSize: 38 }}>🚚</div>
          <p style={{ ...S.texto, maxWidth: 460, margin: "6px auto 12px" }}>Cadastre os fornecedores com o WhatsApp de quem atende você. Tem a lista no celular? Copie e cole de uma vez.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" style={S.botao} onClick={() => setEditando("novo")}>+ Novo fornecedor</button>
            <button type="button" style={S.botaoLeve} onClick={() => setColando(true)}>📋 Colar lista</button>
          </div>
        </section>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12, marginTop: 12 }}>
          {filtrados.map((f) => (
            <article key={f.id} style={{ ...S.cartao, opacity: f.ativo ? 1 : 0.6, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: COR_CLARA, color: COR, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 17, flexShrink: 0 }}>
                  {f.nome.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, color: "#0F172A", fontSize: 15.5 }}>{f.nome}{!f.ativo && <span style={{ ...S.chip, background: "#F1F5F9", color: "#64748B", marginLeft: 6 }}>pausado</span>}</div>
                  <div style={{ fontSize: 13, color: f.telefone ? "#475569" : VERMELHO }}>
                    {f.telefone ? <>📱 {telefoneBonito(f.telefone)}{f.contato ? ` · ${f.contato}` : ""}</> : "Sem WhatsApp: não recebe a cotação"}
                  </div>
                </div>
              </div>
              {f.categorias.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {f.categorias.map((c) => <span key={c} style={{ ...S.chip, background: "#F1F5F9", color: "#334155", fontWeight: 700 }}>{c}</span>)}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5, color: "#475569" }}>
                <div><b style={{ color: "#0F172A" }}>Mínimo</b><br />{f.pedidoMinimo ? reais(f.pedidoMinimo) : "sem mínimo"}</div>
                <div><b style={{ color: "#0F172A" }}>Entrega</b><br />{f.diasDeEntrega.length ? diasEmTexto(f.diasDeEntrega) : "qualquer dia"}{f.prazoEntregaDias !== null ? ` · ${PRAZOS.find(([v]) => v === String(f.prazoEntregaDias))?.[1]?.toLowerCase() || `${f.prazoEntregaDias} dias`}` : ""}</div>
                {f.horarioLimite && <div><b style={{ color: "#0F172A" }}>Pedido até</b><br />{f.horarioLimite}</div>}
                {f.pagamento && <div><b style={{ color: "#0F172A" }}>Pagamento</b><br />{f.pagamento}</div>}
              </div>
              {f.observacoes && <div style={{ fontSize: 12.5, color: "#64748B", fontStyle: "italic" }}>{f.observacoes}</div>}
              <div style={{ display: "flex", gap: 6, marginTop: "auto", flexWrap: "wrap" }}>
                <button type="button" style={S.botaoPequeno} onClick={() => setEditando(f)}>✏️ Editar</button>
                <button type="button" style={S.botaoPequeno} onClick={() => alternar(f)}>{f.ativo ? "⏸ Pausar" : "▶ Reativar"}</button>
                <button type="button" style={{ ...S.botaoPequeno, color: VERMELHO }} onClick={() => apagar(f)}>Apagar</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editando && (
        <FormularioDoFornecedor inicial={editando === "novo" ? null : editando} categoriasUsadas={categoriasUsadas} onFechar={() => setEditando(null)} onAviso={onAviso}
          onSalvou={(l) => { setLista(l); setEditando(null); onMudou(); }} />
      )}
      {colando && <ColarLista onFechar={() => setColando(false)} onAviso={onAviso} onSalvou={(l) => { setLista(l); setColando(false); onMudou(); }} />}
    </>
  );
}

function FormularioDoFornecedor({ inicial, categoriasUsadas, onFechar, onAviso, onSalvou }: {
  inicial: FornecedorDaTela | null; categoriasUsadas: string[]; onFechar: () => void; onAviso: (a: Aviso) => void; onSalvou: (l: FornecedorDaTela[]) => void;
}) {
  const [f, setF] = useState({
    nome: inicial?.nome || "", telefone: inicial?.telefone ? telefoneBonito(inicial.telefone) : "", contato: inicial?.contato || "",
    categorias: (inicial?.categorias || []).join(", "), pedidoMinimo: reaisNoCampo(inicial?.pedidoMinimo), diasDeEntrega: inicial?.diasDeEntrega || [],
    prazoEntregaDias: inicial?.prazoEntregaDias !== null && inicial?.prazoEntregaDias !== undefined ? String(inicial.prazoEntregaDias) : "",
    horarioLimite: inicial?.horarioLimite || "", pagamento: inicial?.pagamento || "", observacoes: inicial?.observacoes || "", ativo: inicial?.ativo ?? true,
  });
  const [salvando, setSalvando] = useState(false);
  const muda = (campo: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [campo]: e.target.value }));
  const categorias = f.categorias.split(",").map((c) => c.trim()).filter(Boolean);

  async function salvar() {
    if (!f.nome.trim()) return onAviso({ tipo: "atencao", titulo: "Dê um nome ao fornecedor." });
    if (f.pedidoMinimo.trim() && lerReais(f.pedidoMinimo) === null) return onAviso({ tipo: "atencao", titulo: "Pedido mínimo: digite o valor, por exemplo 150,00." });
    setSalvando(true);
    const corpo = {
      nome: f.nome, telefone: f.telefone, contato: f.contato, categorias, pedidoMinimo: lerReais(f.pedidoMinimo),
      diasDeEntrega: f.diasDeEntrega, prazoEntregaDias: f.prazoEntregaDias === "" ? null : Number(f.prazoEntregaDias),
      horarioLimite: f.horarioLimite, pagamento: f.pagamento, observacoes: f.observacoes, ativo: f.ativo,
    };
    try {
      const j = inicial
        ? await pedir<{ fornecedores: FornecedorDaTela[] }>("/api/store/cotacao/fornecedores", "PUT", { id: inicial.id, ...corpo })
        : await pedir<{ fornecedores: FornecedorDaTela[] }>("/api/store/cotacao/fornecedores", "POST", { fornecedor: corpo });
      onAviso({ tipo: "ok", titulo: inicial ? "Fornecedor salvo." : `${f.nome.trim()} cadastrado!`, detalhe: f.telefone ? "Quando ele mandar preço pelo WhatsApp, a loja já sabe quem é." : "Sem WhatsApp ele não recebe a cotação: dá para pôr o número depois." });
      onSalvou(j.fornecedores);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  const linha: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 12 };
  return (
    <Janela titulo={inicial ? `Editar ${inicial.nome}` : "Novo fornecedor"} onFechar={onFechar} largura={680}
      rodape={<><button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button><button type="button" style={S.botao} onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar fornecedor"}</button></>}>
      <div style={linha}>
        <div><label style={S.rotulo}>Nome *</label><input autoFocus value={f.nome} onChange={muda("nome")} placeholder="Ex.: Hortifruti Silva" style={S.campo} /></div>
        <div><label style={S.rotulo}>WhatsApp</label><input value={f.telefone} onChange={muda("telefone")} inputMode="tel" placeholder="(22) 99999-8888" style={S.campo} /></div>
      </div>
      <div style={linha}>
        <div><label style={S.rotulo}>Quem atende</label><input value={f.contato} onChange={muda("contato")} placeholder="Ex.: João (vendedor)" style={S.campo} /></div>
        <div>
          <label style={S.rotulo}>O que ele fornece</label>
          <input value={f.categorias} onChange={muda("categorias")} placeholder="Hortifruti, Bebidas" style={S.campo} list="cot-categorias" />
          <datalist id="cot-categorias">{categoriasUsadas.map((c) => <option key={c} value={c} />)}</datalist>
          <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 3 }}>Separe por vírgula. Em branco = pede preço de tudo.</div>
        </div>
      </div>
      <div style={linha}>
        <div><label style={S.rotulo}>Pedido mínimo (R$)</label><input value={f.pedidoMinimo} onChange={muda("pedidoMinimo")} inputMode="decimal" placeholder="0,00" style={S.campo} /></div>
        <div>
          <label style={S.rotulo}>Entrega em quanto tempo</label>
          <select value={f.prazoEntregaDias} onChange={muda("prazoEntregaDias")} style={S.campo}>{PRAZOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>
        </div>
        <div><label style={S.rotulo}>Pedido até que horas</label><input type="time" value={f.horarioLimite} onChange={muda("horarioLimite")} style={S.campo} /></div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.rotulo}>Dias em que entrega</label>
        <EscolherDias dias={f.diasDeEntrega} onMudar={(d) => setF((x) => ({ ...x, diasDeEntrega: d }))} />
        <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 4 }}>Nenhum marcado = entrega qualquer dia.</div>
      </div>
      <div style={linha}>
        <div>
          <label style={S.rotulo}>Pagamento</label>
          <input value={f.pagamento} onChange={muda("pagamento")} placeholder="Ex.: Boleto 14 dias" style={S.campo} list="cot-pagamentos" />
          <datalist id="cot-pagamentos">{PAGAMENTOS.map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={f.ativo} onChange={(e) => setF((x) => ({ ...x, ativo: e.target.checked }))} style={{ width: 18, height: 18, accentColor: COR }} />
            Recebe os pedidos de cotação
          </label>
        </div>
      </div>
      <label style={S.rotulo}>Observações</label>
      <textarea value={f.observacoes} onChange={muda("observacoes")} rows={2} placeholder="Ex.: não entrega no feriado; pedir a nota no nome da loja" style={{ ...S.campo, resize: "vertical" }} />
    </Janela>
  );
}

function ColarLista({ onFechar, onAviso, onSalvou }: { onFechar: () => void; onAviso: (a: Aviso) => void; onSalvou: (l: FornecedorDaTela[]) => void }) {
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const lidos = useMemo(() => lerListaDeFornecedores(texto), [texto]);
  async function salvar() {
    if (!lidos.length) return;
    setSalvando(true);
    try {
      const j = await pedir<{ cadastrados: number; recusados: string[]; fornecedores: FornecedorDaTela[] }>("/api/store/cotacao/fornecedores", "POST", { lista: lidos });
      onAviso({ tipo: j.recusados.length ? "atencao" : "ok", titulo: `${j.cadastrados} fornecedor${j.cadastrados === 1 ? "" : "es"} cadastrado${j.cadastrados === 1 ? "" : "s"}.`, detalhe: j.recusados.length ? `Ficaram de fora:\n${j.recusados.slice(0, 5).join("\n")}` : "Complete o mínimo e os dias de entrega de cada um em Editar." });
      onSalvou(j.fornecedores);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para cadastrar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Janela titulo="Colar lista de fornecedores" subtitulo="Um por linha: nome e WhatsApp (e quem atende, se quiser)" onFechar={onFechar} largura={680}
      rodape={<><button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button><button type="button" style={S.botao} onClick={salvar} disabled={salvando || !lidos.length}>{salvando ? "Cadastrando…" : `Cadastrar ${lidos.length || ""}`}</button></>}>
      <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} rows={7} placeholder={"Hortifruti Silva - (22) 99999-8888 - João\nAtacadão Bebidas 22 98888-7777\nFrios do Zé (21) 97777-6666 Marcos"} style={{ ...S.campo, fontFamily: "ui-monospace, monospace", fontSize: 13.5, resize: "vertical" }} />
      {lidos.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>O que eu entendi ({lidos.length}):</div>
          <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
            {lidos.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "8px 12px", borderTop: i ? "1px solid #F1F5F9" : undefined, fontSize: 13.5 }}>
                <b style={{ flex: 1 }}>{l.nome}</b>
                <span style={{ color: l.telefone ? "#334155" : VERMELHO }}>{l.telefone ? telefoneBonito(l.telefone) : "sem WhatsApp"}</span>
                {l.contato && <span style={{ color: "#64748B" }}>{l.contato}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Janela>
  );
}
