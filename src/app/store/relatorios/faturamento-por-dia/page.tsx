import FaturamentoPorDiaClient from "./FaturamentoPorDiaClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function FaturamentoPorDiaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <FaturamentoPorDiaClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
