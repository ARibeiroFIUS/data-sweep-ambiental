import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PORTAL_TRANSPARENCIA_API_KEY = (Deno.env.get("PORTAL_TRANSPARENCIA_API_KEY") ?? "").trim();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const TCU_LICITANTES_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/licitantes-inidoneos.csv";
const TCU_ELEITORAL_URL =
  "https://sites.tcu.gov.br/dados-abertos/inidoneos-irregulares/arquivos/resp-contas-julgadas-irreg-implicacao-eleitoral.csv";
const MTE_TRABALHO_ESCRAVO_URL =
  "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/cadastro_de_empregadores.csv";
const PGFN_FGTS_ZIP_URL = "https://dadosabertos.pgfn.gov.br/2025_trimestre_04/Dados_abertos_FGTS.zip";

interface RiskFlag {
  id: string;
  source: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  weight: number;
}

interface DataSource {
  name: string;
  status: "success" | "error" | "not_found" | "unavailable";
  message?: string;
}

interface CsvMatchResult {
  count: number;
  sampleValues: string[];
}

interface ExternalCheckResult {
  source: DataSource;
  flags: RiskFlag[];
}

interface ReceitaQSARecord {
  nome_socio?: string;
  nome?: string;
  qualificacao_socio?: string;
  qual?: string;
  pais_origem?: string;
  nome_representante_legal?: string;
  nome_rep_legal?: string;
  qualificacao_representante_legal?: string;
  qual_rep_legal?: string;
  faixa_etaria?: string;
  cnpj_cpf_do_socio?: string;
  identificador_de_socio?: number;
}

interface ReceitaCompanyData {
  situacao_cadastral?: number;
  descricao_situacao_cadastral?: string;
  razao_social?: string;
  nome_fantasia?: string;
  data_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  cnae_fiscal?: number;
  cnae_fiscal_descricao?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cep?: string;
  municipio?: string;
  uf?: string;
  natureza_juridica?: string;
  porte?: string;
  capital_social?: number;
  qsa?: ReceitaQSARecord[];
}

interface CompanyPartner {
  nome: string;
  qual: string;
  pais_origem: string;
  nome_rep_legal: string;
  qual_rep_legal: string;
  faixa_etaria: string;
  cnpj_cpf_do_socio: string;
  tipo: "PF" | "PJ";
}

interface BuiltCompany {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  data_situacao_cadastral: string;
  data_inicio_atividade: string;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  municipio: string;
  uf: string;
  natureza_juridica: string;
  porte: string;
  capital_social: number;
  qsa: CompanyPartner[];
}

interface CachedText {
  fetchedAt: number;
  value: string;
}

interface CachedPGFNFgts {
  fetchedAt: number;
  cnpjs: Set<string>;
}

interface CachedTCUEleitoral {
  fetchedAt: number;
  cpfs: Set<string>;
}

const textCache = new Map<string, CachedText>();
let pgfnFgtsCache: CachedPGFNFgts | null = null;
let tcuEleitoralCache: CachedTCUEleitoral | null = null;

function cleanDocument(value: string): string {
  return value.replace(/\D/g, "");
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function resolveHeaderIndex(headers: string[], targetHeader: string): number {
  const normalizedTarget = targetHeader.replace(/^\uFEFF/, "").trim().toUpperCase();
  return headers.findIndex((header) => header.replace(/^\uFEFF/, "").trim().toUpperCase() === normalizedTarget);
}

function findCsvMatchesByDocument(
  csvText: string,
  delimiter: string,
  documentHeader: string,
  targetDocument: string,
  sampleHeader?: string,
): CsvMatchResult {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return { count: 0, sampleValues: [] };

  const headers = parseDelimitedLine(lines[0], delimiter);
  const documentIndex = resolveHeaderIndex(headers, documentHeader);
  const sampleIndex = sampleHeader ? resolveHeaderIndex(headers, sampleHeader) : -1;

  if (documentIndex < 0) return { count: 0, sampleValues: [] };

  let count = 0;
  const samples = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    const columns = parseDelimitedLine(line, delimiter);
    const document = cleanDocument(columns[documentIndex] ?? "");
    if (document !== targetDocument) continue;

    count += 1;

    if (sampleIndex >= 0) {
      const sample = (columns[sampleIndex] ?? "").trim();
      if (sample) samples.add(sample);
    }
  }

  return { count, sampleValues: Array.from(samples).slice(0, 3) };
}

