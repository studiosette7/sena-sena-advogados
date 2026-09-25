// ============================================================
// SENA & SENA — Edge Function "triagem"
//
// Recebe o id de um caso, lê a ficha que a pessoa preencheu na landing e
// devolve uma análise preliminar: viabilidade, o que pedir de documento,
// o que ainda falta perguntar e um rascunho de resposta pro WhatsApp.
//
// Roda no servidor (Deno). A chave do Gemini é secret do Supabase e nunca
// chega no navegador. Exige usuário logado — o público não chama isso.
//
// Fornecedor: Google Gemini (gemini-2.5-flash), tier gratuito da API.
// Deploy:  npx supabase functions deploy triagem
// Segredo: npx supabase secrets set GEMINI_API_KEY=AIza...
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI, semAdditionalProperties, comRetentativa } from "../_shared/gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

const SCHEMA = semAdditionalProperties({
  type: "object",
  properties: {
    viabilidade: {
      type: "string",
      enum: ["provavel", "possivel", "improvavel", "fora_da_area"],
      description:
        "provavel = há caminho claro; possivel = depende de prova ou de informação que falta; " +
        "improvavel = os fatos relatados não sustentam ação; fora_da_area = não é trabalhista nem previdenciário",
    },
    resumo: {
      type: "string",
      description: "Uma ou duas frases dizendo o que aconteceu com essa pessoa, em português simples.",
    },
    teses: {
      type: "array",
      items: { type: "string" },
      description: "Pedidos ou teses que os fatos relatados comportam. Vazio se não houver.",
    },
    pontos_atencao: {
      type: "array",
      items: { type: "string" },
      description:
        "O que pode derrubar ou enfraquecer o caso: prazo apertado, falta de prova, " +
        "relato contraditório, verba já quitada. Vazio se não houver.",
    },
    documentos_pedir: {
      type: "array",
      items: { type: "string" },
      description: "Documentos a pedir para essa pessoa, do mais decisivo para o menos.",
    },
    perguntas_fazer: {
      type: "array",
      items: { type: "string" },
      description: "O que ainda falta saber antes de decidir. No máximo 4.",
    },
    resposta_whatsapp: {
      type: "string",
      description:
        "Rascunho da primeira resposta ao cliente pelo WhatsApp, para o advogado revisar antes de enviar.",
    },
    urgencia: {
      type: "string",
      enum: ["alta", "media", "baixa"],
      description: "alta quando o prazo aperta ou há risco de perda de direito.",
    },
  },
  required: [
    "viabilidade", "resumo", "teses", "pontos_atencao",
    "documentos_pedir", "perguntas_fazer", "resposta_whatsapp", "urgencia",
  ],
  additionalProperties: false,
});

// ---------- instruções ----------
const SISTEMA = `
Você assessora um advogado (OAB/UF 000.000) que atua em Direito do
Trabalho e Previdenciário no ABC Paulista. Ele é sempre o polo ativo: processa
empregador e processa o INSS.

Sua função é fazer a TRIAGEM INTERNA de um lead que preencheu o formulário do
site. Você escreve para o advogado, não para o cliente.

Como avaliar
- Trabalhe apenas com os fatos relatados. Não invente vínculo, salário, data,
  função nem documento que a pessoa não mencionou.
- O relato é de leigo, feito num formulário. É incompleto por natureza. Quando
  faltar informação decisiva, diga isso em "perguntas_fazer" em vez de supor.
- Prazo importa: na Justiça do Trabalho a ação prescreve em 2 anos contados do
  fim do contrato, e dentro dela se cobra os últimos 5 anos. Se o relato indicar
  que o prazo está perto do fim ou já passou, isso é ponto de atenção e a
  urgência sobe.
- No INSS a lógica é outra: indeferimento pode ser rediscutido, e revisão de
  valor tem prazo decadencial de 10 anos. O motivo da negativa determina a
  estratégia — se a pessoa não disse o motivo, pergunte.
- "viabilidade" é leitura preliminar, não parecer. Prefira "possivel" quando o
  caso depender de prova ou de informação que não está na ficha.

O rascunho de WhatsApp
Escreva como o próprio advogado escreveria: primeira pessoa, direto, sem
juridiquês, sem saudação genérica longa. De 3 a 6 linhas. Deve reconhecer o
caso da pessoa, pedir o documento mais decisivo e propor o próximo passo.

Restrições da OAB — valem para o rascunho e para tudo que possa chegar ao cliente:
- Não prometa nem sugira resultado. Nada de "você vai receber", "é ganho certo",
  "garantimos". Fale em analisar, verificar, entrar com a ação.
- Não cite valores, honorários, percentuais nem estimativa de quanto a pessoa
  tem a receber.
- Não ofereça consulta gratuita nem qualquer serviço sem custo como atrativo.
- Sem sensacionalismo e sem comparação com outros advogados.

Escreva tudo em português do Brasil.
`.trim();

