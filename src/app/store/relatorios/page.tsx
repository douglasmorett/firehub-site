import MenuDeRelatorios from "@/components/relatorios/MenuDeRelatorios";
import { acessoAoRelatorio } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

/**
 * /store/relatorios — o menu de relatórios, como o da Saipos: seções, busca e
 * favoritos. O painel que morava aqui (faturamento, ranking, plataformas,
 * tempos) é o primeiro item do menu, em /store/relatorios/painel.
 */
export default async function RelatoriosPage() {
  const { nomeDaLoja } = await acessoAoRelatorio();
  return <MenuDeRelatorios nomeDaLoja={nomeDaLoja} />;
}