async function fetchWithTimeout(url: string, timeoutMs = 10000, init: RequestInit = {}): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function fetchTextCached(url: string, timeoutMs = 10000): Promise<string> {
  const cached = textCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response || !response.ok) {
    throw new Error(`Falha ao consultar ${url}`);
  }

  const text = await response.text();
  textCache.set(url, { fetchedAt: Date.now(), value: text });
  return text;
}

async function queryReceitaFederal(cnpj: string): Promise<ReceitaCompanyData | null> {
  const response = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!response || !response.ok) return null;

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") return null;

  return payload as ReceitaCompanyData;
}

async function queryCGU(endpoint: string, cnpj: string): Promise<{ status: DataSource["status"]; data: unknown[] | null }> {
  const headers: HeadersInit = PORTAL_TRANSPARENCIA_API_KEY
    ? {
        "chave-api-dados": PORTAL_TRANSPARENCIA_API_KEY,
        accept: "application/json",
      }
    : {};

  const response = await fetchWithTimeout(
    `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?cnpjSancionado=${cnpj}&pagina=1`,
    15000,
    { headers },
  );

  if (!response) return { status: "unavailable", data: null };
  if (response.status === 403 || response.status === 401) return { status: "unavailable", data: null };
  if (!response.ok) return { status: "error", data: null };

  const payload: unknown = await response.json();
  return { status: "success", data: Array.isArray(payload) ? payload : [] };
}

async function queryCEIS(cnpj: string) {
  return queryCGU("ceis", cnpj);
}

async function queryCNEP(cnpj: string) {
  return queryCGU("cnep", cnpj);
}

async function queryCEPIM(cnpj: string) {
  return queryCGU("cepim", cnpj);
}

async function queryTCULicitantes(cnpj: string): Promise<ExternalCheckResult> {
  try {
    const csv = await fetchTextCached(TCU_LICITANTES_URL, 15000);
    const matches = findCsvMatchesByDocument(csv, "|", "CPF_CNPJ", cnpj, "PROCESSO");

    if (matches.count === 0) {
      return {
        source: { name: "TCU — Licitantes Inidôneos", status: "not_found" },
        flags: [],
      };
    }

    const sample = matches.sampleValues.length > 0 ? ` Exemplo de processo: ${matches.sampleValues[0]}.` : "";
    return {
      source: { name: "TCU — Licitantes Inidôneos", status: "success" },
      flags: [
        {
          id: "tcu_licitantes_inidoneos",
          source: "TCU",
          severity: "critical",
          title: "Empresa em lista do TCU (Licitantes Inidôneos)",
          description: `Foram encontrados ${matches.count} registro(s) na base de licitantes inidôneos.${sample}`,
          weight: 35,
        },
      ],
    };
  } catch {
    return {
      source: { name: "TCU — Licitantes Inidôneos", status: "error", message: "Não foi possível consultar a base do TCU" },
      flags: [],
    };
  }
}

async function queryMTETrabalhoEscravo(cnpj: string): Promise<ExternalCheckResult> {
  try {
    const csv = await fetchTextCached(MTE_TRABALHO_ESCRAVO_URL, 20000);
    const matches = findCsvMatchesByDocument(csv, ";", "CNPJ/CPF", cnpj, "Empregador");

    if (matches.count === 0) {
      return {
        source: { name: "MTE — Cadastro de Empregadores (Trabalho Escravo)", status: "not_found" },
        flags: [],
      };
    }

    const sampleEmployer = matches.sampleValues.length > 0 ? ` Exemplo: ${matches.sampleValues[0]}.` : "";
    return {
      source: { name: "MTE — Cadastro de Empregadores (Trabalho Escravo)", status: "success" },
      flags: [
        {
          id: "mte_trabalho_escravo",
          source: "MTE",
          severity: "critical",
          title: "Empresa no cadastro de trabalho escravo",
          description: `Foram encontradas ${matches.count} ocorrência(s) no cadastro de empregadores que submeteram trabalhadores a condições análogas à escravidão.${sampleEmployer}`,
          weight: 35,
        },
      ],
    };
  } catch {
    return {
      source: {
        name: "MTE — Cadastro de Empregadores (Trabalho Escravo)",
        status: "error",
        message: "Não foi possível consultar a base do MTE",
      },
      flags: [],
    };
  }
}

