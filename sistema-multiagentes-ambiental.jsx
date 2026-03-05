import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE BASES (embedded for offline AI interpretation)
// ═══════════════════════════════════════════════════════════════════

const FTE_CATEGORIES = [
  { id: 1, name: "Extração e Tratamento de Minerais", cnae_prefixes: ["05", "06", "07", "08", "09"], keywords: ["mineração", "extração mineral", "pedreira", "areia", "argila", "calcário"] },
  { id: 2, name: "Indústria de Produtos Minerais Não Metálicos", cnae_prefixes: ["23"], keywords: ["cerâmica", "cimento", "vidro", "gesso", "amianto"] },
  { id: 3, name: "Indústria Metalúrgica", cnae_prefixes: ["24"], keywords: ["siderurgia", "metalurgia", "aço", "ferro", "fundição"] },
  { id: 4, name: "Indústria Mecânica", cnae_prefixes: ["25", "28"], keywords: ["máquinas", "equipamentos", "caldeiraria", "usinagem"] },
  { id: 5, name: "Indústria de Material Elétrico, Eletrônico e Comunicações", cnae_prefixes: ["26", "27"], keywords: ["eletrônico", "elétrico", "telecomunicação", "semicondutor"] },
  { id: 6, name: "Indústria de Material de Transporte", cnae_prefixes: ["29", "30"], keywords: ["veículo", "automóvel", "embarcação", "aeronave", "locomotiva"] },
  { id: 7, name: "Indústria de Madeira", cnae_prefixes: ["16"], keywords: ["madeira", "serraria", "compensado", "laminado"] },
  { id: 8, name: "Indústria de Papel e Celulose", cnae_prefixes: ["17"], keywords: ["papel", "celulose", "papelão", "embalagem papel"] },
  { id: 9, name: "Indústria de Borracha", cnae_prefixes: ["22.1"], keywords: ["borracha", "pneu", "artefato borracha"] },
  { id: 10, name: "Indústria de Couros e Peles", cnae_prefixes: ["15.1"], keywords: ["couro", "curtume", "pele animal"] },
  { id: 11, name: "Indústria Têxtil, de Vestuário, Calçados e Artefatos de Tecidos", cnae_prefixes: ["13", "15.2", "15.3", "15.4"], keywords: ["têxtil", "tecelagem", "fiação", "tinturaria", "calçado"] },
  { id: 12, name: "Indústria de Produtos de Matéria Plástica", cnae_prefixes: ["22.2"], keywords: ["plástico", "polímero", "embalagem plástica"] },
  { id: 13, name: "Indústria do Fumo", cnae_prefixes: ["12"], keywords: ["fumo", "tabaco", "cigarro"] },
  { id: 14, name: "Indústrias Diversas", cnae_prefixes: ["32"], keywords: ["joalheria", "brinquedo", "instrumento musical"] },
  { id: 15, name: "Indústria Química", cnae_prefixes: ["20", "21"], keywords: ["química", "farmacêutica", "petroquímica", "fertilizante", "agrotóxico", "tintas", "verniz", "resina", "solvente"] },
  { id: 16, name: "Indústria de Produtos Alimentares e Bebidas", cnae_prefixes: ["10", "11"], keywords: ["alimento", "bebida", "frigorífico", "laticínio", "açúcar", "álcool"] },
  { id: 17, name: "Serviços de Utilidade", cnae_prefixes: ["35", "36", "37", "38", "39"], keywords: ["energia", "água", "esgoto", "resíduo", "reciclagem", "limpeza urbana"] },
  { id: 18, name: "Transporte, Terminais, Depósitos e Comércio", cnae_prefixes: ["49", "50", "51", "52"], keywords: ["transporte", "terminal", "armazém", "depósito", "combustível", "posto gasolina"] },
  { id: 19, name: "Turismo", cnae_prefixes: ["55", "79"], keywords: ["hotel", "resort", "complexo turístico"] },
  { id: 20, name: "Uso de Recursos Naturais", cnae_prefixes: ["01", "02", "03"], keywords: ["silvicultura", "pesca", "aquicultura", "agricultura", "pecuária", "fauna", "flora"] },
];

const CETESB_ANEXO5_CNAES = [
  "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17",
  "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "31", "32", "33", "35", "36", "37", "38", "39", "41", "42", "43", "45", "46",
  "47", "49", "50", "51", "52", "53", "55", "56", "71", "72", "75", "77", "80",
  "81", "82", "85", "86", "87", "88", "90", "91", "93", "94", "95", "96"
];

