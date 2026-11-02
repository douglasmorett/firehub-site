/**
 * A BASE DE ENDEREÇOS DO IBGE NO BANCO — a parte que lê (lib/enderecos-ibge.ts
 * é a regra pura; scripts/importar-ibge.ts é quem grava).
 *
 * Três tabelas próprias, por SQL cru e fora do schema.prisma (como a dos
 * lançamentos do cashback): o boot as cria, a importação as enche por
 * município, e se faltarem — ou o município da loja não estiver importado — a
 * busca devolve null e a cascata do mapa segue IGUAL à de antes.
 *
 *   "IbgeMunicipio" — os municípios importados (código IBGE, nome, UF).
 *   "IbgeRua"       — um trecho de rua por (tipo, nome, localidade) com os
 *                     números e os pontos em arrays (Cabo Frio: 3,8 mil linhas).
 *   "IbgeBairro"    — o centro de cada bairro (localidade do CNEFE) e, quando o
 *                     município tem bairro oficial na malha do Censo 2022, o
 *                     polígono simplificado.
 *
 * Na memória do processo fica só o ÍNDICE do município (tipo, chave e bairro
 * de cada trecho, sem os pontos) e os bairros; os pontos vêm do banco só para
 * os trechos de nome parecido com o que o cliente escreveu.
 */
import { prisma } from "./prisma";
import { executarDDL } from "./ddl-do-boot";
import { DDL_DO_IBGE } from "./enderecos-ibge-ddl";
import {
  acharNoIbge,
  bairroDoPonto,
  casamentoDoNome,
  mesmoBairro,
  NOME_GENERICO,
  nomeComAcento,
  normalizar,
  numeroDaCasa,
  primeiroPedaco,
  separarLogradouro,
  type BairroDaMalha,
  type Ponto,
  type RuaDoIbge,
} from "./enderecos-ibge";

let tabelasOk = false;

/** As tabelas do IBGE existem? Uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirTabelasDoIbge(): Promise<boolean> {
  if (tabelasOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await executarDDL("enderecos-ibge", DDL_DO_IBGE);
    tabelasOk = true;
    return true;
  } catch (err: any) {
    // Sem as tabelas, a busca do IBGE devolve null e a cascata do mapa segue como antes.
    console.error(`[IBGE] 🛑 Tabelas do IBGE falharam: ${err?.message}`);
    return false;
  }
}

// ── O índice do município, na memória ───────────────────────────────────────

type Indice = { id: string; tipo: string; chave: string; chaveSemTitulo: string | null; bairro: string };
type BairroDoBanco = { nome: string; fonte: string; lat: number; lng: number; enderecos: number; bbox: number[] | null; aneis: unknown };
type DoMunicipio = { ruas: Indice[]; bairros: BairroDoBanco[]; malha: BairroDaMalha[]; exp: number };

const VALIDADE_DOS_MUNICIPIOS_MS = 10 * 60_000;
const VALIDADE_DO_INDICE_MS = 6 * 60 * 60_000;
let municipios: { lista: { codigo: number; chave: string; uf: string; nome: string }[]; exp: number } | null = null;
const indices = new Map<number, DoMunicipio>();
const emVoo = new Map<number, Promise<DoMunicipio | null>>();

async function municipiosImportados() {
  if (municipios && municipios.exp > Date.now()) return municipios.lista;
  const linhas = await prisma.$queryRawUnsafe<{ codigo: number; chaveDoNome: string; uf: string; nome: string }[]>(
    `SELECT "codigo", "chaveDoNome", "uf", "nome" FROM "IbgeMunicipio"`,
  );
  municipios = { lista: linhas.map((l) => ({ codigo: Number(l.codigo), chave: l.chaveDoNome, uf: l.uf, nome: l.nome })), exp: Date.now() + VALIDADE_DOS_MUNICIPIOS_MS };
  return municipios.lista;
}

/** A chave do nome do município: "CABO FRIO", "Cabo Frio - RJ" → "cabo frio". */
export function chaveDoMunicipio(nome: string): string {
  return normalizar(String(nome || "").replace(/\s*[-/,]\s*[A-Za-z]{2}\s*$/, ""));
}

