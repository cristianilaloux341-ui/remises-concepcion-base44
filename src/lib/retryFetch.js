/**
 * Ejecuta una función async con reintentos y backoff exponencial.
 * Reintenta solo en errores de red (Network Error) o 5xx.
 */
export async function withRetry(fn, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = (err?.message || "").toLowerCase();
      const isNetworkError = msg.includes("network error") || err?.code === "ERR_NETWORK" || msg.includes("failed to fetch") || msg.includes("network request failed") || msg.includes("load failed");
      const isServerError = err?.response?.status >= 500 || err?.status >= 500;
      if (!isNetworkError && !isServerError) throw err; // error no recuperable
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}