const CONSEMA_INDUSTRIAL_CNAES = [
  "1011", "1012", "1013", "1020", "1031", "1032", "1033", "1041", "1042", "1043",
  "1051", "1052", "1053", "1061", "1062", "1063", "1064", "1065", "1066", "1069",
  "1071", "1072", "1081", "1082", "1091", "1092", "1093", "1094", "1095", "1096",
  "1099", "1111", "1112", "1113", "1121", "1122", "1220", "1311", "1312", "1313",
  "1314", "1321", "1322", "1323", "1330", "1340", "1351", "1352", "1353", "1354",
  "1359", "1411", "1412", "1413", "1414", "1421", "1422", "1510", "1521", "1529",
  "1531", "1532", "1533", "1539", "1540", "1610", "1621", "1622", "1623", "1629",
  "1710", "1721", "1722", "1731", "1732", "1733", "1741", "1742", "1749", "1811",
  "1812", "1813", "1821", "1822", "1830", "1910", "1921", "1922", "1931", "1932",
  "2011", "2012", "2013", "2014", "2019", "2021", "2022", "2029", "2031", "2032",
  "2033", "2040", "2051", "2052", "2061", "2062", "2063", "2071", "2072", "2073",
  "2091", "2092", "2093", "2094", "2099", "2110", "2121", "2122", "2123", "2211",
  "2212", "2219", "2221", "2222", "2223", "2229", "2311", "2312", "2319", "2320",
  "2330", "2341", "2342", "2349", "2391", "2392", "2399", "2411", "2412", "2421",
  "2422", "2431", "2432", "2439", "2441", "2442", "2443", "2449", "2451", "2452",
  "2511", "2512", "2513", "2521", "2522", "2531", "2532", "2539", "2541", "2542",
  "2543", "2550", "2591", "2592", "2593", "2599", "2610", "2621", "2622", "2631",
  "2632", "2640", "2651", "2652", "2660", "2670", "2680", "2710", "2721", "2722",
  "2731", "2732", "2733", "2740", "2751", "2759", "2790", "2811", "2812", "2813",
  "2814", "2815", "2821", "2822", "2823", "2824", "2825", "2829", "2831", "2832",
  "2833", "2840", "2851", "2852", "2853", "2854", "2861", "2862", "2863", "2864",
  "2865", "2866", "2869", "2910", "2920", "2930", "2941", "2942", "2943", "2944",
  "2945", "2949", "2950", "3011", "3012", "3031", "3032", "3041", "3042", "3050",
  "3091", "3092", "3099", "3101", "3102", "3103", "3104", "3211", "3212", "3230",
  "3240", "3250", "3291", "3292", "3299", "3311", "3312", "3313", "3314", "3315",
  "3316", "3317", "3319", "3321", "3329", "3511", "3512", "3513", "3514", "3520",
  "3530", "3600", "3701", "3702", "3811", "3812", "3821", "3822", "3831", "3832",
  "3839", "3900",
];

// ═══════════════════════════════════════════════════════════════════
// AGENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

async function agentBuscaCNPJ(cnpj) {
  const cleanCnpj = cnpj.replace(/\D/g, "");
  if (cleanCnpj.length !== 14) throw new Error("CNPJ inválido. Deve conter 14 dígitos.");

  // Try multiple APIs with fallback
  const apis = [
    { name: "BrasilAPI", url: `https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}` },
    { name: "OpenCNPJ", url: `https://api.opencnpj.org/${cleanCnpj}` },
  ];

  for (const api of apis) {
    try {
      const res = await fetch(api.url, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
      });
      if (!res.ok) continue;
      const data = await res.json();

      // Normalize response
      if (api.name === "BrasilAPI") {
        const cnaes = [];
        if (data.cnae_fiscal) {
          cnaes.push({
            codigo: String(data.cnae_fiscal),
            descricao: data.cnae_fiscal_descricao || "",
            principal: true
          });
        }
        if (data.cnaes_secundarios) {
          data.cnaes_secundarios.forEach(c => {
            cnaes.push({
              codigo: String(c.codigo),
              descricao: c.descricao || "",
              principal: false
            });
          });
        }
        return {
          razao_social: data.razao_social || data.nome_fantasia || "",
          nome_fantasia: data.nome_fantasia || "",
          cnpj: cleanCnpj,
          situacao: data.descricao_situacao_cadastral || "",
          endereco: `${data.logradouro || ""}, ${data.numero || ""} - ${data.bairro || ""}, ${data.municipio || ""}/${data.uf || ""}`,
          cnaes,
          source: api.name
        };
      }

      if (api.name === "OpenCNPJ") {
        const cnaes = [];
        if (data.cnae_principal) {
          cnaes.push({
            codigo: String(data.cnae_principal),
            descricao: "",
            principal: true
          });
        }
        if (data.cnaes_secundarios) {
          data.cnaes_secundarios.forEach(c => {
            cnaes.push({
              codigo: String(c),
              descricao: "",
              principal: false
            });
          });
        }
        return {
          razao_social: data.razao_social || "",
          nome_fantasia: data.nome_fantasia || "",
          cnpj: cleanCnpj,
          situacao: data.situacao_cadastral || "",
          endereco: `${data.logradouro || ""}, ${data.numero || ""} - ${data.municipio || ""}/${data.uf || ""}`,
          cnaes,
          source: api.name
        };
      }
    } catch (e) {
      continue;
    }
  }

  throw new Error("Não foi possível consultar o CNPJ. Verifique o número e tente novamente.");
}

