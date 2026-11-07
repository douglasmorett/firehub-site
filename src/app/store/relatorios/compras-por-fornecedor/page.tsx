import ComprasPorFornecedorClient from "./ComprasPorFornecedorClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function ComprasPorFornecedorPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <ComprasPorFornecedorClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
