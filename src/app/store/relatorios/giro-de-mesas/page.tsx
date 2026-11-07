import GiroDeMesasClient from "./GiroDeMesasClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function GiroDeMesasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <GiroDeMesasClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
