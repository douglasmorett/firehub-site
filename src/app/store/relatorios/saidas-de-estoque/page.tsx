import SaidasDeEstoqueClient from "./SaidasDeEstoqueClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function SaidasDeEstoquePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <SaidasDeEstoqueClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
