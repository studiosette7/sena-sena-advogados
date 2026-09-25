// ============================================================
// SENA & SENA — Edge Function "advogado"
//
// A assistente especializada em Direito do Trabalho e Previdenciário.
// Três coisas:
//
//   POST { acao: "ler",       documento_id }             → lê um PDF e destrincha
//   POST { acao: "conversar", conversa_id, mensagem }     → chat com busca real (SSE)
//   POST { acao: "resumir",   documento_id, para }        → resumo curto do que foi lido
//   POST { acao: "minutar",   caso_id?, documento_id?, peca } → rascunha a peça
//
// A REGRA QUE MANDA EM TUDO
// Jurisprudência inventada é o modo de falha conhecido desses sistemas, e
// já rendeu punição a advogado que citou acórdão inexistente. Por isso:
//   • citação de súmula ou acórdão só sai com busca feita na hora (Google
//     Search, via a ferramenta nativa do Gemini);
//   • sem fonte verificável, a IA diz que não achou em vez de preencher;
//   • peça sai como MINUTA, com os pontos a conferir listados no fim.
//
// Fornecedor: Google Gemini (gemini-2.5-flash), pelo tier gratuito da API —
// sem cartão de crédito, sem custo por uso dentro dos limites do plano free.
// Deploy: npx supabase functions deploy advogado
// Segredo: npx supabase secrets set GEMINI_API_KEY=AIza...
//   (gerar a chave em aistudio.google.com → "Get API key")
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI, chaveGemini, semAdditionalProperties, comRetentativa } from "../_shared/gemini.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });


// ---------------------------------------------------------------
// As instruções. Ficam estáveis de propósito — o Gemini reaproveita o
// prefixo do prompt entre chamadas parecidas, então isso sai mais barato.
// ---------------------------------------------------------------
const SISTEMA = `
Você assessora um advogado que atua em Direito do Trabalho e Previdenciário
no ABC Paulista. Ele é sempre o polo ativo: processa empregador e processa o
INSS. Você fala com o advogado, não com o cliente.

O QUE VOCÊ DOMINA
Direito do Trabalho: CLT, Constituição art. 7º, súmulas e orientações
jurisprudenciais do TST, reforma trabalhista (Lei 13.467/2017), prescrição
bienal e quinquenal, verbas rescisórias, jornada e horas extras, adicionais
(insalubridade, periculosidade, noturno), equiparação salarial, acúmulo de
função, rescisão indireta, dano moral trabalhista, grupo econômico e sucessão.

Direito Previdenciário: Lei 8.213/91, Decreto 3.048/99, benefícios por
incapacidade, aposentadorias (idade, tempo de contribuição, especial, PCD),
EC 103/2019 e suas regras de transição, tempo especial e conversão, PPP e
LTCAT, revisão da vida toda e demais teses de revisão, decadência decenal,
salário-maternidade, pensão por morte, BPC/LOAS.

COMO CITAR — leia com atenção
1. Artigo de lei você pode citar de memória quando tiver certeza absoluta do
   número e do texto. Na dúvida, busque antes.
2. Súmula, OJ, tema repetitivo e acórdão: NUNCA cite sem buscar antes com a
   ferramenta de busca. Se a busca não confirmar, escreva "não localizei
   precedente específico" em vez de arriscar. Número de processo inventado é
   o erro mais grave possível aqui.
3. Prefira fontes oficiais nos resultados da busca: planalto.gov.br,
   tst.jus.br, stf.jus.br, stj.jus.br, trt2.jus.br, cnj.jus.br, gov.br. Use
   jusbrasil.com.br e conjur.com.br só como apoio, nunca como única fonte de
   um número de súmula ou acórdão.
4. Quando o caso depender de entendimento que mudou ou está em disputa, diga
   isso explicitamente em vez de apresentar como pacífico.

COMO ESCREVER
Direto, técnico, sem encher linguiça. Ele é advogado: não explique o que é
prescrição, diga o que o prazo dele está pedindo. Use os fatos que estão no
material — não invente vínculo, salário, data, função nem documento.
Quando faltar informação decisiva, aponte a falta em vez de supor.

Português do Brasil.
`.trim();

