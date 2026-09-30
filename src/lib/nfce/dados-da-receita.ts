/**
 * /src/lib/nfce/dados-da-receita.ts
 *
 * Os dados da empresa que a Receita Federal publica (consulta pública do CNPJ,
 * /api/cnpj-lookup → BrasilAPI ou ReceitaWS), no formato do cadastro fiscal —
 * como SUGESTÃO a confirmar.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * O emitente vai no XML de toda nota: razão social, endereço, o código IBGE do
 * município (é ele que a SEFAZ confere com a UF) e o regime (CRT). O lojista
 * digitava isso de memória — a NIK tinha "Nik Esfiharia" onde a Receita diz
 * NIK COMERCIO DE ALIMENTOS LTDA. A Receita já tem quase tudo; o que ela NÃO
 * tem é a Inscrição Estadual (é do estado), e a tela diz isso.
 *
 * Nada aqui grava: a tela mostra cada valor ao lado do campo ("Sugestão
 * (Receita Federal): … Usar esta"), e só vira dado quando o lojista usa e
 * salva — a mesma regra das outras sugestões (lib/fiscal-config →
 * sugestoesDoCadastro).
 *
 * ── Regime ──────────────────────────────────────────────────────────────────
 *
 * Optante pelo MEI → CRT 4; optante pelo Simples → CRT 1. O CRT 2 (Simples com
 * excesso de sublimite) não aparece na consulta pública — por isso é sugestão,
 * com o aviso. Fora do Simples é Regime Normal (CRT 3), que o FireHub ainda
 * não emite.
 *
 * Puro: a tela importa.
 */

export type RespostaDoCnpj = {
  cnpj?: string;
  razao_social?: string;
  nome_fantasia?: string;
  situacao?: string;
  municipio?: string;
  uf?: string;
  bairro?: string;
  logradouro?: string;
  numero?: string;
  cep?: string;
  tipo_logradouro?: string;
  complemento?: string;
  codigo_municipio_ibge?: string;
  opcao_pelo_simples?: boolean | null;
  opcao_pelo_mei?: boolean | null;
  porte?: string;
  cnae_fiscal?: string;
  cnae_fiscal_descricao?: string;
};

export type SugestoesDaReceita = {
  cnpj: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  codigoMunicipio?: string;
  uf?: string;
  cep?: string;
  /** 1 Simples, 4 MEI; null = fora do Simples; ausente = a consulta não disse. */
  regimeTributario?: 1 | 4 | null;
  situacao: string;
  ativa: boolean;
  porte?: string;
  atividade?: string;
  avisos: string[];
};

const t = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v === null || v === undefined ? "" : String(v).trim());

/** Compara ignorando caixa, acento e espaços — "Brasília" e "BRASILIA" são o mesmo. */
export function mesmoTexto(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => t(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^0-9A-Z]+/g, " ").trim();
  return n(a) === n(b);
}

export function sugestoesDaReceita(bruto: unknown): SugestoesDaReceita | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as RespostaDoCnpj;
  const cnpj = t(r.cnpj).toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cnpj.length !== 14) return null;

  const avisos: string[] = [];
  const situacao = t(r.situacao).toUpperCase();
  const ativa = !situacao || situacao === "ATIVA";
  if (!ativa) avisos.push(`A Receita mostra o CNPJ como ${situacao}: a SEFAZ recusa nota de CNPJ que não está ativo.`);

  // "QUADRA" + "5 COMERCIO LOCAL": o tipo vem separado na consulta, e no
  // cartão CNPJ (e na nota) o logradouro é o conjunto.
  const tipo = t(r.tipo_logradouro);
  const logradouroSo = t(r.logradouro);
  const logradouro = tipo && logradouroSo && !mesmoTexto(logradouroSo.split(" ")[0], tipo) ? `${tipo} ${logradouroSo}` : logradouroSo;

  const cepDigitos = t(r.cep).replace(/\D/g, "");
  const ibge = t(r.codigo_municipio_ibge).replace(/\D/g, "");
  let regimeTributario: SugestoesDaReceita["regimeTributario"];
  if (r.opcao_pelo_mei === true) regimeTributario = 4;
  else if (r.opcao_pelo_simples === true) regimeTributario = 1;
  else if (r.opcao_pelo_simples === false && r.opcao_pelo_mei === false) regimeTributario = null;
  if (regimeTributario === 1) {
    avisos.push("Optante pelo Simples: CRT 1. Se a empresa passou do sublimite do ICMS no ano, o regime da nota é o CRT 2 — confirme com o contador.");
  } else if (regimeTributario === null) {
    avisos.push("A Receita diz que a empresa não é do Simples nem MEI (Regime Normal, CRT 3) — o FireHub ainda não emite NFC-e para esse regime.");
  }
  if (!ibge) avisos.push("A consulta não trouxe o código IBGE do município: digite os 7 dígitos (busque \"código IBGE\" + a cidade).");

  return {
    cnpj,
    ...(t(r.razao_social) ? { razaoSocial: t(r.razao_social) } : {}),
    ...(t(r.nome_fantasia) ? { nomeFantasia: t(r.nome_fantasia) } : {}),
    ...(logradouro ? { logradouro } : {}),
    // Sem número no cadastro da Receita: "S/N", que é o que a nota aceita.
    ...(logradouro ? { numero: t(r.numero) || "S/N" } : {}),
    ...(t(r.complemento) ? { complemento: t(r.complemento) } : {}),
    ...(t(r.bairro) ? { bairro: t(r.bairro) } : {}),
    ...(t(r.municipio) ? { municipio: t(r.municipio) } : {}),
    ...(ibge.length === 7 ? { codigoMunicipio: ibge } : {}),
    ...(t(r.uf) ? { uf: t(r.uf).toUpperCase() } : {}),
    ...(cepDigitos.length === 8 ? { cep: `${cepDigitos.slice(0, 5)}-${cepDigitos.slice(5)}` } : {}),
    ...(regimeTributario !== undefined ? { regimeTributario } : {}),
    situacao: situacao || "—",
    ativa,
    ...(t(r.porte) ? { porte: t(r.porte) } : {}),
    ...(t(r.cnae_fiscal) ? { atividade: `${t(r.cnae_fiscal)}${t(r.cnae_fiscal_descricao) ? ` — ${t(r.cnae_fiscal_descricao)}` : ""}` } : {}),
    avisos,
  };
}
