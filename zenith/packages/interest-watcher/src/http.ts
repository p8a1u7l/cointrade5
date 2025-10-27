import axios, { AxiosResponse } from 'axios';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(res?: AxiosResponse | null): number | null {
  const headerValue = res?.headers?.['retry-after'];
  if (!headerValue) return null;
  const asNumber = Number(headerValue);
  if (!Number.isNaN(asNumber)) {
    return asNumber * 1000;
  }
  const parsed = Date.parse(headerValue);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(parsed - Date.now(), 0);
}

type GetJsonOptions = {
  timeout?: number;
  retries?: number;
  baseBackoffMs?: number;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
};

export async function getJson<T>(
  url: string,
  {
    timeout = 10_000,
    retries = 4,
    baseBackoffMs = 2_000,
    headers = {},
    params = {},
  }: GetJsonOptions = {}
): Promise<T> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const requestHeaders: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'zenith-interest-watcher/1.0',
        ...headers,
      };
      const res = await axios.request<T>({
        method: 'get',
        url,
        timeout,
        headers: requestHeaders,
        params,
      });
      return res.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const retriable = status === 429 || status === 503;
      if (!retriable || attempt >= retries) {
        throw error;
      }

      const retryAfterMs = parseRetryAfterMs(error.response);
      const backoffMs =
        (retryAfterMs ?? Math.min(60_000, baseBackoffMs * 2 ** attempt)) +
        Math.floor(Math.random() * 500);

      await sleep(backoffMs);
      attempt += 1;
    }
  }
}
