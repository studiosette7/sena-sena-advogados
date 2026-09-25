// ============================================================
// Gemini — o que as quatro functions repetiam
//
// `advogado`, `triagem`, `cnj` e `gmail` chamavam o Gemini cada uma com
// sua própria cópia do endpoint, do limpador de schema e (quando tinha)
// da retentativa de 503. As cópias divergiram: a do `gmail` ficou sem
// retentativa nenhuma, e por causa disso a extração de datas do e-mail
// falhava calada toda vez que o tier grátis engasgava. Aqui é a versão
// única — mexeu aqui, valeu pra todo mundo.
// ============================================================

export const MODELO = "gemini-2.5-flash";
export const GEMINI = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}`;

export function chaveGemini(): string {
  const k = Deno.env.get("GEMINI_API_KEY");
  if (!k) throw new Error("GEMINI_API_KEY não configurada");
  return k;
}

/** O schema do Gemini é um subconjunto do OpenAPI: aceita type, properties,
 * items, enum, required, description — mas não additionalProperties. Passar
 * isso quebra a chamada com 400, então tiramos antes de mandar. */
export function semAdditionalProperties(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(semAdditionalProperties);
  if (s && typeof s === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      if (k === "additionalProperties") continue;
      out[k] = semAdditionalProperties(v);
    }
    return out;
  }
  return s;
}

/** O tier grátis devolve 503 (sobrecarga) de vez em quando — tenta de novo
 * uma vez antes de desistir, em vez de estourar pro usuário. */
export async function comRetentativa<T>(
  chama: () => Promise<T>,
  ehErro: (t: T) => boolean,
  esperaMs = 1500,
): Promise<T> {
  const r1 = await chama();
  if (!ehErro(r1)) return r1;
  await new Promise((ok) => setTimeout(ok, esperaMs));
  return chama();
}

/** Uma geração com resposta em JSON (responseSchema), já com retentativa.
 * Devolve o objeto pronto, ou `null` quando não deu — quem chama decide o
 * que fazer com o vazio, sem precisar repetir try/catch em cada lugar. */
export async function geraJson(
  corpo: Record<string, unknown>,
  aoFalhar?: (motivo: string) => void,
): Promise<any | null> {
  try {
    const chama = () =>
      fetch(`${GEMINI}:generateContent?key=${chaveGemini()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });

    const r = await comRetentativa(chama, (resp) => resp.status === 503);
    if (!r.ok) {
      aoFalhar?.(`Gemini respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
      return null;
    }

    const j = await r.json();
    const bruto = j?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!bruto) {
      aoFalhar?.(`resposta sem texto: ${JSON.stringify(j).slice(0, 300)}`);
      return null;
    }
    return JSON.parse(bruto);
  } catch (e) {
    aoFalhar?.(String(e));
    return null;
  }
}
