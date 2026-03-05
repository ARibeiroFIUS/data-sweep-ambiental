import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface DetailPanelLink {
  label: string;
  href: string;
}

export interface DetailPanelSection {
  title: string;
  items: string[];
}

export interface DetailPanelItem {
  kind: "rag" | "ibama" | "state" | "municipal" | "areas" | "evidence" | "source";
  title: string;
  subtitle?: string;
  risk?: string;
  status?: string;
  description?: string;
  sections?: DetailPanelSection[];
  links?: DetailPanelLink[];
  raw?: unknown;
}

function riskTone(risk?: string) {
  if (risk === "alto") return "bg-red-100 text-red-800 border-red-200";
  if (risk === "medio") return "bg-amber-100 text-amber-800 border-amber-200";
  if (risk === "baixo") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (risk === "nao_classificado") return "bg-gray-100 text-gray-700 border-gray-200";
  return "bg-sky-100 text-sky-800 border-sky-200";
}

export function EnvironmentalDetailSheet({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: DetailPanelItem | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0">
        <div className="h-full flex flex-col">
          <div className="border-b border-gray-200 bg-gray-50 px-6 py-5">
            <SheetHeader>
              <SheetTitle className="text-gray-900">{item?.title || "Detalhes"}</SheetTitle>
              <SheetDescription className="text-gray-600">{item?.subtitle || "Visualização detalhada do item selecionado."}</SheetDescription>
            </SheetHeader>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {item?.kind && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700">
                  Tipo: {item.kind}
                </span>
              )}
              {item?.status && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-700">
                  Status: {item.status}
                </span>
              )}
              {item?.risk && (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 font-medium ${riskTone(item.risk)}`}>Risco: {item.risk}</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {item?.description && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">{item.description}</div>
            )}

            {Array.isArray(item?.sections) &&
              item.sections.map((section) => (
                <div key={section.title} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</p>
                  <div className="mt-2 space-y-1">
                    {section.items.length > 0 ? (
                      section.items.map((line) => (
                        <p key={line} className="text-sm text-gray-700">
                          - {line}
                        </p>
                      ))
                    ) : (
                      <p className="text-sm text-gray-400">Sem dados para esta seção.</p>
                    )}
                  </div>
                </div>
              ))}

            {Array.isArray(item?.links) && item.links.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fontes e links</p>
                <div className="mt-2 flex flex-col gap-2">
                  {item.links.map((link) => (
                    <a
                      key={`${link.label}-${link.href}`}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-sky-700 hover:text-sky-900 underline decoration-sky-300 hover:decoration-sky-500"
                    >
                      {link.label}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {item?.raw !== undefined && (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Payload técnico</div>
                <pre className="max-h-80 overflow-auto bg-gray-950 text-gray-100 p-3 text-[11px] leading-relaxed">{JSON.stringify(item.raw, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