/** O código IBGE do município da loja, se ele foi importado. Com dois de mesmo nome, decide a UF. */
export async function municipioImportado(cidade: string | null | undefined, uf?: string | null): Promise<number | null> {
  const chave = chaveDoMunicipio(cidade || "");
  if (!chave) return null;
  const achados = (await municipiosImportados()).filter((m) => m.chave === chave);
  if (achados.length === 0) return null;
  if (achados.length === 1) return achados[0].codigo;
  const doUf = achados.filter((m) => m.uf.toUpperCase() === String(uf || "").toUpperCase());
  return doUf.length === 1 ? doUf[0].codigo : null;
}

async function doMunicipio(codigo: number): Promise<DoMunicipio | null> {
  const guardado = indices.get(codigo);
  if (guardado && guardado.exp > Date.now()) return guardado;
  let voo = emVoo.get(codigo);
  if (!voo) {
    voo = (async () => {
      const [ruas, bairros] = await Promise.all([
        prisma.$queryRawUnsafe<{ id: bigint | string; tipo: string; chave: string; chaveSemTitulo: string | null; bairro: string }[]>(
          `SELECT "id", "tipo", "chave", "chaveSemTitulo", "bairro" FROM "IbgeRua" WHERE "municipio" = $1`,
          codigo,
        ),
        prisma.$queryRawUnsafe<BairroDoBanco[]>(
          `SELECT "nome", "fonte", "lat", "lng", "enderecos", "bbox", "aneis" FROM "IbgeBairro" WHERE "municipio" = $1`,
          codigo,
        ),
      ]);
      const malha: BairroDaMalha[] = bairros
        .filter((b) => b.fonte === "MALHA" && Array.isArray(b.bbox) && Array.isArray(b.aneis))
        .map((b) => ({ nome: b.nome, bbox: b.bbox as [number, number, number, number], aneis: b.aneis as [number, number][][] }));
      const d: DoMunicipio = {
        ruas: ruas.map((r) => ({ id: String(r.id), tipo: r.tipo, chave: r.chave, chaveSemTitulo: r.chaveSemTitulo, bairro: r.bairro })),
        bairros,
        malha,
        exp: Date.now() + VALIDADE_DO_INDICE_MS,
      };
      indices.set(codigo, d);
      return d;
    })().finally(() => emVoo.delete(codigo));
    emVoo.set(codigo, voo);
  }
  return voo;
}

// ── A busca ─────────────────────────────────────────────────────────────────

export type PedidoAoIbge = {
  /** O texto do endereço, inteiro. */
  texto: string;
  /** Rua, número e bairro em campos separados (checkout), quando vieram. */
  rua?: string | null;
  numero?: string | null;
  bairro?: string | null;
  /** As ruas que a cascata já tirou do texto (logradourosCandidatos). */
  ruasDoTexto?: string[];
  cidade: string;
  uf?: string | null;
  /** A loja e o raio dela: homônima fora daqui não conta. */
  loja: Ponto;
  raioKm: number;
};

export type AchadoNoIbgeParaOMapa = Ponto & {
  displayName: string;
  /** "endereco" = o número (ou um vizinho até ±30); "rua" = entre números ou o meio da rua. */
  precisao: "endereco" | "rua";
  /** O bairro oficial do ponto: o polígono da malha do Censo, ou a localidade do CNEFE. */
  bairro: string;
};

const PRAZO_DO_IBGE_MS = 2500;

/**
 * O endereço do cliente na base do IBGE do município da loja. null = o
 * município não foi importado, o IBGE não tem a rua com segurança (homônima
 * sem bairro, rua nova) ou o banco não respondeu — a cascata do mapa segue.
 */
