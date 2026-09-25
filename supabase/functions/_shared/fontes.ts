// ============================================================
// Contrato de fonte de processo (Fase 5 da V3).
//
// Hoje só o DJEN descobre processo novo (cnj/index.ts::varrer), e o
// DataJud só enriquece um processo já conhecido (cnj/index.ts, ação
// "andamento"). Este arquivo não muda esse comportamento — ele só
// registra o formato comum que os dois já seguem, pra uma fonte nova
// (outra API oficial, ou futuramente uma integração comercial contratada)
// entrar sem reescrever a triagem/deduplicação em supabase/setup.sql
// nem o núcleo de `cnj/index.ts`.
//
// NÃO implementar aqui: scraping de terceiros, automação de login,
// captura de cookie, ou qualquer forma de burlar autenticação/CAPTCHA.
// Só fontes oficiais/públicas, ou integração comercial com contrato.
// ============================================================

export type Fonte = "djen" | "datajud";

/** O que uma fonte de DESCOBERTA (acha processo novo pela OAB) devolve
 * por processo encontrado — é o formato que `criaProcesso`/
 * `atualizaProcessoExistente` em cnj/index.ts consomem hoje pro DJEN. */
export interface ProcessoDescoberto {
  processo: string | null;        // com máscara, pra exibir
  processo_num: string | null;    // como a fonte mandou, antes de normalizar
  tribunal: string | null;
  orgao: string | null;
  classe: string | null;
  partes: unknown;                // formato livre — cada fonte tem o seu, o front lê por polo
  disponibilizada: string | null; // data/hora do evento que originou a descoberta
  idExterno: string;              // id da fonte pra essa descoberta (upsert em processo_fontes)
  dadosCrus: unknown;             // payload original, guardado em processo_fontes.dados
}

/** O que uma fonte de ENRIQUECIMENTO (movimentos de um processo já
 * conhecido) devolve — é o formato que a ação "andamento" já grava em
 * processo_movimentos hoje, vindo do DataJud. */
export interface MovimentoEncontrado {
  dataMovimento: string | null;
  descricao: string;
  idExterno: string;   // usado em processo_movimentos.id_externo pro upsert não duplicar
  dadosCrus: unknown;
}

// ---------------------------------------------------------------
// Regras que toda fonte tem que respeitar (documentadas aqui porque são
// a parte fácil de esquecer ao plugar uma fonte nova):
//
// 1. Descoberta NUNCA cria processo já `confirmado`. Todo processo novo
//    nasce `observacao` — normalizaCnj + calculaConfianca (./processos.ts)
//    decidem a chave de dedup e o selo, não o status.
// 2. Enriquecimento de processo `confirmado` ou `ignorado` NUNCA muda
//    status_triagem — só atualiza dados/movimentos.
// 3. Deduplicar por normalizaCnj(processo_num) quando der 20 dígitos;
//    cair pro texto de `processo` só quando não der.
// 4. Gravar em processo_fontes (upsert por processo_id+fonte+id_externo)
//    e, quando houver movimento, em processo_movimentos (mesma chave) —
//    nunca inserir sem checar conflito, senão duplica a cada sincronização.
// ---------------------------------------------------------------