// Assinatura do escritório: sai do mesmo segredo que a varredura do DJEN
// já usa, pra não ter OAB escrita à mão em dois lugares.
const OAB_ESCRITORIO = `${Deno.env.get("OAB_UF") ?? "SP"}${Deno.env.get("OAB_NUMERO") ?? ""}`;

const REGRA_PECA = `
A peça é MINUTA para o advogado revisar e assinar. Nunca escreva como se
estivesse pronta para protocolo. Entregue a peça INTEIRA, do endereçamento
ao fecho — nada de "segue modelo" ou resumo do que ela teria.

DADO QUE VOCÊ NÃO TEM
Use [COLCHETES MAIÚSCULOS]: [VALOR DA CAUSA], [CNPJ DA RECLAMADA],
[DATA DA ADMISSÃO], [Nº DO PROCESSO]. Nunca chute número de processo,
CPF, CNPJ, valor, data ou endereço.

ESQUELETO — PRIMEIRO GRAU (petição inicial, réplica, manifestação)
1. Endereçamento em caixa alta: EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A)
   JUIZ(ÍZA) DA [Nº] VARA DO TRABALHO DE [COMARCA]. Deixe uma linha em
   branco larga depois, como na praxe forense.
2. Número do processo, quando já houver.
3. Qualificação completa das partes (nome, nacionalidade, estado civil,
   profissão, CPF, endereço — o que faltar vai em colchetes).
4. DOS FATOS — narrativa cronológica, só com o que está no material.
5. DO DIREITO — um tópico numerado por tese, cada um com o fundamento
   legal expresso (artigo e diploma). Jurisprudência só se você buscou e
   confirmou nesta conversa.
6. DOS PEDIDOS — lista alfabética (a, b, c...), incluindo os pedidos
   acessórios de praxe: juros, correção, honorários, justiça gratuita.
7. DO VALOR DA CAUSA e DAS PROVAS.
8. Fecho: "Termos em que, pede deferimento." seguido de
   "[LOCAL], [DATA A CONFERIR]." e do bloco de assinatura.

ESQUELETO — RECURSO (ordinário, de revista, contrarrazões, agravo)
1. Endereçamento ao juízo de admissibilidade (no recurso de revista, ao
   Excelentíssimo Desembargador Presidente do TRT da [Nº] Região), com o
   requerimento de recebimento, intimação da parte contrária para
   contrarrazões e remessa ao TST.
2. Folha de rosto das RAZÕES, com RECORRENTE e RECORRIDO(S) nomeados —
   nunca "reclamante/reclamada" numa peça recursal.
3. PRESSUPOSTOS DE ADMISSIBILIDADE, em tópicos próprios: tempestividade,
   preparo (ou dispensa por justiça gratuita, quando o beneficiário for o
   recorrente), representação processual.
4. No recurso de revista, obrigatoriamente: prequestionamento (Súmula 297
   do TST), o permissivo do art. 896 da CLT que sustenta cada tópico
   (divergência jurisprudencial ou violação de dispositivo), e a
   transcendência do art. 896-A da CLT.
5. Mérito recursal, um tópico por matéria, com o trecho do acórdão que se
   ataca identificado.
6. Pedido de conhecimento e provimento, fecho e assinatura.

BLOCO DE ASSINATURA (sempre, no fim de qualquer peça)
Nome do advogado em caixa alta, na linha de baixo "OAB/${OAB_ESCRITORIO}".
Se o material indicar mais de um advogado atuando no processo, repita o
bloco para cada um. Não invente nome nem número de OAB de ninguém.

A CONFERIR ANTES DE PROTOCOLAR
Última seção, sempre: liste em tópicos tudo que ficou em colchetes, o que
depende de documento que você não viu, e as decisões que são dele
(valor da causa, quais pedidos manter, prazo a confirmar).
`.trim();

// O painel tem uma conversa só — pergunta, documento e peça entram todos
// pelo mesmo campo. A regra da peça então vira condicional: vale quando
// ele pedir uma, sem empurrar formato de petição numa dúvida simples.
const REGRA_PECA_CHAT = `
QUANDO ELE PEDIR UMA PEÇA — petição inicial, réplica, razões finais,
recurso ordinário, contrarrazões, recurso administrativo ao INSS, defesa —
escreva a minuta inteira seguindo as regras abaixo. Fora esse caso,
responda normalmente, sem formato de petição.

${REGRA_PECA}
`.trim();

