"use client";
/**
 * A barra de filtros de todo relatório — os filtros da Saipos, no mesmo lugar
 * em toda tela: período (com atalhos), horário, tipo de venda, canal, marca,
 * loja, categoria e produto. Cada relatório liga só os que fazem sentido nele.
 *
 * Nada marcado = TODOS (a regra de FiltroMultiplo). O relatório que zera
 * porque alguém desmarcou o último item pareceria quebrado.
 */
import React from "react";
import FiltroMultiplo from "@/components/customer/FiltroMultiplo";
import { PALETA } from "@/lib/paleta-brasa";
import {
  ATALHOS, atalhoDoPeriodo, periodoDoAtalho, TIPOS_DE_VENDA, ROTULO_DO_TIPO,
  type FiltrosDoRelatorio, type TipoDeVenda,
} from "@/lib/relatorios/base";
import type { OpcoesDosFiltros } from "@/components/relatorios/useRelatorio";

export type FiltrosVisiveis = Partial<Record<"horario" | "tipos" | "canais" | "marcas" | "lojas" | "categorias" | "produtos", boolean>>;

const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: PALETA.areiaTinta, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
const campo: React.CSSProperties = { padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", background: "#fff", color: PALETA.carvao };

export default function BarraDeFiltros({
  filtros, mudar, opcoes, hoje: hojeDaLoja, visiveis = {}, children,
}: {
  filtros: FiltrosDoRelatorio;
  /** "Hoje" no dia operacional da loja (vem do servidor — lib/relatorios/pagina.ts). */
  hoje?: string;
  mudar: (parcial: Partial<FiltrosDoRelatorio>) => void;
  opcoes: OpcoesDosFiltros | null;
  visiveis?: FiltrosVisiveis;
  /** Controles próprios do relatório (agrupamentos, por exemplo), abaixo dos filtros. */
  children?: React.ReactNode;
}) {
  const hoje = hojeDaLoja || opcoes?.hoje || filtros.ate;
  const ativo = atalhoDoPeriodo(filtros.de, filtros.ate, hoje);
  const v = { horario: true, tipos: true, canais: true, marcas: true, lojas: true, ...visiveis };

  const alternarTipo = (t: TipoDeVenda) => {
    const tem = filtros.tipos.includes(t);
    mudar({ tipos: tem ? filtros.tipos.filter((x) => x !== t) : [...filtros.tipos, t] });
  };

  return (
    <section className="fh-sem-impressao" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "1rem 1.1rem", marginBottom: "1.25rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      {/* Período */}
      <div>
        <div style={rotulo}>Período</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {ATALHOS.map((a) => (
            <button
              key={a.chave}
              type="button"
              onClick={() => mudar(periodoDoAtalho(a.chave, hoje))}
              aria-pressed={ativo === a.chave}
              style={{
                padding: "6px 12px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                border: `1.5px solid ${ativo === a.chave ? PALETA.carvao : PALETA.areiaBorda}`,
                background: ativo === a.chave ? PALETA.carvao : "#fff",
                color: ativo === a.chave ? "#fff" : PALETA.carvao2,
              }}
            >
              {a.rotulo}
            </button>
          ))}
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: 4 }}>
            <input type="date" name="de" aria-label="Data inicial" value={filtros.de} max={filtros.ate}
              onChange={(e) => e.target.value && mudar({ de: e.target.value })} style={campo} />
            <span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>até</span>
            <input type="date" name="ate" aria-label="Data final" value={filtros.ate} min={filtros.de}
              onChange={(e) => e.target.value && mudar({ ate: e.target.value })} style={campo} />
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem 1.4rem", alignItems: "flex-end" }}>
        {v.horario && (
          <div>
            <div style={rotulo} title="O turno: das 18:00 às 02:00 atravessa a meia-noite.">Horário</div>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="time" name="horaDe" aria-label="Horário inicial" value={filtros.horaDe} onChange={(e) => mudar({ horaDe: e.target.value })} style={campo} />
              <span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>às</span>
              <input type="time" name="horaAte" aria-label="Horário final" value={filtros.horaAte} onChange={(e) => mudar({ horaAte: e.target.value })} style={campo} />
              {(filtros.horaDe || filtros.horaAte) && (
                <button type="button" onClick={() => mudar({ horaDe: "", horaAte: "" })}
                  style={{ border: "none", background: "none", color: PALETA.marca, fontWeight: 700, cursor: "pointer", fontSize: "0.78rem" }}>
                  dia todo
                </button>
              )}
            </span>
          </div>
        )}

        {v.tipos && (
          <div>
            <div style={rotulo}>Tipo de venda</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {TIPOS_DE_VENDA.map((t) => {
                // Nada marcado = todos marcados, como os checkboxes da Saipos.
                const marcado = filtros.tipos.length === 0 || filtros.tipos.includes(t);
                return (
                  <label key={t} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, cursor: "pointer",
                    border: `1.5px solid ${marcado ? PALETA.carvao2 : PALETA.areiaBorda}`, fontSize: "0.82rem", fontWeight: 700,
                    color: marcado ? PALETA.carvao : PALETA.areiaTinta, background: "#fff",
                  }}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => {
                        if (filtros.tipos.length === 0) mudar({ tipos: TIPOS_DE_VENDA.filter((x) => x !== t) });
                        else alternarTipo(t);
                      }}
                      style={{ accentColor: PALETA.carvao }}
                    />
                    {ROTULO_DO_TIPO[t]}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "0.8rem" }}>
        {v.canais && opcoes && (
          <FiltroMultiplo rotulo="📱 Canal / origem" nomeDoTipo="canais" textoTodos={`Todos os canais (${opcoes.canais.length})`}
            opcoes={opcoes.canais.map((c) => ({ valor: c.chave, rotulo: c.rotulo }))}
            selecionados={filtros.canais} onChange={(canais) => mudar({ canais })} />
        )}
        {v.marcas && opcoes && opcoes.marcas.length > 1 && (
          <FiltroMultiplo rotulo="🏷️ Marcas" nomeDoTipo="marcas" textoTodos={`Todas as marcas (${opcoes.marcas.length})`}
            opcoes={opcoes.marcas.map((m) => ({ valor: m.chave, rotulo: m.rotulo }))}
            selecionados={filtros.marcas} onChange={(marcas) => mudar({ marcas })} />
        )}
        {v.lojas && opcoes && opcoes.lojasDaConta.length > 1 && (
          <FiltroMultiplo rotulo="🏪 Lojas" nomeDoTipo="lojas" textoTodos="A loja ativa"
            opcoes={opcoes.lojasDaConta.map((l) => ({ valor: l.id, rotulo: l.nome }))}
            selecionados={filtros.lojas} onChange={(lojas) => mudar({ lojas })} />
        )}
        {v.categorias && opcoes && (
          <FiltroMultiplo rotulo="🍔 Categoria" nomeDoTipo="categorias" placeholderBusca="buscar categoria…"
            textoTodos={`Todas as categorias (${opcoes.categorias.length})`}
            opcoes={opcoes.categorias.map((c) => ({ valor: c, rotulo: c }))}
            selecionados={filtros.categorias} onChange={(categorias) => mudar({ categorias })} />
        )}
        {v.produtos && opcoes && (
          <FiltroMultiplo rotulo="🔍 Produto" nomeDoTipo="produtos" placeholderBusca="buscar produto…"
            textoTodos={`Todos os produtos (${opcoes.produtos.length})`}
            opcoes={opcoes.produtos
              .filter((p) => filtros.categorias.length === 0 || filtros.categorias.includes(p.categoria))
              .map((p) => ({ valor: p.id, rotulo: p.nome, detalhe: p.categoria }))}
            selecionados={filtros.produtos} onChange={(produtos) => mudar({ produtos })} />
        )}
      </div>

      {children}
    </section>
  );
}
