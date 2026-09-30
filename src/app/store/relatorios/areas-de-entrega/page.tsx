import AreasDeEntregaClient from "./AreasDeEntregaClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function AreasDeEntregaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <AreasDeEntregaClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
