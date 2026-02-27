import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Search, UserRoundSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cleanCNPJ, formatCNPJ, isValidCNPJ } from "@/lib/cnpj";
import { cleanCPF, formatCPF, isValidCPF } from "@/lib/cpf";

interface PartnerSearchProps {
  onSearch: (input: { cnpj: string; cpf: string; nome: string }) => void;
  isLoading: boolean;
  initialValues?: {
    cnpj?: string;
    cpf?: string;
    cpfHint?: string;
    nome?: string;
  };
}

export function PartnerSearch({ onSearch, isLoading, initialValues }: PartnerSearchProps) {
  const [cnpj, setCnpj] = useState(() => formatCNPJ(initialValues?.cnpj ?? ""));
  const [cpf, setCpf] = useState(() => formatCPF(initialValues?.cpf ?? ""));
  const [cpfHint, setCpfHint] = useState(() => String(initialValues?.cpfHint ?? "").trim());
  const [nome, setNome] = useState(() => String(initialValues?.nome ?? ""));
  const [error, setError] = useState("");

  useEffect(() => {
    setCnpj(formatCNPJ(initialValues?.cnpj ?? ""));
    setCpf(formatCPF(initialValues?.cpf ?? ""));
    setCpfHint(String(initialValues?.cpfHint ?? "").trim());
    setNome(String(initialValues?.nome ?? ""));
    setError("");
  }, [initialValues?.cnpj, initialValues?.cpf, initialValues?.cpfHint, initialValues?.nome]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanCnpj = cleanCNPJ(cnpj);
    const cleanCpf = cleanCPF(cpf);
    const trimmedName = nome.trim();

    if (!isValidCNPJ(cleanCnpj)) {
      setError("CNPJ inválido.");
      return;
    }
    if (!isValidCPF(cleanCpf)) {
      setError("CPF inválido.");
      return;
    }
    if (!trimmedName) {
      setError("Informe o nome do sócio.");
      return;
    }

    setError("");
    onSearch({ cnpj: cleanCnpj, cpf: cleanCpf, nome: trimmedName });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto glass-card p-6 md:p-8 space-y-5"
    >
      <div className="space-y-2 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-primary/10 border border-primary/20">
          <UserRoundSearch className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-2xl md:text-3xl font-bold">Scan Individual de Sócio</h1>
        <p className="text-sm text-muted-foreground">
          Informe CNPJ da empresa, CPF e nome do sócio para análise individual.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={cnpj}
            onChange={(event) => {
              setCnpj(formatCNPJ(event.target.value));
              setError("");
            }}
            placeholder="CNPJ da empresa (00.000.000/0000-00)"
            className="pl-10 h-12"
            disabled={isLoading}
            maxLength={18}
          />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={cpf}
            onChange={(event) => {
              setCpf(formatCPF(event.target.value));
              setError("");
            }}
            placeholder="CPF do sócio (000.000.000-00)"
            className="pl-10 h-12"
            disabled={isLoading}
            maxLength={14}
          />
        </div>
        {cpfHint && cleanCPF(cpf).length !== 11 && (
          <p className="text-xs text-muted-foreground">
            CPF no QSA: <span className="font-mono">{cpfHint}</span>. Complete o CPF para continuar.
          </p>
        )}
        <Input
          value={nome}
          onChange={(event) => {
            setNome(event.target.value);
            setError("");
          }}
          placeholder="Nome completo do sócio"
          className="h-12"
          disabled={isLoading}
          maxLength={180}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-12 w-full" disabled={isLoading}>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Analisar Sócio"}
        </Button>
      </form>
    </motion.div>
  );
}
