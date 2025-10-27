import { fetch as undiciFetch, Headers, Request, Response, FormData, File, Blob } from 'undici';

if (typeof globalThis.fetch !== 'function') {
  globalThis.fetch = undiciFetch;
}

if (typeof globalThis.Headers !== 'function') {
  globalThis.Headers = Headers;
}

if (typeof globalThis.Request !== 'function') {
  globalThis.Request = Request;
}

if (typeof globalThis.Response !== 'function') {
  globalThis.Response = Response;
}

if (typeof globalThis.FormData !== 'function') {
  globalThis.FormData = FormData;
}

if (typeof globalThis.File !== 'function') {
  globalThis.File = File;
}

if (typeof globalThis.Blob !== 'function') {
  globalThis.Blob = Blob;
}
