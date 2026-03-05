import { useState, type ReactNode } from "react";
import { cleanCNPJ, formatCNPJ, isValidCNPJ } from "@/lib/cnpj";
import type {
  AreasContaminadasResult,
  CetesbResult,
  EnvironmentalAiReport,
  EnvironmentalCompany,
  EnvironmentalComplianceResult,
  FteDeepAnalysis,
  IbamaResult,
  MunicipalResult,
} from "@/types/environmental";

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const COMPLIANCE_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/environmental-compliance` : "/api/environmental-compliance";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeEnvironmentalCompliance(cnpj: string): Promise<EnvironmentalComplianceResult> {
  const response = await fetch(COMPLIANCE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cnpj }),
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Nao foi possivel executar a analise ambiental.";
    throw new Error(message);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta invalida da API.");
  }

  return data as EnvironmentalComplianceResult;
}

type BadgeType = "alto" | "medio" | "baixo" | "info" | "neutral";

function Badge({ type, children }: { type: BadgeType; children: ReactNode }) {
  const colors: Record<BadgeType, string> = {
    alto: "bg-red-100 text-red-800 border border-red-200",
    medio: "bg-amber-100 text-amber-800 border border-amber-200",
    baixo: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    info: "bg-sky-100 text-sky-800 border border-sky-200",
    neutral: "bg-gray-100 text-gray-700 border border-gray-200",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[type]}`}>
      {children}
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
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
}