export async function enderecoNoIbge(p: PedidoAoIbge): Promise<AchadoNoIbgeParaOMapa | null> {
  const trabalho = (async () => {
    // As tabelas nascem no boot (instrumentation); faltando, a leitura falha e cai no catch: null.
    if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return null;
    const codigo = await municipioImportado(p.cidade, p.uf);
    if (!codigo) return null;
    const m = await doMunicipio(codigo);
    if (!m || m.ruas.length === 0) return null;

    const ruaSeparada = String(p.rua || "").trim();
    const logradouros = [...new Set((ruaSeparada ? [ruaSeparada] : [...(p.ruasDoTexto || []), primeiroPedaco(p.texto)]).filter(Boolean))];
    if (logradouros.length === 0) return null;
    const numeroEscrito = Number(String(p.numero || "").match(/\d{1,5}/)?.[0] || 0);
    const numero = numeroEscrito > 0 ? numeroEscrito : numeroDaCasa(p.texto);
    const bairro = String(p.bairro || "").trim() || null;

    // Só os trechos de nome parecido vêm do banco com os pontos.
    const alvos = logradouros.map(separarLogradouro).filter((a) => a.chave && !NOME_GENERICO.test(a.chave));
    const ids = m.ruas
      .filter((r) =>
        alvos.some(
          (a) =>
            casamentoDoNome(a.chave, r.chave) > 0 ||
            (!!r.chaveSemTitulo && casamentoDoNome(a.chave, r.chaveSemTitulo) > 0) ||
            (!!a.chaveSemTitulo && casamentoDoNome(a.chaveSemTitulo, r.chave) > 0),
        ),
      )
      .map((r) => r.id);
    if (ids.length === 0) return null;
    const linhas = await prisma.$queryRawUnsafe<RuaDoIbge[]>(
      `SELECT "tipo", "nome", "chave", "chaveSemTitulo", "bairro", "numeros", "lats", "lngs" FROM "IbgeRua" WHERE "id" = ANY($1::bigint[])`,
      ids.slice(0, 400),
    );
    const centroDoBairro = (nome: string): Ponto | null => {
      const n = normalizar(nome);
      const iguais = m.bairros.filter((b) => normalizar(b.nome) === n);
      const lista = iguais.length > 0 ? iguais : m.bairros.filter((b) => mesmoBairro(nome, b.nome));
      const b = [...lista].sort((x, y) => y.enderecos - x.enderecos)[0];
      return b ? { lat: Number(b.lat), lng: Number(b.lng) } : null;
    };
    const achado = acharNoIbge({ logradouros, numero, bairro }, linhas, { centroDoBairro, loja: p.loja, limiteKm: p.raioKm });
    if (!achado) return null;

    const bairroOficial = (m.malha.length > 0 ? bairroDoPonto(achado, m.malha) : null) || achado.bairro;
    const textoDoCliente = [p.texto, p.rua, p.bairro].filter(Boolean).join(" ");
    const rua = nomeComAcento(`${achado.rua.tipo} ${achado.rua.nome}`, textoDoCliente);
    const nomeDoBairro = nomeComAcento(bairroOficial, textoDoCliente);
    const cidade = nomeComAcento(p.cidade, textoDoCliente);
    const precisao = achado.precisao === "casa" || achado.precisao === "vizinho" ? "endereco" : "rua";
    const comNumero = precisao === "endereco" && numero ? `, ${numero}` : "";
    return {
      lat: achado.lat,
      lng: achado.lng,
      precisao,
      bairro: nomeDoBairro,
      displayName: `${rua}${comNumero} - ${nomeDoBairro}, ${cidade}`,
    } satisfies AchadoNoIbgeParaOMapa;
  })();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((r) => { relogio = setTimeout(() => r(null), PRAZO_DO_IBGE_MS); });
  try {
    return await Promise.race([trabalho, prazo]);
  } catch (e: any) {
    console.warn(`[IBGE] busca falhou, segue o mapa: ${e?.message}`);
    return null;
  } finally {
    clearTimeout(relogio);
    trabalho.catch(() => undefined);
  }
}

/** Esquece os índices na memória (depois de uma importação, e nos testes). */
export function esquecerIndicesDoIbge() {
  municipios = null;
  indices.clear();
}