function agentIBAMA(cnaes) {
  const results = [];
  const matchedCategories = new Set();

  for (const cnae of cnaes) {
    const code = cnae.codigo.replace(/[.\-/]/g, "");
    const prefix2 = code.substring(0, 2);
    const prefix3 = code.substring(0, 3);

    for (const cat of FTE_CATEGORIES) {
      if (matchedCategories.has(cat.id)) continue;
      const matched = cat.cnae_prefixes.some(p => {
        const cleanP = p.replace(".", "");
        return code.startsWith(cleanP) || prefix2 === cleanP || prefix3 === cleanP;
      });

      if (matched) {
        matchedCategories.add(cat.id);
        results.push({
          categoria: cat.id,
          nome: cat.name,
          cnae_match: cnae.codigo,
          cnae_desc: cnae.descricao,
          link_fte: `https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias`,
          link_tabela: `https://www.ibama.gov.br/phocadownload/qualidadeambiental/relatorios/2009/2019-03-06-Ibama-Tabela-FTE%20-completa.pdf`,
          obrigacao: "Inscrição no CTF/APP obrigatória. Verificar FTE específica para confirmar enquadramento.",
          risco: "alto"
        });
      }
    }
  }

  // Check for keywords match on description
  for (const cnae of cnaes) {
    const desc = (cnae.descricao || "").toLowerCase();
    for (const cat of FTE_CATEGORIES) {
      if (matchedCategories.has(cat.id)) continue;
      const kwMatch = cat.keywords.some(kw => desc.includes(kw));
      if (kwMatch) {
        matchedCategories.add(cat.id);
        results.push({
          categoria: cat.id,
          nome: cat.name,
          cnae_match: cnae.codigo,
          cnae_desc: cnae.descricao,
          link_fte: `https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/ftes-por-categorias`,
          link_tabela: `https://www.ibama.gov.br/phocadownload/qualidadeambiental/relatorios/2009/2019-03-06-Ibama-Tabela-FTE%20-completa.pdf`,
          obrigacao: "Possível enquadramento por descrição. Consultar FTE para confirmação.",
          risco: "medio"
        });
      }
    }
  }

  return {
    enquadrado: results.length > 0,
    matches: results,
    nota: "A CNAE é referência, não determinante. O enquadramento final depende da análise da FTE específica (IN Ibama nº 13/2021).",
    link_consulta: "https://www.gov.br/ibama/pt-br/servicos/cadastros/ctf/ctf-app/ftes/enquadramento-passo-a-passo"
  };
}

