/**
 * Importa a base de endereços do IBGE de UM município para o banco
 * (lib/enderecos-ibge-servidor.ts lê; lib/enderecos-ibge.ts é a regra).
 *
 * Os arquivos são baixados à mão, sem conta, do FTP do IBGE (Censo 2022):
 *   CNEFE do município (CSV, latin1, separado por ";"):
 *     https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/<UF cód>_<UF>/<cód>_<NOME>.zip
 *     ex.: .../CSV/Municipio/33_RJ/3300704_CABO_FRIO.zip
 *   Malha de bairros da UF (shapefile; só os municípios com bairro oficial):
 *     https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/shp/UF/<UF>_bairros_CD2022.zip
 * Descompactados em <dados>/cnefe/x/ e <dados>/bairros/x/ (padrão C:/Users/Micro/dados-ibge).
 *
 *   npx tsx scripts/importar-ibge.ts 3300704              (só mostra o plano)
 *   npx tsx scripts/importar-ibge.ts 3300704 --gravar     (grava: troca as linhas do município)
 *   opções: --dados=<pasta>  --csv=<arquivo.csv>  --malha=<prefixo do .shp sem extensão>
 *
 * O banco é o da DATABASE_URL do ambiente (ou do .env). Gravar troca, numa
 * transação, só as linhas DESTE município nas tabelas Ibge*; nenhuma outra
 * tabela é tocada.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { DDL_DO_IBGE } from "../src/lib/enderecos-ibge-ddl";
import { chaveDoNome, distanciaDeEdicao, normalizar, semTitulo, simplificar } from "../src/lib/enderecos-ibge";

const args = process.argv.slice(2);
const opcao = (nome: string) => args.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
const CODIGO = Number(args.find((a) => /^\d{7}$/.test(a)));
const GRAVAR = args.includes("--gravar");
const DADOS = opcao("dados") || "C:/Users/Micro/dados-ibge";
if (!CODIGO) {
  console.error("Uso: npx tsx scripts/importar-ibge.ts <código IBGE de 7 dígitos> [--gravar]");
  process.exit(1);
}

const UFS: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN",
  "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC",
  "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};
const UF = UFS[String(CODIGO).slice(0, 2)];

// ── O CNEFE ──────────────────────────────────────────────────────────────────

function acharCsv(): string {
  const dado = opcao("csv");
  if (dado) return dado;
  const pasta = path.join(DADOS, "cnefe", "x");
  const arq = existsSync(pasta) ? readdirSync(pasta).find((f) => f.startsWith(`${CODIGO}_`) && f.toLowerCase().endsWith(".csv")) : null;
  if (!arq) throw new Error(`CSV do CNEFE de ${CODIGO} não achado em ${pasta} (use --csv=)`);
  return path.join(pasta, arq);
}

type Endereco = { tipo: string; titulo: string; nome: string; loc: string; num: number; cep: string; lat: number; lng: number; nv: number };

function lerCnefe(caminho: string) {
  const linhas = readFileSync(caminho, "latin1").split(/\r?\n/);
  const cab = linhas[0].split(";");
  const c = (n: string) => {
    const i = cab.indexOf(n);
    if (i < 0) throw new Error(`coluna ${n} não está no CSV`);
    return i;
  };
  const C = { mun: c("COD_MUNICIPIO"), cep: c("CEP"), loc: c("DSC_LOCALIDADE"), tipo: c("NOM_TIPO_SEGLOGR"), tit: c("NOM_TITULO_SEGLOGR"), nome: c("NOM_SEGLOGR"), num: c("NUM_ENDERECO"), lat: c("LATITUDE"), lng: c("LONGITUDE"), nv: c("NV_GEO_COORD") };
  const out: Endereco[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const v = linhas[i].split(";");
    if (v.length < 20 || Number(v[C.mun]) !== CODIGO) continue;
    const lat = Number(v[C.lat]);
    const lng = Number(v[C.lng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;
    out.push({ tipo: normalizar(v[C.tipo]) || "rua", titulo: v[C.tit].trim(), nome: v[C.nome].trim(), loc: v[C.loc].trim() || "SEM LOCALIDADE", num: Number(v[C.num]) || 0, cep: v[C.cep].trim(), lat, lng, nv: Number(v[C.nv]) || 0 });
  }
  return out;
}

/** Localidade escrita errada pelo recenseador ("JARDIM EDPERANCA", 6 casas) vira a grande de nome quase igual. "Verão Vermelho I" ≠ "II". */
function corrigirLocalidades(enderecos: Endereco[]) {
  const contagem = new Map<string, number>();
  for (const e of enderecos) contagem.set(e.loc, (contagem.get(e.loc) || 0) + 1);
  const grandes = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  const fim = (t: string) => (normalizar(t).match(/\s(i{1,3}|iv|v|vi{1,3}|ix|x|\d+)$/) || [])[1] || "";
  const troca = new Map<string, string>();
  for (const [nome, n] of grandes) {
    for (const [maior, m] of grandes) {
      if (maior === nome || m < 10 * n || fim(nome) !== fim(maior)) continue;
      const a = normalizar(nome).replace(/\s/g, "");
      const b = normalizar(maior).replace(/\s/g, "");
      const menor = Math.min(a.length, b.length);
      if (menor >= 6 && distanciaDeEdicao(a, b, 2) <= (menor >= 12 ? 2 : 1)) {
        troca.set(nome, maior);
        break;
      }
    }
  }
  for (const e of enderecos) e.loc = troca.get(e.loc) || e.loc;
  return Object.fromEntries(troca);
}

