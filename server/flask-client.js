import { Blob } from "node:buffer";

export class FlaskApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "FlaskApiError";
    this.status = status;
  }
}

function endpoint(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function requestOptions(options = {}) {
  return { ...options, signal: AbortSignal.timeout(30_000) };
}

async function readEnvelope(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new FlaskApiError(`Flask returned HTTP ${response.status} without JSON`, response.status);
  }
  if (!response.ok || !payload.ok) {
    throw new FlaskApiError(payload.error || `Flask returned HTTP ${response.status}`, response.status);
  }
  return payload.data;
}

export async function login(baseUrl, loginName, password) {
  const response = await fetch(endpoint(baseUrl, "/login"), requestOptions({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login_name: loginName, password }),
  }));
  const data = await readEnvelope(response);
  return data;
}

export async function getMe(baseUrl, token) {
  const response = await fetch(endpoint(baseUrl, "/me"), requestOptions({
    headers: { authorization: `Bearer ${token}` },
  }));
  return readEnvelope(response);
}

export async function getChecks(baseUrl, token) {
  const response = await fetch(endpoint(baseUrl, "/checks"), requestOptions({
    headers: { authorization: `Bearer ${token}` },
  }));
  return readEnvelope(response);
}

async function postMobileOnce(baseUrl, token, image) {
  const form = new FormData();
  form.append("image", new Blob([image.bytes], { type: image.mimeType }), image.name);
  const response = await fetch(endpoint(baseUrl, "/checks/mobile"), requestOptions({
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  }));
  return readEnvelope(response);
}

export async function postMobileWithRetry(baseUrl, token, image) {
  try {
    return await postMobileOnce(baseUrl, token, image);
  } catch (error) {
    if (error instanceof FlaskApiError && error.status > 0 && error.status < 500) {
      throw error;
    }
    return postMobileOnce(baseUrl, token, image);
  }
}