function fichaEmTexto(c: Record<string, any>): string {
  const linha = (rotulo: string, valor: unknown) => {
    if (valor === null || valor === undefined) return "";
    const t = Array.isArray(valor) ? valor.join(", ") : String(valor).trim();
    return t ? `${rotulo}: ${t}\n` : "";
  };
  return (
    linha("Área", c.area) +
    linha("Situação", c.situacao) +
    linha("Tempo desde a saída", c.saida) +
    linha("O que a pessoa acha que ficou pra trás", c.pontos) +
    linha("Benefício pretendido", c.beneficio) +
    linha("Situação no INSS", c.inss) +
    linha("Documentos que diz ter", c.documentos) +
    linha("Relato dela", c.relato) +
    linha("Cidade", c.cidade)
  ).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  // ---------- 1) só usuário logado ----------
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) {
    return json({ erro: "não autenticado" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );

  const { data: sessao, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !sessao?.user) return json({ erro: "não autenticado" }, 401);

  // ---------- 2) carrega o caso ----------
  let corpo: { caso_id?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "corpo inválido" }, 400);
  }
  if (!corpo.caso_id) return json({ erro: "informe caso_id" }, 400);

  // O select passa pelo RLS com o token do usuário: se ele não pode ver o
  // caso, não vem nada — a função não contorna a permissão do banco.
  const { data: caso, error: erroCaso } = await supabase
    .from("casos")
    .select("*")
    .eq("id", corpo.caso_id)
    .single();

  if (erroCaso || !caso) return json({ erro: "caso não encontrado" }, 404);

  // ---------- 3) chama a IA ----------
  const chave = Deno.env.get("GEMINI_API_KEY");
  if (!chave) return json({ erro: "GEMINI_API_KEY não configurada" }, 500);

  let resposta: any;
  try {
    const chama = () => fetch(`${GEMINI}:generateContent?key=${chave}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SISTEMA }] },
        contents: [{
          role: "user",
          parts: [{ text: `Faça a triagem desta ficha:\n\n${fichaEmTexto(caso)}` }],
        }],
        generationConfig: {
          maxOutputTokens: 8000,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      }),
    });
    // o tier grátis devolve 503 (sobrecarga) de vez em quando — tenta 1x de novo
    const r = await comRetentativa(chama, (resp) => resp.status === 503);
    const j = await r.json();
    if (!r.ok) {
      const status = j?.error?.status ?? "";
      const msg = j?.error?.message ?? "";
      const amigavel = status === "RESOURCE_EXHAUSTED" || /quota/i.test(msg)
        ? "A cota diária gratuita da IA acabou por hoje. Volta a funcionar amanhã."
        : (msg || `Gemini respondeu ${r.status}`);
      throw new Error(amigavel);
    }
    resposta = j;
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : "falha ao chamar a IA" }, 502);
  }

  const cand = resposta.candidates?.[0];
  const motivo = cand?.finishReason;
  if (motivo === "SAFETY" || motivo === "PROHIBITED_CONTENT" || motivo === "RECITATION") {
    return json({ erro: "a IA recusou analisar esse caso" }, 422);
  }
  if (motivo === "MAX_TOKENS") {
    return json({ erro: "análise ficou incompleta (max_tokens)" }, 502);
  }

  const bruto = cand?.content?.parts?.[0]?.text;
  if (!bruto) return json({ erro: "resposta da IA sem texto" }, 502);

  const analise = JSON.parse(bruto);

  // ---------- 4) grava no caso ----------
  const { error: erroGravar } = await supabase
    .from("casos")
    .update({ ia: analise, ia_at: new Date().toISOString() })
    .eq("id", corpo.caso_id);

  if (erroGravar) {
    return json({ erro: "análise feita, mas falhou ao gravar", detalhe: erroGravar.message }, 500);
  }

  const u = resposta.usageMetadata ?? {};
  return json({
    ok: true,
    analise,
    uso: {
      entrada: u.promptTokenCount ?? 0,
      saida: u.candidatesTokenCount ?? 0,
    },
  });
});
