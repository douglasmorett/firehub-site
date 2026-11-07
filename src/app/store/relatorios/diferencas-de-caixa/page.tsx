import DiferencasDeCaixaClient from "./DiferencasDeCaixaClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function DiferencasDeCaixaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <DiferencasDeCaixaClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
