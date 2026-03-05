import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeEnvironmentalCompliance } from "../../server/environmental-compliance.mjs";
import { buildCoverageMatrix, getEnvironmentalSourceCatalog } from "../../server/environmental-source-catalog.mjs";
import { getEnvironmentalRuleCatalog } from "../../server/environmental-rule-catalog.mjs";

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
    expect(result.orchestration.steps).toHaveLength(7);
    expect(result.company.cnaes.length).toBeGreaterThan(0);
    expect(result.ux_v2).toBeTruthy();
    expect(result.ux_v2?.executive).toBeTruthy();
    expect(typeof result.ux_v2?.executive?.decision_summary).toBe("string");
    expect(Array.isArray(result.ux_v2?.executive?.coverage_gaps)).toBe(true);
    expect(Array.isArray(result.action_plan?.items)).toBe(true);
    expect((result.action_plan?.items ?? []).length).toBeGreaterThan(0);
  });
});