type Trecho = { tipo: string; nome: string; chave: string; chaveSemTitulo: string | null; bairro: string; ceps: Set<string>; pontos: Map<string, [number, number, number]> };

/** Um trecho por (tipo, título+nome, localidade). Só NV_GEO_COORD 1–3 (casa, face, quadra): 4+ é o centro do setor. */
function trechos(enderecos: Endereco[]) {
  const grupos = new Map<string, Trecho>();
  for (const e of enderecos) {
    if (e.nv > 3 || !e.nome) continue;
    const nome = [e.titulo, e.nome].filter(Boolean).join(" ");
    const chave = chaveDoNome(nome);
    if (!chave) continue;
    const k = `${e.tipo}|${chave}|${e.loc}`;
    let g = grupos.get(k);
    if (!g) {
      const sem = e.titulo ? chaveDoNome(e.nome) : semTitulo(chave);
      g = { tipo: e.tipo, nome, chave, chaveSemTitulo: sem && sem !== chave ? sem : null, bairro: e.loc, ceps: new Set(), pontos: new Map() };
      grupos.set(k, g);
    }
    if (e.cep) g.ceps.add(e.cep);
    // Apartamentos do mesmo número no mesmo ponto: um só.
    const p = `${e.num}|${e.lat.toFixed(5)}|${e.lng.toFixed(5)}`;
    if (!g.pontos.has(p)) g.pontos.set(p, [e.num, e.lat, e.lng]);
  }
  return [...grupos.values()];
}

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
};

// ── A malha de bairros (shapefile) ───────────────────────────────────────────

function lerDbf(caminho: string) {
  const b = readFileSync(caminho);
  const n = b.readUInt32LE(4);
  const hdr = b.readUInt16LE(8);
  const rec = b.readUInt16LE(10);
  const campos: { nome: string; tam: number }[] = [];
  let off = 32;
  while (b[off] !== 0x0d) {
    campos.push({ nome: b.toString("latin1", off, off + 11).replace(/\0[\s\S]*$/, ""), tam: b[off + 16] });
    off += 32;
  }
  const linhas: Record<string, string>[] = [];
  for (let i = 0; i < n; i++) {
    let p = hdr + i * rec + 1;
    const o: Record<string, string> = {};
    for (const c of campos) {
      o[c.nome] = b.toString("utf8", p, p + c.tam).trim();
      p += c.tam;
    }
    linhas.push(o);
  }
  return linhas;
}

