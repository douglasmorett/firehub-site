"use client";

/**
 * ANDARES DO SALÃO — a aba "Andares" do ⚙️ da tela de Mesas.
 *
 * Pedido do dono (27/09/2026): "quem tem mais de um andar dá o nome (Piso 1,
 * Piso 2), escolhe quais mesas estão naquele andar e qual impressora imprime em
 * cada andar — térreo, mesas 1 a 30, impressora B; segundo andar, 31 a 60,
 * impressora C. Da forma fácil e intuitiva."
 *
 * Grava só a chave `andares` do printerConfig (o PUT mescla por chave, e as
 * telas de Impressoras não mandam esta chave). A regra de impressão mora em
 * src/lib/andares-da-mesa.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { lerAndares, numerosDaFaixa, type AndarDaMesa } from "@/lib/andares-da-mesa";

type Impressora = {
  id?: string;
  name?: string;
  label?: string;
  categories?: string[];
  somenteBebidas?: boolean;
  contaDaMesa?: boolean;
};

const novoId = () => "andar_" + Math.random().toString(36).slice(2, 9);

/** {1,2,3,5,7,8} → "1 a 3, 5, 7 a 8" */
function faixaLegivel(numeros: number[]): string {
  const ordenados = [...new Set(numeros)].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < ordenados.length; ) {
    let j = i;
    while (j + 1 < ordenados.length && ordenados[j + 1] === ordenados[j] + 1) j++;
    partes.push(i === j ? `${ordenados[i]}` : `${ordenados[i]} a ${ordenados[j]}`);
    i = j + 1;
  }
  return partes.join(", ");
}

function oQueImprime(p: Impressora): string {
  if (p.somenteBebidas) return "só bebidas";
  const cats = (p.categories || []).filter(Boolean);
  if (cats.length === 0) return "o pedido inteiro";
  return cats.length > 3 ? `${cats.slice(0, 3).join(", ")} +${cats.length - 3}` : cats.join(", ");
}

