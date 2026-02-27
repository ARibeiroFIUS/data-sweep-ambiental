import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, ChevronDown, ChevronUp, Cpu, AlertCircle } from "lucide-react";
import type { AiAnalysis } from "@/types/risk";

interface AiAnalysisSectionProps {
  aiAnalysis?: AiAnalysis;
}

const SECTION_TITLES = [
  "## RESUMO EXECUTIVO",
  "## ANÁLISE DETALHADA",
  "## RECOMENDAÇÕES",
];

interface ParsedSection {
  title: string;
  content: string;
}

function parseNarrative(narrative: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const parts = narrative.split(/^## /m);

  for (const part of parts) {
    if (!part.trim()) continue;
    const newlineIndex = part.indexOf("\n");
    if (newlineIndex === -1) continue;
    const title = part.substring(0, newlineIndex).trim();
    const content = part.substring(newlineIndex + 1).trim();
    if (title && content) {
      sections.push({ title, content });
    }
  }

  // If no sections found (model didn't use ## headers), return as single block
  if (sections.length === 0 && narrative.trim()) {
    sections.push({ title: "Laudo Investigativo", content: narrative.trim() });
  }

  return sections;
}

function SectionBlock({ section, index }: { section: ParsedSection; index: number }) {
  const [expanded, setExpanded] = useState(index === 0); // First section expanded by default

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="font-semibold text-sm">{section.title}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3">
          <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {section.content}
          </div>
        </div>
      )}
    </div>
  );
}

export function AiAnalysisSection({ aiAnalysis }: AiAnalysisSectionProps) {
  if (!aiAnalysis) return null;
  const pending = String(aiAnalysis.reason ?? "").toLowerCase().includes("pendente");

  // API key not configured — subtle placeholder
  if (!aiAnalysis.available) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="glass-card p-4 flex items-start gap-3 border border-border/40"
      >
        <AlertCircle className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-muted-foreground/70 font-medium">
            {pending ? "Laudo investigativo por IA em processamento" : "Laudo investigativo por IA indisponível"}
          </p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">
            {aiAnalysis.reason ?? "Configure OPENAI_API_KEY (ou ANTHROPIC_API_KEY) para ativar o laudo narrativo."}
          </p>
        </div>
      </motion.div>
    );
  }

  if (!aiAnalysis.narrative) return null;

  const sections = parseNarrative(aiAnalysis.narrative);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="glass-card p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Laudo Investigativo</h2>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Cpu className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-xs text-muted-foreground/50">
            {aiAnalysis.model ?? "gpt-4o-mini"}
          </span>
          {aiAnalysis.input_tokens != null && (
            <span className="text-xs text-muted-foreground/40">
              · {aiAnalysis.input_tokens + (aiAnalysis.output_tokens ?? 0)} tokens
            </span>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {sections.map((section, i) => (
          <SectionBlock key={section.title} section={section} index={i} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground/40 pt-1">
        Laudo gerado automaticamente com base em dados públicos. Não substitui análise jurídica especializada.
      </p>
    </motion.div>
  );
}
