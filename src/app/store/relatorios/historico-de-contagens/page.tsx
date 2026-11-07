import HistoricoDeContagensClient from "./HistoricoDeContagensClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function HistoricoDeContagensPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <HistoricoDeContagensClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
