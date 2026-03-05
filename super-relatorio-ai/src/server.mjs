import express from "express";
import OpenAI from "openai";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4.1").trim();
const DATASWEEP_API_URL = (process.env.DATASWEEP_API_URL || "https://data-sweep-engine-web-production.up.railway.app").replace(/\/+$/, "");

app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

function cleanCnpj(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatCurrencyBRL(value) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function fetchDatasweepPayload(cnpj) {
  const attempts = [
    { path: "/api/environmental-compliance", kind: "environmental" },
    { path: "/api/analyze-cnpj", kind: "legacy_risk" },
  ];

  let lastError = "Falha ao consultar DataSweep.";

  for (const attempt of attempts) {
    const response = await fetch(`${DATASWEEP_API_URL}${attempt.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cnpj }),
    });

    const payload = await response.json().catch(() => null);
    if (response.ok && payload && typeof payload === "object") {
      return {
        kind: attempt.kind,
        payload,
      };
    }

    const apiMessage =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `Erro ${response.status} em ${attempt.path}`;
    lastError = apiMessage;
  }

  throw new Error(lastError);
}

function normalizeLegacyRiskPayload(payload) {
  const company = payload?.company || {};
  const cnaeCode = company?.cnae_fiscal ? String(company.cnae_fiscal) : "";
  const cnaeDescription = company?.cnae_fiscal_descricao ? String(company.cnae_fiscal_descricao) : "";
  const cnaes = cnaeCode
    ? [{ codigo: cnaeCode, descricao: cnaeDescription, principal: true }]
    : [];
  const flags = Array.isArray(payload?.flags) ? payload.flags : [];

  const severityCount = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const flag of flags) {
    const key = String(flag?.severity || "").toLowerCase();
    if (key in severityCount) severityCount[key] += 1;
  }

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source: "DataSweep (legado /api/analyze-cnpj)",
    },
    company: {
      cnpj: company?.cnpj || null,
      razao_social: company?.razao_social || null,
      nome_fantasia: company?.nome_fantasia || null,
      situacao: company?.situacao_cadastral || null,
      endereco: [company?.logradouro, company?.numero, company?.bairro, company?.municipio, company?.uf]
        .filter(Boolean)
        .join(", "),
      cnaes,
    },
    compliance_summary: {
      score: Number(payload?.score || 0),
      classification: payload?.classification || null,
      summary_text: payload?.summary || null,
      total_flags: flags.length,
    },
    highlights: {
      total_cnaes: cnaes.length,
      total_alerts: flags.length,
      ibama_matches: 0,
      cetesb_matches: 0,
      municipal_matches: 0,
      govbr_contract_records: 0,
      govbr_contract_sample: [],
      flag_severity_distribution: severityCount,
    },
    sources: Array.isArray(payload?.sources) ? payload.sources : [],
    raw: payload,
  };
}

function normalizeEnvironmentalPayload(payload) {
  const company = payload?.company || {};
  const summary = payload?.summary || {};
  const govbr = payload?.govbr_context || null;
  const ibama = payload?.ibama || { matches: [] };
  const cetesb = payload?.cetesb || { matches: [] };
  const municipal = payload?.municipal || { matches: [] };
  const cnaes = Array.isArray(company.cnaes) ? company.cnaes : [];

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source: "DataSweep Ambiental (/api/environmental-compliance)",
    },
    company: {
      cnpj: company.cnpj,
      razao_social: company.razao_social,
      nome_fantasia: company.nome_fantasia,
      situacao: company.situacao,
      endereco: company.endereco,
      cnaes,
    },
    compliance_summary: summary,
    highlights: {
      total_cnaes: cnaes.length,
      total_alerts: Number(summary.total_alerts || 0),
      ibama_matches: Array.isArray(ibama.matches) ? ibama.matches.length : 0,
      cetesb_matches: Array.isArray(cetesb.matches) ? cetesb.matches.length : 0,
      municipal_matches: Array.isArray(municipal.matches) ? municipal.matches.length : 0,
      govbr_contract_records: Number(govbr?.found_records || 0),
      govbr_contract_sample: Array.isArray(govbr?.sample)
        ? govbr.sample.map((item) => ({
            numero: item.numero,
            modalidade: item.modalidade,
            orgao: item.orgao,
            valor_formatado: formatCurrencyBRL(item.valor),
          }))
        : [],
    },
    sources: Array.isArray(payload?.sources) ? payload.sources : [],
    raw: payload,
  };
}

function buildInputForLLM(datasweepResponse) {
  if (datasweepResponse?.kind === "legacy_risk") {
    return normalizeLegacyRiskPayload(datasweepResponse.payload);
  }
  return normalizeEnvironmentalPayload(datasweepResponse?.payload);
}

function extractResponseText(response) {
  if (response && typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (Array.isArray(response?.output)) {
    const chunks = [];
    for (const item of response.output) {
      if (!Array.isArray(item?.content)) continue;
      for (const content of item.content) {
        if (typeof content?.text === "string" && content.text.trim()) {
          chunks.push(content.text.trim());
        }
      }
    }
    if (chunks.length > 0) return chunks.join("\n\n");
  }

  return "";
}

async function generateSuperReport(payload) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada.");
  }

  const client = new OpenAI({ apiKey });

  const systemPrompt = [
    "Você é um especialista sênior em compliance ambiental e governança corporativa no Brasil.",
    "Gere um relatório executivo ultra claro, direto, orientado à decisão e auditável.",
    "Escreva em português do Brasil.",
    "Se houver incerteza, diga explicitamente.",
    "Não invente fatos fora dos dados fornecidos.",
    "Estruture o relatório exatamente nas seções:",
    "1) Resumo Executivo",
    "2) Perfil da Empresa e CNAEs",
    "3) Matriz de Risco Ambiental (IBAMA, CETESB, Municipal)",
    "4) Achados em Contratações Públicas (gov.br)",
    "5) Pontos Críticos e Lacunas",
    "6) Plano de Ação 30-60-90 dias",
    "7) Checklist de Evidências para Auditoria",
    "8) Disclaimer Técnico-Jurídico",
    "Use tabelas em markdown quando útil.",
    "No Plano 30-60-90, inclua responsável sugerido, prazo e prioridade.",
  ].join("\n");

  const userPrompt = `Dados estruturados para análise:\n\n${JSON.stringify(payload, null, 2)}`;

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    max_output_tokens: 2600,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
  });

  const reportMarkdown = extractResponseText(response);
  if (!reportMarkdown) {
    throw new Error("A OpenAI não retornou texto de relatório.");
  }

  return {
    reportMarkdown,
    model: OPENAI_MODEL,
    usage: response.usage || null,
  };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "super-relatorio-ai" });
});

app.post("/api/super-report", async (req, res) => {
  const clean = cleanCnpj(req.body?.cnpj);
  if (clean.length !== 14) {
    return res.status(400).json({ error: "CNPJ inválido. Informe 14 dígitos." });
  }

  try {
    const datasweep = await fetchDatasweepPayload(clean);
    const llmInput = buildInputForLLM(datasweep);
    const llmResult = await generateSuperReport(llmInput);

    const payload = datasweep?.payload || {};

    return res.json({
      cnpj: clean,
      datasource_kind: datasweep?.kind || null,
      company: payload.company || null,
      summary: payload.summary || null,
      govbr_context: payload.govbr_context || null,
      sources: payload.sources || [],
      report_markdown: llmResult.reportMarkdown,
      llm: {
        provider: "openai",
        model: llmResult.model,
        usage: llmResult.usage,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: `Falha ao gerar super relatório: ${message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Super Relatorio AI rodando em http://0.0.0.0:${PORT}`);
});