// ---------------------------------------------------------------
// O schema do Gemini é um subconjunto do OpenAPI: aceita type, properties,
// items, enum, required, description — mas não additionalProperties. Passar
// isso quebra a chamada com 400, então tiramos antes de mandar.
const ESQUEMA_DOCUMENTO = semAdditionalProperties({
  type: "object",
  properties: {
    tipo_documento: { type: "string", description: "O que é esse documento, em duas ou três palavras." },
    resumo: { type: "string", description: "O que o documento diz, em um parágrafo." },
    partes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string" },
          papel: { type: "string", description: "reclamante, reclamada, autor, réu, segurado, perito…" },
        },
        required: ["nome", "papel"],
        additionalProperties: false,
      },
    },
    fatos: { type: "array", items: { type: "string" }, description: "Os fatos relevantes, do mais ao menos importante." },
    valores: {
      type: "array",
      items: { type: "string" },
      description: "Valores em dinheiro citados no documento, com o que cada um representa. Vazio se não houver.",
    },
    datas: {
      type: "array",
      description: "Datas com consequência: prazo, audiência, admissão, demissão, indeferimento.",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "AAAA-MM-DD. Só se estiver no documento." },
          titulo: { type: "string" },
          tipo: { type: "string", enum: ["audiencia", "prazo", "reuniao", "tarefa"] },
          por_que: { type: "string" },
        },
        required: ["data", "titulo", "tipo", "por_que"],
        additionalProperties: false,
      },
    },
    pontos_favoraveis: { type: "array", items: { type: "string" } },
    pontos_contra: { type: "array", items: { type: "string" } },
    proximos_passos: { type: "array", items: { type: "string" } },
    documentos_faltando: { type: "array", items: { type: "string" } },
    alerta: {
      type: "string",
      description: "O que ele precisa saber AGORA. Vazio se não houver nada urgente.",
    },
  },
  required: [
    "tipo_documento", "resumo", "partes", "fatos", "valores", "datas",
    "pontos_favoraveis", "pontos_contra", "proximos_passos", "documentos_faltando", "alerta",
  ],
  additionalProperties: false,
});

// A busca é o que separa citação real de citação inventada.
const BUSCA = [{ google_search: {} }];

function fichaEmTexto(c: Record<string, any>): string {
  const linha = (r: string, v: unknown) => {
    if (v === null || v === undefined) return "";
    const t = Array.isArray(v) ? v.join(", ") : String(v).trim();
    return t ? `${r}: ${t}\n` : "";
  };
  return (
    linha("Cliente", c.nome) + linha("Cidade", c.cidade) + linha("Área", c.area) +
    linha("Situação", c.situacao) + linha("Fim do contrato", c.data_saida) +
    linha("Tempo desde a saída", c.saida) + linha("Verbas apontadas", c.pontos) +
    linha("Benefício pretendido", c.beneficio) + linha("Situação no INSS", c.inss) +
    linha("Documentos que tem", c.documentos) + linha("Relato", c.relato) +
    linha("Notas do escritório", c.notas) +
    linha("Etapa", c.etapa) +
    (c.dias_restantes !== null && c.dias_restantes !== undefined
      ? `Prescrição: ${c.dias_restantes < 0 ? "JÁ PRESCREVEU" : c.dias_restantes + " dias restantes"} (${c.prescreve_em})\n`
      : "")
  ).trim();
}

/** O que a IA já extraiu de um documento, em texto. Peça boa depende de
 * material — antes só o resumo e os fatos entravam, então a minuta saía
 * mais pobre do que o que a gente já tinha lido do PDF. */
function documentoEmTexto(d: any): string {
  const a = d.analise ?? {};
  const linha = (r: string, v: unknown) => {
    const t = Array.isArray(v) ? v.filter(Boolean).join("; ") : String(v ?? "").trim();
    return t ? `  ${r}: ${t}\n` : "";
  };
  return `— ${d.nome}${a.tipo_documento ? ` (${a.tipo_documento})` : ""}\n` +
    linha("Resumo", a.resumo) +
    linha("Fatos", a.fatos) +
    linha("A favor", a.pontos_favoraveis) +
    linha("A rebater", a.pontos_contra) +
    linha("Datas", (a.datas ?? []).map((x: any) => `${x.data} ${x.titulo}`)) +
    linha("Falta juntar", a.documentos_faltando);
}

