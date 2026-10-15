import AcertoDeEntregadoresClient from "./AcertoDeEntregadoresClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function AcertoDeEntregadoresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <AcertoDeEntregadoresClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
