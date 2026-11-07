import SugestaoDeComprasClient from "./SugestaoDeComprasClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function SugestaoDeComprasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <SugestaoDeComprasClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