async function loadPGFNFgtsIndex(): Promise<Set<string>> {
  if (pgfnFgtsCache && Date.now() - pgfnFgtsCache.fetchedAt < CACHE_TTL_MS) {
    return pgfnFgtsCache.cnpjs;
  }

  const response = await fetchWithTimeout(PGFN_FGTS_ZIP_URL, 45000);
  if (!response || !response.ok) {
    throw new Error("Falha ao baixar os dados abertos da PGFN (FGTS)");
  }

  const archive = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(archive);
  const decoder = new TextDecoder("iso-8859-1");
  const cnpjs = new Set<string>();

  for (const [fileName, content] of Object.entries(files)) {
    if (!fileName.endsWith(".csv")) continue;

    const csvText = decoder.decode(content);
    const lines = csvText.split(/\r?\n/);
    if (lines.length === 0) continue;

    const headers = parseDelimitedLine(lines[0], ";");
    const docIndex = resolveHeaderIndex(headers, "CPF_CNPJ");
    if (docIndex < 0) continue;

    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;

      const columns = parseDelimitedLine(line, ";");
      const doc = cleanDocument(columns[docIndex] ?? "");
      if (doc.length === 14) cnpjs.add(doc);
    }
  }

  pgfnFgtsCache = { fetchedAt: Date.now(), cnpjs };
  return cnpjs;
}

async function queryPGFNFgts(cnpj: string): Promise<ExternalCheckResult> {
  try {
    const cnpjs = await loadPGFNFgtsIndex();
    if (!cnpjs.has(cnpj)) {
      return {
        source: { name: "PGFN — Dívida Ativa (FGTS)", status: "not_found" },
        flags: [],
      };
    }

    return {
      source: { name: "PGFN — Dívida Ativa (FGTS)", status: "success" },
      flags: [
        {
          id: "pgfn_fgts_divida_ativa",
          source: "PGFN",
          severity: "medium",
          title: "Empresa com inscrição em dívida ativa (FGTS)",
          description:
            "A empresa consta em dados abertos de inscrições em dívida ativa vinculadas ao FGTS na PGFN.",
          weight: 15,
        },
      ],
    };
  } catch {
    return {
      source: {
        name: "PGFN — Dívida Ativa (FGTS)",
        status: "error",
        message: "Não foi possível processar os dados abertos da PGFN",
      },
      flags: [],
    };
  }
}

async function loadTCUEleitoralIndex(): Promise<Set<string>> {
  if (tcuEleitoralCache && Date.now() - tcuEleitoralCache.fetchedAt < CACHE_TTL_MS) {
    return tcuEleitoralCache.cpfs;
  }

  const csv = await fetchTextCached(TCU_ELEITORAL_URL, 15000);
  const lines = csv.split(/\r?\n/);
  const cpfs = new Set<string>();

  if (lines.length > 0) {
    const headers = parseDelimitedLine(lines[0], "|");
    const cpfIndex = resolveHeaderIndex(headers, "CPF");

    if (cpfIndex >= 0) {
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;

        const columns = parseDelimitedLine(line, "|");
        const cpf = cleanDocument(columns[cpfIndex] ?? "");
        if (cpf.length === 11) cpfs.add(cpf);
      }
    }
  }

  tcuEleitoralCache = { fetchedAt: Date.now(), cpfs };
  return cpfs;
}

async function queryTCUEleitoral(partners: CompanyPartner[]): Promise<ExternalCheckResult> {
  const partnerCpfs = partners
    .map((partner) => cleanDocument(partner.cnpj_cpf_do_socio ?? ""))
    .filter((cpf) => cpf.length === 11);

  if (partnerCpfs.length === 0) {
    return {
      source: {
        name: "TCU — Contas Irregulares com Implicação Eleitoral",
        status: "unavailable",
        message: "CPF de sócios mascarado na fonte de CNPJ; sem validação eleitoral exata",
      },
      flags: [],
    };
  }

  try {
    const eleitoralCpfs = await loadTCUEleitoralIndex();
    const matchedPartners = partners.filter((partner) => {
      const cpf = cleanDocument(partner.cnpj_cpf_do_socio ?? "");
      return cpf.length === 11 && eleitoralCpfs.has(cpf);
    });

    if (matchedPartners.length === 0) {
      return {
        source: { name: "TCU — Contas Irregulares com Implicação Eleitoral", status: "not_found" },
        flags: [],
      };
    }

    const partnerNames = matchedPartners.map((partner) => partner.nome).slice(0, 3).join(", ");
    return {
      source: { name: "TCU — Contas Irregulares com Implicação Eleitoral", status: "success" },
      flags: [
        {
          id: "tcu_implicacao_eleitoral_socio",
          source: "TCU",
          severity: "high",
          title: "Sócio listado em contas irregulares com implicação eleitoral",
          description: `Foram encontrados ${matchedPartners.length} sócio(s) na base do TCU. Exemplos: ${partnerNames}.`,
          weight: 20,
        },
      ],
    };
  } catch {
    return {
      source: {
        name: "TCU — Contas Irregulares com Implicação Eleitoral",
        status: "error",
        message: "Não foi possível consultar a base eleitoral do TCU",
      },
      flags: [],
    };
  }
}

