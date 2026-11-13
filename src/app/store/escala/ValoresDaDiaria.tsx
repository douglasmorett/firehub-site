"use client";

/**
 * "💲 Valores da diária" — só o dono (Lucas/Frangoso, 13/11/2026: "valor por
 * dia e por função; hoje todo mundo é igual").
 *
 *   Valor normal de cada função: Motoboy R$ 60, Cozinha R$ 80…
 *   Valor de um dia: a exceção daquela função naquele dia (sexta, feriado).
 *
 * Qual vale em cada turno (regras.ts, diariaDoTurno): o valor do dia, depois a
 * diária combinada com a pessoa (aba Pessoas), depois o valor da função. O
 * custo previsto, o "a pagar" e o PDF da pessoa usam a mesma conta.
 */

import { useState } from "react";
import { FUNCOES, chaveDaFuncao, diaPorExtenso, type ValorDaDiaria } from "@/lib/escala-da-equipe/regras";
import { COR, Janela, S, pedir, reais, reaisNoCampo, type Aviso } from "./ui";

export default function ValoresDaDiaria({ valores: iniciais, funcoesUsadas, hoje, avisar, onFechar, onMudou }: {
  valores: ValorDaDiaria[]; funcoesUsadas: string[]; hoje: string; avisar: (a: Aviso) => void; onFechar: () => void; onMudou: () => void;
}) {
  const [valores, setValores] = useState(iniciais);
  // As funções da lista, as que a escala usa e as que já têm valor — sem repetir.
  const funcoes: string[] = [];
  for (const f of [...FUNCOES, ...funcoesUsadas, ...iniciais.map((v) => v.funcao)]) {
    if (!funcoes.some((x) => chaveDaFuncao(x) === chaveDaFuncao(f))) funcoes.push(f);
  }
  const normal = (f: string) => valores.find((v) => v.data == null && chaveDaFuncao(v.funcao) === chaveDaFuncao(f))?.valor ?? null;
  const [campos, setCampos] = useState<Record<string, string>>(() => Object.fromEntries(funcoes.map((f) => [f, reaisNoCampo(normal(f))])));
  const [salvando, setSalvando] = useState<string | null>(null);
  const [dia, setDia] = useState(hoje), [funcaoDoDia, setFuncaoDoDia] = useState(funcoes[0] || "Motoboy"), [valorDoDia, setValorDoDia] = useState("");
  const doDia = valores.filter((v) => v.data != null).sort((a, b) => String(a.data).localeCompare(String(b.data)) || a.funcao.localeCompare(b.funcao));

  async function salvar(funcao: string, data: string | null, valor: string, chave: string) {
    setSalvando(chave);
    try {
      const r = await pedir<{ valores: ValorDaDiaria[] }>("/api/store/escala/valores", "PUT", { funcao, data, valor });
      setValores(r.valores);
      avisar({ tipo: "ok", titulo: valor.trim() ? `Valor salvo: ${funcao}` : `Valor apagado: ${funcao}`, detalhe: data ? diaPorExtenso(data) : "valor normal da função" });
      onMudou();
      return true;
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
      return false;
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Janela titulo="💲 Valores da diária" largura={620} onFechar={onFechar}
      subtitulo="Quanto cada função ganha por turno — e os dias que pagam diferente."
      rodape={<button type="button" style={S.botao} onClick={onFechar}>Pronto</button>}>
      <p style={{ ...S.texto, fontSize: 13, marginBottom: 12 }}>
        Em cada turno vale, nesta ordem: o <b>valor do dia</b> (se houver), a <b>diária combinada com a pessoa</b> (aba Pessoas) e o <b>valor da função</b>.
        O custo previsto, o “a pagar” e o PDF de cada pessoa usam a mesma conta. Só você (dono) vê.
      </p>

      <h3 style={{ ...S.h2, fontSize: 15 }}>Valor normal de cada função</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {funcoes.map((f) => {
          const mudou = (campos[f] ?? "") !== reaisNoCampo(normal(f));
          return (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 14.5 }}>{f}</span>
              <span style={{ color: "#64748B", fontSize: 13 }}>R$</span>
              <input value={campos[f] ?? ""} inputMode="decimal" placeholder="—" onChange={(e) => setCampos((c) => ({ ...c, [f]: e.target.value }))}
                style={{ ...S.campo, width: 110, textAlign: "right" }} aria-label={`Valor da diária de ${f}`} />
              <button type="button" disabled={!mudou || salvando === f} onClick={() => salvar(f, null, campos[f] ?? "", f)}
                style={{ ...S.botaoPequeno, width: 72, borderColor: mudou ? COR : "#E2E8F0", color: mudou ? COR : "#94A3B8" }}>
                {salvando === f ? "…" : "Salvar"}
              </button>
            </div>
          );
        })}
      </div>

      <h3 style={{ ...S.h2, fontSize: 15, marginTop: 18 }}>Dia com valor diferente</h3>
      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 150px" }}><span style={S.rotulo}>Dia</span><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={S.campo} /></label>
        <label style={{ flex: "1 1 150px" }}>
          <span style={S.rotulo}>Função</span>
          <select value={funcaoDoDia} onChange={(e) => setFuncaoDoDia(e.target.value)} style={S.campo}>
            {funcoes.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label style={{ flex: "0 1 110px" }}><span style={S.rotulo}>Valor (R$)</span><input value={valorDoDia} inputMode="decimal" placeholder="100,00" onChange={(e) => setValorDoDia(e.target.value)} style={S.campo} /></label>
        <button type="button" style={{ ...S.botao, height: 42 }} disabled={!dia || !valorDoDia.trim() || salvando === "dia"}
          onClick={async () => { if (await salvar(funcaoDoDia, dia, valorDoDia, "dia")) setValorDoDia(""); }}>
          {salvando === "dia" ? "…" : "Adicionar"}
        </button>
      </div>
      {doDia.length === 0 ? (
        <p style={{ ...S.texto, fontSize: 13, marginTop: 8 }}>Nenhum dia com valor diferente.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
          {doDia.map((v) => (
            <div key={`${v.funcao}|${v.data}`} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #E2E8F0", borderRadius: 10, padding: "6px 10px", fontSize: 14 }}>
              <span style={{ flex: 1 }}><b style={{ textTransform: "capitalize" }}>{diaPorExtenso(v.data!)}</b> · {v.funcao}</span>
              <b>{reais(v.valor)}</b>
              <button type="button" disabled={salvando === `${v.funcao}|${v.data}`} onClick={() => salvar(v.funcao, v.data, "", `${v.funcao}|${v.data}`)}
                style={{ border: 0, background: "#FEF2F2", color: "#DC2626", borderRadius: 8, width: 28, height: 28, cursor: "pointer" }} aria-label="Apagar este valor">×</button>
            </div>
          ))}
        </div>
      )}
    </Janela>
  );
}
