import { describe, expect, it } from "vitest";
import { calculateScore } from "../../server/risk-scoring.mjs";
import { cleanDocument, parseDelimitedLine } from "../../server/common-utils.mjs";

describe("server common utils", () => {
  it("normaliza documento para apenas dígitos", () => {
    expect(cleanDocument("11.222.333/0001-44")).toBe("11222333000144");
    expect(cleanDocument("***123.456.789-00***")).toBe("12345678900");
  });

  it("faz parse de CSV delimitado com aspas", () => {
    const parsed = parseDelimitedLine('"A;B";C;"D"', ";");
    expect(parsed).toEqual(["A;B", "C", "D"]);
  });
});

describe("risk scoring", () => {
  it("classifica Baixo quando score < 25", () => {
    const result = calculateScore([{ weight: 10 }, { weight: 5 }]);
    expect(result.score).toBe(15);
    expect(result.classification).toBe("Baixo");
  });

  it("classifica Médio/Alto/Crítico nas faixas corretas", () => {
    expect(calculateScore([{ weight: 25 }]).classification).toBe("Médio");
    expect(calculateScore([{ weight: 55 }]).classification).toBe("Alto");
    expect(calculateScore([{ weight: 90 }]).classification).toBe("Crítico");
  });

  it("limita score a 100", () => {
    const result = calculateScore([{ weight: 80 }, { weight: 60 }]);
    expect(result.score).toBe(100);
    expect(result.classification).toBe("Crítico");
  });
});
