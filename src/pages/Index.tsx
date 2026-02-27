import { useEffect, useState } from "react";
import { CNPJSearch } from "@/components/CNPJSearch";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { RiskReport } from "@/components/RiskReport";
import { useToast } from "@/hooks/use-toast";
import type { RiskAnalysis } from "@/types/risk";

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const ANALYZE_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/analyze-cnpj` : "/api/analyze-cnpj";
const SEARCHES_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/searches` : "/api/searches";

async function analyzeCnpj(cnpj: string): Promise<RiskAnalysis> {
  const response = await fetch(ANALYZE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cnpj }),
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const apiMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível analisar o CNPJ. Tente novamente.";
    throw new Error(apiMessage);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API.");
  }

  return data as RiskAnalysis;
}

async function fetchSearchById(searchId: string): Promise<RiskAnalysis> {
  const response = await fetch(`${SEARCHES_ENDPOINT}/${encodeURIComponent(searchId)}`);
  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const apiMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Não foi possível carregar a busca salva.";
    throw new Error(apiMessage);
  }

  if (!data || typeof data !== "object") {
    throw new Error("Resposta inválida da API.");
  }

  return data as RiskAnalysis;
}

function setSearchIdInUrl(searchId: string | null) {
  const url = new URL(window.location.href);
  if (searchId) {
    url.pathname = `/relatorio/${encodeURIComponent(searchId)}`;
    url.searchParams.delete("search_id");
  } else {
    url.pathname = "/";
    url.searchParams.delete("search_id");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function getInitialSearchIdFromUrl() {
  const pathMatch = window.location.pathname.match(/^\/relatorio\/([^/]+)$/);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]);
  }
  return new URLSearchParams(window.location.search).get("search_id");
}

function isFinalDeepStatus(status: string | null | undefined) {
  return (
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "budget_exceeded"
  );
}

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RiskAnalysis | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const initialSearchId = getInitialSearchIdFromUrl();
    if (!initialSearchId) return;

    let cancelled = false;
    setIsLoading(true);

    fetchSearchById(initialSearchId)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Não foi possível carregar a busca salva.";
        toast({
          title: "Erro ao recuperar busca",
          description: message,
          variant: "destructive",
        });
        setSearchIdInUrl(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    const searchId = result?.meta?.search_id;
    const deepStatus = result?.meta?.deep_investigation?.status;
    if (!searchId || !deepStatus || isFinalDeepStatus(deepStatus)) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await fetchSearchById(searchId);
        if (cancelled) return;
        setResult(next);
      } catch {
        // fail-open polling
      }
    };

    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [result]);

  const handleSearch = async (cnpj: string) => {
    setIsLoading(true);
    setResult(null);
    try {
      const data = await analyzeCnpj(cnpj);
      setResult(data);
      setSearchIdInUrl(data.meta?.search_id ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Não foi possível analisar o CNPJ. Tente novamente.";
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
    setSearchIdInUrl(null);
  };

  return (
    <main className="min-h-screen p-6 md:p-12">
      {!result && !isLoading && <CNPJSearch onSearch={handleSearch} isLoading={isLoading} />}
      {isLoading && <LoadingOverlay />}
      {result && <RiskReport data={result} onBack={handleBack} />}
    </main>
  );
};

export default Index;
