import ItensVendidosClient from "./ItensVendidosClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function ItensVendidosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <ItensVendidosClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
