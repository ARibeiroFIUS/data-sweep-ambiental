import crypto from "node:crypto";
import { cleanDocument, normalizePersonName } from "./common-utils.mjs";

const OBLIGATION_MAP = [
  {
    pattern: /SOCIO[\s-]*ADMINISTRADOR/i,
    relationships: [
      {
        relationship: "SOCIO_DE",
        obligationCode: "PARTICIPACAO_SOCIETARIA",
        obligationLabel: "Participação societária",
      },
      {
        relationship: "ADMINISTRADOR_DE",
        obligationCode: "GESTAO_E_REPRESENTACAO",
        obligationLabel: "Gestão e representação",
      },
    ],
  },
  {
    pattern: /ADMINISTRADOR|DIRETOR|GERENTE|PRESIDENTE/i,
    relationships: [
      {
        relationship: "ADMINISTRADOR_DE",
        obligationCode: "GESTAO_E_REPRESENTACAO",
        obligationLabel: "Gestão e representação",
      },
    ],
  },
  {
    pattern: /REPRESENTANTE|PROCURADOR/i,
    relationships: [
      {
        relationship: "SOCIO_DE",
        obligationCode: "REPRESENTACAO_LEGAL",
        obligationLabel: "Representação legal",
      },
    ],
  },
];

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function maskCpf(cpf) {
  const digits = cleanDocument(cpf);
  if (digits.length !== 11) return "";
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

export function maskCnpj(cnpj) {
  const digits = cleanDocument(cnpj);
  if (digits.length !== 14) return "";
  return `**.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-**`;
}

export function maskDocument(document) {
  const clean = cleanDocument(document);
  if (clean.length === 11) return maskCpf(clean);
  if (clean.length === 14) return maskCnpj(clean);
  return String(document ?? "").trim();
}

export function buildPfNodeId({ nome, cpfFull, cpfMasked }) {
  const cleanCpf = cleanDocument(cpfFull);
  if (cleanCpf.length === 11) {
    return `PFH:${sha256Hex(cleanCpf).slice(0, 24)}`;
  }

  const fingerprint = `${normalizePersonName(nome)}|${cpfMasked ?? ""}`;
  return `PFMASK:${sha256Hex(fingerprint).slice(0, 24)}`;
}

export function deriveObligationRelationships(qualification, partnerType) {
  const qual = String(qualification ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (!qual) {
    return [
      {
        relationship: partnerType === "PJ" ? "SOCIO_PJ_DE" : "SOCIO_DE",
        obligationCode: "PARTICIPACAO_SOCIETARIA",
        obligationLabel: "Participação societária",
      },
    ];
  }

  for (const item of OBLIGATION_MAP) {
    if (!item.pattern.test(qual)) continue;
    if (partnerType === "PJ") {
      return item.relationships.map((entry) => ({
        ...entry,
        relationship: "SOCIO_PJ_DE",
      }));
    }
    return item.relationships;
  }

  return [
    {
      relationship: partnerType === "PJ" ? "SOCIO_PJ_DE" : "SOCIO_DE",
      obligationCode: "PARTICIPACAO_SOCIETARIA",
      obligationLabel: "Participação societária",
    },
  ];
}

export function buildEdgeId(sourceNodeId, targetNodeId, relationship, obligationCode = "") {
  return sha256Hex(`${sourceNodeId}|${targetNodeId}|${relationship}|${obligationCode}`).slice(0, 32);
}

export function normalizeVerificationStatus(flag) {
  if (flag?.verification_status) return flag.verification_status;
  const level = String(flag?.confidence_level ?? "").toUpperCase();
  if (level === "PROVAVEL") return "probable";
  if (level === "POSSIVEL") return "possible";
  return "objective";
}

export function buildFindingId({ nodeId, flagId, sourceId, title }) {
  return sha256Hex(`${nodeId}|${flagId}|${sourceId ?? ""}|${title ?? ""}`).slice(0, 40);
}
