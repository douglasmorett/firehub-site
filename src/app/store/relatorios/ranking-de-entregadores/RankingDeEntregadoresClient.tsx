"use client";
/**
 * Ranking de entregadores — o relatório. A conta é de
 * lib/relatorios/ranking-de-entregadores.ts e o desenho é o mesmo da aba
 * Ranking da tela Motoboys (components/relatorios/RankingDeEntregadores).
 */
import BarraDeFiltros from "@/components/relatorios/BarraDeFiltros";
import ModeloDoRelatorio from "@/components/relatorios/ModeloDoRelatorio";
import RankingDeEntregadores, { type RespostaDoRanking } from "@/components/relatorios/RankingDeEntregadores";
import { useFiltros, useOpcoesDosFiltros, useRelatorio, type InicioDosFiltros } from "@/components/relatorios/useRelatorio";

export default function RankingDeEntregadoresClient({ inicio }: { inicio: InicioDosFiltros }) {
  const opcoes = useOpcoesDosFiltros();
  const { filtros, mudar, query } = useFiltros(inicio, "7d");
  const { dados, carregando, erro, recarregar } = useRelatorio<RespostaDoRanking>("ranking-de-entregadores", query);

  return (
    <ModeloDoRelatorio
      titulo="Ranking de entregadores"
      descricao="Quem é o melhor motoboy do período e por quê: entregas, cancelados com ele, tempo de entrega, entregas no prazo, coleta e o tempo que ele leva para voltar e pegar o próximo pedido. Mesma conta da aba Ranking da tela Motoboys."
      slug="ranking-de-entregadores" query={query} periodo={dados?.periodo} carregando={carregando} erro={erro} onRecarregar={recarregar}>
      <BarraDeFiltros filtros={filtros} mudar={mudar} opcoes={opcoes} hoje={inicio.hoje} visiveis={{ horario: false, tipos: false, canais: false, marcas: false }} />
      {dados && <RankingDeEntregadores dados={dados} />}
    </ModeloDoRelatorio>
  );
}