function buildCompany(receitaData: ReceitaCompanyData, cleanCnpj: string): BuiltCompany {
  const qsaEntries = Array.isArray(receitaData.qsa) ? receitaData.qsa : [];
  const qsa = qsaEntries.map((entry) => {
    const socioType = entry.identificador_de_socio === 1 ? "PJ" : "PF";
    return {
      nome: entry.nome_socio || entry.nome || "",
      qual: entry.qualificacao_socio || entry.qual || "",
      pais_origem: entry.pais_origem || "BRASIL",
      nome_rep_legal: entry.nome_representante_legal || entry.nome_rep_legal || "",
      qual_rep_legal: entry.qualificacao_representante_legal || entry.qual_rep_legal || "",
      faixa_etaria: entry.faixa_etaria || "",
      cnpj_cpf_do_socio: entry.cnpj_cpf_do_socio || "",
      tipo: socioType,
    } satisfies CompanyPartner;
  });

  return {
    cnpj: cleanCnpj,
    razao_social: receitaData.razao_social || "",
    nome_fantasia: receitaData.nome_fantasia || "",
    situacao_cadastral: receitaData.descricao_situacao_cadastral || "Desconhecida",
    data_situacao_cadastral: receitaData.data_situacao_cadastral || "",
    data_inicio_atividade: receitaData.data_inicio_atividade || "",
    cnae_fiscal: toNumber(receitaData.cnae_fiscal),
    cnae_fiscal_descricao: receitaData.cnae_fiscal_descricao || "",
    logradouro: receitaData.logradouro || "",
    numero: receitaData.numero || "",
    complemento: receitaData.complemento || "",
    bairro: receitaData.bairro || "",
    cep: receitaData.cep || "",
    municipio: receitaData.municipio || "",
    uf: receitaData.uf || "",
    natureza_juridica: receitaData.natureza_juridica || "",
    porte: receitaData.porte || "",
    capital_social: toNumber(receitaData.capital_social),
    qsa,
  };
}

function calculateScore(flags: RiskFlag[]): { score: number; classification: string } {
  const totalWeight = flags.reduce((sum, flag) => sum + flag.weight, 0);
  const score = Math.min(100, totalWeight);

  let classification = "Baixo";
  if (score >= 75) classification = "Crítico";
  else if (score >= 50) classification = "Alto";
  else if (score >= 25) classification = "Médio";

  return { score, classification };
}