function lerPoligonos(caminho: string) {
  const b = readFileSync(caminho);
  const out: ([number, number][][] | null)[] = [];
  let off = 100;
  while (off < b.length) {
    const len = b.readInt32BE(off + 4) * 2;
    const r = off + 8;
    const tipo = b.readInt32LE(r);
    if (tipo === 5 || tipo === 15) {
      const nPartes = b.readInt32LE(r + 36);
      const nPts = b.readInt32LE(r + 40);
      const partes: number[] = [];
      for (let i = 0; i < nPartes; i++) partes.push(b.readInt32LE(r + 44 + i * 4));
      const p0 = r + 44 + nPartes * 4;
      const aneis: [number, number][][] = [];
      for (let i = 0; i < nPartes; i++) {
        const z = i + 1 < nPartes ? partes[i + 1] : nPts;
        const anel: [number, number][] = [];
        for (let k = partes[i]; k < z; k++) anel.push([b.readDoubleLE(p0 + k * 16), b.readDoubleLE(p0 + k * 16 + 8)]);
        aneis.push(anel);
      }
      out.push(aneis);
    } else out.push(null);
    off = r + len;
  }
  return out;
}

function malhaDoMunicipio() {
  const prefixo = opcao("malha") || path.join(DADOS, "bairros", "x", `${UF}_bairros_CD2022`);
  if (!existsSync(`${prefixo}.shp`) || !existsSync(`${prefixo}.dbf`)) return { arquivo: null as string | null, bairros: [] as { nome: string; bbox: number[]; aneis: [number, number][][] }[] };
  const dbf = lerDbf(`${prefixo}.dbf`);
  const shp = lerPoligonos(`${prefixo}.shp`);
  const bairros: { nome: string; bbox: number[]; aneis: [number, number][][] }[] = [];
  dbf.forEach((d, i) => {
    if (Number(d.CD_MUN) !== CODIGO || !shp[i]) return;
    // ~5 m de tolerância: o limite de bairro não precisa de mais que isso.
    const aneis = shp[i]!.map((a) => simplificar(a, 0.00005).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as [number, number]));
    const xs = aneis.flat().map((p) => p[0]);
    const ys = aneis.flat().map((p) => p[1]);
    bairros.push({ nome: d.NM_BAIRRO, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], aneis });
  });
  return { arquivo: prefixo, bairros };
}

// ── O plano e a gravação ────────────────────────────────────────────────────

function urlDoBanco(): string {
  if (/^postgres/.test(process.env.DATABASE_URL || "")) return process.env.DATABASE_URL!;
  for (const arq of [".env", "C:/Users/Micro/Documents/firehub-site/.env"]) {
    if (!existsSync(arq)) continue;
    const m = readFileSync(arq, "utf8").match(/^DATABASE_URL="?([^"\n]+)/m);
    if (m) return m[1];
  }
  throw new Error("sem DATABASE_URL");
}

