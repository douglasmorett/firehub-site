import VendasClient from "./VendasClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";
import { semFiltrosDeItem } from "@/lib/relatorios/vendas";

export const dynamic = "force-dynamic";

export default async function VendasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  // Categoria e produto são filtros de ITEM: chegam pelo link do Itens vendidos
  // e aqui não se aplicam nem aparecem na barra (ver semFiltrosDeItem).
  return <VendasClient inicio={{ query: semFiltrosDeItem(queryDaPagina(await searchParams)), hoje }} />;
}
