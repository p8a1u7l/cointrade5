import { getJson } from './http';

const BASE = 'https://cryptopanic.com/api/v1/posts/';

type CryptoPanicParams = {
  authToken: string;
  filter?: string;
  currencies?: string;
  kind?: string;
  timeout?: number;
};

type CryptoPanicResponse = {
  results?: Array<{
    id?: number | string;
    title?: string;
    url?: string;
    published_at?: string;
    created_at?: string;
    domain?: string;
    kind?: string;
    votes?: unknown;
  }>;
};

type NormalisedItem = {
  id: number | string | undefined;
  title: string | undefined;
  url: string | undefined;
  published_at: string | undefined;
  domain: string | undefined;
  kind: string | undefined;
  votes: unknown;
};

export async function fetchCryptoPanic({
  authToken,
  filter = 'important',
  currencies,
  kind,
  timeout = 10_000,
}: CryptoPanicParams): Promise<{ items: NormalisedItem[]; count: number }> {
  if (!authToken) {
    throw new Error('CRYPTOPANIC_TOKEN is missing');
  }

  const params: Record<string, string> = {
    auth_token: authToken,
    filter,
  };
  if (currencies) params.currencies = currencies;
  if (kind) params.kind = kind;

  const data = await getJson<CryptoPanicResponse>(BASE, { timeout, params });
  const items: NormalisedItem[] = (data?.results ?? []).map((it) => ({
    id: it?.id,
    title: typeof it?.title === 'string' ? it.title : undefined,
    url: typeof it?.url === 'string' ? it.url : undefined,
    published_at:
      typeof it?.published_at === 'string'
        ? it.published_at
        : typeof it?.created_at === 'string'
        ? it.created_at
        : undefined,
    domain: typeof it?.domain === 'string' ? it.domain : undefined,
    kind: typeof it?.kind === 'string' ? it.kind : undefined,
    votes: it?.votes,
  }));

  return { items, count: items.length };
}
