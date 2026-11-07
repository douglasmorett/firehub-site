import ContasAReceberClient from "./ContasAReceberClient";
import { acessoAoRelatorio, queryDaPagina } from "@/lib/relatorios/pagina";
import { somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";

export default async function ContasAReceberPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { hoje } = await acessoAoRelatorio();
  // O calendário é do MÊS: sem período na URL, o mês de hoje inteiro.
  const u = new URLSearchParams(queryDaPagina(await searchParams));
  if (!u.get("de")) {
    u.set("de", `${hoje.slice(0, 7)}-01`);
    u.set("ate", somarDias(`${somarDias(`${hoje.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1));
  }
  return <ContasAReceberClient inicio={{ query: u.toString(), hoje }} />;
}
