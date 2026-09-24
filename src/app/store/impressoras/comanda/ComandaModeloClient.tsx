"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchAssistente } from "@/lib/print";
import ComandaModeloEditor from "../ComandaModeloEditor";
import { VERSAO_MINIMA_DO_MODELO, lerModelo, modeloPadrao, type ModeloDeComanda, type ModeloNomeado } from "@/lib/comanda-modelo";

/**
 * A bancada de edição da comanda.
 *
 * Guarda o `printerConfig` INTEIRO e devolve ele inteiro no Salvar: a rota
 * `/api/store/printer-config` substitui o objeto completo, então mandar só o
 * `comandaModelo` apagaria as impressoras da loja. É o tipo de erro que só
 * aparece depois do deploy, com a loja sem imprimir.
 */
export default function ComandaModeloClient({
  storeName,
  initialConfig,
}: {
  storeName: string;
  initialConfig: any;
}) {
  const [config, setConfig] = useState<any>(initialConfig);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");
  const [versaoInstalada, setVersaoInstalada] = useState<string>("");

  // ── QUAL MODELO ESTÁ SENDO EDITADO ─────────────────────────────────────
  //
  // "" é o modelo PADRÃO da loja (as chaves `cozinha`/`completo` da raiz), que
  // é o que toda impressora usa enquanto não escolher outro. Os demais são os
  // modelos nomeados, que a impressora aponta pelo id na tela de Impressoras.
  //
  // O editor abaixo não sabe de nada disso: ele recebe UM modelo com as duas
  // vias e devolve o modelo alterado. Quem sabe em qual gaveta guardar é esta
  // tela — assim o editor continua com uma responsabilidade só.
  const [editando, setEditando] = useState<string>("");

  const modeloCompleto: ModeloDeComanda = lerModelo(config?.comandaModelo);
  const extras: ModeloNomeado[] = modeloCompleto.modelos || [];
  const emEdicao = editando ? extras.find(m => m.id === editando) : null;
  // Modelo apagado noutra aba: volta para o padrão em vez de editar o nada.
  // Os avisos (aba Avisos) andam com o modelo, como as duas vias.
  const viasEmEdicao: ModeloDeComanda = emEdicao
    ? { versao: 1, cozinha: emEdicao.cozinha, completo: emEdicao.completo, avisos: emEdicao.avisos }
    : { versao: 1, cozinha: modeloCompleto.cozinha, completo: modeloCompleto.completo, avisos: modeloCompleto.avisos };

  /** Grava o que o editor devolveu na gaveta certa. */
  const aoEditar = (novo: ModeloDeComanda) => {
    setConfig((c: any) => {
      const atual = lerModelo(c?.comandaModelo);
      if (!editando) {
        return { ...c, comandaModelo: { ...atual, cozinha: novo.cozinha, completo: novo.completo, avisos: novo.avisos } };
      }
      return {
        ...c,
        comandaModelo: {
          ...atual,
          modelos: (atual.modelos || []).map(m =>
            m.id === editando ? { ...m, cozinha: novo.cozinha, completo: novo.completo, avisos: novo.avisos } : m
          ),
        },
      };
    });
  };

  const mexerNaLista = (f: (lista: ModeloNomeado[], atual: ModeloDeComanda) => ModeloNomeado[]) => {
    setConfig((c: any) => {
      const atual = lerModelo(c?.comandaModelo);
      return { ...c, comandaModelo: { ...atual, modelos: f(atual.modelos || [], atual) } };
    });
  };

  const novoModelo = (copiarDoAtual: boolean) => {
    const nome = prompt(copiarDoAtual ? "Nome da cópia:" : "Nome do novo modelo:", copiarDoAtual ? `${emEdicao?.nome || "Padrão"} (cópia)` : "Cozinha");
    if (!nome || !nome.trim()) return;
    // Id derivado do relógio: só precisa ser estável e único dentro da loja,
    // porque é ele que fica gravado na impressora.
    const id = `m${Date.now().toString(36)}`;
    const base = copiarDoAtual ? viasEmEdicao : modeloPadrao();
    mexerNaLista(lista => [...lista, {
      id, nome: nome.trim().slice(0, 40), cozinha: base.cozinha, completo: base.completo,
      ...(copiarDoAtual && viasEmEdicao.avisos ? { avisos: viasEmEdicao.avisos } : {}),
    }]);
    setEditando(id);
  };

  const renomear = () => {
    if (!emEdicao) return;
    const nome = prompt("Novo nome:", emEdicao.nome);
    if (!nome || !nome.trim()) return;
    mexerNaLista(lista => lista.map(m => (m.id === emEdicao.id ? { ...m, nome: nome.trim().slice(0, 40) } : m)));
  };

  const excluir = () => {
    if (!emEdicao) return;
    // A impressora que apontava para ele volta sozinha ao padrão da loja
    // (`viaDoModelo` cai no padrão quando o id não existe mais), então não há
    // impressora muda — mas o lojista precisa saber disso antes de apagar.
    if (!confirm(`Apagar o modelo "${emEdicao.nome}"?\n\nA impressora que estiver usando ele volta a imprimir o modelo padrão da loja.`)) return;
    mexerNaLista(lista => lista.filter(m => m.id !== emEdicao.id));
    setEditando("");
  };

  // Pergunta ao Assistente desta máquina em que versão ele está, para a tela
  // avisar quando o modelo ainda não vai ser lido. Falha em silêncio: sem
  // Assistente aqui (o dono no celular, por exemplo) simplesmente não há aviso.
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const porta of [7899, 7900, 7901, 7891]) {
        try {
          const r = await fetchAssistente(`http://localhost:${porta}/status`, { signal: AbortSignal.timeout(1500) });
          const d = await r.json();
          if (d?.ok && d?.version && vivo) { setVersaoInstalada(String(d.version)); return; }
        } catch {}
      }
    })();
    return () => { vivo = false; };
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/store/printer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e: any) {
      setErro("Não consegui salvar. Confira a internet e tente de novo.");
      console.error("[ComandaModelo] salvar:", e);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "1.25rem 1rem 3rem", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Link
              href="/store/impressoras"
              style={{
                padding: "9px 14px", borderRadius: 11, border: "1.5px solid #E2E8F0", background: "#fff",
                color: "#475569", fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", whiteSpace: "nowrap",
              }}
            >
              ← Voltar para Impressoras
            </Link>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontWeight: 900, fontSize: "1.25rem", margin: 0, color: "#0F172A" }}>🧾 Personalizar impressão</h1>
              <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {storeName}
              </p>
            </div>
          </div>

          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              padding: "11px 26px", borderRadius: 12,
              background: salvo ? "#0F766E" : "linear-gradient(135deg,#B71C1C,#C92E09)",
              color: "#fff", border: "none", fontWeight: 800, fontSize: "0.9rem",
              cursor: salvando ? "wait" : "pointer", fontFamily: "inherit",
            }}
          >
            {salvando ? "Salvando..." : salvo ? "✅ Salvo!" : "Salvar modelo"}
          </button>
        </div>

        {erro && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", color: "#B71C1C", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontWeight: 700, fontSize: "0.85rem" }}>
            {erro}
          </div>
        )}

        <div style={{ background: "#fff", borderRadius: 16, border: "1.5px solid #E2E8F0", padding: "1.25rem" }}>
          {/* ── OS MODELOS DA LOJA ────────────────────────────────────────
              Antes havia um modelo só e ele saía igual em toda impressora. A
              cozinha não precisa de preço e o caixa precisa — então a loja cria
              quantos quiser aqui e aponta um em cada impressora, na tela de
              Impressoras. Quem nunca criar nenhum continua com o modelo padrão,
              exatamente como hoje. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem", paddingBottom: "1rem", borderBottom: "1.5px solid #F1F5F9" }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.04em", marginRight: 4 }}>
              Modelo
            </span>
            {[{ id: "", nome: "Padrão da loja" }, ...extras].map(m => {
              const ativo = editando === m.id;
              return (
                <button
                  key={m.id || "padrao"}
                  type="button"
                  onClick={() => setEditando(m.id)}
                  style={{
                    padding: "7px 14px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
                    fontSize: "0.82rem", fontWeight: 800,
                    border: `1.5px solid ${ativo ? "#C92E09" : "#E2E8F0"}`,
                    background: ativo ? "#C92E09" : "#fff",
                    color: ativo ? "#fff" : "#475569",
                  }}
                >
                  {m.nome}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => novoModelo(false)}
              style={{ padding: "7px 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 800, border: "1.5px dashed #CBD5E1", background: "#fff", color: "#64748B" }}
            >
              + Novo
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => novoModelo(true)}
              style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#fff", color: "#475569" }}
            >
              Duplicar
            </button>
            {emEdicao && (
              <>
                <button
                  type="button"
                  onClick={renomear}
                  style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 700, border: "1.5px solid #E2E8F0", background: "#fff", color: "#475569" }}
                >
                  Renomear
                </button>
                <button
                  type="button"
                  onClick={excluir}
                  style={{ padding: "6px 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 700, border: "1.5px solid #FCA5A5", background: "#FEF2F2", color: "#B71C1C" }}
                >
                  Apagar
                </button>
              </>
            )}
          </div>

          <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 1rem", lineHeight: 1.5 }}>
            {emEdicao
              ? <>Editando <strong>{emEdicao.nome}</strong>. Para uma impressora usar este modelo, escolha ele no cartão dela em <strong>Impressoras</strong>.</>
              : <>Editando o <strong>modelo padrão</strong> — o que sai em toda impressora que não escolher outro.</>}
          </p>

          <ComandaModeloEditor
            key={editando || "padrao"}
            modelo={viasEmEdicao}
            nomeDaLoja={storeName}
            versaoInstalada={versaoInstalada || undefined}
            versaoMinima={VERSAO_MINIMA_DO_MODELO}
            // A prévia sai NA impressora: largura e colunas do cadastro dela,
            // as mesmas que o Assistente usa. Impressora sem nome não imprime
            // (o roteamento a ignora), então também não entra aqui.
            impressoras={(config.printers || [])
              .filter((p: any) => p && String(p.name || "").trim())
              .map((p: any) => ({
                id: String(p.id || p.name),
                nome: String(p.label || p.name),
                paperWidth: p.paperWidth,
                columns: p.columns,
                modeloId: p.modeloId,
              }))}
            modeloEmEdicao={editando}
            autoBeverageTag={config.autoBeverageTag}
            customBeverageKeywords={config.customBeverageKeywords}
            onChange={aoEditar}
          />
        </div>
      </div>
    </div>
  );
}
