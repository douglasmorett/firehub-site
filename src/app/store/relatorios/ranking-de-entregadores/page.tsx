import RankingDeEntregadoresClient from "./RankingDeEntregadoresClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function RankingDeEntregadoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <RankingDeEntregadoresClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