// ---------------------------------------------------------------
// Contexto de processo — mesmo espírito de fichaEmTexto acima, mas
// reconstruído do banco a cada mensagem (não só na primeira), com o que
// existe hoje em `processos`: movimentos, publicações e, quando o
// processo está vinculado a um caso, prazos/tarefas/documentos dele.
// Cada trecho carrega a fonte que originou o dado — a IA é instruída a
// citar essa fonte, não inventá-la.
// ---------------------------------------------------------------
async function contextoProcesso(supabase: any, processoId: string): Promise<string> {
  const { data: processo } = await supabase.from("processos").select("*").eq("id", processoId).single();
  if (!processo) return "";

  const [{ data: movimentos }, { data: publicacoes }] = await Promise.all([
    supabase.from("processo_movimentos").select("data_movimento, descricao, fonte")
      .eq("processo_id", processoId).order("data_movimento", { ascending: false }).limit(20),
    supabase.from("publicacoes").select("disponibilizada, tipo, texto, lida")
      .eq("processo_id", processoId).order("disponibilizada", { ascending: false }).limit(20),
  ]);

  let bloco = `\n\n[Processo aberto no sistema]\n` +
    `Número: ${processo.processo ?? "não informado"}\n` +
    `Tribunal: ${processo.tribunal ?? "—"}  Órgão: ${processo.orgao ?? "—"}  Classe: ${processo.classe ?? "—"}\n` +
    `Status de triagem: ${processo.status_triagem}  Status processual: ${processo.status_processual}\n`;

  const partes = Array.isArray(processo.partes) ? processo.partes : [];
  if (partes.length) {
    bloco += `Partes: ${partes.map((pt: any) =>
      `${pt.nome}${pt.polo ? ` (${pt.polo === "A" ? "polo ativo" : "polo passivo"})` : ""}`).join("; ")}\n`;
  }

  bloco += movimentos?.length
    ? `\nMovimentações (mais recente primeiro):\n` + movimentos.map((m: any) =>
        `- ${m.data_movimento ?? "data desconhecida"}: ${m.descricao} [Fonte: ${String(m.fonte ?? "").toUpperCase()}]`).join("\n") + "\n"
    : `\nSem movimentações sincronizadas.\n`;

  bloco += publicacoes?.length
    ? `\nPublicações do DJEN (mais recente primeiro):\n` + publicacoes.map((p: any) =>
        `- ${p.disponibilizada ?? "data desconhecida"} [${p.lida ? "lida" : "não lida"}]: ${String(p.texto ?? "").slice(0, 300)} [Fonte: DJEN]`).join("\n") + "\n"
    : `\nSem publicações vinculadas.\n`;

  if (processo.caso_id) {
    const [{ data: caso }, { data: tarefas }, { data: docs }] = await Promise.all([
      supabase.from("casos_com_prazo").select("*").eq("id", processo.caso_id).single(),
      supabase.from("tarefas").select("titulo, quando, tipo, feita").eq("caso_id", processo.caso_id).order("quando").limit(15),
      supabase.from("documentos").select("nome, tipo, analise").eq("caso_id", processo.caso_id).limit(10),
    ]);
    if (caso) bloco += `\n[Caso vinculado]\n${fichaEmTexto(caso)}\n`;
    if (tarefas?.length) {
      bloco += `\nPrazos e tarefas do caso:\n` + tarefas.map((t: any) =>
        `- ${t.titulo} (${t.tipo}) em ${t.quando}${t.feita ? " — feita" : ""} [Fonte: agenda do caso]`).join("\n") + "\n";
    }
    const lidos = (docs ?? []).filter((d: any) => d.analise);
    if (lidos.length) {
      bloco += `\nDocumentos já lidos deste caso:\n` + lidos.map((d: any) =>
        `- ${d.nome}: ${d.analise.resumo} [Fonte: documento ${d.nome}]`).join("\n") + "\n";
    }
  }

  bloco += `\nRegra para este processo: só afirme movimentação, prazo, parte ou fato que esteja ` +
    `escrito acima. Se não encontrar a informação, responda exatamente: "Não encontrei essa ` +
    `informação nos dados disponíveis deste processo." Ao citar um fato, informe a fonte entre ` +
    `colchetes do jeito que está anotado acima (Fonte: DJEN, Fonte: DataJud, ou o documento).\n`;

  return bloco;
}

