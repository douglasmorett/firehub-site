import FalhasDeIntegracaoClient from "./FalhasDeIntegracaoClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";

export const dynamic = "force-dynamic";

export default async function FalhasDeIntegracaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  return <FalhasDeIntegracaoClient inicio={{ query: queryDaPagina(await searchParams), hoje }} />;
}
