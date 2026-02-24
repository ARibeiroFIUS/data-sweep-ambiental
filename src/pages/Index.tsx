import { useState } from "react";
import { CNPJSearch } from "@/components/CNPJSearch";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { RiskReport } from "@/components/RiskReport";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { RiskAnalysis } from "@/types/risk";

const Index = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RiskAnalysis | null>(null);
  const { toast } = useToast();

  const handleSearch = async (cnpj: string) => {
    setIsLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-cnpj", {
        body: { cnpj },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as RiskAnalysis);
    } catch (err: any) {
      toast({
        title: "Erro na consulta",
        description: err.message || "Não foi possível analisar o CNPJ. Tente novamente.",
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