function agentCETESB(cnaes) {
  const results = [];

  for (const cnae of cnaes) {
    const code = cnae.codigo.replace(/[.\-/]/g, "");
    const prefix2 = code.substring(0, 2);
    const prefix4 = code.substring(0, 4);

    // Check Anexo 5 match (by division/2 digits)
    const anexo5Match = CETESB_ANEXO5_CNAES.includes(prefix2);

    if (anexo5Match) {
      results.push({
        cnae: cnae.codigo,
        descricao: cnae.descricao,
        tipo: "Anexo 5 - Fonte de Poluição",
        obrigacao: "Licenciamento Ambiental obrigatório (LP, LI, LO) conforme Art. 58 do Regulamento da Lei 997/76",
        risco: "alto",
        legislacao: [
          "Lei Estadual nº 997/76",
          "Decreto nº 8.468/76",
          "Decreto nº 47.397/02"
        ]
      });
    }
  }

  // Check Anexo 10 (LP precedente)
  const anexo10_prefixes = ["05", "06", "07", "08", "19", "20", "23", "24", "35", "36", "37", "38"];
  const needsLP = cnaes.some(c => {
    const code = c.codigo.replace(/[.\-/]/g, "");
    return anexo10_prefixes.includes(code.substring(0, 2));
  });

  // Check RMSP restrictions
  const rmsp_restricted = ["20", "24", "19", "23"];
  const rmspIssues = cnaes.filter(c => {
    const code = c.codigo.replace(/[.\-/]/g, "");
    return rmsp_restricted.includes(code.substring(0, 2));
  });

  return {
    enquadrado: results.length > 0,
    matches: results,
    lp_precedente: needsLP,
    rmsp_restricoes: rmspIssues.length > 0,
    nota_rmsp: rmspIssues.length > 0
      ? "Atenção: Algumas atividades podem ter restrições na RMSP (Lei Estadual nº 1.817/78) e em áreas de drenagem do Rio Piracicaba (Lei 9.825/97)."
      : null,
    links: {
      atividades: "https://licenciamento.cetesb.sp.gov.br/cetesb/atividades_empreendimentos.asp",
      tabela_atividades: "https://cetesb.sp.gov.br/licenciamentoambiental/wp-content/uploads/sites/32/2025/02/Atividades-passiveis-de-licenciamento.pdf",
      portal_licenciamento: "https://cetesb.sp.gov.br/licenciamentoambiental/"
    }
  };
}

function agentMunicipal(cnaes) {
  const results = [];

  for (const cnae of cnaes) {
    const code = cnae.codigo.replace(/[.\-/]/g, "");
    const prefix4 = code.substring(0, 4);

    const isConsema = CONSEMA_INDUSTRIAL_CNAES.some(c => code.startsWith(c.replace(/[.\-/]/g, "")));

    if (isConsema) {
      results.push({
        cnae: cnae.codigo,
        descricao: cnae.descricao,
        enquadramento: "Deliberação CONSEMA 01/2024 - Impacto Local",
        competencia: "Municipal (se município habilitado) ou CETESB",
        risco: "medio"
      });
    }
  }

  // Non-industrial activities check
  const nonIndustrial = [
    { pattern: /^41|^42|^43/, desc: "Construção civil / obras" },
    { pattern: /^55|^56/, desc: "Alojamento e alimentação" },
    { pattern: /^86|^87|^88/, desc: "Saúde" },
    { pattern: /^47/, desc: "Comércio varejista" },
    { pattern: /^49|^50|^51|^52/, desc: "Transporte e armazenamento" },
  ];

  for (const cnae of cnaes) {
    const code = cnae.codigo.replace(/[.\-/]/g, "");
    for (const ni of nonIndustrial) {
      if (ni.pattern.test(code)) {
        results.push({
          cnae: cnae.codigo,
          descricao: cnae.descricao || ni.desc,
          enquadramento: "Verificar Anexo I, item I da DN CONSEMA 01/2024 (atividades não industriais)",
          competencia: "Municipal (conforme porte e impacto)",
          risco: "baixo"
        });
        break;
      }
    }
  }

  return {
    enquadrado: results.length > 0,
    matches: results,
    legislacao: {
      lc140: "https://www.planalto.gov.br/ccivil_03/leis/LCP/Lcp140.htm",
      consema: "https://smastr16.blob.core.windows.net/home/2024/03/Deliberacao-Normativa-CONSEMA-01_2024-assinada.pdf",
      municipios_habilitados: "https://semil.sp.gov.br/consema/licenciamento-ambiental-municipal/"
    },
    nota: "A competência depende da habilitação do município junto ao CONSEMA. Se não habilitado, a CETESB assume o licenciamento."
  };
}

