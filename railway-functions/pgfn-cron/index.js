export default async function handler() {
  const railwayWebUrl = String(process.env.RAILWAY_SERVICE_DATA_SWEEP_ENGINE_WEB_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const appUrl = String(
    process.env.APP_URL ||
      process.env.APP_BASE_URL ||
      (railwayWebUrl ? `https://${railwayWebUrl}` : ""),
  )
    .trim()
    .replace(/\/+$/, "");
  const jobToken = String(process.env.JOB_ADMIN_TOKEN || "").trim();

  if (!appUrl) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "APP_URL não configurada",
        expected: "https://<seu-app>.up.railway.app",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  if (!jobToken) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "JOB_ADMIN_TOKEN não configurado",
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  const url = `${appUrl}/api/jobs/sync-pgfn`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-job-token": jobToken,
        accept: "application/json",
      },
    });

    const responseText = await response.text();

    return new Response(
      JSON.stringify(
        {
          ok: response.ok,
          status: response.status,
          url,
          ran_at: new Date().toISOString(),
          response: responseText.slice(0, 4000),
        },
        null,
        2,
      ),
      {
        status: response.ok ? 200 : 502,
        headers: { "content-type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          url,
          ran_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}