function AgentCard({
  number,
  title,
  icon,
  status,
  children,
}: {
  number: number;
  title: string;
  icon: string;
  status: "success" | "warning" | "danger" | "info" | "idle";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const statusColors = {
    success: "border-l-emerald-500 bg-emerald-50/30",
    warning: "border-l-amber-500 bg-amber-50/30",
    danger: "border-l-red-500 bg-red-50/30",
    info: "border-l-sky-500 bg-sky-50/30",
    idle: "border-l-gray-300 bg-white",
  };

  return (
    <div className={`rounded-lg border border-gray-200 border-l-4 ${statusColors[status]} overflow-hidden shadow-sm transition-all duration-300`}>
      <button
        onClick={() => setOpen((value) => !value)}
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
}

function Spinner() {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      <span className="text-sm text-gray-500">Processando agente...</span>
    </div>
  );
}

export default function Index() {
  const [cnpj, setCnpj] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentAgent, setCurrentAgent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [dadosCNPJ, setDadosCNPJ] = useState<EnvironmentalCompany | null>(null);
  const [resultFteDeep, setResultFteDeep] = useState<FteDeepAnalysis | null>(null);
  const [resultIBAMA, setResultIBAMA] = useState<IbamaResult | null>(null);
  const [resultCETESB, setResultCETESB] = useState<CetesbResult | null>(null);
  const [resultMunicipal, setResultMunicipal] = useState<MunicipalResult | null>(null);
  const [resultAreas, setResultAreas] = useState<AreasContaminadasResult | null>(null);
  const [resultAI, setResultAI] = useState<EnvironmentalAiReport | null>(null);
  const [fullResult, setFullResult] = useState<EnvironmentalComplianceResult | null>(null);

  const reset = () => {
    setDadosCNPJ(null);
    setResultFteDeep(null);
    setResultIBAMA(null);
    setResultCETESB(null);
    setResultMunicipal(null);
    setResultAreas(null);
    setResultAI(null);
    setFullResult(null);
    setError(null);
    setCurrentAgent(0);
  };

  const handleRun = async () => {
    const clean = cleanCNPJ(cnpj);
    if (!isValidCNPJ(clean)) {
      setError("CNPJ invalido. Verifique os digitos informados.");
      return;
    }

    reset();
    setLoading(true);
    setCurrentAgent(1);

    try {
      const payload = await analyzeEnvironmentalCompliance(clean);
      setFullResult(payload);
      setDadosCNPJ(payload.company);

      await wait(180);
      setCurrentAgent(2);
      setResultFteDeep(payload.fte_deep_analysis);

      await wait(180);
      setCurrentAgent(3);
      setResultIBAMA(payload.ibama);

      await wait(180);
      setCurrentAgent(4);
      setResultCETESB(payload.cetesb);

      await wait(180);
      setCurrentAgent(5);
      setResultMunicipal(payload.municipal);

      await wait(180);
      setCurrentAgent(6);
      setResultAreas(payload.areas_contaminadas);

      await wait(180);
      setCurrentAgent(7);
      setResultAI(payload.ai_report);

      await wait(120);
      setCurrentAgent(8);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Falha ao executar analise.");
    } finally {
      setLoading(false);
    }
  };

  const totalAlerts = fullResult?.summary.total_alerts ?? 0;
  const govbrSource = fullResult?.sources?.find((source) => source.id === "cgu_licitacoes_contratos");

  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <div className="bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center text-xs font-semibold">ENV</div>
            <h1 className="text-2xl font-bold tracking-tight">Compliance Ambiental</h1>
          </div>
          <p className="text-gray-400 text-sm">Sistema multiagentes para enquadramento ambiental por CNPJ.</p>

          <div className="mt-6 flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={cnpj}
                onChange={(event) => {
                  setCnpj(formatCNPJ(event.target.value));
                  setError(null);
                }}
                placeholder="Digite o CNPJ (ex: 00.000.000/0001-00)"
                className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) handleRun();
                }}
              />
            </div>
            <button
              onClick={handleRun}
              disabled={loading || cleanCNPJ(cnpj).length !== 14}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors text-sm whitespace-nowrap"
            >
              {loading ? "Analisando..." : "Verificar Compliance"}
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-5xl mx-auto px-6 py-3">
            <div className="flex items-center gap-4 text-xs text-gray-500">
              {["CNPJ/CNAE", "RAG CNAE x FTE", "IBAMA/FTE", "CETESB/SP", "Municipal", "Areas Contam.", "Relatorio IA"].map((label, index) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      currentAgent > index + 1 ? "bg-emerald-500" : currentAgent === index + 1 ? "bg-amber-500 animate-pulse" : "bg-gray-300"
                    }`}
                  />
                  <span className={currentAgent === index + 1 ? "text-gray-900 font-medium" : ""}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 text-red-800 text-sm">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {dadosCNPJ && currentAgent > 1 && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
            <div className="flex justify-between items-start gap-4">
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
            {currentAgent >= 8 && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">CNAEs:</span>
                  <span className="font-semibold">{dadosCNPJ.cnaes.length}</span>
                </div>
                {fullResult && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Alertas FTE:</span>
                    <span className="font-semibold text-amber-700">{fullResult.summary.fte_alerts}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-500">Enquadramentos:</span>
                  <span className="font-semibold text-red-700">{totalAlerts}</span>
                </div>
                {fullResult && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-500">Risco:</span>
                    <Badge type={fullResult.summary.risk_level === "alto" ? "alto" : fullResult.summary.risk_level === "medio" ? "medio" : "baixo"}>
                      {fullResult.summary.risk_level.toUpperCase()}
                    </Badge>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {(dadosCNPJ || currentAgent === 1) && (
          <AgentCard number={1} title="Consulta CNPJ - CNAEs" icon="A1" status={dadosCNPJ ? "success" : currentAgent === 1 ? "info" : "idle"}>
            {currentAgent === 1 && !dadosCNPJ && <Spinner />}
            {dadosCNPJ && (
              <div className="mt-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Codigo</th>
                        <th className="pb-2 pr-3">Descricao</th>
                        <th className="pb-2">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {dadosCNPJ.cnaes.map((cnae) => (
                        <tr key={`${cnae.codigo}-${cnae.principal ? "p" : "s"}`} className="text-gray-700">
                          <td className="py-2 pr-3 font-mono text-xs">{cnae.codigo}</td>
                          <td className="py-2 pr-3 text-xs">{cnae.descricao || "-"}</td>
                          <td className="py-2">
                            <Badge type={cnae.principal ? "info" : "neutral"}>{cnae.principal ? "Principal" : "Secundario"}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-3">Fallback de consulta: BrasilAPI - OpenCNPJ - ReceitaWS.</p>
                {fullResult?.govbr_context && (
                  <div className="mt-3 text-xs rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
                    gov.br (Portal da Transparencia): {fullResult.govbr_context.found_records} registro(s) de contratos na pagina consultada.
                  </div>
                )}
                {fullResult?.govbr_context?.sample?.length ? (
                  <div className="mt-2 space-y-1">
                    {fullResult.govbr_context.sample.map((item, index) => (
                      <p key={`${item.numero ?? "sem-numero"}-${index}`} className="text-xs text-gray-600">
                        {item.numero || "Sem numero"} | {item.modalidade || "Modalidade nao informada"} | {item.orgao || "Orgao nao informado"}
                      </p>
                    ))}
                  </div>
                ) : null}
                {govbrSource && govbrSource.status !== "success" ? (
                  <p className="mt-2 text-xs text-gray-500">
                    gov.br indisponivel nesta execucao: {govbrSource.status_reason}
                  </p>
                ) : null}
              </div>
            )}
          </AgentCard>
        )}

        {(resultIBAMA || currentAgent === 2) && (
          <AgentCard
            number={2}
            title="IBAMA - CTF/APP e FTE"
            icon="A2"
            status={resultIBAMA ? (resultIBAMA.enquadrado ? "danger" : "success") : currentAgent === 2 ? "info" : "idle"}
          >
            {currentAgent === 2 && !resultIBAMA && <Spinner />}
            {resultIBAMA && (
              <div className="mt-3 space-y-3">
                {resultIBAMA.enquadrado ? (
                  <>
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
                      <strong>Atencao:</strong> enquadramento identificado em {resultIBAMA.matches.length} categoria(s) do CTF/APP.
                    </div>
                    {resultIBAMA.matches.map((match, index) => (
                      <div key={`${match.categoria}-${index}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-sm text-gray-900">
                              Cat. {match.categoria} - {match.nome}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Match: CNAE {match.cnae_match} {match.cnae_desc ? `(${match.cnae_desc})` : ""}
                            </p>
                          </div>
                          <Badge type={match.risco}>{match.risco === "alto" ? "Risco Alto" : "Verificar"}</Badge>
                        </div>
                        <p className="text-xs text-gray-600 mt-2">{match.obrigacao}</p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          <ExternalLink href={match.link_fte}>FTEs por Categoria</ExternalLink>
                          <ExternalLink href={match.link_tabela}>Tabela Completa FTE</ExternalLink>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    Nenhum enquadramento direto identificado por CNAE nas categorias do CTF/APP.
                  </div>
                )}
                <p className="text-xs text-gray-400 italic">{resultIBAMA.nota}</p>
                <ExternalLink href={resultIBAMA.link_consulta}>Guia de enquadramento passo a passo (IBAMA)</ExternalLink>
              </div>
            )}
          </AgentCard>
        )}

        {(resultCETESB || currentAgent === 3) && (
          <AgentCard
            number={3}
            title="CETESB - Licenciamento Estadual (SP)"
            icon="A3"
            status={resultCETESB ? (resultCETESB.enquadrado ? "warning" : "success") : currentAgent === 3 ? "info" : "idle"}
          >
            {currentAgent === 3 && !resultCETESB && <Spinner />}
            {resultCETESB && (
              <div className="mt-3 space-y-3">
                {resultCETESB.enquadrado ? (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      <strong>{resultCETESB.matches.length} atividade(s)</strong> identificada(s) como fonte de poluicao (Anexo 5, Decreto 8.468/76).
                      {resultCETESB.lp_precedente && <span className="block mt-1">Licenca Previa precedente a LI pode ser necessaria (Anexo 10).</span>}
                    </div>
                    {resultCETESB.nota_rmsp && (
                      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{resultCETESB.nota_rmsp}</div>
                    )}
                    <div className="space-y-2">
                      {resultCETESB.matches.map((match, index) => (
                        <div key={`${match.cnae}-${index}`} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2">
                          <div>
                            <span className="font-mono text-xs text-gray-600">{match.cnae}</span>
                            <span className="text-gray-500 mx-2">-</span>
                            <span className="text-gray-700 text-xs">{match.descricao || match.tipo}</span>
                          </div>
                          <Badge type={match.risco}>{match.risco === "alto" ? "Obrigatorio" : "Verificar"}</Badge>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    Nenhuma atividade identificada como fonte de poluicao no Anexo 5.
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <ExternalLink href={resultCETESB.links.atividades}>Atividades Licenciaveis (CETESB)</ExternalLink>
                  <ExternalLink href={resultCETESB.links.tabela_atividades}>Tabela CNAE x Licenciamento (PDF)</ExternalLink>
                  <ExternalLink href={resultCETESB.links.portal_licenciamento}>Portal de Licenciamento</ExternalLink>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {(resultMunicipal || currentAgent === 4) && (
          <AgentCard
            number={4}
            title="Municipal - LC 140/2011 + CONSEMA 01/2024"
            icon="A4"
            status={resultMunicipal ? (resultMunicipal.enquadrado ? "warning" : "success") : currentAgent === 4 ? "info" : "idle"}
          >
            {currentAgent === 4 && !resultMunicipal && <Spinner />}
            {resultMunicipal && (
              <div className="mt-3 space-y-3">
                {resultMunicipal.enquadrado ? (
                  <>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                      <strong>{resultMunicipal.matches.length} atividade(s)</strong> com potencial competencia municipal.
                    </div>
                    <div className="space-y-2">
                      {resultMunicipal.matches.map((match, index) => (
                        <div key={`${match.cnae}-${index}`} className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-xs">
                          <div className="flex justify-between items-start">
                            <span className="font-mono text-gray-600">{match.cnae}</span>
                            <Badge type={match.risco === "medio" ? "medio" : "baixo"}>
                              {match.risco === "medio" ? "Industrial" : "Nao-industrial"}
                            </Badge>
                          </div>
                          <p className="text-gray-700 mt-1">{match.descricao || "-"}</p>
                          <p className="text-gray-500 mt-1">{match.enquadramento}</p>
                          <p className="text-gray-400 mt-1">Competencia: {match.competencia}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                    Nenhuma atividade mapeada diretamente na DN CONSEMA 01/2024.
                  </div>
                )}
                <p className="text-xs text-gray-500 italic">{resultMunicipal.nota}</p>
                <div className="flex flex-wrap gap-3">
                  <ExternalLink href={resultMunicipal.legislacao.lc140}>LC 140/2011 (Competencias)</ExternalLink>
                  <ExternalLink href={resultMunicipal.legislacao.consema}>DN CONSEMA 01/2024 (PDF)</ExternalLink>
                  <ExternalLink href={resultMunicipal.legislacao.municipios_habilitados}>Municipios Habilitados</ExternalLink>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {(resultAreas || currentAgent === 5) && (
          <AgentCard number={5} title="Areas Contaminadas (SP)" icon="A5" status={resultAreas ? "info" : currentAgent === 5 ? "info" : "idle"}>
            {currentAgent === 5 && !resultAreas && <Spinner />}
            {resultAreas && (
              <div className="mt-3 space-y-3">
                <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 text-sm text-sky-800">{resultAreas.instrucao}</div>
                {resultAreas.alerta && <p className="text-sm text-gray-700 font-medium">{resultAreas.alerta}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {resultAreas.sistemas.map((sistema) => (
                    <a
                      key={sistema.url}
                      href={sistema.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-sky-300 hover:shadow-sm transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-semibold uppercase">{sistema.tipo}</span>
                        <span className="font-semibold text-sm text-gray-900 group-hover:text-sky-700 transition-colors">{sistema.nome}</span>
                      </div>
                      <p className="text-xs text-gray-500">{sistema.descricao}</p>
                    </a>
                  ))}
                </div>
                <div className="text-xs text-gray-400 space-y-0.5">
                  <p>{resultAreas.legislacao.lei_estadual}</p>
                  <p>{resultAreas.legislacao.decreto}</p>
                  <p>{resultAreas.legislacao.it_cetesb}</p>
                </div>
              </div>
            )}
          </AgentCard>
        )}

        {(resultAI || currentAgent === 6) && (
          <AgentCard
            number={6}
            title="Relatorio IA Ambiental (Ultimo Agente)"
            icon="A6"
            status={resultAI ? (resultAI.available ? "success" : "warning") : currentAgent === 6 ? "info" : "idle"}
          >
            {currentAgent === 6 && !resultAI && <Spinner />}
            {resultAI && (
              <div className="mt-3 space-y-3">
                {resultAI.available ? (
                  <>
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                      Relatorio IA gerado com base nos achados ambientais consolidados.
                    </div>
                    <p className="text-xs text-gray-500">
                      Modelo: {resultAI.model || "N/A"} | Tokens in: {resultAI.input_tokens ?? "-"} | Tokens out:{" "}
                      {resultAI.output_tokens ?? "-"}
                    </p>
                    <pre className="max-h-96 overflow-auto bg-gray-950 text-gray-100 rounded-md p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                      {resultAI.narrative || "Sem conteudo textual."}
                    </pre>
                  </>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    Relatorio IA indisponivel: {resultAI.reason || "motivo nao informado"}
                  </div>
                )}
              </div>
            )}
          </AgentCard>
        )}

        {fullResult && fullResult.orchestration.events.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-2">Feed do Orquestrador</h3>
            <div className="space-y-1 text-xs text-gray-600 max-h-56 overflow-auto">
              {fullResult.orchestration.events.map((event) => (
                <p key={event.seq}>
                  [{event.agent}] {event.message || event.status}
                </p>
              ))}
            </div>
          </div>
        )}

        {fullResult && (
          <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 shadow-sm space-y-4">
            <h3 className="font-semibold text-gray-900">Dados Completos da Analise</h3>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Fontes consultadas</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 uppercase tracking-wide">
                      <th className="pb-2 pr-3">Fonte</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Motivo</th>
                      <th className="pb-2 pr-3">Latencia</th>
                      <th className="pb-2 pr-3">Evidencias</th>
                      <th className="pb-2">Mensagem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {fullResult.sources.map((source) => (
                      <tr key={source.id}>
                        <td className="py-2 pr-3">{source.name}</td>
                        <td className="py-2 pr-3">
                          <Badge type={source.status === "success" ? "baixo" : source.status === "not_found" ? "neutral" : "medio"}>
                            {source.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 font-mono">{source.status_reason || "-"}</td>
                        <td className="py-2 pr-3">{source.latency_ms}ms</td>
                        <td className="py-2 pr-3">{source.evidence_count ?? "-"}</td>
                        <td className="py-2">{source.message || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Etapas do orquestrador</p>
              <div className="space-y-2">
                {fullResult.orchestration.steps.map((step) => (
                  <div key={step.agent} className="border border-gray-200 rounded-md px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-gray-800">{step.title}</p>
                      <Badge type={step.status === "completed" ? "baixo" : step.status === "failed" ? "alto" : "info"}>
                        {step.status}
                      </Badge>
                    </div>
                    <p className="text-gray-600 mt-1">{step.message || "-"}</p>
                    <p className="text-gray-400 mt-1">
                      inicio: {step.started_at || "-"} | fim: {step.completed_at || "-"}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">JSON completo da resposta</p>
              <pre className="max-h-96 overflow-auto bg-gray-950 text-gray-100 rounded-md p-3 text-[11px] leading-relaxed">
                {JSON.stringify(fullResult, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {!dadosCNPJ && !loading && !error && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-4 font-semibold">AGENTES</p>
            <p className="text-sm">Digite um CNPJ para iniciar a verificacao de compliance ambiental.</p>
          </div>
        )}

        {currentAgent >= 7 && fullResult && (
          <div className="bg-gray-800 text-white rounded-lg px-5 py-4 text-xs space-y-1">
            <p className="font-semibold text-sm mb-2">Disclaimer</p>
            {fullResult.disclaimers.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