function agentAreasContaminadas(endereco) {
  return {
    instrucao: "A verificação de áreas contaminadas requer consulta georreferenciada nos sistemas oficiais.",
    sistemas: [
      {
        nome: "Mapa Interativo SEMIL/CETESB",
        url: "https://mapas.semil.sp.gov.br/portal/apps/webappviewer/index.html?id=77da778c122c4ccda8a8d6babce61b63",
        descricao: "Mapa georreferenciado com todas as áreas contaminadas e reabilitadas do Estado de SP. Permite busca por endereço e visualização de camadas.",
        tipo: "geo"
      },
      {
        nome: "SIGAM - Relação de Áreas Contaminadas",
        url: "https://sigam.ambiente.sp.gov.br/sigam3/Default.aspx?idPagina=17676",
        descricao: "Sistema Integrado de Gestão Ambiental - busca textual por áreas contaminadas e reabilitadas.",
        tipo: "lista"
      },
      {
        nome: "Relação Georreferenciada CETESB",
        url: "https://cetesb.sp.gov.br/areas-contaminadas/relacao-de-areas-contaminadas/",
        descricao: "Relação oficial atualizada em tempo real da CETESB com estatísticas e dados por município.",
        tipo: "relatorio"
      },
      {
        nome: "GeoSampa (Município de São Paulo)",
        url: "https://geosampa.prefeitura.sp.gov.br/",
        descricao: "Para empreendimentos em São Paulo capital - ativar camadas de Áreas Contaminadas no sistema municipal.",
        tipo: "geo"
      }
    ],
    legislacao: {
      lei_estadual: "Lei Estadual nº 13.577/2009 - Proteção da qualidade do solo e gerenciamento de áreas contaminadas",
      decreto: "Decreto nº 59.263/2013 - Regulamenta a Lei 13.577/2009",
      it_cetesb: "Instrução Técnica nº 039 da CETESB - Atividades Prioritárias para Gerenciamento de Áreas Contaminadas"
    },
    alerta: endereco
      ? `Consulte os sistemas acima informando o endereço: ${endereco}`
      : "Informe o endereço do empreendimento para orientar a consulta nos mapas georreferenciados."
  };
}

// ═══════════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════

const formatCnpj = (v) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const Badge = ({ type, children }) => {
  const colors = {
    alto: "bg-red-100 text-red-800 border border-red-200",
    medio: "bg-amber-100 text-amber-800 border border-amber-200",
    baixo: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    info: "bg-sky-100 text-sky-800 border border-sky-200",
    neutral: "bg-gray-100 text-gray-700 border border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[type] || colors.neutral}`}>
      {children}
    </span>
  );
};

const ExternalLink = ({ href, children }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 underline decoration-sky-300 hover:decoration-sky-500 transition-colors text-sm"
  >
    {children}
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  </a>
);

