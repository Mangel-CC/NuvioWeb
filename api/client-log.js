const MAX_FIELD_LENGTH = 1200;
const MAX_PAYLOAD_LENGTH = 8000;

function clampText(value) {
  const text = String(value ?? "");
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH)}...` : text;
}

function sanitize(value, depth = 0) {
  if (depth > 4) {
    return "[depth-limit]";
  }
  if (value === null || typeof value === "undefined") {
    return value;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value === "string" ? clampText(value) : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitize(entry, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    Object.entries(value).slice(0, 40).forEach(([key, entry]) => {
      result[clampText(key)] = sanitize(entry, depth + 1);
    });
    return result;
  }
  return clampText(value);
}

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ ok: false });
    return;
  }

  let rawBody = request.body || {};
  if (typeof rawBody === "string") {
    try {
      rawBody = JSON.parse(rawBody);
    } catch (_) {
      rawBody = { raw: rawBody };
    }
  }
  const body = sanitize(rawBody);
  const payloadText = JSON.stringify(body);
  const payload = payloadText.length > MAX_PAYLOAD_LENGTH
    ? { truncated: true, raw: payloadText.slice(0, MAX_PAYLOAD_LENGTH) }
    : body;
  const level = String(payload?.level || "info").toLowerCase();
  const event = String(payload?.event || "client_log");
  const line = `[nuvio-client:${level}] ${event}`;

  if (level === "error") {
    console.error(line, payload);
  } else if (level === "warn" || level === "warning") {
    console.warn(line, payload);
  } else {
    console.log(line, payload);
  }

  response.status(204).end();
}
