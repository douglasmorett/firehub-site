import FluxoDeCaixaClient from "./FluxoDeCaixaClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";
import { somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";

export default async function FluxoDeCaixaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  // O fluxo olha para a FRENTE: sem período na URL, hoje e os próximos 29 dias.
  const u = new URLSearchParams(queryDaPagina(await searchParams));
  if (!u.get("de")) { u.set("de", hoje); u.set("ate", somarDias(hoje, 29)); }
  return <FluxoDeCaixaClient inicio={{ query: u.toString(), hoje }} />;
}
