import { describe, expect, it } from "vitest";
import { calculateScore } from "../../server/risk-scoring.mjs";
import {
  buildPfNodeId,
  deriveObligationRelationships,
  maskCnpj,
  maskCpf,
  normalizeVerificationStatus,
  sha256Hex,
} from "../../server/investigation-helpers.mjs";

describe("deep investigation helpers", () => {
  it("mascara CPF e CNPJ corretamente", () => {
    expect(maskCpf("12345678901")).toBe("***.456.789-**");
    expect(maskCnpj("12345678000190")).toBe("**.345.678/0001-**");
  });

  it("gera node id PF determinístico para CPF mascarado", () => {
    const id1 = buildPfNodeId({
      nome: "Maria da Silva",
      cpfFull: "",
      cpfMasked: "***456789**",
      parentCnpj: "12345678000190",
    });
    const id2 = buildPfNodeId({
      nome: "Maria da Silva",
      cpfFull: "",
      cpfMasked: "***456789**",
      parentCnpj: "12345678000190",
    });

    expect(id1).toBe(id2);
    expect(id1.startsWith("PFMASK:")).toBe(true);
  });

  it("mapeia qualificação de sócio-administrador para obrigações", () => {
    const rels = deriveObligationRelationships("Sócio-Administrador", "PF");
    const codes = rels.map((entry) => entry.obligationCode);
    expect(codes).toContain("PARTICIPACAO_SOCIETARIA");
    expect(codes).toContain("GESTAO_E_REPRESENTACAO");
  });

  it("normaliza verificação por confidence_level", () => {
    expect(normalizeVerificationStatus({ confidence_level: "PROVAVEL" })).toBe("probable");
    expect(normalizeVerificationStatus({ confidence_level: "POSSIVEL" })).toBe("possible");
    expect(normalizeVerificationStatus({})).toBe("objective");
  });

  it("sha256 gera hash estável", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abcd"));
  });
});

describe("score policy", () => {
  it("não pontua flags possible", () => {
    const result = calculateScore([
      { weight: 35, verification_status: "possible" },
      { weight: 10, verification_status: "objective" },
    ]);
    expect(result.score).toBe(10);
    expect(result.classification).toBe("Baixo");
  });

  it("pontua provável com fator reduzido", () => {
    const result = calculateScore([{ weight: 30, verification_status: "probable" }]);
    expect(result.score).toBe(21);
    expect(result.classification).toBe("Médio");
  });

  it("reduz impacto de padrões de rede repetidos", () => {
    const result = calculateScore([
      {
        title: "Sócio conectado a múltiplas empresas",
        source_id: "network",
        source: "Análise de Padrões de Rede Societária",
        weight: 10,
        depth: 1,
        verification_status: "objective",
      },
      {
        title: "Sócio conectado a múltiplas empresas",
        source_id: "network",
        source: "Análise de Padrões de Rede Societária",
        weight: 10,
        depth: 1,
        verification_status: "objective",
      },
      {
        title: "Sócio conectado a múltiplas empresas",
        source_id: "network",
        source: "Análise de Padrões de Rede Societária",
        weight: 10,
        depth: 1,
        verification_status: "objective",
      },
    ]);
    expect(result.score).toBe(11);
    expect(result.classification).toBe("Baixo");
  });

  it("penaliza menos flags em nós indiretos", () => {
    const result = calculateScore([
      {
        title: "Empresa com dívida ativa não-previdenciária",
        source_id: "pgfn_nao_previdenciario",
        weight: 20,
        depth: 2,
        verification_status: "objective",
      },
    ]);
    expect(result.score).toBe(7);
    expect(result.classification).toBe("Baixo");
  });
});
