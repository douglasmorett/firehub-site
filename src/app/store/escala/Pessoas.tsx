"use client";

/**
 * Aba Pessoas: a lista de quem pode entrar na escala, num lugar só —
 *   - Equipe: os logins de funcionário da loja (Minha loja › Equipe);
 *   - Motoboys: os ativos da tela Motoboys;
 *   - Freelancers: os do próprio módulo (cadastrados aqui ou que vieram pelo link).
 * Equipe e motoboy: nome e cadastro moram na tela de origem; aqui só o que a
 * escala precisa (telefone para o link reconhecer, função, diária).
 */

import { useMemo, useState } from "react";
import { FUNCOES, chaveDaFuncao } from "@/lib/escala-da-equipe/regras";
import { COR, COR_CLARA, Janela, S, SeloDoLink, SeloDoTipo, pedir, reais, reaisNoCampo, type Aviso, type Pessoa, type TipoDePessoa } from "./ui";

type Filtro = "todos" | TipoDePessoa | "inativos";

export default function Pessoas({ pessoas, ehDono, onMudou, avisar }: { pessoas: Pessoa[]; ehDono: boolean; onMudou: () => void; avisar: (a: Aviso) => void }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Pessoa | "novo" | null>(null);

  const conta = (f: Filtro) => pessoas.filter((p) => (f === "inativos" ? !p.ativo : p.ativo && (f === "todos" || p.tipo === f))).length;
  const lista = useMemo(() => {
    const b = chaveDaFuncao(busca);
    return pessoas
      .filter((p) => (filtro === "inativos" ? !p.ativo : p.ativo && (filtro === "todos" || p.tipo === filtro)))
      .filter((p) => !b || chaveDaFuncao(p.nome).includes(b) || chaveDaFuncao(p.funcao).includes(b) || (p.telefone || "").includes(busca.trim()));
  }, [pessoas, filtro, busca]);

  const FILTROS: Array<[Filtro, string]> = [["todos", "Todos"], ["equipe", "👤 Equipe"], ["motoboy", "🛵 Motoboys"], ["freelancer", "⭐ Freelancers"], ["inativos", "Desativados"]];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {FILTROS.filter(([f]) => f !== "inativos" || conta("inativos") > 0).map(([f, rotulo]) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} style={{
              ...S.botaoPequeno, borderColor: filtro === f ? COR : "#CBD5E1", background: filtro === f ? COR_CLARA : "#fff", color: filtro === f ? COR : "#334155",
            }}>{rotulo} <span style={{ opacity: 0.7 }}>{conta(f)}</span></button>
          ))}
        </div>
        <button type="button" style={S.botao} onClick={() => setEditando("novo")}>+ Novo freelancer</button>
      </div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, função ou telefone" style={{ ...S.campo, marginTop: 10, maxWidth: 420 }} />

      {lista.length === 0 ? (
        <div style={{ ...S.cartao, marginTop: 12, textAlign: "center" }}>
          <p style={S.texto}>{pessoas.length === 0
            ? "Ninguém ainda. Os logins de funcionário e os motoboys cadastrados aparecem aqui sozinhos; freelancer você cadastra no botão acima — ou ele mesmo se cadastra pelo link."
            : "Ninguém com esse filtro."}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 12 }}>
          {lista.map((p) => (
            <button key={`${p.tipo}:${p.id}`} type="button" onClick={() => setEditando(p)} className="esc-cartao" style={{
              textAlign: "left", fontFamily: "inherit", cursor: "pointer", background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "12px 14px", opacity: p.ativo ? 1 : 0.6,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15, color: "#0F172A", flex: 1, minWidth: 0 }}>{p.nome}</strong>
                <SeloDoTipo tipo={p.tipo} />
                {p.origem === "link" && <SeloDoLink />}
              </div>
              <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>{[p.funcao || "sem função", p.telefone || "sem telefone"].join(" · ")}</div>
              {ehDono && (p.diaria ? <div style={{ fontSize: 13, color: COR, fontWeight: 800, marginTop: 2 }}>Diária {reais(p.diaria)}</div> : <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>sem diária combinada</div>)}
              {!p.telefone && p.tipo !== "freelancer" && <div style={{ fontSize: 12, color: "#B45309", marginTop: 4 }}>Sem telefone: pelo link vai entrar como freelancer. Toque para pôr o WhatsApp.</div>}
            </button>
          ))}
        </div>
      )}

      {editando && <JanelaDaPessoa pessoa={editando === "novo" ? null : editando} ehDono={ehDono} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); onMudou(); }} avisar={avisar} />}
    </div>
  );
}