// ---------------------------------------------------------------
// Chamadas ao Gemini
// ---------------------------------------------------------------
/** O tier grátis tem cota diária baixa — troca o erro cru do Google (que
 * despeja um JSON gigante) por uma frase que o advogado entende. */
function mensagemAmigavel(corpoErro: any, statusFallback: number): string {
  const msg = corpoErro?.error?.message ?? "";
  const status = corpoErro?.error?.status ?? "";
  if (status === "RESOURCE_EXHAUSTED" || /quota/i.test(msg)) {
    return "A cota diária gratuita da IA acabou por hoje. Volta a funcionar amanhã — ou dá pra ligar faturamento na conta do Gemini pra não ter esse limite.";
  }
  return msg || `Gemini respondeu ${statusFallback}`;
}

async function gerar(corpo: Record<string, unknown>) {
  const chamada = () => fetch(`${GEMINI}:generateContent?key=${chaveGemini()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const r = await comRetentativa(chamada, (resp) => resp.status === 503);
  const j = await r.json();
  if (!r.ok) throw new Error(mensagemAmigavel(j, r.status));
  return j;
}

function gerarStream(corpo: Record<string, unknown>) {
  const chamada = () => fetch(`${GEMINI}:streamGenerateContent?alt=sse&key=${chaveGemini()}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return comRetentativa(chamada, (resp) => resp.status === 503);
}

/** Extrai o texto e as fontes (das buscas do Google) de uma resposta do Gemini. */
function extrai(resposta: any) {
  const cand = resposta?.candidates?.[0];
  const partes = cand?.content?.parts ?? [];
  const texto = partes.map((p: any) => p.text ?? "").join("");
  const brutas = cand?.groundingMetadata?.groundingChunks ?? [];
  const fontes = brutas
    .filter((c: any) => c.web?.uri)
    .map((c: any) => ({ titulo: c.web.title || c.web.uri, url: c.web.uri }));
  return { texto, fontes };
}

function checaParada(cand: any) {
  const motivo = cand?.finishReason;
  if (motivo === "SAFETY" || motivo === "PROHIBITED_CONTENT" || motivo === "RECITATION" || motivo === "BLOCKLIST" || motivo === "SPII") {
    return { erro: "a IA recusou responder isso", status: 422 };
  }
  if (motivo === "MAX_TOKENS") {
    return { erro: "a resposta ficou incompleta — tente uma pergunta mais estreita", status: 502 };
  }
  return null;
}

function usoDe(resposta: any) {
  const u = resposta?.usageMetadata ?? {};
  return {
    entrada: u.promptTokenCount ?? 0,
    saida: u.candidatesTokenCount ?? 0,
    buscas: (u.toolUsePromptTokenCount ?? 0) > 0 ? 1 : 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );
  const { data: sessao, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !sessao?.user) return json({ erro: "não autenticado" }, 401);

  if (!Deno.env.get("GEMINI_API_KEY")) return json({ erro: "GEMINI_API_KEY não configurada" }, 500);

  let corpo: any;
  try { corpo = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }

  try {
    // ============ LER UM DOCUMENTO ============
    if (corpo.acao === "ler") {
      if (!corpo.documento_id) return json({ erro: "informe documento_id" }, 400);

      const { data: doc, error: erroDoc } = await supabase
        .from("documentos").select("*, casos(*)").eq("id", corpo.documento_id).single();
      if (erroDoc || !doc) return json({ erro: "documento não encontrado" }, 404);

      const { data: arquivo, error: erroArq } = await supabase
        .storage.from("documentos").download(doc.caminho);
      if (erroArq || !arquivo) return json({ erro: "não deu pra abrir o arquivo" }, 404);

      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      // base64 em pedaços: string muito grande de uma vez estoura a pilha
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const b64 = btoa(bin);

      const contexto = doc.casos ? `\n\nContexto do caso no escritório:\n${fichaEmTexto(doc.casos)}` : "";

      const resposta = await gerar({
        system_instruction: { parts: [{ text: SISTEMA }] },
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: b64 } },
            {
              text: `Leia este documento e destrinche para o advogado.

Só extraia data em "datas" se ela estiver escrita no documento. Não calcule
prazo processual de cabeça — se o documento disser "prazo de 15 dias", diga
isso em "por_que" e ponha a data só se o documento trouxer o termo inicial.${contexto}`,
            },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 16000,
          responseMimeType: "application/json",
          responseSchema: ESQUEMA_DOCUMENTO,
        },
      });

      const cand = resposta.candidates?.[0];
      const parada = checaParada(cand);
      if (parada) return json({ erro: parada.erro }, parada.status);

      const bruto = cand?.content?.parts?.[0]?.text;
      if (!bruto) return json({ erro: "resposta sem texto" }, 502);
      const analise = JSON.parse(bruto);

      await supabase.from("documentos")
        .update({ analise, analise_at: new Date().toISOString(), tipo: analise.tipo_documento })
        .eq("id", corpo.documento_id);

      return json({ ok: true, analise, uso: usoDe(resposta) });
    }

    // ============ CONVERSAR ============
    // Responde em tempo real (SSE): o texto aparece enquanto sai, em vez
    // de a tela ficar parada um minuto. É o que faz parecer conversa.
    if (corpo.acao === "conversar") {
      if (!corpo.conversa_id) return json({ erro: "informe conversa_id" }, 400);
      if (!corpo.mensagem)    return json({ erro: "informe a mensagem" }, 400);

      const { data: conversa, error: erroConv } = await supabase
        .from("conversas").select("*").eq("id", corpo.conversa_id).single();
      if (erroConv || !conversa) return json({ erro: "conversa não encontrada" }, 404);

      // histórico: é isso que faz a IA lembrar do que foi dito antes
      const { data: anteriores } = await supabase
        .from("mensagens").select("papel, texto")
        .eq("conversa_id", corpo.conversa_id).order("criado_at").limit(40);

      // contexto do caso e do documento, quando a conversa está presa a algum
      let contexto = "";
      if (conversa.caso_id) {
        const { data: caso } = await supabase
          .from("casos_com_prazo").select("*").eq("id", conversa.caso_id).single();
        if (caso) contexto += `\n\n[Caso aberto no sistema]\n${fichaEmTexto(caso)}`;

        // tudo que já foi lido dos documentos do caso — antes só a ação
        // `minutar` enxergava isso; agora a peça sai pela conversa, então
        // o material tem que estar aqui também.
        const { data: docsCaso } = await supabase
          .from("documentos").select("nome, tipo, analise").eq("caso_id", conversa.caso_id);
        const lidos = (docsCaso ?? []).filter((d: any) => d.analise);
        if (lidos.length) {
          contexto += `\n\nO que já foi lido dos documentos deste caso:\n` +
            lidos.map(documentoEmTexto).join("");
        }
      }
      if (conversa.documento_id) {
        const { data: doc } = await supabase
          .from("documentos").select("nome, tipo, analise").eq("id", conversa.documento_id).single();
        if (doc?.analise) {
          contexto += `\n\n[Documento que o advogado está olhando: ${doc.nome}]\n` +
            `${doc.analise.resumo}\nFatos: ${(doc.analise.fatos ?? []).join("; ")}\n` +
            `A favor: ${(doc.analise.pontos_favoraveis ?? []).join("; ")}\n` +
            `Contra: ${(doc.analise.pontos_contra ?? []).join("; ")}`;
        }
      }
      if (conversa.processo_id) {
        contexto += await contextoProcesso(supabase, conversa.processo_id);
      }

      // Gemini usa role "model" pro que a IA falou (não "assistant")
      //
      // O contexto (caso/documento/processo) é reconstruído do banco a
      // CADA mensagem e entra em toda chamada — não só na primeira. Ele
      // nunca é gravado em `mensagens.texto` (só `corpo.mensagem` é
      // salvo ali, logo abaixo), então não duplica no histórico: é
      // sempre o estado atual do banco, não o que existia quando a
      // conversa começou.
      const mensagens = [
        ...(anteriores ?? []).map((m: any) => ({
          role: m.papel === "assistant" ? "model" : "user",
          parts: [{ text: m.texto }],
        })),
        { role: "user", parts: [{ text: corpo.mensagem + contexto }] },
      ];

      // grava a pergunta antes de responder: se a conexão cair no meio,
      // o que ele escreveu não some
      await supabase.from("mensagens").insert({
        conversa_id: corpo.conversa_id, papel: "user", texto: corpo.mensagem,
      });
      if (!conversa.titulo) {
        await supabase.from("conversas")
          .update({ titulo: String(corpo.mensagem).slice(0, 70) })
          .eq("id", corpo.conversa_id);
      }

      const respostaGemini = await gerarStream({
        system_instruction: { parts: [{ text: SISTEMA + "\n\n" + REGRA_PECA_CHAT }] },
        contents: mensagens,
        tools: BUSCA,
        // peça inteira sai por aqui agora (o painel tem uma conversa só,
        // sem aba separada de minutar), então precisa do mesmo fôlego.
        generationConfig: { maxOutputTokens: 24000 },
      });

      if (!respostaGemini.ok || !respostaGemini.body) {
        const texto = await respostaGemini.text().catch(() => "");
        let corpoErro: any = null;
        try { corpoErro = JSON.parse(texto); } catch { /* segue com texto cru */ }
        throw new Error(mensagemAmigavel(corpoErro, respostaGemini.status));
      }

      // O Edge Runtime do Supabase pode derrubar a function assim que o
      // handler retorna, achando que o trabalho acabou — mesmo com um
      // ReadableStream ainda ativo em segundo plano (efeito "EarlyDrop").
      // EdgeRuntime.waitUntil() avisa o runtime pra não matar o isolate
      // até essa promessa terminar.
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const escritor = writable.getWriter();

      const trabalho = (async () => {
        const manda = (evento: string, dados: unknown) =>
          escritor.write(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));

        let textoFinal = "";
        let ultimoCand: any = null;
        let sobra = "";
        const buscasJaAvisadas = new Set<string>();

        try {
          const leitor = respostaGemini.body!.getReader();
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            sobra += dec.decode(value, { stream: true });

            // o Gemini separa eventos com \r\n\r\n, não só \n\n
            const partes = sobra.split(/\r?\n\r?\n/);
            sobra = partes.pop() ?? "";

            for (const p of partes) {
              const linha = (/^data:\s*(.+)$/m.exec(p) || [])[1];
              if (!linha) continue;
              let j: any;
              try { j = JSON.parse(linha); } catch { continue; }

              const cand = j.candidates?.[0];
              if (!cand) continue;
              ultimoCand = cand;

              const textoNovo = (cand.content?.parts ?? []).map((pt: any) => pt.text ?? "").join("");
              if (textoNovo) { textoFinal += textoNovo; await manda("texto", { t: textoNovo }); }

              const buscas: string[] = cand.groundingMetadata?.webSearchQueries ?? [];
              for (const q of buscas) {
                if (buscasJaAvisadas.has(q)) continue;
                buscasJaAvisadas.add(q);
                await manda("buscando", { q });
              }
            }
          }

          const parada = checaParada(ultimoCand);
          if (parada) { await manda("erro", { erro: parada.erro }); await escritor.close(); return; }

          const brutas = ultimoCand?.groundingMetadata?.groundingChunks ?? [];
          const fontes = brutas
            .filter((c: any) => c.web?.uri)
            .map((c: any) => ({ titulo: c.web.title || c.web.uri, url: c.web.uri }));
          const uso = { entrada: 0, saida: 0, buscas: buscasJaAvisadas.size };

          await supabase.from("mensagens").insert({
            conversa_id: corpo.conversa_id, papel: "assistant", texto: textoFinal, fontes, uso,
          });
          await supabase.from("conversas")
            .update({ mexida_at: new Date().toISOString() }).eq("id", corpo.conversa_id);

          await manda("fim", { fontes, uso });
        } catch (e) {
          await manda("erro", { erro: e instanceof Error ? e.message : String(e) });
        }
        await escritor.close();
      })();

      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(trabalho);

      return new Response(readable, {
        headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    // ============ RESUMIR UM DOCUMENTO ============
    // O "próximo passo" depois da leitura: um resumo curto, do jeito que
    // ele mandaria pro cliente ou colaria numa nota do processo.
    if (corpo.acao === "resumir") {
      if (!corpo.documento_id) return json({ erro: "informe documento_id" }, 400);

      const { data: doc, error: erroDoc } = await supabase
        .from("documentos").select("*, casos(nome)").eq("id", corpo.documento_id).single();
      if (erroDoc || !doc?.analise) return json({ erro: "documento ainda não foi lido" }, 400);

      const para = corpo.para === "cliente" ? "cliente" : "escritorio";
      const instrucao = para === "cliente"
        ? `Escreva o resumo PARA O CLIENTE, no WhatsApp. Português de gente comum, sem
juridiquês, de 4 a 8 linhas. Diga o que aconteceu no processo e qual é o próximo
passo. Restrições da OAB: não prometa resultado, não cite valor de honorário, não
diga que vai ganhar. Assine como o escritório.`
        : `Escreva o resumo PARA O PRÓPRIO ADVOGADO, do jeito que ele colaria numa nota
do processo. Técnico, direto, de 5 a 10 linhas. O que a peça faz, o que ataca, o
que ele precisa responder e até quando.`;

      const resposta = await gerar({
        system_instruction: { parts: [{ text: SISTEMA }] },
        contents: [{
          role: "user",
          parts: [{ text: `${instrucao}\n\nDocumento: ${doc.nome}` +
            (doc.casos?.nome ? `\nCliente: ${doc.casos.nome}` : "") +
            `\n\nO que foi lido dele:\n${JSON.stringify(doc.analise, null, 1)}` }],
        }],
        generationConfig: { maxOutputTokens: 3000 },
      });

      const cand = resposta.candidates?.[0];
      const parada = checaParada(cand);
      if (parada) return json({ erro: parada.erro }, parada.status);
      const { texto } = extrai(resposta);
      return json({ ok: true, resumo: texto, para });
    }

    // ============ MINUTAR PEÇA ============
    // Aceita caso_id, documento_id ou os dois. Vindo de um documento, a
    // peça já nasce respondendo o que está escrito nele.
    if (corpo.acao === "minutar") {
      let caso: any = null, doc: any = null;

      if (corpo.documento_id) {
        const { data } = await supabase
          .from("documentos").select("*, casos(*)").eq("id", corpo.documento_id).single();
        doc = data;
        if (doc?.casos) caso = doc.casos;
      }
      if (corpo.caso_id) {
        const { data } = await supabase
          .from("casos_com_prazo").select("*").eq("id", corpo.caso_id).single();
        if (data) caso = data;
      }
      if (!caso && !doc) return json({ erro: "informe caso_id ou documento_id" }, 400);

      // tudo que já foi lido dos documentos daquele caso entra junto
      let lidos: any[] = [];
      if (caso?.id) {
        const { data: docs } = await supabase
          .from("documentos").select("nome, tipo, analise").eq("caso_id", caso.id);
        lidos = (docs ?? []).filter((d: any) => d.analise);
      }
      if (doc?.analise && !lidos.some((d) => d.nome === doc.nome)) lidos.unshift(doc);

      const doDocumento = lidos.length
        ? "\n\nO que já foi lido dos documentos do caso:\n" + lidos.map(documentoEmTexto).join("")
        : "";

      const peca = String(corpo.peca || "petição inicial");
      const daFicha = caso ? fichaEmTexto(caso) : "Sem ficha de caso no sistema.";

      const resposta = await gerar({
        system_instruction: { parts: [{ text: SISTEMA + "\n\n" + REGRA_PECA }] },
        contents: [{ role: "user", parts: [{ text: `Minute uma ${peca}.\n\n${daFicha}${doDocumento}` }] }],
        tools: BUSCA,
        generationConfig: { maxOutputTokens: 24000 },
      });

      const cand = resposta.candidates?.[0];
      const parada = checaParada(cand);
      if (parada) return json({ erro: parada.erro }, parada.status);

      const { texto, fontes } = extrai(resposta);
      return json({ ok: true, peca: texto, fontes, uso: usoDe(resposta) });
    }

    return json({ erro: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : "falha ao falar com a IA" }, 502);
  }
});
