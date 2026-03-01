import { test } from "@playwright/test";
import { runTribunalSmoke, type TribunalSmokeTarget } from "./helpers/tribunal-smoke";

const BASE_TRIBUNALS: TribunalSmokeTarget[] = [
  {
    tribunalId: "tjba",
    tribunalName: "Tribunal de Justiça da Bahia",
    url: "https://pje.tjba.jus.br/pje/ConsultaPublica/listView.seam",
  },
  {
    tribunalId: "tjsp",
    tribunalName: "Tribunal de Justiça de São Paulo",
    url: "https://esaj.tjsp.jus.br/cpopg/open.do",
  },
  {
    tribunalId: "trf1",
    tribunalName: "TRF 1ª Região",
    url: "https://pje1g-consultapublica.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam",
  },
  {
    tribunalId: "trt2",
    tribunalName: "TRT 2ª Região",
    url: "https://pje.trt2.jus.br/primeirograu/ConsultaPublica/listView.seam",
  },
];

test.describe("Tribunais Base Smoke", () => {
  for (const tribunal of BASE_TRIBUNALS) {
    test(`smoke:${tribunal.tribunalId}`, async ({ page }, testInfo) => {
      await runTribunalSmoke(page, testInfo, tribunal);
    });
  }
});

