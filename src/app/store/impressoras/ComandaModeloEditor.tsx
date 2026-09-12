"use client";

/**
 * A tela onde a loja monta a própria comanda.
 *
 * ── A régua é o ponto ───────────────────────────────────────────────────────
 *
 * O papel da direita não é ilustração: ele roda `montarComanda` +
 * `previaEmTexto` de lib/comanda-modelo.ts, as mesmas funções que decidem a
 * largura no papel de verdade. Mesma quebra por palavra, mesma conta de quantas
 * letras cabem em cada tamanho. É isso que separa esta tela do concorrente, onde
 * o lojista só descobre como ficou imprimindo e gastando bobina.
 *
 * O que a prévia NÃO promete: o conteúdo exato de itens e totais. Aqueles
 * números saem do Assistente, com preço efetivo rateado, tarja de bebida e
 * rateio de mesa. Aqui roda um pedido de exemplo — e a tela diz isso, em vez de
 * deixar o lojista achar que o nome do cliente vai ser sempre "Larissa".
 */

import { useMemo, useState } from "react";
import {
  AJUDA_DO_BLOCO,
  BLOCOS_OBRIGATORIOS,
  CAMPOS_DISPONIVEIS,
  NOME_DO_BLOCO,
  TAMANHOS,
  aceitaFormato,
  aceitaTitulo,
  lerModelo,
  modeloPadrao,
  montarComanda,
  pedidoDeExemplo,
  previaEmTexto,
  tamanhoValido,
  type Alinhamento,
  type Bloco,
  type ModeloDeComanda,
  type TipoDeBloco,
} from "@/lib/comanda-modelo";

/**
 * Compara versão NÚMERO a número.
 *
 * Comparar como texto parece funcionar e mente na hora errada: "1.2.9" é
 * MAIOR que "1.2.11" em ordem alfabética, porque "9" vem depois de "1". Seria
 * exatamente a loja mais atrasada — a que mais precisa do aviso — a ficar sem
 * ele.
 */