const AgentCard = ({ number, title, icon, status, children }) => {
  const [open, setOpen] = useState(true);
  const statusColors = {
    success: "border-l-emerald-500 bg-emerald-50/30",
    warning: "border-l-amber-500 bg-amber-50/30",
    danger: "border-l-red-500 bg-red-50/30",
    info: "border-l-sky-500 bg-sky-50/30",
    idle: "border-l-gray-300 bg-white",
  };

  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${statusColors[status] || statusColors.idle} overflow-hidden shadow-sm transition-all duration-300`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
            {number}
          </div>
          <span className="text-xl mr-2">{icon}</span>
          <h3 className="font-semibold text-gray-900 text-left">{title}</h3>
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100">{children}</div>}
    </div>
  );
};

const Spinner = () => (
  <div className="flex items-center gap-3 py-4">
    <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
    <span className="text-sm text-gray-500">Processando agente...</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// MAIN APPLICATION
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(0);
  const [error, setError] = useState(null);

  const [dadosCNPJ, setDadosCNPJ] = useState(null);
  const [resultIBAMA, setResultIBAMA] = useState(null);
  const [resultCETESB, setResultCETESB] = useState(null);
  const [resultMunicipal, setResultMunicipal] = useState(null);
  const [resultAreas, setResultAreas] = useState(null);

  const reset = () => {
    setDadosCNPJ(null);
    setResultIBAMA(null);
    setResultCETESB(null);
    setResultMunicipal(null);
    setResultAreas(null);
    setError(null);
    setCurrentAgent(0);
  };

  const handleRun = async () => {
    reset();
    setLoading(true);

    try {
      // Agent 1: CNPJ
      setCurrentAgent(1);
      const empresa = await agentBuscaCNPJ(cnpj);
      setDadosCNPJ(empresa);
      await new Promise(r => setTimeout(r, 400));

      if (!empresa.cnaes || empresa.cnaes.length === 0) {
        setError("Nenhum CNAE encontrado para este CNPJ.");
        setLoading(false);
        return;
      }

      // Agent 2: IBAMA
      setCurrentAgent(2);
      const ibama = agentIBAMA(empresa.cnaes);
      setResultIBAMA(ibama);
      await new Promise(r => setTimeout(r, 300));

      // Agent 3: CETESB
      setCurrentAgent(3);
      const cetesb = agentCETESB(empresa.cnaes);
      setResultCETESB(cetesb);
      await new Promise(r => setTimeout(r, 300));

      // Agent 4: Municipal
      setCurrentAgent(4);
      const municipal = agentMunicipal(empresa.cnaes);
      setResultMunicipal(municipal);
      await new Promise(r => setTimeout(r, 300));

      // Agent 5: Áreas Contaminadas
      setCurrentAgent(5);
      const areas = agentAreasContaminadas(empresa.endereco);
      setResultAreas(areas);

      setCurrentAgent(6);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const totalAlerts = (resultIBAMA?.matches?.length || 0) + (resultCETESB?.matches?.length || 0) + (resultMunicipal?.matches?.length || 0);

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div className="bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-lg">🌿</div>
            <h1 className="text-2xl font-bold tracking-tight">Compliance Ambiental</h1>
          </div>
          <p className="text-gray-400 text-sm ml-13">
            Sistema multiagentes de verificação de enquadramento em licenciamento ambiental
          </p>

          {/* Input */}
          <div className="mt-6 flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={cnpj}
                onChange={e => setCnpj(formatCnpj(e.target.value))}
                placeholder="Digite o CNPJ (ex: 00.000.000/0001-00)"
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                onKeyDown={e => e.key === "Enter" && !loading && cnpj.replace(/\D/g, "").length === 14 && handleRun()}
              />
            </div>
            <button
              onClick={handleRun}
              disabled={loading || cnpj.replace(/\D/g, "").length !== 14}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors text-sm whitespace-nowrap"
            >
              {loading ? "Analisando..." : "Verificar Compliance"}
            </button>
          </div>
        </div>
      </div>

      {/* Progress */}
      {loading && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-5xl mx-auto px-6 py-3">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {["CNPJ/CNAE", "IBAMA/FTE", "CETESB/SP", "Municipal", "Áreas Contam."].map((label, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${
                    currentAgent > i + 1 ? "bg-emerald-500" :
                    currentAgent === i + 1 ? "bg-amber-500 animate-pulse" : "bg-gray-300"
                  }`} />
                  <span className={currentAgent === i + 1 ? "text-gray-900 font-medium" : ""}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 text-red-800 text-sm">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {/* Summary */}
        {dadosCNPJ && currentAgent > 1 && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="font-bold text-gray-900">{dadosCNPJ.razao_social}</h2>
                {dadosCNPJ.nome_fantasia && <p className="text-sm text-gray-500">{dadosCNPJ.nome_fantasia}</p>}
                <p className="text-xs text-gray-400 mt-1">{dadosCNPJ.endereco}</p>
              </div>
              <div className="text-right">
                <Badge type={dadosCNPJ.situacao?.toLowerCase().includes("ativa") ? "baixo" : "alto"}>
                  {dadosCNPJ.situacao || "N/A"}
                </Badge>
                <p className="text-xs text-gray-400 mt-1">Fonte: {dadosCNPJ.source}</p>
              </div>
            </div>
            {currentAgent >= 6 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">CNAEs:</span>
                  <span className="font-semibold">{dadosCNPJ.cnaes.length}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Enquadramentos:</span>
                  <span className="font-semibold text-red-700">{totalAlerts}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Agent 1: CNAEs */}
        {(dadosCNPJ || currentAgent === 1) && (
          <AgentCard
            number={1}
            title="Consulta CNPJ — CNAEs"
            icon="🏢"
            status={dadosCNPJ ? "success" : currentAgent === 1 ? "info" : "idle"}
          >
            {currentAgent === 1 && !dadosCNPJ && <Spinner />}
            {dadosCNPJ && (
              <div className="mt-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Código</th>
                        <th className="pb-2 pr-3">Descrição</th>
                        <th className="pb-2">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dadosCNPJ.cnaes.map((c, i) => (
                        <tr key={i} className="text-gray-700">
                          <td className="py-2 pr-3 font-mono text-xs">{c.codigo}</td>
                          <td className="py-2 pr-3 text-xs">{c.descricao || "—"}</td>
                          <td className="py-2">
                            <Badge type={c.principal ? "info" : "neutral"}>
                              {c.principal ? "Principal" : "Secundário"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  APIs utilizadas: BrasilAPI (brasilapi.com.br) ou OpenCNPJ (opencnpj.org) — dados públicos da Receita Federal
                </p>
              </div>
            )}
          </AgentCard>
        )}

        {/* Agent 2: IBAMA */}
        {(resultIBAMA || currentAgent === 2) && (
          <AgentCard
            number={2}
            title="IBAMA — CTF/APP e FTE"
            icon="🦜"
            status={
              resultIBAMA ? (resultIBAMA.enquadrado ? "danger" : "success") :
              currentAgent === 2 ? "info" : "idle"
            }
          >
            {currentAgent === 2 && !resultIBAMA && <Spinner />}
            {resultIBAMA && (
              <div className="mt-3 space-y-3">
                {resultIBAMA.enquadrado ? (
                  <>
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                      <strong>⚠️ Enquadramento identificado</strong> em {resultIBAMA.matches.length} categoria(s) do CTF/APP
                    </div>
                    {resultIBAMA.matches.map((m, i) => (
                      <div key={i} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-sm text-gray-900">
                              Cat. {m.categoria} — {m.nome}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Match: CNAE {m.cnae_match} {m.cnae_desc ? `(${m.cnae_desc})` : ""}
                            </p>
                          </div>
                          <Badge type={m.risco}>{m.risco === "alto" ? "Risco Alto" : "Verificar"}</Badge>
                        </div>
                        <p className="text-xs text-gray-600 mt-2">{m.obrigacao}</p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <ExternalLink href={m.link_fte}>FTEs por Categoria</ExternalLink>
                          <ExternalLink href={m.link_tabela}>Tabela Completa FTE</ExternalLink>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    ✅ Nenhum enquadramento direto identificado por CNAE nas categorias do CTF/APP.
                  </div>
                )}
                <p className="text-xs text-gray-400 italic">{resultIBAMA.nota}</p>
                <ExternalLink href={resultIBAMA.link_consulta}>Guia de enquadramento passo a passo (IBAMA)</ExternalLink>
              </div>
            )}
          </AgentCard>
        )}

        {/* Agent 3: CETESB */}
        {(resultCETESB || currentAgent === 3) && (
          <AgentCard
            number={3}
            title="CETESB — Licenciamento Estadual (SP)"
            icon="🏭"
            status={
              resultCETESB ? (resultCETESB.enquadrado ? "warning" : "success") :
              currentAgent === 3 ? "info" : "idle"
            }
          >
            {currentAgent === 3 && !resultCETESB && <Spinner />}
            {resultCETESB && (
              <div className="mt-3 space-y-3">
                {resultCETESB.enquadrado ? (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      <strong>⚠️ {resultCETESB.matches.length} atividade(s)</strong> identificada(s) como fonte de poluição (Anexo 5, Decreto 8.468/76).
                      {resultCETESB.lp_precedente && (
                        <span className="block mt-1">📋 Licença Prévia precedente à LI pode ser necessária (Anexo 10).</span>
                      )}
                    </div>
                    {resultCETESB.nota_rmsp && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                        🚨 {resultCETESB.nota_rmsp}
                      </div>
                    )}
                    <div className="space-y-2">
                      {resultCETESB.matches.slice(0, 10).map((m, i) => (
                        <div key={i} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                          <div>
                            <span className="font-mono text-xs text-gray-600">{m.cnae}</span>
                            <span className="text-gray-500 mx-2">—</span>
                            <span className="text-gray-700 text-xs">{m.descricao || m.tipo}</span>
                          </div>
                          <Badge type={m.risco}>{m.risco === "alto" ? "Obrigatório" : "Verificar"}</Badge>
                        </div>
                      ))}
                      {resultCETESB.matches.length > 10 && (
                        <p className="text-xs text-gray-400">... e mais {resultCETESB.matches.length - 10} atividades</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    ✅ Nenhuma atividade identificada como fonte de poluição no Anexo 5.
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <ExternalLink href={resultCETESB.links.atividades}>Atividades Licenciáveis (CETESB)</ExternalLink>
                  <ExternalLink href={resultCETESB.links.tabela_atividades}>Tabela CNAE × Licenciamento (PDF)</ExternalLink>
                  <ExternalLink href={resultCETESB.links.portal_licenciamento}>Portal de Licenciamento</ExternalLink>
                </div>
                <div className="text-xs text-gray-400 space-y-0.5 mt-2">
                  <p>📜 Lei Estadual nº 997/76 | Decreto nº 8.468/76 | Decreto nº 47.397/02</p>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {/* Agent 4: Municipal */}
        {(resultMunicipal || currentAgent === 4) && (
          <AgentCard
            number={4}
            title="Municipal — LC 140/2011 + CONSEMA 01/2024"
            icon="🏛️"
            status={
              resultMunicipal ? (resultMunicipal.enquadrado ? "warning" : "success") :
              currentAgent === 4 ? "info" : "idle"
            }
          >
            {currentAgent === 4 && !resultMunicipal && <Spinner />}
            {resultMunicipal && (
              <div className="mt-3 space-y-3">
                {resultMunicipal.enquadrado ? (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      <strong>📋 {resultMunicipal.matches.length} atividade(s)</strong> com possível competência municipal conforme DN CONSEMA 01/2024.
                    </div>
                    <div className="space-y-2">
                      {resultMunicipal.matches.map((m, i) => (
                        <div key={i} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-gray-600">{m.cnae}</span>
                            <Badge type={m.risco === "medio" ? "medio" : "baixo"}>
                              {m.risco === "medio" ? "Industrial" : "Não-industrial"}
                            </Badge>
                          </div>
                          <p className="text-gray-700 mt-1">{m.descricao || "—"}</p>
                          <p className="text-gray-500 mt-1">{m.enquadramento}</p>
                          <p className="text-gray-400 mt-1">Competência: {m.competencia}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    ✅ Nenhuma atividade mapeada diretamente na DN CONSEMA 01/2024.
                  </div>
                )}
                <p className="text-xs text-gray-500 italic">{resultMunicipal.nota}</p>
                <div className="flex flex-wrap gap-3">
                  <ExternalLink href={resultMunicipal.legislacao.lc140}>LC nº 140/2011 (Competências)</ExternalLink>
                  <ExternalLink href={resultMunicipal.legislacao.consema}>DN CONSEMA 01/2024 (PDF)</ExternalLink>
                  <ExternalLink href={resultMunicipal.legislacao.municipios_habilitados}>Municípios Habilitados</ExternalLink>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {/* Agent 5: Áreas Contaminadas */}
        {(resultAreas || currentAgent === 5) && (
          <AgentCard
            number={5}
            title="Áreas Contaminadas (SP)"
            icon="☣️"
            status={resultAreas ? "info" : currentAgent === 5 ? "info" : "idle"}
          >
            {currentAgent === 5 && !resultAreas && <Spinner />}
            {resultAreas && (
              <div className="mt-3 space-y-3">
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-800">
                  ℹ️ {resultAreas.instrucao}
                </div>
                {resultAreas.alerta && (
                  <p className="text-sm text-gray-700 font-medium">{resultAreas.alerta}</p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resultAreas.sistemas.map((s, i) => (
                    <a
                      key={i}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-sky-300 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-base">
                          {s.tipo === "geo" ? "🗺️" : s.tipo === "lista" ? "📋" : "📊"}
                        </span>
                        <span className="font-semibold text-sm text-gray-900 group-hover:text-sky-700 transition-colors">
                          {s.nome}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">{s.descricao}</p>
                    </a>
                  ))}
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  <p>📜 {resultAreas.legislacao.lei_estadual}</p>
                  <p>📜 {resultAreas.legislacao.decreto}</p>
                  <p>📜 {resultAreas.legislacao.it_cetesb}</p>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {/* Footer info */}
        {!dadosCNPJ && !loading && !error && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-4">🔍</p>
            <p className="text-sm">Digite um CNPJ acima para iniciar a verificação de compliance ambiental</p>
            <div className="mt-6 max-w-xl mx-auto text-xs text-gray-400 space-y-2 text-left bg-white rounded-lg border border-gray-200 p-5">
              <p className="font-semibold text-gray-600 mb-3">Agentes do sistema:</p>
              <p><strong>1.</strong> Busca CNAEs via APIs públicas (BrasilAPI / OpenCNPJ)</p>
              <p><strong>2.</strong> Verifica enquadramento IBAMA (CTF/APP) via Fichas Técnicas de Enquadramento</p>
              <p><strong>3.</strong> Verifica enquadramento CETESB (Anexo 5, Dec. 8.468/76)</p>
              <p><strong>4.</strong> Verifica competência municipal (LC 140/2011 + DN CONSEMA 01/2024)</p>
              <p><strong>5.</strong> Orienta consulta a áreas contaminadas (SEMIL / SIGAM / CETESB)</p>
              <p className="text-gray-300 mt-3 italic">Nota: Este sistema é uma ferramenta de apoio. O enquadramento definitivo requer análise técnica por profissional habilitado.</p>
            </div>
          </div>
        )}

        {currentAgent >= 6 && (
          <div className="bg-gray-800 text-white rounded-lg px-5 py-4 text-xs space-y-1">
            <p className="font-semibold text-sm mb-2">⚖️ Disclaimer</p>
            <p>Este sistema realiza uma pré-análise automatizada com base nos CNAEs e nas bases de dados públicas. Não substitui a análise técnica de um profissional habilitado.</p>
            <p>A correspondência CNAE × atividade ambiental é indicativa e não vinculante (conforme IN Ibama nº 13/2021, Art. 2.1.3).</p>
            <p>Sempre consulte as FTEs originais no site do IBAMA, a tabela de atividades da CETESB, e verifique a habilitação do município junto ao CONSEMA.</p>
          </div>
        )}
      </div>
    </div>
  );
}