export default function AndaresConfig({
  andaresSalvos,
  numerosDasMesas,
  onSalvo,
}: {
  andaresSalvos: AndarDaMesa[];
  numerosDasMesas: number[];
  onSalvo: (andares: AndarDaMesa[]) => void;
}) {
  const [andares, setAndares] = useState<AndarDaMesa[]>(andaresSalvos);
  const [impressoras, setImpressoras] = useState<Impressora[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string>("");

  useEffect(() => {
    fetch("/api/store/printer-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        setImpressoras(Array.isArray(cfg?.printers) ? cfg.printers.filter((p: Impressora) => p && p.id && p.name) : []);
        // O que está gravado agora (outra aba pode ter salvo depois de a tela abrir).
        if (cfg) setAndares(lerAndares(cfg));
      })
      .catch(() => setImpressoras([]));
  }, []);

  const existentes = useMemo(() => new Set(numerosDasMesas), [numerosDasMesas]);

  // Por andar: quais mesas ele tem de verdade, as que não existem e as repetidas.
  const leitura = useMemo(() => {
    const dono = new Map<number, string>();
    return andares.map((a) => {
      const nums = [...numerosDaFaixa(a.mesas)];
      const reais = nums.filter((n) => existentes.has(n));
      const repetidas = reais.filter((n) => dono.has(n) && dono.get(n) !== a.id);
      for (const n of reais) if (!dono.has(n)) dono.set(n, a.id);
      return {
        id: a.id,
        reais: reais.filter((n) => !repetidas.includes(n)),
        inexistentes: nums.filter((n) => !existentes.has(n)).length,
        repetidas,
      };
    });
  }, [andares, existentes]);

  const semAndar = useMemo(() => {
    const comAndar = new Set(leitura.flatMap((l) => [...l.reais, ...l.repetidas]));
    return numerosDasMesas.filter((n) => !comAndar.has(n));
  }, [leitura, numerosDasMesas]);

  const mudar = (id: string, parcial: Partial<AndarDaMesa>) =>
    setAndares((lista) => lista.map((a) => (a.id === id ? { ...a, ...parcial } : a)));

  const adicionar = () => {
    // Sugere a próxima faixa: depois da maior mesa já com andar, até a última.
    const usadas = leitura.flatMap((l) => l.reais);
    const maiorUsada = usadas.length ? Math.max(...usadas) : 0;
    const restantes = numerosDasMesas.filter((n) => n > maiorUsada).sort((a, b) => a - b);
    const sugestao = restantes.length ? `${restantes[0]}-${restantes[restantes.length - 1]}` : "";
    const nome = andares.length === 0 ? "Térreo" : `Piso ${andares.length + 1}`;
    setAndares((lista) => [...lista, { id: novoId(), nome, mesas: sugestao, impressoras: [] }]);
  };

  const salvar = async () => {
    const vazio = andares.find((a) => !a.nome.trim());
    if (vazio) { setAviso("Dê um nome para cada andar."); return; }
    setSalvando(true);
    setAviso("");
    try {
      const limpos = andares.map((a) => ({ ...a, nome: a.nome.trim(), mesas: a.mesas.trim() }));
      const r = await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andares: limpos }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSalvo(lerAndares({ andares: limpos }));
      setAviso("✅ Andares salvos");
    } catch {
      setAviso("❌ Não consegui salvar. Confira a internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  const caixa = { border: "1px solid #E2E8F0", borderRadius: 14, padding: 14, background: "#fff" } as const;
  const rotulo = { fontSize: 12, fontWeight: 800, color: "#475569", marginBottom: 4, display: "block" } as const;
  const campo = {
    width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 10,
    border: "1.5px solid #E2E8F0", fontSize: 14, fontFamily: "inherit", outline: "none",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
      <p style={{ margin: 0, fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
        Tem mais de um andar? Dê um nome a cada um, diga quais mesas estão nele e em qual impressora ele imprime.
        A tela de mesas ganha um botão para cada andar.
      </p>

      {andares.map((a, i) => {
        const l = leitura[i];
        return (
          <div key={a.id} style={caixa}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={rotulo}>Nome do andar</label>
                <input value={a.nome} maxLength={30} placeholder="Térreo, Piso 2, Varanda…"
                  onChange={(e) => mudar(a.id, { nome: e.target.value })} style={campo} />
              </div>
              <button type="button" onClick={() => setAndares((lista) => lista.filter((x) => x.id !== a.id))}
                title="Remover este andar"
                style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid #FECACA", background: "#FEF2F2", color: "#C92E09", fontWeight: 700, cursor: "pointer" }}>
                🗑
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <label style={rotulo}>Mesas deste andar</label>
              <input value={a.mesas} placeholder="Ex.: 1-30   ou   1-20, 25, 40-45"
                onChange={(e) => mudar(a.id, { mesas: e.target.value })} style={campo} />
              <div style={{ fontSize: 12, marginTop: 5, color: l.reais.length ? "#0F766E" : "#94A3B8", fontWeight: 600 }}>
                {l.reais.length
                  ? `${l.reais.length} mesa${l.reais.length > 1 ? "s" : ""}: ${faixaLegivel(l.reais)}`
                  : "Nenhuma mesa ainda — escreva os números, como 1-30."}
              </div>
              {l.repetidas.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 3, color: "#B45309", fontWeight: 700 }}>
                  ⚠ {faixaLegivel(l.repetidas)} já {l.repetidas.length > 1 ? "estão" : "está"} em outro andar e {l.repetidas.length > 1 ? "ficam" : "fica"} lá.
                </div>
              )}
              {l.inexistentes > 0 && (
                <div style={{ fontSize: 12, marginTop: 3, color: "#94A3B8" }}>
                  {l.inexistentes} número{l.inexistentes > 1 ? "s" : ""} da faixa não {l.inexistentes > 1 ? "são mesas cadastradas" : "é mesa cadastrada"} (sem problema).
                </div>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={rotulo}>Imprime em</label>
              {impressoras === null ? (
                <div style={{ fontSize: 13, color: "#94A3B8" }}>Carregando impressoras…</div>
              ) : impressoras.length === 0 ? (
                <div style={{ fontSize: 13, color: "#94A3B8" }}>Nenhuma impressora cadastrada na tela de Impressoras.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {impressoras.map((p) => {
                    const marcada = a.impressoras.includes(String(p.id));
                    return (
                      <label key={p.id} style={{
                        display: "flex", gap: 10, alignItems: "center", cursor: "pointer",
                        padding: "8px 10px", borderRadius: 10,
                        border: `1.5px solid ${marcada ? "#0F766E" : "#E2E8F0"}`,
                        background: marcada ? "#F0FDFA" : "#fff",
                      }}>
                        <input type="checkbox" checked={marcada} style={{ width: 18, height: 18 }}
                          onChange={() => mudar(a.id, {
                            impressoras: marcada
                              ? a.impressoras.filter((x) => x !== String(p.id))
                              : [...a.impressoras, String(p.id)],
                          })} />
                        <span style={{ fontSize: 13, lineHeight: 1.3 }}>
                          <b>{p.name}</b>{p.label ? <span style={{ color: "#94A3B8" }}> · {p.label}</span> : null}
                          <br />
                          <span style={{ color: "#64748B" }}>imprime {oQueImprime(p)}{p.contaDaMesa ? " · e a conta da mesa" : ""}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button type="button" onClick={adicionar} style={{
        padding: "11px", borderRadius: 12, border: "1.5px dashed #94A3B8", background: "#F8FAFC",
        color: "#334155", fontWeight: 800, fontSize: 14, cursor: "pointer",
      }}>+ Adicionar andar</button>

      {andares.length > 0 && (
        <div style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.5, background: "#F8FAFC", borderRadius: 10, padding: "10px 12px" }}>
          {semAndar.length > 0 && <div><b>Sem andar:</b> {faixaLegivel(semAndar)}</div>}
          <div>A impressora que <b>nenhum</b> andar marcou continua imprimindo as mesas de todos os andares (a cozinha, por exemplo).
            O que cada uma imprime se ajusta na tela de Impressoras.</div>
        </div>
      )}

      <button type="button" onClick={salvar} disabled={salvando} style={{
        padding: "12px", borderRadius: 12, border: "none", background: salvando ? "#94A3B8" : "#0F766E",
        color: "#fff", fontWeight: 800, fontSize: 15, cursor: salvando ? "default" : "pointer",
      }}>{salvando ? "Salvando…" : "Salvar andares"}</button>
      {aviso && <div style={{ fontSize: 13, fontWeight: 700, textAlign: "center", color: aviso.startsWith("✅") ? "#0F766E" : "#C92E09" }}>{aviso}</div>}
    </div>
  );
}
