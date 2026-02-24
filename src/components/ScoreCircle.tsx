import { motion } from "framer-motion";
import { useMemo } from "react";

interface ScoreCircleProps {
  score: number;
  classification: string;
}

export function ScoreCircle({ score, classification }: ScoreCircleProps) {
  const { color, bgColor } = useMemo(() => {
    if (score >= 75) return { color: "text-risk-critical", bgColor: "hsl(var(--risk-critical))" };
    if (score >= 50) return { color: "text-risk-high", bgColor: "hsl(var(--risk-high))" };
    if (score >= 25) return { color: "text-risk-medium", bgColor: "hsl(var(--risk-medium))" };
    return { color: "text-risk-low", bgColor: "hsl(var(--risk-low))" };
  }, [score]);

  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
          <motion.circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke={bgColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            className="score-circle"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className={`text-3xl font-bold ${color}`}
          >
            {score}
          </motion.span>
          <span className="text-xs text-muted-foreground uppercase tracking-wider">Score</span>
        </div>
      </div>
      <span className={`text-sm font-semibold uppercase tracking-wide ${color}`}>
        {classification}
      </span>
    </div>
  );
}