(async () => {
  const csv = acharCsv();
  const nomeDoArquivo = path.basename(csv, ".csv").replace(/^\d+_/, "").replace(/_/g, " ");
  const enderecos = lerCnefe(csv);
  if (enderecos.length === 0) throw new Error(`nenhum endereço do município ${CODIGO} em ${csv}`);
  const trocas = corrigirLocalidades(enderecos);
  const lista = trechos(enderecos);
  const porLocalidade = new Map<string, { la: number[]; ln: number[] }>();
  for (const e of enderecos) {
    const g = porLocalidade.get(e.loc) || porLocalidade.set(e.loc, { la: [], ln: [] }).get(e.loc)!;
    g.la.push(e.lat);
    g.ln.push(e.lng);
  }
  const localidades = [...porLocalidade.entries()].map(([nome, g]) => ({ nome, lat: mediana(g.la), lng: mediana(g.ln), enderecos: g.la.length }));
  const malha = malhaDoMunicipio();
  const pontos = lista.reduce((s, t) => s + t.pontos.size, 0);
  // Estimativa: 12 bytes por ponto (número + lat + lng) + ~120 por linha (texto, cabeçalho, índice).
  const estimativaMb = (pontos * 12 + lista.length * 120 + JSON.stringify(malha.bairros).length) / 1e6;

  console.log(`Município ${CODIGO} ${nomeDoArquivo}/${UF} — ${csv}`);
  console.log(`  endereços no CNEFE: ${enderecos.length} (NV 1: ${enderecos.filter((e) => e.nv === 1).length})`);
  console.log(`  trechos de rua: ${lista.length}; pontos (sem repetir apartamento): ${pontos}`);
  console.log(`  localidades: ${localidades.length}; corrigidas: ${JSON.stringify(trocas)}`);
  console.log(`  bairros da malha do Censo: ${malha.bairros.length}${malha.arquivo ? ` (${malha.arquivo})` : " (arquivo da malha não achado)"}`);
  console.log(`  tamanho estimado no banco: ~${estimativaMb.toFixed(1)} MB`);
  if (!GRAVAR) {
    console.log("\nSó o plano. Para gravar: --gravar");
    return;
  }

  const sql = neon(urlDoBanco());
  for (const ddl of DDL_DO_IBGE) await sql.query(ddl);
  const LOTE = 150;
  const comandos: any[] = [
    sql.query(`DELETE FROM "IbgeRua" WHERE "municipio" = $1`, [CODIGO]),
    sql.query(`DELETE FROM "IbgeBairro" WHERE "municipio" = $1`, [CODIGO]),
  ];
  for (let i = 0; i < lista.length; i += LOTE) {
    const lote = lista.slice(i, i + LOTE);
    const valores: unknown[] = [];
    const linhas = lote.map((t, j) => {
      const ps = [...t.pontos.values()];
      valores.push(CODIGO, t.tipo, t.nome, t.chave, t.chaveSemTitulo, t.bairro, [...t.ceps], ps.map((p) => p[0]), ps.map((p) => p[1]), ps.map((p) => p[2]));
      const b = j * 10;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::text[],$${b + 8}::integer[],$${b + 9}::real[],$${b + 10}::real[])`;
    });
    comandos.push(
      sql.query(`INSERT INTO "IbgeRua" ("municipio","tipo","nome","chave","chaveSemTitulo","bairro","ceps","numeros","lats","lngs") VALUES ${linhas.join(",")}`, valores),
    );
  }
  for (const l of localidades) {
    comandos.push(sql.query(`INSERT INTO "IbgeBairro" ("municipio","nome","fonte","lat","lng","enderecos") VALUES ($1,$2,'CNEFE',$3,$4,$5)`, [CODIGO, l.nome, l.lat, l.lng, l.enderecos]));
  }
  for (const b of malha.bairros) {
    const cx = (b.bbox[0] + b.bbox[2]) / 2;
    const cy = (b.bbox[1] + b.bbox[3]) / 2;
    comandos.push(
      sql.query(`INSERT INTO "IbgeBairro" ("municipio","nome","fonte","lat","lng","bbox","aneis") VALUES ($1,$2,'MALHA',$3,$4,$5::real[],$6::jsonb) ON CONFLICT DO NOTHING`, [CODIGO, b.nome, cy, cx, b.bbox, JSON.stringify(b.aneis)]),
    );
  }
  comandos.push(
    sql.query(
      `INSERT INTO "IbgeMunicipio" ("codigo","nome","chaveDoNome","uf","fonte","enderecos","trechos","bairrosDaMalha","importadoEm")
       VALUES ($1,$2,$3,$4,'CNEFE 2022',$5,$6,$7,NOW())
       ON CONFLICT ("codigo") DO UPDATE SET "nome"=EXCLUDED."nome","chaveDoNome"=EXCLUDED."chaveDoNome","uf"=EXCLUDED."uf","fonte"=EXCLUDED."fonte",
         "enderecos"=EXCLUDED."enderecos","trechos"=EXCLUDED."trechos","bairrosDaMalha"=EXCLUDED."bairrosDaMalha","importadoEm"=NOW()`,
      [CODIGO, nomeDoArquivo, normalizar(nomeDoArquivo), UF, enderecos.length, lista.length, malha.bairros.length],
    ),
  );
  await sql.transaction(comandos);
  const [conta] = await sql.query(`SELECT count(*)::int AS trechos, sum(cardinality("numeros"))::int AS pontos FROM "IbgeRua" WHERE "municipio" = $1`, [CODIGO]);
  const tamanho = await sql.query(
    `SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho, pg_total_relation_size(c.oid) AS bytes FROM pg_class c WHERE relname IN ('IbgeRua','IbgeBairro','IbgeMunicipio')`,
  );
  console.log(`\nGravado: ${conta.trechos} trechos, ${conta.pontos} pontos.`);
  for (const t of tamanho) console.log(`  ${t.relname}: ${t.tamanho}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