function ehMaisVelha(instalada?: string, minima?: string): boolean {
  if (!instalada || !minima) return false;
  const a = instalada.split(".").map((n) => parseInt(n, 10) || 0);
  const b = minima.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

const VERMELHO = "#C62828";
const BORDA = "1.5px solid #E2E8F0";

/** As larguras que a prévia sabe mostrar — as mesmas três da bobina. */
const LARGURAS: { colunas: number; rotulo: string }[] = [
  { colunas: 48, rotulo: "80 mm · 48 colunas" },
  { colunas: 42, rotulo: "Bematech · 42 colunas" },
  { colunas: 32, rotulo: "58 mm · 32 colunas" },
];

type Props = {
  modelo: unknown;
  nomeDaLoja: string;
  /** Versão do Assistente instalado nesta máquina, quando ele respondeu. */
  versaoInstalada?: string;
  /** Versão em que o modelo passou a ser lido pelo Assistente. */
  versaoMinima: string;
  /** Colunas da primeira impressora cadastrada, para a prévia abrir na largura certa. */
  colunasDaLoja?: number;
  onChange: (modelo: ModeloDeComanda) => void;
};

export default function ComandaModeloEditor({ modelo, nomeDaLoja, versaoInstalada, versaoMinima, colunasDaLoja, onChange }: Props) {
  const atual = useMemo(() => lerModelo(modelo), [modelo]);
  const [via, setVia] = useState<"completo" | "cozinha">("completo");
  const [colunas, setColunas] = useState<number>(
    LARGURAS.some((l) => l.colunas === colunasDaLoja) ? (colunasDaLoja as number) : 48,
  );
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);

  const lista = atual[via];
  const exemplo = useMemo(() => pedidoDeExemplo(nomeDaLoja), [nomeDaLoja]);
  const papel = useMemo(
    () => previaEmTexto(montarComanda(lista, exemplo, { colunas, comValores: via === "completo" }), colunas),
    [lista, exemplo, colunas, via],
  );

  const trocar = (novaLista: Bloco[]) => onChange({ ...atual, [via]: novaLista });
  const mexerNoBloco = (i: number, mudanca: Partial<Bloco>) =>
    trocar(lista.map((b, j) => (j === i ? { ...b, ...mudanca } : b)));
  const mover = (de: number, para: number) => {
    if (para < 0 || para >= lista.length || de === para) return;
    const nova = [...lista];
    nova.splice(para, 0, nova.splice(de, 1)[0]);
    trocar(nova);
  };

  return (
    <div>
      <p style={{ fontSize: "0.84rem", color: "#64748B", margin: "0 0 14px", maxWidth: "62ch", lineHeight: 1.5 }}>
        Arraste para mudar a ordem, desligue o que não quer e escreva o que quiser. O papel ao lado
        mostra a largura exata que vai sair da sua impressora.
      </p>

      {/* ── O ASSISTENTE VELHO IGNORA O MODELO, E ISSO PRECISA ESTAR ESCRITO ──
          Sem este aviso o lojista monta a comanda, vê a prévia certinha, manda
          imprimir e recebe o layout de fábrica — e conclui que a tela está
          quebrada. O papel continua saindo normal, que é o que importa; o que
          falta é só a atualização. */}
      {ehMaisVelha(versaoInstalada, versaoMinima) && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "10px 13px", marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: "0.83rem", color: "#92400E", fontWeight: 700 }}>
            ⚠️ O Assistente desta máquina está na {versaoInstalada} e só lê o modelo a partir da {versaoMinima}.
          </p>
          <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#B45309", lineHeight: 1.5 }}>
            Pode montar a comanda à vontade: fica salva. Até o Assistente atualizar (ele faz
            isso sozinho em até 6 horas), o papel sai no layout de sempre.
          </p>
        </div>
      )}

      {/* ── Via e largura ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <label style={rotuloStyle}>QUAL VIA</label>
          <div style={{ display: "flex", gap: 8 }}>
            {([
              { chave: "completo" as const, nome: "Completa (entrega)" },
              { chave: "cozinha" as const, nome: "Cozinha (sem valores)" },
            ]).map((v) => (
              <button key={v.chave} type="button" onClick={() => setVia(v.chave)} style={botao(via === v.chave)}>
                {v.nome}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={rotuloStyle}>VER NA LARGURA DE</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LARGURAS.map((l) => (
              <button key={l.colunas} type="button" onClick={() => setColunas(l.colunas)} style={botao(colunas === l.colunas)}>
                {l.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 0.85fr)", gap: 18, alignItems: "start" }}
           className="comanda-grade">
        {/* ── A lista de blocos ────────────────────────────────────────── */}
        <div>
          <div style={{ border: BORDA, borderRadius: 12, overflow: "hidden" }}>
            {lista.map((bloco, i) => {
              const fixo = BLOCOS_OBRIGATORIOS.includes(bloco.tipo);
              const formatavel = aceitaFormato(bloco.tipo);
              return (
                <div
                  key={`${bloco.tipo}-${i}`}
                  draggable
                  onDragStart={() => setArrastando(i)}
                  onDragEnd={() => setArrastando(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); if (arrastando !== null) mover(arrastando, i); setArrastando(null); }}
                  style={{
                    display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 11px",
                    borderBottom: i === lista.length - 1 ? "none" : "1px solid #F1F5F9",
                    background: arrastando === i ? "#FEF2F2" : bloco.ligado ? "#fff" : "#F8FAFC",
                    opacity: arrastando === i ? 0.5 : 1,
                  }}
                >
                  <span title="Arraste para mudar a ordem" style={{ cursor: "grab", color: "#CBD5E1", fontSize: "1.05rem", lineHeight: 1.2, userSelect: "none" }}>⠿</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: bloco.ligado ? "#0F172A" : "#94A3B8", textDecoration: bloco.ligado ? "none" : "line-through" }}>
                      {NOME_DO_BLOCO[bloco.tipo]}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 1, lineHeight: 1.4 }}>
                      {AJUDA_DO_BLOCO[bloco.tipo]}
                    </div>

                    {aceitaTitulo(bloco.tipo) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 700 }}>Título:</span>
                        <input
                          value={bloco.titulo ?? ""}
                          onChange={(e) => mexerNoBloco(i, { titulo: e.target.value })}
                          placeholder="(sem título)"
                          style={{ flex: "1 1 140px", minWidth: 110, padding: "5px 8px", borderRadius: 7, border: BORDA, fontSize: "0.78rem", fontWeight: 700, fontFamily: "inherit" }}
                        />
                        {stepper(tamanhoValido(bloco.tamanho), (t) => mexerNoBloco(i, { tamanho: t }))}
                      </div>
                    )}

                    {bloco.tipo === "textoLivre" && (
                      <>
                        <textarea
                          value={bloco.texto ?? ""}
                          onChange={(e) => mexerNoBloco(i, { texto: e.target.value })}
                          rows={2}
                          placeholder="Ex.: Obrigado, {cliente}! Volte sempre."
                          style={{ width: "100%", marginTop: 7, padding: "7px 9px", borderRadius: 8, border: BORDA, fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.8rem", resize: "vertical" }}
                        />
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          {CAMPOS_DISPONIVEIS.map((c) => (
                            <button
                              key={c.chave}
                              type="button"
                              title={`Insere ${c.rotulo.toLowerCase()} aqui`}
                              onClick={() => mexerNoBloco(i, { texto: `${bloco.texto || ""}{${c.chave}}` })}
                              style={{ border: "1px dashed #CBD5E1", background: "transparent", color: "#64748B", borderRadius: 6, padding: "2px 7px", fontSize: "0.7rem", fontFamily: "ui-monospace, Consolas, monospace", cursor: "pointer" }}
                            >
                              {`{${c.chave}}`}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {formatavel && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7, alignItems: "center" }}>
                        <button type="button" onClick={() => mexerNoBloco(i, { negrito: !bloco.negrito })} style={chip(!!bloco.negrito)}>
                          <b>N</b> negrito
                        </button>
                        {stepper(tamanhoValido(bloco.tamanho), (t) => mexerNoBloco(i, { tamanho: t }))}
                        {(["esquerda", "centro", "direita"] as Alinhamento[]).map((a) => (
                          <button
                            key={a}
                            type="button"
                            title={`Alinhar à ${a}`}
                            onClick={() => mexerNoBloco(i, { alinhamento: a })}
                            style={chip((bloco.alinhamento || "esquerda") === a)}
                          >
                            {a === "esquerda" ? "⇤" : a === "centro" ? "↔" : "⇥"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", flexShrink: 0 }}>
                    <input
                      type="checkbox"
                      checked={bloco.ligado}
                      disabled={fixo}
                      title={fixo ? "Este bloco não pode ser desligado" : bloco.ligado ? "Não imprimir este bloco" : "Voltar a imprimir este bloco"}
                      onChange={(e) => mexerNoBloco(i, { ligado: e.target.checked })}
                      style={{ width: 17, height: 17, accentColor: VERMELHO, cursor: fixo ? "not-allowed" : "pointer" }}
                    />
                    <button type="button" title="Subir" onClick={() => mover(i, i - 1)} style={mini}>▲</button>
                    <button type="button" title="Descer" onClick={() => mover(i, i + 1)} style={mini}>▼</button>
                    {!fixo && (
                      <button type="button" title="Tirar da comanda" onClick={() => trocar(lista.filter((_, j) => j !== i))} style={mini}>✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" onClick={() => setMenuAberto((v) => !v)} style={botao(false)}>
              {menuAberto ? "Fechar" : "+ Adicionar bloco"}
            </button>
            <button
              type="button"
              onClick={() => { if (confirm("Voltar esta via ao modelo padrão do FireHub?")) onChange({ ...atual, [via]: modeloPadrao()[via] }); }}
              style={botao(false)}
            >
              Restaurar o padrão
            </button>
          </div>

          {menuAberto && (
            <div style={{ marginTop: 10, border: BORDA, borderRadius: 10, overflow: "hidden" }}>
              {(Object.keys(NOME_DO_BLOCO) as TipoDeBloco[]).map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => {
                    const novo: Bloco = { tipo, ligado: true };
                    if (tipo === "textoLivre") { novo.texto = "Obrigado pela preferência!"; novo.alinhamento = "centro"; }
                    trocar([...lista, novo]);
                    setMenuAberto(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #F1F5F9", background: "#fff", padding: "8px 12px", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <span style={{ fontWeight: 700, fontSize: "0.83rem", color: "#0F172A" }}>{NOME_DO_BLOCO[tipo]}</span>
                  <span style={{ display: "block", fontSize: "0.73rem", color: "#64748B", marginTop: 1 }}>{AJUDA_DO_BLOCO[tipo]}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── O papel ──────────────────────────────────────────────────── */}
        <div style={{ position: "sticky", top: 16 }}>
          <div style={{ ...rotuloStyle, marginBottom: 6 }}>COMO VAI SAIR — {colunas} COLUNAS</div>
          <div style={{ overflowX: "auto", background: "#F1F5F9", borderRadius: 12, padding: 12 }}>
            <pre style={{
              margin: 0, background: "#FFFDF8", color: "#1A1512", padding: "16px 10px 22px",
              fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
              fontSize: colunas > 44 ? "11.5px" : colunas > 36 ? "12.5px" : "14px",
              lineHeight: 1.42, whiteSpace: "pre", width: "max-content", minWidth: "100%",
              boxShadow: "0 2px 10px rgba(60,40,25,0.12)",
            }}>
              {papel || "(nenhum bloco ligado)"}
            </pre>
          </div>
          <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "8px 2px 0", lineHeight: 1.5 }}>
            Pedido de exemplo. A ordem, a largura e o tamanho das letras são exatamente os do papel;
            os itens e os valores vêm do pedido de verdade na hora de imprimir.
          </p>
        </div>
      </div>

      {/* Em tela estreita a prévia vai para baixo da lista, em vez de espremer as duas. */}
      <style>{`@media (max-width: 900px) { .comanda-grade { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

/* ─── Peças de interface ─────────────────────────────────────── */

const rotuloStyle: React.CSSProperties = {
  fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8",
  letterSpacing: "0.06em", display: "block", marginBottom: 5,
};

const mini: React.CSSProperties = {
  border: BORDA, background: "#fff", color: "#64748B", borderRadius: 6,
  width: 24, height: 20, fontSize: "0.68rem", lineHeight: 1, cursor: "pointer", padding: 0, fontFamily: "inherit",
};

function botao(ativo: boolean): React.CSSProperties {
  return {
    padding: "7px 13px", borderRadius: 9,
    border: `1.5px solid ${ativo ? VERMELHO : "#E2E8F0"}`,
    background: ativo ? "#C6282810" : "#fff",
    color: ativo ? VERMELHO : "#64748B",
    fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
  };
}

function chip(ativo: boolean): React.CSSProperties {
  return {
    border: `1px solid ${ativo ? VERMELHO : "#E2E8F0"}`,
    background: ativo ? VERMELHO : "#F8FAFC",
    color: ativo ? "#fff" : "#64748B",
    borderRadius: 7, padding: "3px 8px", fontSize: "0.72rem",
    fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };
}

/**
 * O controle de tamanho da letra.
 *
 * Anda pela escada 1 / 1,5 / 2 / 3 em vez de aceitar número livre: são os
 * únicos degraus que a impressora térmica consegue de verdade (ver o comentário
 * de `Tamanho` em lib/comanda-modelo.ts). Deixar digitar 2,5 seria prometer o
 * que o papel não entrega.
 */
function stepper(valor: number, aoMudar: (t: (typeof TAMANHOS)[number]) => void) {
  const i = TAMANHOS.indexOf(valor as (typeof TAMANHOS)[number]);
  const passo: React.CSSProperties = {
    border: "none", background: "transparent", color: "#64748B",
    cursor: "pointer", padding: "0 3px", fontWeight: 800, fontSize: "0.8rem", lineHeight: 1, fontFamily: "inherit",
  };
  return (
    <span
      title="Tamanho da letra. A impressora só consegue estes degraus: 1x, 1,5x, 2x e 3x — quanto maior, menos letras cabem na linha."
      style={{ display: "inline-flex", alignItems: "center", gap: 4, border: BORDA, background: "#F8FAFC", borderRadius: 7, padding: "2px 6px" }}
    >
      <button type="button" onClick={() => aoMudar(TAMANHOS[Math.max(0, i - 1)])} style={passo}>A−</button>
      <b style={{ fontSize: "0.72rem", fontFamily: "ui-monospace, Consolas, monospace", minWidth: "2.4em", textAlign: "center", color: "#0F172A" }}>
        {String(valor).replace(".", ",")}×
      </b>
      <button type="button" onClick={() => aoMudar(TAMANHOS[Math.min(TAMANHOS.length - 1, i + 1)])} style={passo}>A+</button>
    </span>
  );
}