function JanelaDaPessoa({ pessoa, ehDono, onFechar, onSalvo, avisar }: { pessoa: Pessoa | null; ehDono: boolean; onFechar: () => void; onSalvo: () => void; avisar: (a: Aviso) => void }) {
  const freelancer = !pessoa || pessoa.tipo === "freelancer";
  const [nome, setNome] = useState(pessoa?.nome || "");
  const [telefone, setTelefone] = useState(pessoa?.telefone || "");
  const [funcao, setFuncao] = useState(pessoa?.funcao || "");
  const [cpf, setCpf] = useState(pessoa?.cpf || "");
  const [pix, setPix] = useState(pessoa?.pix || "");
  // Motoboy sem diária própria na escala mostra a do cadastro dele como dica, e
  // o campo vazio: salvar não "congela" o valor se a tela Motoboys mudar depois.
  const [diaria, setDiaria] = useState(pessoa?.diariaDaOrigem && pessoa.diaria === pessoa.diariaDaOrigem ? "" : reaisNoCampo(pessoa?.diaria));
  const [obs, setObs] = useState(pessoa?.obs || "");
  const [salvando, setSalvando] = useState(false);

  async function salvar(ativo = pessoa?.ativo ?? true) {
    setSalvando(true);
    try {
      const corpo = { nome, telefone, funcao, cpf, pix, diaria, obs, ativo };
      if (!pessoa) await pedir("/api/store/escala/pessoas", "POST", corpo);
      else await pedir("/api/store/escala/pessoas", "PUT", { ...corpo, tipo: pessoa.tipo, id: pessoa.id });
      avisar({ tipo: "ok", titulo: !pessoa ? "Freelancer cadastrado" : ativo === pessoa.ativo ? "Salvo" : ativo ? "Reativado" : "Desativado", detalhe: !ativo ? "Não aparece mais para encaixar nem consegue se inscrever pelo link." : undefined });
      onSalvo();
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Janela titulo={pessoa ? pessoa.nome : "Novo freelancer"} subtitulo={pessoa?.detalhe || (pessoa?.origem === "link" ? "Se cadastrou pelo link de inscrição" : undefined)} onFechar={onFechar} rodape={<>
      {pessoa && freelancer && (
        <button type="button" style={{ ...S.botaoLeve, marginRight: "auto", color: pessoa.ativo ? "#DC2626" : COR }} disabled={salvando} onClick={() => salvar(!pessoa.ativo)}>
          {pessoa.ativo ? "Desativar" : "Reativar"}
        </button>
      )}
      <button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button>
      <button type="button" style={S.botao} disabled={salvando || (freelancer && nome.trim().length < 2)} onClick={() => salvar()}>{salvando ? "Salvando…" : "Salvar"}</button>
    </>}>
      <div className="esc-form">
        {freelancer ? (
          <label style={{ gridColumn: "1 / -1" }}><span style={S.rotulo}>Nome</span><input autoFocus value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} style={S.campo} /></label>
        ) : (
          <p style={{ ...S.texto, gridColumn: "1 / -1", fontSize: 13, background: "#F8FAFC", borderRadius: 10, padding: "8px 10px" }}>
            O nome e o cadastro de {pessoa!.nome} ficam na tela {pessoa!.tipo === "motoboy" ? "Motoboys" : "Minha loja › Equipe & permissões"}. Aqui você completa o que a escala usa.
          </p>
        )}
        <label><span style={S.rotulo}>WhatsApp</span><input value={telefone} inputMode="tel" onChange={(e) => setTelefone(e.target.value)} placeholder="22 99999-1234" style={S.campo} /></label>
        <label>
          <span style={S.rotulo}>Função principal</span>
          <input value={funcao} list="esc-funcoes" maxLength={40} onChange={(e) => setFuncao(e.target.value)} placeholder="Motoboy, Cozinha…" style={S.campo} />
          <datalist id="esc-funcoes">{FUNCOES.map((f) => <option key={f} value={f} />)}</datalist>
        </label>
        {freelancer && <>
          <label><span style={S.rotulo}>CPF (opcional)</span><input value={cpf} inputMode="numeric" maxLength={20} onChange={(e) => setCpf(e.target.value)} style={S.campo} /></label>
          <label><span style={S.rotulo}>Chave Pix (opcional)</span><input value={pix} maxLength={120} onChange={(e) => setPix(e.target.value)} style={S.campo} /></label>
        </>}
        {ehDono && (
          <label>
            <span style={S.rotulo}>Diária combinada (opcional)</span>
            <input value={diaria} inputMode="decimal" onChange={(e) => setDiaria(e.target.value)} placeholder={pessoa?.diariaDaOrigem ? reaisNoCampo(pessoa.diariaDaOrigem) : "80,00"} style={S.campo} />
            {pessoa?.diariaDaOrigem ? <span style={{ fontSize: 11.5, color: "#64748B" }}>Vazio = a diária do cadastro do motoboy ({reais(pessoa.diariaDaOrigem)}).</span> : null}
          </label>
        )}
        <label style={{ gridColumn: "1 / -1" }}><span style={S.rotulo}>Observação</span><input value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} style={S.campo} /></label>
      </div>
    </Janela>
  );
}
