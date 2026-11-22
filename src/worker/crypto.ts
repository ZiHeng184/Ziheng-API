const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64(digest);
}

export async function hashPassword(password: string, salt = base64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 100000 },
    key,
    256
  );
  return { salt, hash: base64(bits) };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function encryptionKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
  if (!secret) throw new Error("缺少 KEY_ENCRYPTION_SECRET");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `${base64(iv)}.${base64(encrypted)}`;
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
  if (!secret) throw new Error("缺少 KEY_ENCRYPTION_SECRET");
  const [iv, encrypted] = value.split(".");
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv) },
    key,
    fromBase64(encrypted)
  );
  return decoder.decode(decrypted);
}

export function createApiToken() {
  const raw = base64(crypto.getRandomValues(new Uint8Array(30)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `zh-sk-${raw}`;
}

export function maskSecret(value: string) {
  if (value.length <= 8) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
