/**
 * POST de JSON que **siempre termina**.
 *
 * `fetch` sin `signal` puede quedarse esperando indefinidamente si el servidor
 * se atasca, y en la interfaz eso se ve como un botón que dice «Analizando…»
 * para siempre: sin error, sin resultado, sin nada que hacer salvo recargar.
 * Un fallo con mensaje es mucho mejor que un estado del que no se sale.
 *
 * El escaneo del servidor ya tiene su propio presupuesto de tiempo; este es la
 * segunda red, para lo que ese presupuesto no cubre — el proceso caído, el
 * socket que no cierra, el disco que no responde.
 */
export class TimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(`sin respuesta tras ${seconds} s`);
    this.name = "TimeoutError";
  }
}

export async function postJSON<T>(
  url: string,
  body: unknown,
  { timeoutMs = 90_000 }: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await r.json()) as T;
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new TimeoutError(Math.round(timeoutMs / 1000));
    throw e;
  } finally {
    clearTimeout(t);
  }
}
