import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

async function fetchWithTimeout(url: string, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function queryReceitaFederal(cnpj: string) {
  const res = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res || !res.ok) return null;
  return await res.json();
}

async function queryCGU(endpoint: string, cnpj: string) {
  const res = await fetchWithTimeout(
    `https://api.portaldatransparencia.gov.br/api-de-dados/${endpoint}?cnpjSancionado=${cnpj}&pagina=1`,
    15000
  );
  if (!res) return { status: "unavailable" as const, data: null };
  if (res.status === 403 || res.status === 401) return { status: "unavailable" as const, data: null };
  if (!res.ok) return { status: "error" as const, data: null };
  const data = await res.json();
  return { status: "success" as const, data: Array.isArray(data) ? data : [] };
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

function calculateScore(flags: RiskFlag[]): { score: number; classification: string } {
  const totalWeight = flags.reduce((sum, f) => sum + f.weight, 0);
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
  const flagSummary = flags.map((f) => f.title).join(", ");
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
    const { cnpj } = await req.json();
    if (!cnpj || cnpj.replace(/\D/g, "").length !== 14) {
      return new Response(JSON.stringify({ error: "CNPJ inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanCnpj = cnpj.replace(/\D/g, "");

    // Query all sources in parallel
    const [receitaData, ceisResult, cnepResult, cepimResult] = await Promise.all([
      queryReceitaFederal(cleanCnpj),
      queryCEIS(cleanCnpj),
      queryCNEP(cleanCnpj),
      queryCEPIM(cleanCnpj),
    ]);

    const flags: RiskFlag[] = [];
    const sources: DataSource[] = [];

    // Receita Federal
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

    // CEIS
    if (ceisResult.status === "success") {
      sources.push({ name: "CEIS — Empresas Inidôneas e Suspensas", status: ceisResult.data?.length ? "success" : "not_found" });
      if (ceisResult.data && ceisResult.data.length > 0) {
        flags.push({
          id: "ceis",
          source: "CEIS (CGU)",
          severity: "critical",
          title: "Empresa no CEIS",
          description: "Cadastrada no Cadastro de Empresas Inidôneas e Suspensas. Impedida de contratar com a administração pública.",
          weight: 35,
        });
      }
    } else {
      sources.push({ name: "CEIS — Empresas Inidôneas e Suspensas", status: ceisResult.status, message: "API indisponível (requer chave do Portal da Transparência)" });
    }

    // CNEP
    if (cnepResult.status === "success") {
      sources.push({ name: "CNEP — Empresas Punidas", status: cnepResult.data?.length ? "success" : "not_found" });
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
      sources.push({ name: "CNEP — Empresas Punidas", status: cnepResult.status, message: "API indisponível (requer chave do Portal da Transparência)" });
    }

    // CEPIM
    if (cepimResult.status === "success") {
      sources.push({ name: "CEPIM — Entidades Impedidas", status: cepimResult.data?.length ? "success" : "not_found" });
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
      sources.push({ name: "CEPIM — Entidades Impedidas", status: cepimResult.status, message: "API indisponível (requer chave do Portal da Transparência)" });
    }

    // Additional sources marked as unavailable (require specific API keys or are not freely available)
    sources.push({ name: "TCU — Licitantes Inidôneos", status: "unavailable", message: "API requer autenticação específica" });
    sources.push({ name: "MTE — Lista de Trabalho Escravo", status: "unavailable", message: "Dados não disponíveis via API pública" });
    sources.push({ name: "PGFN — Dívida Ativa", status: "unavailable", message: "API requer certificado digital" });
    sources.push({ name: "Servidores Federais (CGU)", status: "unavailable", message: "Requer chave do Portal da Transparência" });

    // Build company data
    const company = receitaData
      ? {
          cnpj: cleanCnpj,
          razao_social: receitaData.razao_social || "",
          nome_fantasia: receitaData.nome_fantasia || "",
          situacao_cadastral: receitaData.descricao_situacao_cadastral || "Desconhecida",
          data_situacao_cadastral: receitaData.data_situacao_cadastral || "",
          data_inicio_atividade: receitaData.data_inicio_atividade || "",
          cnae_fiscal: receitaData.cnae_fiscal || 0,
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
          capital_social: receitaData.capital_social || 0,
          qsa: (receitaData.qsa || []).map((s: any) => ({
            nome: s.nome_socio || s.nome || "",
            qual: s.qualificacao_socio || s.qual || "",
            pais_origem: s.pais_origem || "BRASIL",
            nome_rep_legal: s.nome_representante_legal || s.nome_rep_legal || "",
            qual_rep_legal: s.qualificacao_representante_legal || s.qual_rep_legal || "",
            faixa_etaria: s.faixa_etaria || "",
            cnpj_cpf_do_socio: s.cnpj_cpf_do_socio || "",
            tipo: s.identificador_de_socio === 1 ? "PJ" : "PF",
          })),
        }
      : null;

    if (!company) {
      return new Response(
        JSON.stringify({ error: "Não foi possível obter dados da empresa. Verifique o CNPJ." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
