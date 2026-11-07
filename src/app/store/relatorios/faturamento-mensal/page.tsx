import FaturamentoMensalClient from "./FaturamentoMensalClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function FaturamentoMensalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <FaturamentoMensalClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
