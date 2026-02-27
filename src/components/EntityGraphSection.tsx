import { useMemo, useRef, useState, useCallback, type WheelEvent } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Filter,
  GitBranch,
  Minus,
  Network,
  Plus,
  RefreshCcw,
  RotateCcw,
  ShieldAlert,
  Table2,
} from "lucide-react";
import type {
  InvestigationEvent,
  InvestigationGraphEdge,
  InvestigationGraphNode,
  InvestigationGraphResponse,
  InvestigationStatus,
} from "@/types/risk";

interface EntityGraphSectionProps {
  runId: string;
  status: InvestigationStatus | null;
  graph: InvestigationGraphResponse | null;
  events: InvestigationEvent[];
  loading: boolean;
}

const riskColor: Record<string, string> = {
  Baixo: "#00D4AA",
  Médio: "#FFB800",
  Alto: "#FF6B35",
  Crítico: "#FF0000",
};

const badgeColor: Record<string, string> = {
  Baixo: "bg-risk-low/10 text-risk-low",
  Médio: "bg-risk-medium/10 text-risk-medium",
  Alto: "bg-risk-high/10 text-risk-high",
  Crítico: "bg-risk-critical/10 text-risk-critical",
};

function nodeMatchesSeverity(node: InvestigationGraphNode, severity: string) {
  if (severity === "all") return true;
  if (severity === "critical") return node.risk_score >= 70;
  if (severity === "high") return node.risk_score >= 45 && node.risk_score < 70;
  if (severity === "medium") return node.risk_score >= 20 && node.risk_score < 45;
  return node.risk_score < 20;
}

function entityLabel(entityType: string) {
  if (entityType === "PJ") return "Pessoa Jurídica";
  if (entityType === "PF") return "Pessoa Física";
  if (entityType === "SOURCE") return "Base";
  if (entityType === "ORGAO") return "Órgão";
  return entityType;
}

