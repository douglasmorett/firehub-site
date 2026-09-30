"use client";
/**
 * Itens vendidos — a tela do relatório da Saipos que os lojistas pediram
 * (NIK, 24/09/2026). A conta mora em lib/relatorios/itens-vendidos.ts; aqui
 * são os filtros, os agrupamentos e as duas tabelas.
 *
 * Diferença de propósito para a Saipos: não há botão BUSCAR. Trocar um filtro
 * ou um agrupamento já refaz o relatório — lá o lojista precisa lembrar de
 * clicar de novo ("Lembre-se de clicar novamente em BUSCAR", diz a ajuda deles).
 */
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import { fmtQtd, fmtReais } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio, { Cartao, GradeDeCartoes } from "@/components/relatorios/ModeloDoRelatorio";
import TabelaEmArvore, { chavesAbriveis, filtrarArvore, type NoDaArvore } from "@/components/relatorios/TabelaEmArvore";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

type Resposta = {
  lojas: string[];
  periodo: { de: string; ate: string };
  pedidos: number;
  linhas: number;
  itens: NoDaArvore[];
  opcoes: NoDaArvore[] | null;
  total: { quantidade: number; valor: number };
  gruposDeOpcao: { chave: string; nome: string; quantidade: number }[];
};

const caixa: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.86rem", fontWeight: 600, cursor: "pointer", color: PALETA.carvao };

