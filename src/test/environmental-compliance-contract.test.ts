import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeEnvironmentalCompliance } from "../../server/environmental-compliance.mjs";
import { buildCoverageMatrix, getEnvironmentalSourceCatalog } from "../../server/environmental-source-catalog.mjs";
import { getEnvironmentalRuleCatalog } from "../../server/environmental-rule-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cetesbResultadoFixture = fs.readFileSync(path.join(__dirname, "fixtures/cetesb/processo_resultado.html"), "latin1");
const cetesbDetalheFixture = fs.readFileSync(path.join(__dirname, "fixtures/cetesb/processo_resultado2.html"), "latin1");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("environmental source/rule catalogs", () => {
  it("marca SP como api_ready em estadual/municipal/territorial", () => {
    const coverage = buildCoverageMatrix({
      uf: "SP",
      municipioNome: "Sao Paulo",
      municipioIbge: "3550308",
    });

    expect(coverage.federal.status).toBe("api_ready");
    expect(coverage.state.status).toBe("api_ready");
    expect(coverage.municipal.status).toBe("api_ready");
    expect(coverage.ambiental_territorial.status).toBe("api_ready");
  });

  it("marca UF sem conector estruturado como manual_required", () => {
    const coverage = buildCoverageMatrix({
      uf: "MG",
      municipioNome: "Belo Horizonte",
      municipioIbge: "3106200",
    });

    expect(coverage.state.status).toBe("manual_required");
    expect(coverage.municipal.status).toBe("manual_required");
    expect(coverage.ambiental_territorial.status).toBe("manual_required");
  });

  it("retorna regra estadual SP quando UF=SP", () => {
    const catalog = getEnvironmentalRuleCatalog({ uf: "SP" });
    const ruleIds = catalog.rules.map((rule) => rule.rule_id);
    expect(ruleIds).toContain("state.sp.cetesb.anexo5");
  });

  it("retorna fontes estaduais da UF solicitada", () => {
    const catalog = getEnvironmentalSourceCatalog({ uf: "SP" });
    const sourceIds = catalog.state.map((source) => source.source_id);
    expect(sourceIds).toContain("sp_cetesb_licenciamento");
  });
});

