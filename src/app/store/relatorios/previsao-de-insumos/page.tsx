import PrevisaoDeInsumosClient from "./PrevisaoDeInsumosClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function PrevisaoDeInsumosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <PrevisaoDeInsumosClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
