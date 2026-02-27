import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCNPJ, cleanCNPJ, isValidCNPJ } from "@/lib/cnpj";
import { Link } from "react-router-dom";

interface CNPJSearchProps {
  onSearch: (cnpj: string) => void;
  isLoading: boolean;
}

export function CNPJSearch({ onSearch, isLoading }: CNPJSearchProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value);
    setValue(formatted);
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanCNPJ(value);
    if (!isValidCNPJ(clean)) {
      setError("CNPJ inválido. Verifique os dígitos.");
      return;
    }
    onSearch(clean);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-8 w-full max-w-2xl mx-auto"
    >
      <div className="text-center space-y-4">
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2 }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 mb-4"
        >
          <Shield className="w-10 h-10 text-primary" />
        </motion.div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Supply Risk <span className="text-primary">Mapping</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Análise automatizada de risco de fornecedores em bases públicas brasileiras
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              value={value}
              onChange={handleChange}
              placeholder="00.000.000/0000-00"
              className="pl-12 h-14 text-lg bg-secondary/50 border-glass-border focus:border-primary"
              disabled={isLoading}
              maxLength={18}
            />
          </div>
          <Button
            type="submit"
            disabled={isLoading || cleanCNPJ(value).length < 14}
            className="h-14 px-8 text-base font-semibold"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              "Analisar Risco"
            )}
          </Button>
        </div>
        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-destructive text-sm pl-1"
          >
            {error}
          </motion.p>
        )}
      </form>
      <p className="text-xs text-muted-foreground">
        Precisa analisar um sócio específico?{" "}
        <Link to="/socio" className="text-primary hover:underline">
          Abrir scan individual
        </Link>
      </p>
    </motion.div>
  );
}
