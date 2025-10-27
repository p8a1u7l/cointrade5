import undici from 'undici';

const {
  fetch: undiciFetch,
  Headers: UndiciHeaders,
  Request: UndiciRequest,
  Response: UndiciResponse,
  FormData: UndiciFormData,
  File: UndiciFile,
  Blob: UndiciBlob,
} = undici;

if (typeof globalThis.fetch !== 'function' && typeof undiciFetch === 'function') {
  globalThis.fetch = undiciFetch;
}

if (typeof globalThis.Headers !== 'function' && typeof UndiciHeaders === 'function') {
  globalThis.Headers = UndiciHeaders;
}

if (typeof globalThis.Request !== 'function' && typeof UndiciRequest === 'function') {
  globalThis.Request = UndiciRequest;
}

if (typeof globalThis.Response !== 'function' && typeof UndiciResponse === 'function') {
  globalThis.Response = UndiciResponse;
}

if (typeof globalThis.FormData !== 'function' && typeof UndiciFormData === 'function') {
  globalThis.FormData = UndiciFormData;
}

if (typeof globalThis.File !== 'function' && typeof UndiciFile === 'function') {
  globalThis.File = UndiciFile;
}

if (typeof globalThis.Blob !== 'function' && typeof UndiciBlob === 'function') {
  globalThis.Blob = UndiciBlob;
}
