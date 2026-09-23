"use client";
import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, Bike, Check, X, Phone, DollarSign, Search, Bookmark } from "lucide-react";
import {
  explicarFaixas, lerFaixasDoMotoboy, problemasDasFaixas, type FaixaDoMotoboy,
} from "@/lib/faixas-do-motoboy";
import {
  acertoSegueOModelo, aplicarModelo, explicarModelo, lerModelosDePagamento, modeloDoAcerto,
  problemasDoModelo, type ModeloDePagamento,
} from "@/lib/modelos-de-pagamento";
// Que campos cada tipo de pagamento usa — a MESMA regra do fechamento, para a
// tela nunca mostrar (nem salvar) um campo que a conta ignora, e vice-versa.
import { usaDiaria, usaPorEntrega, usaPorKm } from "@/lib/ganho-do-entregador";

type Motoboy = {
  // password só existe na ida (definir/redefinir). A API não devolve mais o
  // valor — devolve senhaPadrao, dizendo se o entregador ainda não trocou.
  id: string; name: string; phone?: string; password?: string; senhaPadrao?: boolean; active: boolean;
  paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; notes?: string;
  faixasDeKm?: FaixaDoMotoboy[];
  /** Id do modelo de onde este acerto foi copiado (lib/modelos-de-pagamento.ts). */
  modeloDePagamento?: string | null;
  todayDeliveryCount?: number; todayDeliveryFees?: number; todayDailyRate?: number; todayTotalEarnings?: number;
};

const PAYMENT_TYPES = [
  { value: "PER_DELIVERY", label: "Por Entrega (fixo por corrida)" },
  { value: "DAILY_RATE", label: "Diária Fixa" },
  { value: "BOTH", label: "Diária + Por Entrega" },
  { value: "DAILY_PLUS_FEE", label: "Diária + Taxa do Pedido" },
  { value: "PER_KM", label: "Por KM Percorrido (R$ por km rodado)" },
  // O acerto que a loja realmente faz: diária mais "até 2 km R$ 3, até 4 km
  // R$ 4". Antes só existia R$/km, e o lojista tinha de converter a tabela de
  // cabeça.
  //
  // O nome diz DIÁRIA porque é o intuito da opção, confirmado pelo dono em
  // 15/09/2026: "o Lucas paga diária + a escala cadastrada, esse foi o intuito
  // dessa funcionalidade nova". Chamada só de "Por faixa de distância", a
  // diária entrava na conta sem estar no nome. Quem paga só a escada deixa o
  // campo da diária vazio.
  // O nome diz "para cada km percorrido" e não "por faixa de distância" porque
  // é assim que o lojista descreve o acerto (decisão do dono em 16/09/2026): a
  // escada "até 1 km R$ 3,70 / até 2 km R$ 4,20" é lida como quanto o
  // entregador ganha conforme o km que ele roda, não como uma tabela de faixas.
  // Só o rótulo mudou — a conta e o cadastro das faixas são os mesmos.
  { value: "FAIXA_KM", label: "Diária + valor para cada km percorrido" },
];

const empty = (): Partial<Motoboy> => ({ name: "", phone: "", password: "", paymentType: "PER_DELIVERY", active: true, dailyRate: undefined, perDeliveryRate: undefined, perKmRate: undefined, faixasDeKm: [], modeloDePagamento: null, notes: "" });

