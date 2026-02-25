const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export async function fetchWithTimeout(url, timeoutMs = 10000, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "*/*",
        "user-agent": DEFAULT_USER_AGENT,
        ...init.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function urlExists(url, timeoutMs = 10000) {
  const headResponse = await fetchWithTimeout(url, timeoutMs, { method: "HEAD" });
  if (headResponse?.ok) return true;

  if (headResponse && headResponse.status !== 405) return false;

  const fallbackResponse = await fetchWithTimeout(url, timeoutMs, {
    headers: { Range: "bytes=0-0" },
  });
  if (!fallbackResponse) return false;

  if (fallbackResponse.body) {
    try {
      await fallbackResponse.body.cancel();
    } catch {
      // no-op
    }
  }

  return fallbackResponse.ok || fallbackResponse.status === 206;
}