describe("environmental compliance contract", () => {
  it("retorna schema br-v1 com coverage/evidence/areas_contaminadas", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_FTE_VECTOR_STORE_ID", "");
    vi.stubEnv("PORTAL_TRANSPARENCIA_API_KEY", "");

    const brasilApiPayload = {
      cnpj: "03171752000103",
      razao_social: "EMPRESA TESTE AMBIENTAL LTDA",
      nome_fantasia: "EMPRESA TESTE",
      descricao_situacao_cadastral: "ATIVA",
      logradouro: "Rua das Flores",
      numero: "100",
      bairro: "Centro",
      municipio: "Belo Horizonte",
      uf: "MG",
      cep: "30110000",
      cnae_fiscal: "3811400",
      cnae_fiscal_descricao: "Coleta de residuos nao-perigosos",
      cnaes_secundarios: [
        {
          codigo: "3821100",
          descricao: "Tratamento e disposicao de residuos nao-perigosos",
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("brasilapi.com.br/api/cnpj/v1/03171752000103")) {
        return new Response(JSON.stringify(brasilApiPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeEnvironmentalCompliance("03.171.752/0001-03");

    expect(result.schema_version).toBe("br-v1");
    expect(result.jurisdiction_context.uf).toBe("MG");
    expect(result.coverage.state.status).toBe("manual_required");
    expect(result.coverage.municipal.status).toBe("manual_required");
    expect(result.areas_contaminadas.method).toBe("manual_required");
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.orchestration.steps).toHaveLength(10);
    expect(result.orchestration.steps.map((step) => step.agent)).toEqual([
      "agent_1_cnpj_cnae",
      "agent_2_fte_rag_cnae",
      "agent_3_ibama_fte",
      "agent_4_state",
      "agent_5_cetesb_licencas_publicas",
      "agent_6_municipal",
      "agent_7_areas_contaminadas",
      "agent_8_sanitario",
      "agent_9_sei_publico",
      "agent_10_relatorio_ai",
    ]);
    expect(result.company.cnaes.length).toBeGreaterThan(0);
    expect(result.ux_v2).toBeTruthy();
    expect(result.ux_v2?.executive).toBeTruthy();
    expect(typeof result.ux_v2?.executive?.decision_summary).toBe("string");
    expect(Array.isArray(result.ux_v2?.executive?.coverage_gaps)).toBe(true);
    expect(Array.isArray(result.action_plan?.items)).toBe(true);
    expect((result.action_plan?.items ?? []).length).toBeGreaterThan(0);
    expect(result.cetesb_licencas_publicas).toBeTruthy();
    expect(result.sanitario).toBeTruthy();
    expect(result.sei_publico).toBeTruthy();
  });

  it("integra A5 CETESB licenças públicas para CNPJ de referência em SP", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_FTE_VECTOR_STORE_ID", "");
    vi.stubEnv("PORTAL_TRANSPARENCIA_API_KEY", "");

    const brasilApiPayloadSp = {
      cnpj: "42365296001085",
      razao_social: "KION SOUTH AMERICA FABRICACAO DE EQUIPAMENTOS PARA ARMAZENAGEM LTDA",
      nome_fantasia: "KION SOUTH AMERICA FAB DE EQUIP PARA ARM LTDA",
      descricao_situacao_cadastral: "ATIVA",
      logradouro: "RODOVIA ENGENHEIRO ERMENIO DE OLIVEIRA PENTEADO",
      numero: "S/N",
      bairro: "BARROCA FUNDA",
      municipio: "INDAIATUBA",
      uf: "SP",
      cep: "13340000",
      cnae_fiscal: "2822402",
      cnae_fiscal_descricao: "Fabricação de máquinas, equipamentos e aparelhos para transporte e elevação de cargas, peças e acessórios",
      cnaes_secundarios: [],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("brasilapi.com.br/api/cnpj/v1/42365296001085")) {
        return new Response(JSON.stringify(brasilApiPayloadSp), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("licenciamento.cetesb.sp.gov.br/cetesb/processo_resultado.asp")) {
        return new Response(Buffer.from(cetesbResultadoFixture, "latin1"), {
          status: 200,
          headers: { "content-type": "text/html; charset=iso-8859-1" },
        });
      }
      if (url.includes("licenciamento.cetesb.sp.gov.br/cetesb/processo_resultado2.asp")) {
        return new Response(Buffer.from(cetesbDetalheFixture, "latin1"), {
          status: 200,
          headers: { "content-type": "text/html; charset=iso-8859-1" },
        });
      }
      return null as any;
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeEnvironmentalCompliance("42.365.296/0010-85");

    expect(result.cetesb_licencas_publicas?.available).toBe(true);
    expect(result.cetesb_licencas_publicas?.method).toBe("portal_connector");
    expect(Array.isArray(result.cetesb_licencas_publicas?.company_matches)).toBe(true);
    expect((result.cetesb_licencas_publicas?.company_matches ?? []).length).toBeGreaterThan(0);
    expect(Array.isArray(result.cetesb_licencas_publicas?.licenses)).toBe(true);
    expect((result.cetesb_licencas_publicas?.licenses ?? []).length).toBeGreaterThan(0);
    expect(result.orchestration.steps.find((step) => step.agent === "agent_5_cetesb_licencas_publicas")?.status).toBe("completed");
  });

  it("integra A8 sanitário para cenário com gatilho e sem gatilho", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_FTE_VECTOR_STORE_ID", "");
    vi.stubEnv("PORTAL_TRANSPARENCIA_API_KEY", "");

    const farmaceuticoPayload = {
      cnpj: "11222333000181",
      razao_social: "EMPRESA FARMACEUTICA TESTE LTDA",
      nome_fantasia: "FARMA TESTE",
      descricao_situacao_cadastral: "ATIVA",
      logradouro: "Rua A",
      numero: "100",
      bairro: "Centro",
      municipio: "Curitiba",
      uf: "PR",
      cep: "80000000",
      cnae_fiscal: "2121101",
      cnae_fiscal_descricao: "Fabricação de medicamentos alopáticos para uso humano",
      cnaes_secundarios: [],
    };
    const softwarePayload = {
      cnpj: "99888777000155",
      razao_social: "SOFTWARE TESTE LTDA",
      nome_fantasia: "SOFT TESTE",
      descricao_situacao_cadastral: "ATIVA",
      logradouro: "Rua B",
      numero: "200",
      bairro: "Centro",
      municipio: "Florianopolis",
      uf: "SC",
      cep: "88000000",
      cnae_fiscal: "6203100",
      cnae_fiscal_descricao: "Desenvolvimento e licenciamento de programas de computador não-customizáveis",
      cnaes_secundarios: [],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("brasilapi.com.br/api/cnpj/v1/11222333000181")) {
        return new Response(JSON.stringify(farmaceuticoPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("brasilapi.com.br/api/cnpj/v1/99888777000155")) {
        return new Response(JSON.stringify(softwarePayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return null as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const withSanitario = await analyzeEnvironmentalCompliance("11.222.333/0001-81");
    expect(Array.isArray(withSanitario.sanitario?.findings)).toBe(true);
    expect((withSanitario.sanitario?.findings ?? []).length).toBeGreaterThan(0);

    const withoutSanitario = await analyzeEnvironmentalCompliance("99.888.777/0001-55");
    expect(withoutSanitario.sanitario?.available).toBe(true);
    expect(Array.isArray(withoutSanitario.sanitario?.findings)).toBe(true);
    expect((withoutSanitario.sanitario?.findings ?? []).length).toBe(0);
  });
});