export default function ItensVendidosClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, extras, mudarExtra, query } = useFiltros(inicio, "7d", {
    porCategoria: "1", opcoesPorProduto: "1", apenasProdutos: "", juntarNome: "", pctPor: "", gruposOcultos: "",
  });
  const { dados, carregando, erro, recarregar } = useRelatorio<Resposta>("itens-vendidos", query);

  const porCategoria = extras.porCategoria === "1";
  const opcoesPorProduto = extras.opcoesPorProduto === "1";
  const apenasProdutos = extras.apenasProdutos === "1";
  const juntarNome = extras.juntarNome !== "0";
  const pctPorValor = extras.pctPor === "valor";
  const gruposOcultos = new Set((extras.gruposOcultos || "").split(",").filter(Boolean));

  const [verFiltragem, setVerFiltragem] = useState(false);
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbertos((a) => { const n = new Set(a); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Ao trocar o agrupamento, as categorias vêm abertas — é o que o lojista
  // quer ver primeiro (a tela do vídeo da NIK).
  useEffect(() => { setAbertos(new Set()); }, [porCategoria, opcoesPorProduto, apenasProdutos, juntarNome]);

  const itens = useMemo(() => filtrarArvore(dados?.itens || [], busca), [dados, busca]);
  const listaDeOpcoes = useMemo(() => (dados?.opcoes ? filtrarArvore(dados.opcoes, busca) : null), [dados, busca]);
  const todasAbertas = useMemo(() => [...chavesAbriveis(itens), ...(listaDeOpcoes ? chavesAbriveis(listaDeOpcoes) : [])], [itens, listaDeOpcoes]);

  const tituloDaTabela = opcoesPorProduto ? "Itens e opções" : "Itens";
  const produtos = useMemo(() => {
    let n = 0;
    const contar = (nos: NoDaArvore[]) => { for (const x of nos) { if (x.tipo === "produto") n++; if (x.filhos) contar(x.filhos); } };
    contar(dados?.itens || []);
    return n;
  }, [dados]);

  return (
    <ModeloDoRelatorio
      titulo="Itens vendidos"
      descricao="Quantos de cada produto saíram — e, dentro deles, quantos de cada sabor, borda e adicional. O valor do produto já inclui as opções escolhidas nele."
      slug="itens-vendidos" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>

      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ categorias: true, produtos: true }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem 1.6rem", alignItems: "center", borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: "0.8rem" }}>
          <label style={caixa}>
            <input type="checkbox" checked={porCategoria} onChange={(e) => mudarExtra("porCategoria", e.target.checked ? "1" : "")} style={{ accentColor: PALETA.carvao }} />
            Agrupar produtos por categoria
          </label>
          <label style={{ ...caixa, opacity: apenasProdutos ? 0.45 : 1 }} title={apenasProdutos ? "Não combina com “apenas produtos”" : undefined}>
            <input type="checkbox" checked={opcoesPorProduto && !apenasProdutos} disabled={apenasProdutos}
              onChange={(e) => mudarExtra("opcoesPorProduto", e.target.checked ? "1" : "")} style={{ accentColor: PALETA.carvao }} />
            Agrupar opções por produto
          </label>
          <label style={caixa} title="A Coca escolhida dentro do combo soma na linha da Coca vendida sozinha.">
            <input type="checkbox" checked={apenasProdutos} onChange={(e) => mudarExtra("apenasProdutos", e.target.checked ? "1" : "")} style={{ accentColor: PALETA.carvao }} />
            Agrupar apenas produtos
          </label>
          <label style={caixa} title="O mesmo produto vindo do iFood, da Wabiz e do balcão vira uma linha só.">
            <input type="checkbox" checked={juntarNome} onChange={(e) => mudarExtra("juntarNome", e.target.checked ? "" : "0")} style={{ accentColor: PALETA.carvao }} />
            Juntar produtos de mesmo nome
          </label>
          <span style={{ display: "inline-flex", gap: 12, alignItems: "center", fontSize: "0.86rem" }}>
            <span style={{ fontWeight: 800, color: PALETA.areiaTinta, fontSize: "0.72rem", textTransform: "uppercase" }}>% pela</span>
            <label style={caixa}><input type="radio" name="pct" checked={!pctPorValor} onChange={() => mudarExtra("pctPor", "")} style={{ accentColor: PALETA.carvao }} /> quantidade</label>
            <label style={caixa}><input type="radio" name="pct" checked={pctPorValor} onChange={() => mudarExtra("pctPor", "valor")} style={{ accentColor: PALETA.carvao }} /> valor</label>
          </span>
        </div>

        {!apenasProdutos && (dados?.gruposDeOpcao?.length || 0) > 0 && (
          <div>
            <button type="button" onClick={() => setVerFiltragem((v) => !v)} aria-expanded={verFiltragem}
              style={{ border: `1.5px solid ${PALETA.areiaBorda}`, background: "#fff", borderRadius: 10, padding: "6px 12px", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", color: PALETA.carvao2, fontFamily: "inherit" }}>
              Filtragem de opções {gruposOcultos.size ? `(${gruposOcultos.size} escondido${gruposOcultos.size > 1 ? "s" : ""})` : ""} {verFiltragem ? "▴" : "▾"}
            </button>
            {verFiltragem && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.2rem", marginTop: 10 }}>
                {dados!.gruposDeOpcao.map((g) => (
                  <label key={g.chave} style={caixa}>
                    <input type="checkbox" checked={!gruposOcultos.has(g.chave)} style={{ accentColor: PALETA.carvao }}
                      onChange={(e) => {
                        const n = new Set(gruposOcultos);
                        if (e.target.checked) n.delete(g.chave); else n.add(g.chave);
                        mudarExtra("gruposOcultos", [...n].join(","));
                      }} />
                    {g.nome} <span style={{ color: PALETA.areiaTinta, fontWeight: 500 }}>({fmtQtd(g.quantidade)})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </BarraDeFiltros>

      {dados && (
        <GradeDeCartoes>
          <Cartao rotulo="Itens vendidos" valor={fmtQtd(dados.total.quantidade)} detalhe={`${produtos} produto${produtos === 1 ? "" : "s"} diferente${produtos === 1 ? "" : "s"}`} />
          <Cartao rotulo="Total dos itens" valor={fmtReais(dados.total.valor)} detalhe="Produtos + opções, sem taxa de entrega e sem desconto" />
          <Cartao rotulo="Pedidos" valor={dados.pedidos.toLocaleString("pt-BR")} detalhe="Cancelados não entram" />
        </GradeDeCartoes>
      )}

      <div className="fh-sem-impressao" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: "0.8rem" }}>
        <input name="busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou opção…" aria-label="Buscar produto ou opção"
          style={{ padding: "8px 12px", borderRadius: 10, border: `1.5px solid ${PALETA.areiaBorda}`, fontSize: "0.85rem", fontFamily: "inherit", minWidth: 240 }} />
        <button type="button" className="btn btn-outline" style={{ padding: "7px 12px" }} onClick={() => setAbertos(new Set(todasAbertas))}>Abrir tudo</button>
        <button type="button" className="btn btn-outline" style={{ padding: "7px 12px" }} onClick={() => setAbertos(new Set())}>Fechar tudo</button>
      </div>

      {dados && (
        <div style={{ display: "grid", gridTemplateColumns: listaDeOpcoes ? "repeat(auto-fit, minmax(380px, 1fr))" : "1fr", gap: "1rem", alignItems: "start" }}>
          <TabelaEmArvore titulo={tituloDaTabela} nos={itens} total={dados.total} abertos={abertos} alternar={alternar}
            textoVazio={busca ? `Nada com “${busca}”.` : "Nenhum item vendido no período e filtros escolhidos."} rotuloPct={pctPorValor ? "% valor" : "%"} />
          {listaDeOpcoes && (
            <TabelaEmArvore titulo="Opções" nos={listaDeOpcoes} abertos={abertos} alternar={alternar} cor={PALETA.brasa}
              textoVazio="Nenhuma opção escolhida." rotuloPct={pctPorValor ? "% valor" : "%"} />
          )}
        </div>
      )}

      <p style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: "1rem", lineHeight: 1.5 }}>
        Meia pizza conta <strong>0,5</strong> de cada sabor. O percentual é {pctPorValor ? "pelo valor" : "pela quantidade"}, dentro do nível de cima
        (a categoria no total, o produto na categoria, a opção entre as opções do produto). As opções não se somam aos itens: o valor delas já está no produto.
        O total confere com o total dos itens de <Link href={`/store/relatorios/vendas?${query}`} style={{ color: PALETA.marca, fontWeight: 700 }}>Vendas por período</Link>.
      </p>
    </ModeloDoRelatorio>
  );
}
