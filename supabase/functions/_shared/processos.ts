// ============================================================
// Compartilhado entre as Edge Functions que mexem em `processos`
// (hoje: cnj, processos). Mantém a normalização de CNJ e o cálculo de
// confiança num lugar só, pra `cnj/index.ts` (varredura) e
// `processos/index.ts` (confirmar/ignorar/reavaliar) nunca divergirem.
// ============================================================

/** Só dígitos. "0001234-56.2026.8.10.0001" e "00012345620268100001" têm
 * que virar a mesma chave — é o que impede duplicar processo por causa
 * de formatação diferente entre fontes. Espelha `normaliza_cnj` do SQL. */
export function normalizaCnj(s: string | null | undefined): string | null {
  const so = String(s ?? "").replace(/\D/g, "");
  return so || null;
}

/** CNJ "de verdade" tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO). Abaixo
 * disso não é chave de dedup confiável — vira fallback por texto. */
export function cnjValido(normalizado: string | null): boolean {
  return !!normalizado && normalizado.length === 20;
}

export interface SinalConfianca {
  sinal: string;
  peso: number;   // pontos que esse sinal contribui pro score 0–100
  motivo: string; // frase pro advogado entender o porquê, sem abrir o console
}

export interface Confianca {
  nivel: "alta" | "media" | "baixa";
  score: number;
  sinais: SinalConfianca[];
}

// Faixas isoladas de propósito: são um ponto de partida razoável, não uma
// calibração validada com dados reais. Ajustar aqui não exige mexer no
// resto do fluxo de sincronização/triagem.
const FAIXA_ALTA = 70;
const FAIXA_MEDIA = 40;

/** Nunca decide status sozinha — só ordena/rotula a fila de observação
 * pra o advogado saber o que revisar primeiro. */
export function calculaConfianca(sinais: SinalConfianca[]): Confianca {
  const score = Math.max(0, Math.min(100, sinais.reduce((soma, s) => soma + s.peso, 0)));
  const nivel = score >= FAIXA_ALTA ? "alta" : score >= FAIXA_MEDIA ? "media" : "baixa";
  return { nivel, score, sinais };
}
