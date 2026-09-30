import ItensConsumidosClient from "./ItensConsumidosClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function ItensConsumidosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <ItensConsumidosClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
