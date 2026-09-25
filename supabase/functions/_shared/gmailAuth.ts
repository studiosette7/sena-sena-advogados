// Assinatura do "state" do fluxo OAuth do Gmail — compartilhado entre
// `gmail` (que gera) e `gmail-callback` (que confere). Sem isso, qualquer
// um poderia forjar uma chamada ao callback, que é público por precisar
// receber o redirect do Google sem Authorization do Supabase.

const VALIDADE_MS = 10 * 60 * 1000; // 10 minutos é de sobra pro usuário concluir o login no Google

export function base64url(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlParaBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
}

async function chaveHmac(segredo: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

export async function assinaEstado(usuarioId: string, segredo: string): Promise<string> {
  const payload = JSON.stringify({ uid: usuarioId, ts: Date.now(), nonce: crypto.randomUUID() });
  const chave = await chaveHmac(segredo);
  const assinatura = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(payload));
  return `${base64url(new TextEncoder().encode(payload))}.${base64url(assinatura)}`;
}

/** Devolve o usuario_id se o state for válido e recente; null se for
 * inválido, forjado ou velho demais. */
export async function verificaEstado(state: string, segredo: string): Promise<string | null> {
  const [payloadB64, assinaturaB64] = String(state ?? "").split(".");
  if (!payloadB64 || !assinaturaB64) return null;

  const chave = await chaveHmac(segredo);
  const payloadBytes = base64urlParaBytes(payloadB64);
  const ok = await crypto.subtle.verify("HMAC", chave, base64urlParaBytes(assinaturaB64), payloadBytes);
  if (!ok) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (typeof payload.uid !== "string" || typeof payload.ts !== "number") return null;
    if (Date.now() - payload.ts > VALIDADE_MS) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
