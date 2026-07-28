const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function apiError(status, code, message, headers = {}) {
  return json({ error: { code, message } }, status, headers);
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new HttpError(413, 'payload_too_large', 'Request body is too large.');
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('object required');
    }
    return body;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be a valid JSON object.');
  }
}

export function assertSameOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'origin_rejected', 'Cross-origin changes are not allowed.');
  }
}

export function requiredString(value, field, { max = 500, pattern } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'validation_error', `${field} is required.`);
  }
  const cleaned = value.trim();
  if (cleaned.length > max || (pattern && !pattern.test(cleaned))) {
    throw new HttpError(400, 'validation_error', `${field} is invalid.`);
  }
  return cleaned;
}

export function optionalString(value, field, { max = 2000, pattern } = {}) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new HttpError(400, 'validation_error', `${field} must be text.`);
  }
  const cleaned = value.trim();
  if (cleaned.length > max || (pattern && !pattern.test(cleaned))) {
    throw new HttpError(400, 'validation_error', `${field} is invalid.`);
  }
  return cleaned;
}

export function finiteNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, 'validation_error', `${field} is invalid.`);
  }
  return number;
}

export function integer(value, field, options = {}) {
  const number = finiteNumber(value, field, options);
  if (!Number.isInteger(number)) {
    throw new HttpError(400, 'validation_error', `${field} must be a whole number.`);
  }
  return number;
}

export function oneOf(value, field, choices) {
  if (!choices.includes(value)) {
    throw new HttpError(400, 'validation_error', `${field} must be one of: ${choices.join(', ')}.`);
  }
  return value;
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function handleError(error) {
  if (error instanceof HttpError) return apiError(error.status, error.code, error.message);
  console.error('STR Ops API error', error);
  return apiError(500, 'internal_error', 'The server could not complete that request.');
}

export function methodNotAllowed(allowed) {
  return apiError(405, 'method_not_allowed', 'That method is not allowed here.', {
    allow: allowed.join(', '),
  });
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export function nowIso() {
  return new Date().toISOString();
}
