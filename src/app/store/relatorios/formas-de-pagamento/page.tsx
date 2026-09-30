import FormasDePagamentoClient from "./FormasDePagamentoClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function FormasDePagamentoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <FormasDePagamentoClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