function generateSummary(classification: string, flags: RiskFlag[], companyName: string): string {
  if (flags.length === 0) {
    return `A empresa ${companyName} não apresenta registros negativos nas bases consultadas. Risco considerado baixo.`;
  }

  const flagSummary = flags.map((flag) => flag.title).join(", ");
  const recommendations: Record<string, string> = {
    Baixo: "Monitoramento periódico recomendado.",
    Médio: "Recomenda-se análise aprofundada antes de prosseguir com a contratação.",
    Alto: "Alto risco identificado. Recomenda-se cautela extrema e due diligence completa.",
    Crítico: "RISCO CRÍTICO. Recomenda-se NÃO prosseguir com a contratação sem análise jurídica detalhada.",
  };

  return `A empresa ${companyName} apresenta ${flags.length} alerta(s): ${flagSummary}. ${recommendations[classification] || ""}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: unknown = await req.json();
    const cnpj = typeof body === "object" && body !== null && "cnpj" in body ? String(body.cnpj ?? "") : "";
    const cleanCnpj = cleanDocument(cnpj);

    if (cleanCnpj.length !== 14) {
      return new Response(JSON.stringify({ error: "CNPJ inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [receitaData, ceisResult, cnepResult, cepimResult, tcuResult, mteResult, pgfnResult] = await Promise.all([
      queryReceitaFederal(cleanCnpj),
      queryCEIS(cleanCnpj),
      queryCNEP(cleanCnpj),
      queryCEPIM(cleanCnpj),
      queryTCULicitantes(cleanCnpj),
      queryMTETrabalhoEscravo(cleanCnpj),
      queryPGFNFgts(cleanCnpj),
    ]);

    const flags: RiskFlag[] = [];
    const sources: DataSource[] = [];

    if (receitaData) {
      sources.push({ name: "Receita Federal (BrasilAPI)", status: "success" });

      if (receitaData.situacao_cadastral !== undefined && receitaData.situacao_cadastral !== 2) {
        flags.push({
          id: "receita_situacao",
          source: "Receita Federal",
          severity: "high",
          title: "Situação cadastral irregular",
          description: `Empresa com situação cadastral: ${receitaData.descricao_situacao_cadastral || "Irregular"}`,
          weight: 30,
        });
      }
    } else {
      sources.push({ name: "Receita Federal (BrasilAPI)", status: "error", message: "Não foi possível consultar" });
    }

    if (ceisResult.status === "success") {
      sources.push({
        name: "CEIS — Empresas Inidôneas e Suspensas",
        status: ceisResult.data?.length ? "success" : "not_found",
      });
      if (ceisResult.data && ceisResult.data.length > 0) {
        flags.push({
          id: "ceis",
          source: "CEIS (CGU)",
          severity: "critical",
          title: "Empresa no CEIS",
          description:
            "Cadastrada no Cadastro de Empresas Inidôneas e Suspensas. Impedida de contratar com a administração pública.",
          weight: 35,
        });
      }
    } else {
      sources.push({
        name: "CEIS — Empresas Inidôneas e Suspensas",
        status: ceisResult.status,
        message: PORTAL_TRANSPARENCIA_API_KEY
          ? "Falha ao consultar API"
          : "API indisponível (configure PORTAL_TRANSPARENCIA_API_KEY)",
      });
    }

    if (cnepResult.status === "success") {
      sources.push({
        name: "CNEP — Empresas Punidas",
        status: cnepResult.data?.length ? "success" : "not_found",
      });
      if (cnepResult.data && cnepResult.data.length > 0) {
        flags.push({
          id: "cnep",
          source: "CNEP (CGU)",
          severity: "critical",
          title: "Empresa no CNEP",
          description: "Cadastrada no Cadastro Nacional de Empresas Punidas por atos contra a administração pública.",
          weight: 35,
        });
      }
    } else {
      sources.push({
        name: "CNEP — Empresas Punidas",
        status: cnepResult.status,
        message: PORTAL_TRANSPARENCIA_API_KEY
          ? "Falha ao consultar API"
          : "API indisponível (configure PORTAL_TRANSPARENCIA_API_KEY)",
      });
    }

    if (cepimResult.status === "success") {
      sources.push({
        name: "CEPIM — Entidades Impedidas",
        status: cepimResult.data?.length ? "success" : "not_found",
      });
      if (cepimResult.data && cepimResult.data.length > 0) {
        flags.push({
          id: "cepim",
          source: "CEPIM (CGU)",
          severity: "high",
          title: "Entidade no CEPIM",
          description: "Cadastrada no CEPIM — impedida de receber transferências voluntárias.",
          weight: 25,
        });
      }
    } else {
      sources.push({
        name: "CEPIM — Entidades Impedidas",
        status: cepimResult.status,
        message: PORTAL_TRANSPARENCIA_API_KEY
          ? "Falha ao consultar API"
          : "API indisponível (configure PORTAL_TRANSPARENCIA_API_KEY)",
      });
    }

    sources.push(tcuResult.source);
    flags.push(...tcuResult.flags);

    sources.push(mteResult.source);
    flags.push(...mteResult.flags);

    sources.push(pgfnResult.source);
    flags.push(...pgfnResult.flags);

    sources.push({
      name: "Servidores Federais (CGU)",
      status: "unavailable",
      message: "Integração de servidores federais ainda não implementada nesta versão",
    });

    if (!receitaData) {
      return new Response(
        JSON.stringify({ error: "Não foi possível obter dados da empresa. Verifique o CNPJ." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const company = buildCompany(receitaData, cleanCnpj);
    const eleitoralResult = await queryTCUEleitoral(company.qsa);
    sources.push(eleitoralResult.source);
    flags.push(...eleitoralResult.flags);

    const { score, classification } = calculateScore(flags);
    const summary = generateSummary(classification, flags, company.razao_social);

    const result = {
      company,
      score,
      classification,
      flags,
      sources,
      summary,
      analyzed_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error analyzing CNPJ:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno ao processar a consulta" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
