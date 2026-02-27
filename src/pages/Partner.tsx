import { useEffect, useMemo, useState } from "react";
import { PartnerSearch } from "@/components/PartnerSearch";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { PartnerReport } from "@/components/PartnerReport";
import { useToast } from "@/hooks/use-toast";
import type { PartnerRiskAnalysis } from "@/types/risk";
import { useLocation } from "react-router-dom";

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const ANALYZE_PARTNER_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/analyze-partner` : "/api/analyze-partner";
const PARTNER_SEARCHES_ENDPOINT = API_BASE_URL
  ? `${API_BASE_URL}/api/partner-searches`
  : "/api/partner-searches";

async function analyzePartner(input: {
  cnpj: string;
  cpf: string;
  nome: string;
}): Promise<PartnerRiskAnalysis> {
  const response = await fetch(ANALYZE_PARTNER_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const apiMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível analisar o sócio informado.";
    throw new Error(apiMessage);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API.");
  }

  return data as PartnerRiskAnalysis;
}

async function fetchPartnerSearchById(partnerSearchId: string): Promise<PartnerRiskAnalysis> {
  const response = await fetch(`${PARTNER_SEARCHES_ENDPOINT}/${encodeURIComponent(partnerSearchId)}`);
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const apiMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível carregar a busca de sócio salva.";
    throw new Error(apiMessage);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API.");
  }

  return data as PartnerRiskAnalysis;
}

function setPartnerSearchIdInUrl(partnerSearchId: string | null) {
  const url = new URL(window.location.href);
  if (partnerSearchId) {
    url.pathname = `/socio/relatorio/${encodeURIComponent(partnerSearchId)}`;
    url.searchParams.delete("partner_search_id");
  } else {
    url.pathname = "/socio";
    url.searchParams.delete("partner_search_id");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getPartnerSearchIdFromLocation(pathname: string, search: string) {
  const pathMatch = pathname.match(/^\/socio\/relatorio\/([^/]+)$/);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  return new URLSearchParams(search).get("partner_search_id");
}

function getPartnerPrefillFromSearch(search: string) {
  const params = new URLSearchParams(search);
  const cnpj = (params.get("cnpj") ?? "").replace(/\D/g, "").slice(0, 14);
  const cpf = (params.get("cpf") ?? "").replace(/\D/g, "").slice(0, 11);
  const cpfHint = (params.get("cpf_hint") ?? "").trim();
  const nome = (params.get("nome") ?? "").trim();

  return {
    cnpj,
    cpf,
    cpfHint,
    nome,
  };
}

export default function Partner() {
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PartnerRiskAnalysis | null>(null);
  const { toast } = useToast();
  const prefill = useMemo(() => getPartnerPrefillFromSearch(location.search), [location.search]);

  useEffect(() => {
    const initialId = getPartnerSearchIdFromLocation(location.pathname, location.search);
    if (!initialId) return;

    let cancelled = false;
    setIsLoading(true);
    fetchPartnerSearchById(initialId)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Erro ao carregar relatório de sócio.";
        toast({
          title: "Erro ao recuperar busca",
          description: message,
          variant: "destructive",
        });
        setPartnerSearchIdInUrl(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, toast]);

  const handleSearch = async (input: { cnpj: string; cpf: string; nome: string }) => {
    setIsLoading(true);
    setResult(null);
    try {
      const data = await analyzePartner(input);
      setResult(data);
      setPartnerSearchIdInUrl(data.meta?.partner_search_id ?? null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Não foi possível analisar o sócio.";
      toast({
        title: "Erro na consulta",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setResult(null);
    setPartnerSearchIdInUrl(null);
  };

  return (
    <main className="min-h-screen p-6 md:p-12">
      {!result && !isLoading && <PartnerSearch onSearch={handleSearch} isLoading={isLoading} initialValues={prefill} />}
      {isLoading && <LoadingOverlay />}
      {result && <PartnerReport data={result} onBack={handleBack} />}
    </main>
  );
}
