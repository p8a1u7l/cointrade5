import axios from "axios";
import { CFG } from "./config.js";

type GetJsonOptions = {
  headers?: Record<string, string>;
};

export async function getJson<T>(url: string, options: GetJsonOptions = {}): Promise<T> {
  const { retry, pauseMs, timeoutMs } = CFG.http;
  let last: any;
  for (let i=0;i<retry;i++){
    try {
      const { data } = await axios.get(url, {
        timeout: timeoutMs,
        headers: options.headers,
      });
      return data as T;
    } catch (e:any) {
      last = e;
      await new Promise(r=>setTimeout(r, pauseMs*(i+1)));
    }
  }
  throw last;
}
