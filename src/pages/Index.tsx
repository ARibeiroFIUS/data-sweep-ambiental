import { useState } from "react";
import { CNPJSearch } from "@/components/CNPJSearch";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { RiskReport } from "@/components/RiskReport";
import { useToast } from "@/hooks/use-toast";
import type { RiskAnalysis } from "@/types/risk";

const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const ANALYZE_ENDPOINT = API_BASE_URL ? `${API_BASE_URL}/api/analyze-cnpj` : "/api/analyze-cnpj";

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

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RiskAnalysis | null>(null);
  const { toast } = useToast();

  const handleSearch = async (cnpj: string) => {
    setIsLoading(true);
    setResult(null);
    try {
      const data = await analyzeCnpj(cnpj);
      setResult(data);
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
