import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseCetesbDetalheLicencasHtml,
  parseCetesbResultadoCandidatesHtml,
} from "../../server/environmental-compliance.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures/cetesb");

function readFixture(fileName: string) {
  return fs.readFileSync(path.join(fixtureDir, fileName), "latin1");
}

describe("CETESB public portal parsers", () => {
  it("parses candidates from processo_resultado.asp fixture", () => {
    const html = readFixture("processo_resultado.html");
    const candidates = parseCetesbResultadoCandidatesHtml(html);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.href).toContain("processo_resultado2.asp");
    expect(candidates[0]?.razao_social).toContain("KION SOUTH AMÉRICA");
    expect(candidates[0]?.cnpj).toBe("42365296001085");
    expect(candidates[0]?.municipio).toBe("INDAIATUBA");
  });

  it("parses licenses and cadastro fields from processo_resultado2.asp fixture", () => {
    const html = readFixture("processo_resultado2.html");
    const parsed = parseCetesbDetalheLicencasHtml(html);

    expect(parsed.cadastro.razao_social).toContain("KION SOUTH AMÉRICA");
    expect(parsed.cadastro.cnpj).toBe("42365296001085");
    expect(parsed.cadastro.municipio).toBe("INDAIATUBA");
    expect(parsed.licenses.length).toBeGreaterThan(0);
    expect(parsed.licenses[0]?.sd_numero).toBe("36021439");
    expect(parsed.licenses[0]?.numero_processo).toBe("36/00660/11");
    expect(parsed.licenses[0]?.documento_autenticidade_url).toContain("autenticidade.cetesb.sp.gov.br");
  });

  it("supports missing document fields without crashing", () => {
    const html = readFixture("processo_resultado2_missing_fields.html");
    const parsed = parseCetesbDetalheLicencasHtml(html);

    expect(parsed.licenses).toHaveLength(1);
    expect(parsed.licenses[0]?.numero_documento).toBeNull();
    expect(parsed.licenses[0]?.documento_autenticidade_url).toBeNull();
    expect(parsed.licenses[0]?.situacao).toBe("Atendida");
  });
});
