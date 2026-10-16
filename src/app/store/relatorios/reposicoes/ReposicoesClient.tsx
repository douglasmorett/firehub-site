"use client";
/**
 * Reposições (faltou item e troca) — quantas, quanto isso representa nas
 * vendas e quanto custou refazer e entregar de novo. A conta mora em
 * lib/relatorios/reposicoes.ts; aqui são os filtros e a busca. O desenho está
 * em CorpoDasReposicoes.tsx.
 */
import React from "react";
import { filtrosParaQuery } from "@/lib/relatorios/base";
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio from "@/components/relatorios/ModeloDoRelatorio";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";
import CorpoDasReposicoes, { type RespostaDasReposicoes } from "./CorpoDasReposicoes";

export default function ReposicoesClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "30d");
  const { dados, carregando, erro, recarregar } = useRelatorio<RespostaDasReposicoes>("reposicoes", filtrosParaQuery(filtros));

  return (
    <ModeloDoRelatorio
      titulo="Reposições (faltou item e troca)"
      descricao="Quantas vezes faltou item ou veio errado, quanto isso representa nas vendas e quanto custou refazer e mandar o motoboy de novo."
      slug="reposicoes" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} />
      {dados && <CorpoDasReposicoes dados={dados} />}
    </ModeloDoRelatorio>
  );
}
