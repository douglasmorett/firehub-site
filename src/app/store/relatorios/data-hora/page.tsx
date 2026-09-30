import DataHoraClient from "./DataHoraClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function DataHoraPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <DataHoraClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