export default function MotoboyManager({ initialMotoboys }: { initialMotoboys: Motoboy[] }) {
  const [motoboys, setMotoboys] = useState<Motoboy[]>(initialMotoboys);
  const [editing, setEditing] = useState<Partial<Motoboy> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // ── OS ACERTOS SALVOS ──────────────────────────────────────────────────
  //
  // A escada de km é a mesma para quase todo mundo: "até 1 km R$ 5, até 2 km
  // R$ 6, até 3 km R$ 7". Como ela morava só dentro de cada entregador,
  // cadastrar o segundo era redigitar a escada inteira — e um dígito diferente
  // numa linha qualquer vira diferença no acerto do fim do dia, que ninguém
  // encontra depois. Aqui o acerto ganha nome e é escolhido de novo.
  const [modelos, setModelos] = useState<ModeloDePagamento[]>([]);
  const [salvandoModelo, setSalvandoModelo] = useState(false);
  /** O campo de nome aparece só quando a pessoa decide salvar. */
  const [dandoNome, setDandoNome] = useState(false);
  const [nomeDoAcerto, setNomeDoAcerto] = useState("");
  useEffect(() => {
    fetch("/api/store/modelos-pagamento")
      .then((r) => (r.ok ? r.json() : { modelos: [] }))
      .then((d) => setModelos(lerModelosDePagamento(d?.modelos)))
      .catch(() => {});
  }, []);

  /**
   * Escolheu um modelo: os valores dele são COPIADOS para o formulário.
   *
   * Copiados, e não apontados — mexer no modelo depois não pode mudar, calado,
   * quanto dez pessoas recebem, nem valer para entregas que já aconteceram.
   */
  const usarModelo = (id: string) => {
    const m = modelos.find((x) => x.id === id);
    if (!m) { setEditing((p) => ({ ...p, modeloDePagamento: null })); return; }
    const campos = aplicarModelo(m);
    setEditing((p) => ({
      ...p,
      paymentType: campos.paymentType,
      dailyRate: campos.dailyRate ?? undefined,
      perDeliveryRate: campos.perDeliveryRate ?? undefined,
      perKmRate: campos.perKmRate ?? undefined,
      faixasDeKm: campos.faixasDeKm,
      modeloDePagamento: campos.modeloDePagamento,
    }));
    setMsg(`✅ Acerto de "${m.nome}" aplicado aqui.`);
  };

  /**
   * Salva o acerto do formulário como um modelo com nome.
   *
   * O nome vem de um campo NA TELA. Antes vinha de um `prompt()` do
   * navegador — uma janelinha cinza, sem explicação, que alguns navegadores
   * de celular simplesmente não mostram. Quem não viu a janela achou que o
   * botão não funcionava.
   */
  const salvarComoModelo = async () => {
    const nome = nomeDoAcerto.trim();
    if (!nome) { setMsg("❌ Dê um nome ao acerto antes de salvar."); return; }
    const novo = modeloDoAcerto(nome, {
      paymentType: editing?.paymentType,
      dailyRate: editing?.dailyRate,
      perDeliveryRate: editing?.perDeliveryRate,
      perKmRate: editing?.perKmRate,
      faixasDeKm: editing?.faixasDeKm,
    });
    const problemas = problemasDoModelo(novo, modelos);
    if (problemas.length) { setMsg("❌ " + problemas.join(" ")); return; }
    setSalvandoModelo(true);
    try {
      const lista = [...modelos, novo];
      const res = await fetch("/api/store/modelos-pagamento", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelos: lista }),
      });
      if (!res.ok) throw new Error();
      setModelos(lista);
      setEditing((p) => ({ ...p, modeloDePagamento: novo.id }));
      setNomeDoAcerto("");
      setDandoNome(false);
      setMsg(`✅ Salvo como "${nome}". No próximo entregador é só escolher pelo nome.`);
    } catch { setMsg("❌ Não deu para salvar o acerto."); } finally { setSalvandoModelo(false); }
  };

  /** Apaga um modelo. Quem já usa continua igual: os valores foram copiados. */
  const apagarModelo = async (id: string) => {
    const m = modelos.find((x) => x.id === id);
    if (!m) return;
    if (!confirm(`Apagar o modelo "${m.nome}"?\n\nQuem já usa continua recebendo igual — os valores ficaram gravados dentro de cada entregador.`)) return;
    const lista = modelos.filter((x) => x.id !== id);
    const res = await fetch("/api/store/modelos-pagamento", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelos: lista }),
    });
    if (res.ok) setModelos(lista);
  };

  const filteredMotoboys = motoboys.filter(mb => 
    mb.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (mb.phone && mb.phone.includes(searchTerm))
  );

  const openNew = () => { setEditing(empty()); setEditingId(null); };
  // A senha não vem mais do servidor, e o campo do formulário fica vazio: em
  // branco quer dizer "não mexer na senha". Antes o input era preenchido com a
  // senha em texto puro do entregador, à vista de quem estivesse perto da tela.
  const openEdit = (mb: Motoboy) => { setEditing({ ...mb, password: "" }); setEditingId(mb.id); };
  const cancel = () => { setEditing(null); setEditingId(null); };

  const save = async () => {
    if (!editing?.name?.trim()) { setMsg("❌ Nome obrigatório"); return; }
    setSaving(true); setMsg("");
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `/api/motoboys/${editingId}` : "/api/motoboys";
      // Salvar LIMPA o que o tipo escolhido não usa. Sem isto o valor do tipo
      // anterior fica no registro sem aparecer em lugar nenhum do formulário —
      // e o fechamento pagava por ele (Frangoso, 15/09/2026: R$ 2,00/entrega e
      // R$ 60,00 de diária num entregador pago por faixa de km).
      const corpo = {
        ...editing,
        dailyRate: usaDiaria(editing.paymentType) ? editing.dailyRate : null,
        perDeliveryRate: usaPorEntrega(editing.paymentType) ? editing.perDeliveryRate : null,
        perKmRate: usaPorKm(editing.paymentType) ? editing.perKmRate : null,
      };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) throw new Error();
      const saved: Motoboy = await res.json();
      if (editingId) setMotoboys(prev => prev.map(m => m.id === editingId ? saved : m));
      else setMotoboys(prev => [...prev, saved]);
      setMsg("✅ Salvo!");
      cancel();
    } catch { setMsg("❌ Erro ao salvar."); } finally { setSaving(false); }
  };

  const toggle = async (mb: Motoboy) => {
    const res = await fetch(`/api/motoboys/${mb.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !mb.active }) });
    if (res.ok) { const saved = await res.json(); setMotoboys(prev => prev.map(m => m.id === mb.id ? saved : m)); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover motoboy?")) return;
    const res = await fetch(`/api/motoboys/${id}`, { method: "DELETE" });
    if (res.ok) setMotoboys(prev => prev.filter(m => m.id !== id));
  };

  const payLabel = (pt: string) => PAYMENT_TYPES.find(p => p.value === pt)?.label || pt;

  const renderForm = () => {
    if (!editing) return null;
    return (
      <div style={{ background: "#fff", border: "1.5px solid #C92E09", borderRadius: 16, padding: 20, marginBottom: 12, boxShadow: "0 4px 12px rgba(198, 40, 40, 0.08)" }}>
        <h3 style={{ fontWeight: 800, marginBottom: 16, color: "#C92E09", display: "flex", alignItems: "center", gap: 8 }}>
          {editingId ? "✏️ Editar Motoboy" : "➕ Novo Motoboy"}
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Nome *</label>
            <input className="input-field" value={editing.name || ""} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="Nome completo" />
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Telefone</label>
            <input className="input-field" value={editing.phone || ""} onChange={e => setEditing(p => ({ ...p, phone: e.target.value }))} placeholder="(22) 99999-9999" />
          </div>
        </div>
        {/* ── ACERTOS SALVOS ────────────────────────────────────────────

            Uma LISTA de botões, não um <select>: o lojista precisa ver a
            tabela inteira ("até 1 km R$ 5 · até 2 km R$ 6") ao lado do nome
            para saber qual escolher. Num select isso fica escondido até
            abrir, e some de novo assim que ele escolhe.

            Fica ANTES do tipo de pagamento porque é o caminho curto: quem
            já tem a tabela pronta escolhe o nome e não olha mais para
            baixo. Quem está montando a primeira ignora e segue. */}
        <div style={{ marginBottom: 14, padding: "12px 14px", background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
            <Bookmark size={15} style={{ color: "#334155" }} />
            <b style={{ fontSize: "0.9rem", color: "#334155" }}>Acertos salvos</b>
          </div>
          <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "#475569", lineHeight: 1.5 }}>
            {modelos.length > 0
              ? "Toque no acerto que este entregador vai receber. Os valores entram preenchidos abaixo."
              : "Você ainda não salvou nenhum. Monte o pagamento abaixo e toque em “Salvar este acerto” — aí ele aparece aqui, com nome, para os próximos entregadores."}
          </p>

          {modelos.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {modelos.map((m) => {
                const escolhido = editing.modeloDePagamento === m.id;
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => usarModelo(m.id)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: "left", cursor: "pointer",
                        padding: "10px 12px", borderRadius: 10, fontFamily: "inherit",
                        border: escolhido ? "2px solid #475569" : "1.5px solid #E2E8F0",
                        background: escolhido ? "#F1F5F9" : "#fff",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: 800, color: "#0F172A" }}>{m.nome}</span>
                        {escolhido && <span style={{ fontSize: "0.68rem", fontWeight: 900, color: "#fff", background: "#475569", borderRadius: 999, padding: "2px 7px" }}>EM USO</span>}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#334155", marginTop: 2, lineHeight: 1.4 }}>{explicarModelo(m)}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => apagarModelo(m.id)}
                      title={`Apagar o acerto "${m.nome}" da lista`}
                      style={{ width: 40, borderRadius: 10, border: "1px solid #FCA5A5", background: "#fff", color: "#C92E09", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}

              {/* Sair de um acerto salvo tem que ser tão fácil quanto entrar:
                  sem isto, escolher errado obriga a recarregar a tela. */}
              {editing.modeloDePagamento && (
                <button
                  type="button"
                  onClick={() => usarModelo("")}
                  style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#334155", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: "2px 0", fontFamily: "inherit" }}
                >
                  Não usar acerto salvo (montar na mão)
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Tipo de Pagamento</label>
          <select className="input-field" value={editing.paymentType || "PER_DELIVERY"} onChange={e => {
            const tipo = e.target.value;
            // Escolheu faixa e não tem nenhuma: a tela já abre com três linhas
            // EM BRANCO. Quadro vazio com um botão 'adicionar' não ensina o
            // formato; três linhas prontas para digitar, sim.
            setEditing(p => ({
              ...p,
              paymentType: tipo,
              faixasDeKm: tipo === "FAIXA_KM" && !(p?.faixasDeKm?.length)
                ? [{ ate: 0, valor: 0 }, { ate: 0, valor: 0 }, { ate: 0, valor: 0 }]
                : p?.faixasDeKm,
            }));
          }}>
            {PAYMENT_TYPES.map(pt => <option key={pt.value} value={pt.value}>{pt.label}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
          {usaDiaria(editing.paymentType) && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                Diária (R$)
                {editing.paymentType === "FAIXA_KM" && (
                  <span style={{ fontWeight: 500, color: "#64748B" }}> — deixe vazio se paga só a faixa</span>
                )}
              </label>
              <input className="input-field" type="number" step="0.5" min="0" value={editing.dailyRate ?? ""} onChange={e => setEditing(p => ({ ...p, dailyRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 60" />
            </div>
          )}
          {usaPorEntrega(editing.paymentType) && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Por entrega (R$)</label>
              <input className="input-field" type="number" step="0.5" min="0" value={editing.perDeliveryRate ?? ""} onChange={e => setEditing(p => ({ ...p, perDeliveryRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 5" />
            </div>
          )}
          {usaPorKm(editing.paymentType) && (
            <div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Por KM (R$)</label>
              <input className="input-field" type="number" step="0.1" min="0" value={editing.perKmRate ?? ""} onChange={e => setEditing(p => ({ ...p, perKmRate: e.target.value ? Number(e.target.value) : undefined }))} placeholder="Ex: 1.50" />
            </div>
          )}
        </div>
        {/* ── FAIXAS DE DISTÂNCIA ──────────────────────────────────────
            Uma linha por faixa: 'até X km' → 'R$ Y por entrega'. É o acerto
            que a loja faz de verdade; R$/km obrigava a converter de cabeça e
            dava um número diferente a cada corrida. */}
        {(editing.paymentType === "FAIXA_KM" || (editing.faixasDeKm?.length || 0) > 0) && (() => {
          const faixas = editing.faixasDeKm || [];
          const mudarFaixa = (i: number, campo: "ate" | "valor", v: number) =>
            setEditing(p => ({ ...p, faixasDeKm: (p?.faixasDeKm || []).map((f, k) => k === i ? { ...f, [campo]: v } : f) }));
          const remover = (i: number) =>
            setEditing(p => ({ ...p, faixasDeKm: (p?.faixasDeKm || []).filter((_, k) => k !== i) }));
          const adicionar = () => setEditing(p => {
            const atuais = p?.faixasDeKm || [];
            const ultima = atuais.length ? atuais[atuais.length - 1] : null;
            return { ...p, faixasDeKm: [...atuais, { ate: 0, valor: 0 }] };
          });
          const problemas = problemasDasFaixas(faixas);
          return (
            <div style={{ margin: "0 0 12px", padding: "12px 14px", background: "#FFFBF5", borderRadius: 12, border: "1.5px solid #FFD3C2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <b style={{ fontSize: "0.88rem", color: "#9A3412" }}>🛵 Quanto pagar por faixa de distância</b>
              </div>
              <p style={{ margin: "0 0 10px", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.5 }}>
                Uma linha por faixa. O pedido cai na <b>primeira faixa que alcança</b> a distância da entrega;
                acima da última, vale a última.
              </p>


              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {faixas.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#0F172A", whiteSpace: "nowrap" }}>até</span>
                    <input type="number" min="0.5" step="0.5" placeholder="2" value={f.ate || ""}
                      onChange={e => mudarFaixa(i, "ate", parseFloat(e.target.value) || 0)}
                      style={{ width: 72, padding: "7px 8px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.88rem", fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit" }} />
                    <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#64748B", whiteSpace: "nowrap" }}>km  →  o entregador recebe R$</span>
                    <input type="number" min="0" step="0.5" placeholder="5,00" value={f.valor || ""}
                      onChange={e => mudarFaixa(i, "valor", parseFloat(e.target.value) || 0)}
                      style={{ width: 86, padding: "7px 8px", borderRadius: 8, border: "1.5px solid #FFD3C2", background: "#fff", color: "#9A3412", fontSize: "0.88rem", fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit" }} />
                    <button type="button" onClick={() => remover(i)} title="Remover esta faixa"
                      style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #FCA5A5", background: "#fff", color: "#C92E09", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "auto" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={adicionar}
                style={{ width: "100%", marginTop: 9, padding: "9px", borderRadius: 10, border: "1.5px dashed #FFD3C2", background: "#fff", color: "#9A3412", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Plus size={14} /> Adicionar faixa de km
              </button>

              {faixas.some(f => Number(f.ate) > 0) && problemas.length === 0 && (
                <p style={{ margin: "9px 0 0", fontSize: "0.74rem", color: "#0F766E", background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 8, padding: "7px 10px", lineHeight: 1.45 }}>
                  {explicarFaixas(lerFaixasDoMotoboy(faixas))}
                </p>
              )}
              {problemas.map((x, i) => (
                <p key={i} style={{ margin: "7px 0 0", fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700 }}>{x}</p>
              ))}
            </div>
          );
        })()}

        {editing.paymentType === "DAILY_PLUS_FEE" && (
          <div style={{ margin: "0 0 12px", padding: "10px 14px", background: "#FAF6F2", borderRadius: 10, border: "1.5px solid #E7DDD3", fontSize: "0.82rem", color: "#1C1917" }}>
            💡 <strong>Diária + Taxa:</strong> O motoboy recebe a diária fixa + o valor da taxa de entrega de cada pedido (iFood ou site). As taxas são somadas automaticamente.
          </div>
        )}

        {/* ── SALVAR ESTE ACERTO ────────────────────────────────────────
            Fica no FIM do bloco de pagamento, que é onde a pessoa acabou de
            digitar a escada inteira — é ali que ela descobre que não vai
            precisar digitar de novo. O botão some quando o acerto já veio de
            um modelo e ninguém mexeu nele: não há o que salvar duas vezes. */}
        {(() => {
          const acerto = {
            paymentType: editing.paymentType,
            dailyRate: editing.dailyRate,
            perDeliveryRate: editing.perDeliveryRate,
            perKmRate: editing.perKmRate,
            faixasDeKm: editing.faixasDeKm,
          };
          const daLista = modelos.find((m) => m.id === editing.modeloDePagamento);
          const igualAoModelo = daLista ? acertoSegueOModelo(acerto, daLista) : false;
          // Botão apagado tem que DIZER o que falta. Antes ele só ficava
          // cinza quando o acerto estava pela metade, e o lojista não tinha
          // como saber que o problema era a faixa em branco lá em cima.
          const faltaParaSalvar = problemasDoModelo(modeloDoAcerto("x", acerto)).filter((s) => !/nome/i.test(s))[0] || null;
          if (igualAoModelo) {
            return (
              <p style={{ margin: "0 0 12px", fontSize: "0.76rem", color: "#334155", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 9, padding: "8px 11px" }}>
                🔖 Este entregador está no acerto <b>{daLista!.nome}</b>.
              </p>
            );
          }
          return (
            <div style={{ margin: "0 0 12px" }}>
              {daLista && (
                <p style={{ margin: "0 0 7px", fontSize: "0.76rem", color: "#B45309", fontWeight: 700 }}>
                  ✏️ Você mudou os valores de <b>{daLista.nome}</b> — a mudança vale só para este
                  entregador. Para valer para todos, salve como um acerto novo.
                </p>
              )}
              {/* O nome é digitado AQUI. Antes vinha de um prompt() do
                  navegador: janelinha cinza, sem explicação, que alguns
                  navegadores de celular nem mostram — e quem não viu a janela
                  concluiu que o botão não fazia nada. */}
              {!dandoNome ? (
                <>
                <button
                  type="button"
                  onClick={() => setDandoNome(true)}
                  disabled={faltaParaSalvar !== null}
                  title={faltaParaSalvar || "Guarda este pagamento com um nome, para escolher nos próximos entregadores"}
                  style={{
                    width: "100%", padding: "11px", borderRadius: 10, fontFamily: "inherit",
                    border: "1.5px dashed #CBD5E1", background: "#fff",
                    color: faltaParaSalvar ? "#A1A1AA" : "#334155", fontWeight: 800, fontSize: "0.84rem",
                    cursor: faltaParaSalvar ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}
                >
                  <Bookmark size={15} /> Salvar este acerto para usar em outros
                </button>
                  {/* Tooltip não existe no celular: o motivo tem que estar
                      escrito embaixo do botão, não pendurado no title. */}
                  {faltaParaSalvar && (
                    <p style={{ margin: "6px 0 0", fontSize: "0.75rem", color: "#B45309", fontWeight: 700, textAlign: "center" }}>
                      Para salvar, primeiro termine o pagamento acima: {faltaParaSalvar.toLowerCase()}
                    </p>
                  )}
                </>
              ) : (
                <div style={{ padding: "12px 13px", borderRadius: 11, border: "1.5px solid #CBD5E1", background: "#F8FAFC" }}>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#0F172A", marginBottom: 3 }}>
                    Que nome dar a este acerto?
                  </label>
                  <p style={{ margin: "0 0 8px", fontSize: "0.74rem", color: "#334155", lineHeight: 1.45 }}>
                    É por ele que você vai escolher nos próximos entregadores.
                  </p>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    <input
                      autoFocus
                      value={nomeDoAcerto}
                      onChange={(e) => setNomeDoAcerto(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); salvarComoModelo(); } }}
                      placeholder="Ex.: Tabela padrão"
                      maxLength={40}
                      style={{ flex: "1 1 160px", minWidth: 0, padding: "10px 11px", borderRadius: 9, border: "1.5px solid #CBD5E1", fontSize: "0.88rem", fontWeight: 700, outline: "none", fontFamily: "inherit" }}
                    />
                    <button
                      type="button"
                      onClick={salvarComoModelo}
                      disabled={salvandoModelo || !nomeDoAcerto.trim()}
                      style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: nomeDoAcerto.trim() ? "#475569" : "#CBD5E1", color: "#fff", fontWeight: 800, fontSize: "0.84rem", cursor: nomeDoAcerto.trim() ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                    >
                      {salvandoModelo ? "Salvando…" : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDandoNome(false); setNomeDoAcerto(""); }}
                      style={{ padding: "10px 14px", borderRadius: 9, border: "1.5px solid #E2E8F0", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Cancelar
                    </button>
                  </div>
                  {/* Sugestões: o lojista não precisa inventar um nome do zero. */}
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                    {["Tabela padrão", "Turno da noite", "Fim de semana", "Moto própria"].map((s) => (
                      <button
                        key={s} type="button" onClick={() => setNomeDoAcerto(s)}
                        style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid #E2E8F0", background: nomeDoAcerto === s ? "#475569" : "#fff", color: nomeDoAcerto === s ? "#fff" : "#334155", fontSize: "0.71rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
            🔑 {editingId ? "Redefinir senha do App Entregador" : "Senha de Acesso ao App Entregador"}
          </label>
          <input
            className="input-field"
            type="password"
            value={editing.password ?? ""}
            onChange={e => setEditing(p => ({ ...p, password: e.target.value }))}
            placeholder={editingId ? "Deixe em branco para manter a senha atual" : "Mínimo 6 caracteres (padrão: 123456)"}
          />
          <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 4 }}>
            A senha fica guardada criptografada e não pode mais ser consultada — nem por você. Se o
            entregador esquecer, defina uma nova aqui.
          </div>
          {editingId && editing.senhaPadrao && (
            <div style={{ fontSize: "0.75rem", color: "#B45309", marginTop: 6, fontWeight: 600 }}>
              ⚠️ Este entregador ainda usa a senha padrão 123456. Qualquer pessoa que saiba o nome dele
              entra no app de entregas — defina uma senha própria.
            </div>
          )}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Observações</label>
          <input className="input-field" value={editing.notes || ""} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional..." />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ flex: 1 }}>
            <Check size={15} style={{ marginRight: 6 }} />{saving ? "Salvando..." : "Salvar"}
          </button>
          <button onClick={cancel} className="btn btn-outline" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <X size={15} /> Cancelar
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 700 }}>
      {msg && <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: 12, background: msg.startsWith("✅") ? "#F0FDFA" : "#fef2f2", color: msg.startsWith("✅") ? "#0F766E" : "#C92E09", border: `1px solid ${msg.startsWith("✅") ? "#99F6E4" : "#fecaca"}`, fontSize: "0.85rem" }}>{msg}</div>}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>🏍️ Motoboys Cadastrados ({motoboys.length})</h3>
        {!editing && <button onClick={openNew} className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}><Plus size={15} style={{ marginRight: 6 }} />Novo Motoboy</button>}
      </div>

      {/* Busca */}
      {motoboys.length > 0 && !editing && (
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Search size={18} color="#94A3B8" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
          <input 
            type="text" 
            placeholder="Buscar por nome ou telefone..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "100%", padding: "12px 14px 12px 40px", borderRadius: 12, border: "1px solid #E2E8F0", background: "#F8FAFC", fontSize: "0.95rem", outline: "none", transition: "border 0.2s" }}
            onFocus={(e) => e.target.style.border = "1px solid #1C1917"}
            onBlur={(e) => e.target.style.border = "1px solid #E2E8F0"}
          />
        </div>
      )}

      {/* New Motoboy Form at top if editingId is null */}
      {editing && editingId === null && renderForm()}

      {motoboys.length === 0 && !editing && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem", background: "#F8FAFC", borderRadius: 16, border: "1.5px dashed #E2E8F0" }}>
          <Bike size={40} color="#CBD5E1" style={{ margin: "0 auto 12px" }} />
          <p style={{ color: "#94A3B8", fontWeight: 600 }}>Nenhum motoboy cadastrado ainda.</p>
          <button onClick={openNew} className="btn btn-primary" style={{ marginTop: 12 }}>+ Cadastrar Primeiro Motoboy</button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filteredMotoboys.length === 0 && motoboys.length > 0 && (
          <div style={{ textAlign: "center", padding: "2rem", color: "#64748B", fontSize: "0.9rem" }}>
            Nenhum motoboy encontrado para "{searchTerm}".
          </div>
        )}
        {filteredMotoboys.map(mb => {
          if (editingId === mb.id) {
            return <div key={mb.id}>{renderForm()}</div>;
          }

          return (
            <div key={mb.id} style={{ background: "#fff", border: `1.5px solid ${mb.active ? "#E2E8F0" : "#FEE2E2"}`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, opacity: mb.active ? 1 : 0.7 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: mb.active ? "#FEF3E2" : "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bike size={20} color={mb.active ? "#C92E09" : "#C92E09"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#1E293B" }}>{mb.name}
                  {!mb.active && <span style={{ marginLeft: 8, fontSize: "0.7rem", background: "#FEE2E2", color: "#C92E09", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>Inativo</span>}
                </div>
                <div style={{ fontSize: "0.78rem", color: "#64748B", display: "flex", gap: 12, marginTop: 2, flexWrap: "wrap" }}>
                  {mb.phone && <span><Phone size={11} style={{ marginRight: 3 }} />{mb.phone}</span>}
                  <span><DollarSign size={11} style={{ marginRight: 3 }} />{payLabel(mb.paymentType)}</span>
                  {/* Só o que o tipo escolhido usa. O valor digitado num tipo
                      anterior continua gravado, e o cartão mostrava tudo junto:
                      o Lucas lia "Diária R$60 · R$2,00/entrega · R$1,00/km" num
                      entregador pago por faixa, sem ter onde apagar — os campos
                      nem aparecem no formulário nesse tipo. */}
                  {usaDiaria(mb.paymentType) && mb.dailyRate ? <span>Diária: R${mb.dailyRate.toFixed(2)}</span> : null}
                  {usaPorEntrega(mb.paymentType) && mb.perDeliveryRate ? <span>R${mb.perDeliveryRate.toFixed(2)}/entrega</span> : null}
                  {usaPorKm(mb.paymentType) && mb.perKmRate ? <span>R${mb.perKmRate.toFixed(2)}/km</span> : null}
                  {mb.paymentType === "FAIXA_KM" && (mb.faixasDeKm?.length || 0) > 0 ? <span>{mb.faixasDeKm!.length} faixas de km</span> : null}
                  {mb.paymentType === "DAILY_PLUS_FEE" && <span style={{ color: "#1C1917" }}>💰 Recebe taxa do pedido</span>}
                </div>
                {/* Resumo do dia */}
                {mb.active && (mb.todayDeliveryCount ?? 0) >= 0 && (
                  <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ background: "#F0FDFA", color: "#0F766E", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>📦 Hoje: {mb.todayDeliveryCount ?? 0} entregas</span>
                    {(mb.todayDailyRate ?? 0) > 0 && <span style={{ background: "#FAF6F2", color: "#1C1917", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>📅 Diária: R${(mb.todayDailyRate ?? 0).toFixed(2)}</span>}
                    {(mb.todayDeliveryFees ?? 0) > 0 && <span style={{ background: "#FFF4EF", color: "#B45309", padding: "2px 8px", borderRadius: 6, fontWeight: 600 }}>🛵 Taxas: R${(mb.todayDeliveryFees ?? 0).toFixed(2)}</span>}
                    <span style={{ background: "#F0FDFA", color: "#0F766E", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>💰 Total: R${(mb.todayTotalEarnings ?? 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => toggle(mb)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, color: mb.active ? "#C92E09" : "#0F766E" }}>{mb.active ? "Pausar" : "Ativar"}</button>
                <button onClick={() => openEdit(mb)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Edit2 size={14} color="#1C1917" /></button>
                <button onClick={() => remove(mb.id)} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #FCA5A5", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={14} color="#C92E09" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