export function EntityGraphSection({ runId, status, graph, events, loading }: EntityGraphSectionProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [obligationFilter, setObligationFilter] = useState("all");
  const svgRef = useRef<SVGSVGElement>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragAnchor, setDragAnchor] = useState<{ x: number; y: number } | null>(null);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const obligationOptions = useMemo(() => {
    const unique = Array.from(new Set(edges.map((edge) => edge.obligation_code).filter(Boolean)));
    return unique.sort();
  }, [edges]);

  const visibleNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (entityFilter !== "all" && node.entity_type !== entityFilter) return false;
      if (!nodeMatchesSeverity(node, severityFilter)) return false;
      return true;
    });
  }, [nodes, entityFilter, severityFilter]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    return edges.filter((edge) => {
      if (!visibleNodeIds.has(edge.source_id) || !visibleNodeIds.has(edge.target_id)) return false;
      if (obligationFilter !== "all" && edge.obligation_code !== obligationFilter) return false;
      return true;
    });
  }, [edges, obligationFilter, visibleNodeIds]);

  const layout = useMemo(() => {
    const grouped = new Map<number, InvestigationGraphNode[]>();
    for (const node of visibleNodes) {
      const depth = Number(node.depth ?? 0);
      const list = grouped.get(depth) ?? [];
      list.push(node);
      grouped.set(depth, list);
    }

    const depths = Array.from(grouped.keys()).sort((a, b) => a - b);
    const positions = new Map<string, { x: number; y: number }>();
    const xSpacing = 260;
    const ySpacing = 96;
    const xPadding = 120;
    const yPadding = 80;
    let maxRows = 0;

    depths.forEach((depth, colIdx) => {
      const column = grouped.get(depth) ?? [];
      maxRows = Math.max(maxRows, column.length);
      column.forEach((node, rowIdx) => {
        positions.set(node.id, {
          x: xPadding + colIdx * xSpacing,
          y: yPadding + rowIdx * ySpacing,
        });
      });
    });

    return {
      positions,
      width: Math.max(900, depths.length * xSpacing + 260),
      height: Math.max(420, maxRows * ySpacing + 180),
    };
  }, [visibleNodes]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0] ?? null,
    [nodes, selectedNodeId, visibleNodes],
  );

  // Converts screen coordinates (clientX/Y) to SVG viewBox coordinates
  const toSVGCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: clientX, y: clientY };
      const rect = svg.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (layout.width / rect.width),
        y: (clientY - rect.top) * (layout.height / rect.height),
      };
    },
    [layout.width, layout.height],
  );

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1 / 1.2 : 1.2;
    const svgMouse = toSVGCoords(event.clientX, event.clientY);
    setScale((currentScale) => {
      const newScale = Math.max(0.1, Math.min(8.0, currentScale * factor));
      setOffset((currentOffset) => ({
        x: svgMouse.x - (svgMouse.x - currentOffset.x) * (newScale / currentScale),
        y: svgMouse.y - (svgMouse.y - currentOffset.y) * (newScale / currentScale),
      }));
      return newScale;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="glass-card p-6 space-y-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Cadeia Societária Profunda
          </h2>
          <p className="text-xs text-muted-foreground">
            run_id: <span className="font-mono">{runId}</span>
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <RefreshCcw className="w-3.5 h-3.5 animate-spin" />
              Atualizando investigação...
            </span>
          ) : (
            <div className="space-y-0.5">
              <span>
                Status: <strong>{status?.status ?? "desconhecido"}</strong>
                {status ? ` | nós ${status.entities_processed}/${status.entities_discovered}` : ""}
              </span>
              {status?.status === "budget_exceeded" && (
                <p className="text-[11px] text-amber-500/80">
                  Orçamento da varredura atingido (tempo/entidades). Resultado parcial.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 text-xs">
        <label className="flex items-center gap-2 rounded border border-border/50 bg-secondary/20 px-2 py-1.5">
          <Filter className="w-3.5 h-3.5" />
          Entidade
          <select
            className="ml-auto bg-transparent outline-none"
            value={entityFilter}
            onChange={(event) => setEntityFilter(event.target.value)}
          >
            <option value="all">Todas</option>
            <option value="PJ">PJ</option>
            <option value="PF">PF</option>
            <option value="SOURCE">Bases</option>
            <option value="ORGAO">Órgãos</option>
          </select>
        </label>

        <label className="flex items-center gap-2 rounded border border-border/50 bg-secondary/20 px-2 py-1.5">
          <ShieldAlert className="w-3.5 h-3.5" />
          Risco
          <select
            className="ml-auto bg-transparent outline-none"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="critical">Crítico</option>
            <option value="high">Alto</option>
            <option value="medium">Médio</option>
            <option value="low">Baixo</option>
          </select>
        </label>

        <label className="flex items-center gap-2 rounded border border-border/50 bg-secondary/20 px-2 py-1.5 lg:col-span-2">
          <GitBranch className="w-3.5 h-3.5" />
          Obrigação
          <select
            className="ml-auto bg-transparent outline-none"
            value={obligationFilter}
            onChange={(event) => setObligationFilter(event.target.value)}
          >
            <option value="all">Todas</option>
            {obligationOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-border/60 bg-secondary/10 overflow-hidden">
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="w-full h-[600px] cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onMouseDown={(event) => {
            const svgMouse = toSVGCoords(event.clientX, event.clientY);
            setDragAnchor({ x: svgMouse.x - offset.x, y: svgMouse.y - offset.y });
          }}
          onMouseMove={(event) => {
            if (!dragAnchor) return;
            const svgMouse = toSVGCoords(event.clientX, event.clientY);
            setOffset({ x: svgMouse.x - dragAnchor.x, y: svgMouse.y - dragAnchor.y });
          }}
          onMouseUp={() => setDragAnchor(null)}
          onMouseLeave={() => setDragAnchor(null)}
        >
          <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
            {visibleEdges.map((edge: InvestigationGraphEdge) => {
              const source = layout.positions.get(edge.source_id);
              const target = layout.positions.get(edge.target_id);
              if (!source || !target) return null;
              const mx = (source.x + target.x) / 2;
              const my = (source.y + target.y) / 2;

              return (
                <g key={edge.id}>
                  <line
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    stroke="rgba(148, 163, 184, 0.45)"
                    strokeWidth={1.2}
                  />
                  {edge.obligation_code && (
                    <text x={mx} y={my - 4} textAnchor="middle" fontSize="8" fill="rgba(148, 163, 184, 0.85)">
                      {edge.obligation_code}
                    </text>
                  )}
                </g>
              );
            })}

            {visibleNodes.map((node) => {
              const pos = layout.positions.get(node.id);
              if (!pos) return null;
              const color = riskColor[node.risk_classification] ?? "#94A3B8";
              const active = selectedNode?.id === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x} ${pos.y})`}
                  onClick={() => setSelectedNodeId(node.id)}
                  className="cursor-pointer"
                >
                  <circle
                    r={active ? 27 : 22}
                    fill="rgba(15,23,42,0.92)"
                    stroke={color}
                    strokeWidth={active ? 3 : 2}
                  />
                  <text x={0} y={3} textAnchor="middle" fontSize="9" fill="white">
                    {node.entity_type}
                  </text>
                  <text x={0} y={38} textAnchor="middle" fontSize="9" fill="rgba(226,232,240,0.9)">
                    {node.label.length > 22 ? `${node.label.slice(0, 22)}...` : node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/40 bg-secondary/20 text-xs">
          <span className="text-muted-foreground font-mono">{Math.round(scale * 100)}%</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Diminuir zoom"
              className="rounded p-1 hover:bg-secondary/60 transition-colors"
              onClick={() =>
                setScale((s) => {
                  const n = Math.max(0.1, s / 1.2);
                  setOffset((o) => ({ x: o.x * (n / s), y: o.y * (n / s) }));
                  return n;
                })
              }
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Aumentar zoom"
              className="rounded p-1 hover:bg-secondary/60 transition-colors"
              onClick={() =>
                setScale((s) => {
                  const n = Math.min(8.0, s * 1.2);
                  setOffset((o) => ({ x: o.x * (n / s), y: o.y * (n / s) }));
                  return n;
                })
              }
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Redefinir visualização"
              className="rounded p-1 hover:bg-secondary/60 transition-colors"
              onClick={() => {
                setScale(1);
                setOffset({ x: 0, y: 0 });
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" />
            Detalhes da Entidade Selecionada
          </h3>
          {!selectedNode ? (
            <p className="text-xs text-muted-foreground">Nenhuma entidade disponível para seleção.</p>
          ) : (
            <div className="space-y-1 text-xs">
              <p>
                <strong>Nome:</strong> {selectedNode.label}
              </p>
              <p>
                <strong>Tipo:</strong> {entityLabel(selectedNode.entity_type)}
              </p>
              <p>
                <strong>Depth:</strong> {selectedNode.depth}
              </p>
              <p>
                <strong>Documento:</strong> {selectedNode.document_masked || "—"}
              </p>
              <p>
                <strong>Status:</strong> {selectedNode.status}
              </p>
              <p>
                <strong>Risco:</strong>{" "}
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${badgeColor[selectedNode.risk_classification] ?? ""}`}
                >
                  {selectedNode.risk_score} {selectedNode.risk_classification}
                </span>
              </p>
              <p>
                <strong>Restrições:</strong> {selectedNode.restriction_count}
              </p>
              <div className="pt-1 space-y-1">
                {(selectedNode.findings ?? []).slice(0, 6).map((finding) => (
                  <div key={finding.finding_id} className="rounded border border-border/50 bg-background/50 p-2">
                    <p className="font-medium">{finding.title}</p>
                    <p className="text-muted-foreground">{finding.description}</p>
                    <p className="text-muted-foreground/80 mt-1">
                      flag_id={finding.id} | verificação={finding.verification_status} | peso={finding.weight}
                    </p>
                  </div>
                ))}
                {(selectedNode.findings ?? []).length === 0 && (
                  <p className="text-muted-foreground">Sem findings para esta entidade.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Feed Multiagente
          </h3>
          <div className="max-h-64 overflow-auto space-y-1 pr-1" role="log" aria-live="polite">
            {events.length === 0 && (
              <p className="text-xs text-muted-foreground">Sem eventos disponíveis ainda.</p>
            )}
            {events.slice(-80).map((event) => (
              <div key={event.seq} className="rounded border border-border/40 bg-background/40 px-2 py-1.5 text-xs">
                <p className="font-medium">
                  [{event.agent}] {event.message}
                </p>
                <p className="text-muted-foreground">
                  #{event.seq} • {new Date(event.created_at).toLocaleTimeString("pt-BR")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <Table2 className="w-4 h-4 text-primary" />
          Trilha Auditável de Entidades ({visibleNodes.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b border-border/60 text-muted-foreground">
                <th className="py-2 pr-3">Entidade</th>
                <th className="py-2 pr-3">Tipo</th>
                <th className="py-2 pr-3">Depth</th>
                <th className="py-2 pr-3">Risco</th>
                <th className="py-2 pr-3">Restrições</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleNodes.map((node) => (
                <tr
                  key={node.id}
                  className="border-b border-border/30 hover:bg-background/40 cursor-pointer"
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <td className="py-2 pr-3">
                    <p className="font-medium">{node.label}</p>
                    <p className="text-muted-foreground">{node.document_masked || node.id}</p>
                  </td>
                  <td className="py-2 pr-3">{node.entity_type}</td>
                  <td className="py-2 pr-3">{node.depth}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${badgeColor[node.risk_classification] ?? ""}`}>
                      {node.risk_score} {node.risk_classification}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{node.restriction_count}</td>
                  <td className="py-2 pr-3">{node.status}</td>
                </tr>
              ))}
              {visibleNodes.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    Nenhuma entidade corresponde aos filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
