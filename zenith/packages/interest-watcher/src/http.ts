import axios from 'axios';
import { CFG } from './config';

type GetJsonOptions = {
  headers?: Record<string, string>;
};

export async function getJson<T>(
  url: string,
  options: GetJsonOptions = {}
): Promise<T> {
  const { retry, pauseMs, timeoutMs } = CFG.http;
  let last: unknown;
  for (let i = 0; i < retry; i += 1) {
    try {
      const { data } = await axios.get(url, {
        timeout: timeoutMs,
        headers: options.headers,
      });
      return data as T;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, pauseMs * (i + 1)));
    }
  }
  throw last;
}
