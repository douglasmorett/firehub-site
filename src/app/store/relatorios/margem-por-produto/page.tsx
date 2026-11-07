import MargemPorProdutoClient from "./MargemPorProdutoClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function MargemPorProdutoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <MargemPorProdutoClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
