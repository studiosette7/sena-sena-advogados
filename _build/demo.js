/* ============================================================
   MODO DEMONSTRAÇÃO — entra só no painel-demo.html

   Substitui o `fetch` antes do painel carregar, então o painel roda
   inteiro sem saber que o banco não existe: é o mesmo código do
   painel.html de verdade. Nada sai desta máquina, nada é gravado.
   Recarregar a página devolve tudo ao estado inicial.

   Todos os nomes, casos e documentos aqui são inventados.
   ============================================================ */
(function(){
'use strict';

var AGORA = new Date(),
    MEIA_NOITE = new Date(AGORA.getFullYear(), AGORA.getMonth(), AGORA.getDate());

/* datas relativas a hoje — a demo não envelhece na gaveta */
function dia(d){ return new Date(AGORA.getTime() - d*86400000).toISOString().slice(0,10); }
function hora(d){ return new Date(AGORA.getTime() - d*86400000).toISOString(); }
/* compromisso de escritório cai em hora cheia, não na hora que a demo abriu */
function daqui(d, h){
  var x = new Date(AGORA.getTime() + d*86400000);
  x.setHours(h === undefined ? 9 : h, h === undefined ? 30 : 0, 0, 0);
  return x.toISOString();
}

/* o mesmo cálculo da view casos_com_prazo, aqui em JS */
function prazo(c){
  if(!c.data_saida){
    c.prescreve_em = null; c.dias_restantes = null; c.alerta_prazo = 'sem_data';
    return c;
  }
  var p = new Date(c.data_saida + 'T00:00:00');
  p.setFullYear(p.getFullYear() + 2);
  c.prescreve_em   = p.toISOString().slice(0,10);
  c.dias_restantes = Math.round((p - MEIA_NOITE) / 86400000);
  c.alerta_prazo   = c.dias_restantes < 0   ? 'prescrito'
                   : c.dias_restantes <= 90 ? 'critico'
                   : c.dias_restantes <= 180? 'atencao' : 'ok';
  return c;
}

var CASOS = [
  {
    id:'d1', criado_at:hora(1), nome:'Maria Aparecida da Silva', whatsapp:'11987654321',
    cidade:'São Bernardo do Campo', horario:'Fim do dia, depois do trabalho',
    area:'Trabalhista', situacao:'Fui demitido sem justa causa', saida:'Entre 1 e 2 anos',
    pontos:['Horas extras','Verbas rescisórias','Assédio moral'], beneficio:null, inss:null,
    documentos:'Tenho alguma coisa',
    relato:'Trabalhei 4 anos numa metalúrgica em Diadema. Ficava quase duas horas a mais todo dia e nunca vi isso no holerite. Quando reclamei o encarregado começou a me humilhar na frente dos outros.',
    origem:'instagram', etapa:'triagem', notas:null, data_saida:dia(655), ia:null, ia_at:null
  },
  {
    id:'d2', criado_at:hora(2), nome:'Edvaldo Ramos Batista', whatsapp:'11965874123',
    cidade:'São Bernardo do Campo', horario:'De manhã',
    area:'Trabalhista', situacao:'A empresa não paga em dia', saida:'Ainda estou trabalhando',
    pontos:['Salários atrasados','FGTS'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Estão atrasando o salário há três meses. Já falei com o RH e não resolve. Não quero perder o emprego mas também não dá pra continuar assim.',
    origem:'direto', etapa:'triagem', notas:null, data_saida:null, ia:null, ia_at:null
  },
  {
    id:'d3', criado_at:hora(4), nome:'Antônio Marcos Pereira', whatsapp:'11996321478',
    cidade:'Mauá', horario:'De manhã',
    area:'Trabalhista', situacao:'Pedi demissão porque não aguentava mais', saida:'Quase 2 anos',
    pontos:['Horas extras','FGTS','Adicional de insalubridade'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Sete anos na mesma empresa de limpeza industrial, lidando com produto químico sem receber insalubridade. Saí em setembro porque minha saúde não deu mais.',
    origem:'instagram', etapa:'documentos', notas:'Mandou a CTPS. Falta o extrato do FGTS.',
    data_saida:dia(702),
    ia:{
      viabilidade:'provavel', urgencia:'alta',
      resumo:'Trabalhador da limpeza industrial que pediu demissão após sete anos, com exposição a produto químico sem adicional de insalubridade e jornada extraordinária habitual.',
      teses:['Adicional de insalubridade com reflexos em férias, 13º e FGTS','Horas extras habituais e reflexos','Depósitos de FGTS não recolhidos','Rescisão indireta, se a saída decorreu do descumprimento contratual'],
      pontos_atencao:['O prazo prescricional está em contagem final — menos de 30 dias','Pedido de demissão limita verbas rescisórias, salvo reconhecimento de rescisão indireta','A insalubridade depende de perícia técnica e do grau apurado'],
      documentos_pedir:['Extrato analítico do FGTS','CTPS e termo de rescisão','Holerites dos últimos 5 anos','Ficha de entrega de EPI','PPRA e PCMSO da empresa'],
      perguntas_fazer:['Recebia EPI e assinava a ficha de entrega?','Chegou a formalizar reclamação interna antes de sair?','Tem colega que possa testemunhar a jornada?'],
      resposta_whatsapp:'Olá, Antônio. Recebi sua mensagem e li o que você me contou.\nSeu caso tem um ponto de urgência: o prazo para entrar com a ação está próximo do fim, então preciso analisar isso rápido.\nMe mande, por favor, o extrato analítico do FGTS e os holerites que você tiver guardado.\nAssim que eu receber, te retorno com a análise.'
    },
    ia_at:hora(3)
  },
  {
    id:'d4', criado_at:hora(6), nome:'Luciana Prado Machado', whatsapp:'11954789632',
    cidade:'Santo André', horario:'À noite',
    area:'Trabalhista', situacao:'Fui demitido sem justa causa', saida:'Menos de 6 meses',
    pontos:['Verbas rescisórias','Aviso prévio','Férias'], beneficio:null, inss:null,
    documentos:'Só a carteira assinada',
    relato:'Trabalhei dois anos como auxiliar administrativa. Fui mandada embora e até hoje não recebi o acerto.',
    origem:'direto', etapa:'viabilidade', notas:'Aguardando ela mandar o termo de rescisão.',
    data_saida:dia(95),
    ia:{
      viabilidade:'provavel', urgencia:'baixa',
      resumo:'Auxiliar administrativa dispensada sem justa causa após dois anos, com verbas rescisórias não quitadas dentro do prazo legal.',
      teses:['Verbas rescisórias em atraso','Multa do art. 477 da CLT pelo pagamento fora do prazo','Multa de 40% do FGTS, se não depositada'],
      pontos_atencao:['Prazo confortável, mas a multa do 477 depende de comprovar a data do acerto','Falta o termo de rescisão para conferir o que foi pago'],
      documentos_pedir:['Termo de rescisão','Extrato do FGTS','Últimos três holerites','Carteira de trabalho'],
      perguntas_fazer:['Recebeu algum valor parcial na saída?','Deu baixa na carteira? Em que data?'],
      resposta_whatsapp:'Olá, Luciana. Recebi o que você preencheu no site.\nPelo que você me contou, a empresa parece ter passado do prazo legal para o acerto.\nMe mande o termo de rescisão e o extrato do FGTS que eu confiro o que ficou em aberto.\nQualquer dúvida é só chamar por aqui.'
    },
    ia_at:hora(5)
  },
  {
    id:'d5', criado_at:hora(9), nome:'José Carlos Ferreira', whatsapp:'11912345678',
    cidade:'Santo André', horario:'De manhã',
    area:'Previdenciário', situacao:null, saida:null, pontos:null,
    beneficio:['Auxílio-doença','Aposentadoria por invalidez'], inss:'Pedido negado',
    documentos:'Tenho alguma coisa',
    relato:'Fiz a perícia e o INSS negou dizendo que não constatou incapacidade. Mas eu não consigo mais levantar peso, tenho hérnia de disco e laudo do ortopedista.',
    origem:'direto', etapa:'viabilidade', notas:'Ligar depois das 9h. Trabalha à tarde.',
    data_saida:null,
    ia:{
      viabilidade:'possivel', urgencia:'media',
      resumo:'Segurado teve auxílio-doença indeferido por não constatação de incapacidade na perícia administrativa, mas relata hérnia de disco com laudo particular.',
      teses:['Concessão de auxílio por incapacidade temporária','Conversão em aposentadoria por incapacidade permanente, se a perícia judicial apontar incapacidade definitiva'],
      pontos_atencao:['A perícia administrativa foi desfavorável — o caso depende de perícia judicial','Não sabemos a data do indeferimento nem se houve recurso ao CRPS','Laudo particular não vincula, serve como indício'],
      documentos_pedir:['Carta de indeferimento do INSS','Extrato CNIS','Laudos, exames de imagem e receituários','Comunicado de decisão da perícia médica'],
      perguntas_fazer:['Qual a data exata do indeferimento?','Chegou a recorrer administrativamente?','Está trabalhando ou afastado hoje?'],
      resposta_whatsapp:'Olá, José. Recebi sua mensagem sobre a negativa do INSS.\nPra eu analisar direito, preciso da carta de indeferimento e dos laudos e exames que você tem.\nMe diga também a data em que saiu a negativa.\nCom isso em mãos consigo verificar qual o caminho no seu caso.'
    },
    ia_at:hora(8)
  },
  {
    id:'d6', criado_at:hora(13), nome:'Rosângela Nunes de Oliveira', whatsapp:'11981472536',
    cidade:'Diadema', horario:'Qualquer horário',
    area:'Trabalhista', situacao:'A empresa fechou e não pagou nada', saida:'Mais de 2 anos',
    pontos:['Verbas rescisórias','FGTS','Salários atrasados'], beneficio:null, inss:null,
    documentos:'Só a carteira assinada',
    relato:'O mercado onde eu trabalhava fechou de uma hora pra outra. Fiquei com dois meses de salário atrasado e ninguém me pagou nada.',
    origem:'direto', etapa:'triagem', notas:null, data_saida:dia(772), ia:null, ia_at:null
  },
  {
    id:'d7', criado_at:hora(17), nome:'Silvana Rodrigues Campos', whatsapp:'11973654128',
    cidade:'São Caetano do Sul', horario:'Fim do dia, depois do trabalho',
    area:'Previdenciário', situacao:null, saida:null, pontos:null,
    beneficio:['Pensão por morte'], inss:'Pedido negado',
    documentos:'Tenho tudo guardado',
    relato:'Meu companheiro faleceu e o INSS negou a pensão dizendo que não comprovei a união estável, mesmo a gente morando junto há 14 anos.',
    origem:'indicacao', etapa:'documentos', notas:'Reunir prova de união estável: contas, fotos, testemunhas.',
    data_saida:null,
    ia:{
      viabilidade:'possivel', urgencia:'media',
      resumo:'Companheira teve pensão por morte indeferida por falta de comprovação de união estável, apesar de convivência longa alegada.',
      teses:['Concessão de pensão por morte com reconhecimento de união estável','Reconhecimento judicial da união estável como questão prejudicial'],
      pontos_atencao:['O INSS exige início de prova material — declaração isolada não basta','Quanto mais antiga a prova documental, melhor','Verificar se há outro dependente habilitado'],
      documentos_pedir:['Certidão de óbito','Carta de indeferimento','Comprovantes de endereço comum ao longo dos anos','Conta conjunta, plano de saúde ou seguro com ela como beneficiária','Fotos e declaração de testemunhas'],
      perguntas_fazer:['Existe filho em comum?','Ele tinha outro dependente cadastrado no INSS?','Há contrato de aluguel ou financiamento em nome dos dois?'],
      resposta_whatsapp:'Olá, Silvana. Sinto muito pela sua perda.\nRecebi as informações que você mandou pelo site. Para o INSS, o ponto é comprovar a convivência com documentos da época.\nMe mande a certidão de óbito, a carta de indeferimento e qualquer papel em nome dos dois — conta, contrato, plano de saúde.\nCom isso eu consigo montar a prova.'
    },
    ia_at:hora(15)
  },
  {
    id:'d8', criado_at:hora(24), nome:'Cleiton Souza Barbosa', whatsapp:'11974185296',
    cidade:'São Caetano do Sul', horario:'À noite',
    area:'Trabalhista', situacao:'Fui demitido sem justa causa', saida:'Menos de 6 meses',
    pontos:['Horas extras','Acúmulo de função'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Fui contratado como auxiliar e no fim fazia o serviço de encarregado sem nunca ter mudado o salário.',
    origem:'instagram', etapa:'contrato', notas:'Contrato assinado. Preparar a inicial.',
    data_saida:dia(160), ia:null, ia_at:null
  },
  {
    id:'d9', criado_at:hora(31), nome:'Vanderlei Alves dos Santos', whatsapp:'11963258741',
    cidade:'Ribeirão Pires', horario:'De manhã',
    area:'Previdenciário', situacao:null, saida:null, pontos:null,
    beneficio:['Aposentadoria por tempo de contribuição'], inss:'Ainda não pedi',
    documentos:'Tenho tudo guardado',
    relato:'Trabalhei 12 anos em fundição e quero saber se conta como tempo especial.',
    origem:'indicacao', etapa:'contrato', notas:'Reunir PPP das três empresas antes de protocolar.',
    data_saida:null, ia:null, ia_at:null
  },
  {
    id:'d10', criado_at:hora(46), nome:'Fernanda Lima Teixeira', whatsapp:'11955412398',
    cidade:'Santo André', horario:'De manhã',
    area:'Trabalhista', situacao:'Fui demitido sem justa causa', saida:'Entre 6 meses e 1 ano',
    pontos:['Horas extras','Assédio moral','Verbas rescisórias'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Trabalhei cinco anos no telemarketing. Metas impossíveis, humilhação em reunião e hora extra que nunca entrou.',
    origem:'instagram', etapa:'protocolado', notas:'Distribuído na 3ª Vara do Trabalho de São Bernardo.',
    data_saida:dia(280), ia:null, ia_at:null
  },
  {
    id:'d11', criado_at:hora(63), nome:'Marcelo Aparecido Duarte', whatsapp:'11982365471',
    cidade:'Mauá', horario:'Qualquer horário',
    area:'Trabalhista', situacao:'Sofri acidente de trabalho', saida:'Entre 1 e 2 anos',
    pontos:['Estabilidade','Danos morais','FGTS'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Perdi dois dedos numa prensa sem proteção. A empresa emitiu a CAT com atraso e me mandou embora assim que voltei.',
    origem:'indicacao', etapa:'andamento', notas:'Perícia designada. Cliente avisado.',
    data_saida:dia(420), ia:null, ia_at:null
  },
  {
    id:'d12', criado_at:hora(88), nome:'Regina Célia Fontes', whatsapp:'11994736512',
    cidade:'Diadema', horario:'À noite',
    area:'Previdenciário', situacao:null, saida:null, pontos:null,
    beneficio:['Aposentadoria por idade'], inss:'Recebo mas acho que o valor está errado',
    documentos:'Tenho alguma coisa',
    relato:'Me aposentei em 2019 e acho que não contaram os anos que trabalhei de carteira assinada nos anos 90.',
    origem:'direto', etapa:'andamento', notas:'Revisão protocolada. Aguardando manifestação do INSS.',
    data_saida:null, ia:null, ia_at:null
  },
  {
    id:'d13', criado_at:hora(112), nome:'Paulo Henrique Andrade', whatsapp:'11961247835',
    cidade:'São Bernardo do Campo', horario:'De manhã',
    area:'Trabalhista', situacao:'Fui demitido sem justa causa', saida:'Menos de 6 meses',
    pontos:['Verbas rescisórias','Horas extras'], beneficio:null, inss:null,
    documentos:'Tenho tudo guardado',
    relato:'Motorista de entrega. Fazia jornada de 12 horas e recebia como se fosse oito.',
    origem:'instagram', etapa:'desfecho', notas:'Acordo homologado em audiência. Aguardando o depósito.',
    data_saida:dia(330), ia:null, ia_at:null
  },
  {
    id:'d14', criado_at:hora(140), nome:'Ana Paula Souza Lima', whatsapp:'11999998888',
    cidade:'Santo André', horario:null,
    area:'Não sei classificar', situacao:null, saida:null, pontos:null, beneficio:null, inss:null,
    documentos:null,
    relato:'Não sei se meu caso é trabalhista. Prestava serviço como MEI mas cumpria horário e tinha chefe.',
    origem:'direto', etapa:'encerrado', notas:'Orientada em consulta. Optou por não seguir.',
    data_saida:null, ia:null, ia_at:null
  },
  {
    id:'d15', criado_at:hora(155), nome:'Wagner Oliveira Pinto', whatsapp:'11933214567',
    cidade:'Santo André', horario:'De manhã',
    area:'Trabalhista', situacao:'Fui demitido por justa causa e discordo', saida:'Mais de 2 anos',
    pontos:['Verbas rescisórias'], beneficio:null, inss:null,
    documentos:'Não tenho nada',
    relato:'Fui mandado embora por justa causa há três anos e queria reverter.',
    origem:'direto', etapa:'descartado', notas:'Prazo bienal já vencido quando procurou. Orientado na consulta.',
    data_saida:dia(1180), ia:null, ia_at:null
  }
].map(prazo);

var MOVS = [
  {id:'m01', caso_id:'d3',  criado_at:hora(0.3), tipo:'contato',   texto:'Cliente enviou a CTPS pelo WhatsApp. Falta o extrato analítico do FGTS.'},
  {id:'m02', caso_id:'d3',  criado_at:hora(3),   tipo:'ia',        texto:'Análise preliminar gerada pela IA.'},
  {id:'m03', caso_id:'d3',  criado_at:hora(4),   tipo:'etapa',     texto:'Etapa mudou de Triagem para Documentos.'},
  {id:'m04', caso_id:'d7',  criado_at:hora(1.2), tipo:'nota',      texto:'Ela lembrou que tem plano de saúde com ele como titular desde 2016. Prova excelente.'},
  {id:'m05', caso_id:'d11', criado_at:hora(2),   tipo:'audiencia', texto:'Perícia médica designada. Cliente avisado por WhatsApp.'},
  {id:'m06', caso_id:'d13', criado_at:hora(5),   tipo:'prazo',     texto:'Acordo homologado. Prazo de 15 dias para o depósito.'},
  {id:'m07', caso_id:'d10', criado_at:hora(7),   tipo:'etapa',     texto:'Etapa mudou de Contrato para Protocolado.'},
  {id:'m08', caso_id:'d10', criado_at:hora(8),   tipo:'nota',      texto:'Ação distribuída na 3ª Vara do Trabalho de São Bernardo.'},
  {id:'m09', caso_id:'d5',  criado_at:hora(8.5), tipo:'ia',        texto:'Análise preliminar gerada pela IA.'},
  {id:'m10', caso_id:'d8',  criado_at:hora(11),  tipo:'contato',   texto:'Contrato assinado no escritório. Cópia entregue ao cliente.'},
  {id:'m11', caso_id:'d12', criado_at:hora(19),  tipo:'nota',      texto:'Revisão protocolada. Aguardando manifestação do INSS.'},
  {id:'m12', caso_id:'d9',  criado_at:hora(26),  tipo:'contato',   texto:'Pedido o PPP das três empresas. Duas já responderam.'},
  {id:'m13', caso_id:'d11', criado_at:hora(40),  tipo:'etapa',     texto:'Etapa mudou de Protocolado para Em andamento.'},
  {id:'m14', caso_id:'d15', criado_at:hora(150), tipo:'nota',      texto:'Prazo bienal já vencido na data da consulta. Cliente orientado.'}
];

var TAREFAS = [
  {id:'t1', caso_id:'d3',  criado_at:hora(3), titulo:'Cobrar o extrato analítico do FGTS',       quando:daqui(-1, 11), tipo:'tarefa',    feita:false, feita_at:null},
  {id:'t2', caso_id:'d3',  criado_at:hora(3), titulo:'Protocolar a inicial antes da prescrição', quando:daqui(21, 17), tipo:'prazo',     feita:false, feita_at:null},
  {id:'t3', caso_id:'d11', criado_at:hora(2), titulo:'Perícia médica no INSS de Mauá',           quando:daqui(2, 10),  tipo:'audiencia', feita:false, feita_at:null},
  {id:'t4', caso_id:'d13', criado_at:hora(5), titulo:'Conferir o depósito do acordo',            quando:daqui(6, 17),  tipo:'prazo',     feita:false, feita_at:null},
  {id:'t5', caso_id:'d7',  criado_at:hora(9), titulo:'Reunião para colher declaração das testemunhas', quando:daqui(4, 15),  tipo:'reuniao', feita:false, feita_at:null},
  {id:'t6', caso_id:'d10', criado_at:hora(8), titulo:'Audiência inicial — 3ª Vara de São Bernardo', quando:daqui(29, 14), tipo:'audiencia', feita:false, feita_at:null},
  {id:'t7', caso_id:'d8',  criado_at:hora(11),titulo:'Redigir a petição inicial',                quando:daqui(9, 9),   tipo:'tarefa',    feita:false, feita_at:null},
  {id:'t8', caso_id:'d10', criado_at:hora(20),titulo:'Enviar cópia da inicial para a cliente',   quando:hora(6),    tipo:'tarefa',    feita:true,  feita_at:hora(6)}
];

/* Publicações no formato exato que o DJEN devolve. Na versão de verdade
   isso chega da API do CNJ pela OAB 417.105/SP — aqui é imitação. */
var PUBS = [
  {
    id_cnj:696708288, visto_em:hora(0.2), disponibilizada:dia(0),
    tribunal:'TRT2', orgao:'3ª Vara do Trabalho de São Bernardo do Campo',
    classe:'Ação Trabalhista - Rito Ordinário', tipo:'Intimação',
    processo:'1001760-56.2026.5.02.0463', processo_num:'10017605620265020463',
    texto:'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 2ª REGIÃO  3ª VARA DO TRABALHO DE SÃO BERNARDO DO CAMPO  INTIMAÇÃO  Fica V. Sa. intimado para tomar ciência da designação de audiência inicial para o dia 12/09/2026, às 14h20, a ser realizada por videoconferência. O não comparecimento do reclamante importa arquivamento da ação, nos termos do art. 844 da CLT. As partes deverão apresentar documentos e rol de testemunhas no prazo legal.',
    link:'https://pje.trt2.jus.br/pjekz/validacao/26081311404873500000479635989',
    partes:[{nome:'FERNANDA LIMA TEIXEIRA', polo:'A'},{nome:'TRANSPORTES REUNIDOS ABC LTDA', polo:'P'}],
    lida:false, caso_id:'d10'
  },
  {
    id_cnj:696701442, visto_em:hora(0.4), disponibilizada:dia(0),
    tribunal:'TRT2', orgao:'2ª Vara do Trabalho de Santo André',
    classe:'Ação Trabalhista - Rito Ordinário', tipo:'Sentença',
    processo:'1000923-14.2026.5.02.0432', processo_num:'10009231420265020432',
    texto:'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 2ª REGIÃO  2ª VARA DO TRABALHO DE SANTO ANDRÉ  Fica V. Sa. intimado do inteiro teor da sentença proferida nos autos, homologando o acordo celebrado entre as partes. O pagamento deverá ser comprovado nos autos no prazo de 15 (quinze) dias, sob pena de execução. Custas na forma da lei.',
    link:'https://pje.trt2.jus.br/pjekz/validacao/26081311404873500000479631201',
    partes:[{nome:'PAULO HENRIQUE ANDRADE', polo:'A'}],
    lida:false, caso_id:'d13'
  },
  {
    id_cnj:695330119, visto_em:hora(2), disponibilizada:dia(2),
    tribunal:'TRF3', orgao:'1º Juizado Especial Federal de São Bernardo do Campo',
    classe:'Procedimento do Juizado Especial Cível', tipo:'Intimação',
    processo:'5001284-72.2026.4.03.6114', processo_num:'50012847220264036114',
    texto:'JUSTIÇA FEDERAL  1º JUIZADO ESPECIAL FEDERAL DE SÃO BERNARDO DO CAMPO  Fica a parte autora intimada da designação de perícia médica judicial para o dia 03/09/2026, às 10h00, no consultório do perito nomeado. A parte deverá comparecer munida de documento de identidade e de todos os exames, laudos e receituários que possuir, ainda que antigos.',
    link:'https://pje1g.trf3.jus.br/pje/validacao/26081209331245600000412887',
    partes:[{nome:'MARCELO APARECIDO DUARTE', polo:'A'},{nome:'INSTITUTO NACIONAL DO SEGURO SOCIAL', polo:'P'}],
    lida:false, caso_id:'d11'
  },
  {
    id_cnj:694882037, visto_em:hora(5), disponibilizada:dia(5),
    tribunal:'TRT2', orgao:'1ª Vara do Trabalho de São Bernardo do Campo',
    classe:'Ação Trabalhista - Rito Ordinário', tipo:'Despacho',
    processo:'1002014-88.2026.5.02.0461', processo_num:'10020148820265020461',
    texto:'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 2ª REGIÃO  1ª VARA DO TRABALHO DE SÃO BERNARDO DO CAMPO  Manifeste-se a parte autora, no prazo de 5 (cinco) dias, sobre os documentos juntados pela reclamada, bem como sobre a proposta de acordo apresentada em audiência.',
    link:'https://pje.trt2.jus.br/pjekz/validacao/26080911224498100000478112034',
    partes:[{nome:'SILVANA RODRIGUES CAMPOS', polo:'A'}],
    lida:true, caso_id:'d7'
  },
  {
    id_cnj:693410558, visto_em:hora(9), disponibilizada:dia(9),
    tribunal:'TRT2', orgao:'Gabinete da 4ª Turma',
    classe:'Recurso Ordinário Trabalhista', tipo:'Intimação',
    processo:'1000455-30.2025.5.02.0468', processo_num:'10004553020255020468',
    texto:'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 2ª REGIÃO  4ª TURMA  Fica V. Sa. intimado para apresentar contrarrazões ao recurso ordinário interposto pela reclamada, no prazo de 8 (oito) dias, nos termos do art. 900 da CLT.',
    link:'https://pje.trt2.jus.br/pjekz/validacao/26080510113367200000476004881',
    partes:[{nome:'REGINA CÉLIA FONTES', polo:'A'}],
    lida:true, caso_id:'d12'
  }
];

/* linha do tempo que o DataJud devolveria pra um processo */
function movimentosFalsos(){
  var base = [
    'Distribuição', 'Conclusão', 'Expedição de documento', 'Publicação',
    'Audiência designada', 'Juntada de petição', 'Juntada de documento',
    'Contestação apresentada', 'Réplica', 'Conclusão para julgamento'
  ];
  return base.map(function(nome, i){
    var d = new Date(AGORA.getTime() - (base.length - i) * 11 * 86400000);
    return {
      quando: d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') +
              String(d.getDate()).padStart(2,'0') + '090000',
      nome: nome
    };
  }).reverse();
}

/* análise simulada — o texto muda com a área, pra demonstração fazer sentido */
function analiseFalsa(c){
  var nome = String(c.nome).split(' ')[0];
  if(c.area === 'Previdenciário') return {
    viabilidade:'possivel', urgencia:'media',
    resumo:'Segurado busca reconhecimento de benefício junto ao INSS; o caminho depende do motivo formal da negativa e da prova médica ou de tempo de contribuição.',
    teses:['Concessão do benefício pretendido','Reconhecimento de período especial, se houver exposição comprovada'],
    pontos_atencao:['Falta a data e o motivo formal do indeferimento','A prova técnica é decisiva e ainda não está reunida'],
    documentos_pedir:['Carta de indeferimento','Extrato CNIS completo','PPP e LTCAT das empresas','Laudos e exames'],
    perguntas_fazer:['Qual a data do indeferimento?','Já recorreu administrativamente?'],
    resposta_whatsapp:'Olá, ' + nome + '. Recebi as informações que você mandou pelo site.\nPra eu analisar seu caso, preciso da carta de indeferimento do INSS e dos documentos das empresas onde você trabalhou.\nMe mande o que tiver que eu retorno com a análise.'
  };
  var apertado = c.alerta_prazo === 'critico' || c.alerta_prazo === 'prescrito';
  return {
    viabilidade:'provavel', urgencia: apertado ? 'alta' : 'media',
    resumo:'Ex-empregado relata verbas não pagas ao longo do contrato e busca o que ficou pendente após a saída.',
    teses:['Horas extras habituais e reflexos em férias, 13º e FGTS','Verbas rescisórias não quitadas','Diferenças de depósito de FGTS'],
    pontos_atencao:(apertado
      ? ['O prazo prescricional está em contagem final — priorizar este caso']
      : ['A prova da jornada depende de documento ou testemunha']).concat(
      ['O relato veio de formulário e é incompleto por natureza']),
    documentos_pedir:['CTPS e termo de rescisão','Holerites dos últimos 5 anos','Extrato analítico do FGTS','Controles de ponto, se tiver'],
    perguntas_fazer:['Tem colega que possa testemunhar a jornada?','Recebeu algum acerto na saída?'],
    resposta_whatsapp:'Olá, ' + nome + '. Recebi o que você preencheu no site e já dei uma olhada.\nPra eu analisar seu caso direito, me mande a carteira de trabalho e os holerites que você tiver guardado.\nSe tiver o termo de rescisão, mande também.\nCom isso em mãos eu te retorno.'
  };
}

/* ---------- a assistente, imitada ---------- */
var DOCS = [
  {id:'doc1', caso_id:'d10', criado_at:hora(6), nome:'Contestacao - Transportes Reunidos ABC.pdf',
   caminho:'demo/contestacao.pdf', tamanho:842113, tipo:'Contestação trabalhista',
   analise:null, analise_at:hora(6)}
];

var FONTES_FALSAS = [
  {titulo:'Decreto-Lei nº 5.452/1943 — Consolidação das Leis do Trabalho', url:'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm'},
  {titulo:'Súmulas do Tribunal Superior do Trabalho', url:'https://www.tst.jus.br/sumulas'},
  {titulo:'Lei nº 8.213/1991 — Planos de Benefícios da Previdência Social', url:'https://www.planalto.gov.br/ccivil_03/leis/l8213cons.htm'}
];

var RESPOSTA_FALSA = [
  'Resposta curta: o pedido de demissão não impede o reconhecimento de rescisão indireta, mas muda o ônus e o risco.',
  '',
  '## O fundamento',
  'A rescisão indireta está no art. 483 da CLT. A hipótese que costuma servir em ambiente insalubre é a alínea "c" (perigo manifesto de mal considerável) combinada com a alínea "d" (descumprimento das obrigações do contrato) — não fornecer EPI adequado nem pagar o adicional devido é descumprimento contratual.',
  '',
  '## O problema prático',
  '- Se ele assinou pedido de demissão, o documento vale como declaração de vontade e você vai ter que desconstituí-lo.',
  '- O art. 483, §3º da CLT permite que o empregado permaneça ou não no serviço até a decisão. Ter saído não derruba o pedido.',
  '- O ponto que decide é a **prova do motivo**: laudo, ficha de EPI, reclamação interna, testemunha, atestado médico ligando o afastamento ao ambiente.',
  '',
  '## O que eu faria neste caso',
  '1. Pedir o PPRA/PGR e o PCMSO da empresa — se a insalubridade estiver reconhecida no próprio programa dela, metade do caminho está feito.',
  '2. Verificar se houve CAT aberta ou afastamento pelo INSS no período.',
  '3. Requerer perícia técnica já na inicial, com quesitos sobre agente, grau e uso efetivo de EPI.',
  '',
  'Atenção ao risco: se a rescisão indireta não for reconhecida, o pedido de demissão prevalece e as verbas rescisórias caem. Vale calcular se compensa pedir em caráter subsidiário.'
].join('\n');

var CONVERSAS = [
  {id:'c1', criado_at:hora(1), mexida_at:hora(1), caso_id:'d3', documento_id:null,
   titulo:'Pedido de demissão afasta a rescisão indireta se o motivo foi ambiente insalubre?'},
  {id:'c2', criado_at:hora(3), mexida_at:hora(3), caso_id:null, documento_id:null,
   titulo:'Como fica a conversão de tempo especial depois da EC 103/2019?'}
];
var MENSAGENS = [
  {id:'m1', conversa_id:'c1', criado_at:hora(1), papel:'user',
   texto:'Pedido de demissão afasta a rescisão indireta se o motivo foi ambiente insalubre?', fontes:null},
  {id:'m2', conversa_id:'c1', criado_at:hora(1), papel:'assistant',
   texto:RESPOSTA_FALSA, fontes:FONTES_FALSAS}
];

var LEITURA_FALSA = {
  tipo_documento:'Contestação trabalhista',
  resumo:'Contestação da reclamada em ação trabalhista movida por ex-motorista, negando o vínculo de horas extras, sustentando validade dos controles de ponto e apresentando proposta de acordo. Suscita preliminar de incompetência territorial e prescrição quinquenal parcial.',
  partes:[
    {nome:'FERNANDA LIMA TEIXEIRA', papel:'reclamante'},
    {nome:'TRANSPORTES REUNIDOS ABC LTDA', papel:'reclamada'}
  ],
  fatos:[
    'A reclamada admite o vínculo de 03/2021 a 11/2025, na função de auxiliar de logística.',
    'Sustenta que os controles de ponto eram britânicos e assinados, e junta 18 folhas de espelho.',
    'Nega o acúmulo de função, alegando que as tarefas descritas são compatíveis com o cargo.',
    'Reconhece o pagamento em atraso das verbas rescisórias, atribuindo a falha ao banco.',
    'Apresenta proposta de acordo em audiência.'
  ],
  valores:[
    'R$ 18.400,00 — proposta de acordo apresentada pela reclamada',
    'R$ 3.212,55 — valor que a reclamada afirma ter pago a título de rescisão'
  ],
  datas:[
    {data:daqui(29).slice(0,10), titulo:'Audiência inicial — 3ª Vara de São Bernardo',
     tipo:'audiencia', por_que:'Data designada no despacho citado na contestação.'},
    {data:daqui(8).slice(0,10), titulo:'Prazo para réplica',
     tipo:'prazo', por_que:'15 dias da juntada da contestação, contados do protocolo indicado na peça.'}
  ],
  pontos_favoraveis:[
    'A reclamada admite o vínculo e o período — não sobra discussão sobre isso.',
    'Ponto britânico é inválido como prova (Súmula 338, III do TST) e inverte o ônus a favor da reclamante.',
    'Ela própria reconhece o atraso no pagamento das verbas, o que sustenta a multa do art. 477, §8º da CLT.'
  ],
  pontos_contra:[
    'Os espelhos assinados vão exigir prova testemunhal firme para serem afastados.',
    'A tese de acúmulo de função está fraca sem descrição concreta das tarefas extras.',
    'A prescrição quinquenal parcial procede e vai limitar o período cobrado.'
  ],
  proximos_passos:[
    'Impugnar os controles de ponto na réplica, invocando a Súmula 338 do TST.',
    'Arrolar duas testemunhas que trabalharam no mesmo turno.',
    'Refazer a planilha de horas extras já considerando o corte quinquenal.',
    'Avaliar a proposta de acordo contra o valor recalculado antes da audiência.'
  ],
  documentos_faltando:[
    'Cartões de ponto do período de 2021 a 2022, não juntados pela reclamada',
    'Extrato analítico do FGTS da reclamante',
    'Comprovante da data efetiva do pagamento rescisório'
  ],
  alerta:'Prazo para réplica corre agora — 15 dias da juntada. A audiência já está designada.'
};

var RESUMO_ESCRITORIO_FALSO = [
'Contestação da Transportes Reunidos ABC. Admite o vínculo de 03/2021 a 11/2025 e a função,',
'então esse ponto está fora de disputa. Ataca as horas extras juntando 18 espelhos de ponto',
'britânicos e assinados — impugnar pela Súmula 338, III do TST, que os invalida e inverte o ônus.',
'Nega o acúmulo de função com argumento genérico; nossa tese aqui está fraca sem descrição',
'concreta das tarefas. Reconhece o atraso no pagamento rescisório, o que sustenta a multa do',
'art. 477, §8º. Suscita prescrição quinquenal parcial, que procede e limita o período.',
'Propõe acordo de R$ 18.400,00.',
'',
'Prazo de réplica: 15 dias da juntada. Audiência inicial já designada.',
'Refazer a planilha com o corte quinquenal antes de decidir sobre a proposta.'
].join('\n');

var RESUMO_CLIENTE_FALSO = [
'Oi, Fernanda. A empresa apresentou a defesa dela no seu processo.',
'',
'Ela reconheceu que você trabalhou lá no período todo, o que é bom — esse ponto',
'já está resolvido. Mas contestou as horas extras e juntou os controles de ponto.',
'',
'Vou apresentar nossa resposta dentro do prazo. Para isso preciso que você me',
'confirme se algum colega do seu turno pode servir de testemunha.',
'',
'A empresa também fez uma proposta de acordo. Vou analisar se ela faz sentido',
'diante do que você tem a receber e te retorno para conversarmos.',
'',
'Escritório'
].join('\n');

var MINUTA_FALSA = [
  'EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DA [Nº] VARA DO TRABALHO DE SÃO BERNARDO DO CAMPO/SP',
  '',
  '',
  '[NOME COMPLETO DA RECLAMANTE], [NACIONALIDADE], [ESTADO CIVIL], [PROFISSÃO], portadora do RG nº [RG] e do CPF nº [CPF], residente e domiciliada em [ENDEREÇO COMPLETO], vem, por seu advogado que esta subscreve (procuração anexa), com escritório na R. Rio Branco, 133, Centro, São Bernardo do Campo/SP, CEP 09710-090, onde recebe intimações, propor a presente',
  '',
  'RECLAMAÇÃO TRABALHISTA',
  '',
  'em face de [RAZÃO SOCIAL DA RECLAMADA], pessoa jurídica de direito privado, inscrita no CNPJ sob o nº [CNPJ], com sede em [ENDEREÇO DA RECLAMADA], pelos fatos e fundamentos a seguir expostos.',
  '',
  '',
  'I — DOS FATOS',
  '',
  'A Reclamante foi admitida pela Reclamada em [DATA DE ADMISSÃO], para exercer a função de [FUNÇÃO ANOTADA NA CTPS], mediante remuneração mensal de R$ [SALÁRIO], sendo dispensada sem justa causa em [DATA DE SAÍDA].',
  '',
  'Durante todo o pacto laboral, a Reclamante cumpria jornada das [HORÁRIO DE ENTRADA] às [HORÁRIO DE SAÍDA], de [DIAS DA SEMANA], com intervalo intrajornada de apenas [DURAÇÃO DO INTERVALO], extrapolando habitualmente o limite constitucional sem a correspondente contraprestação.',
  '',
  'Não obstante, a Reclamada jamais quitou as horas extraordinárias prestadas, tampouco os reflexos daí decorrentes.',
  '',
  '',
  'II — DO DIREITO',
  '',
  'II.1 — DAS HORAS EXTRAORDINÁRIAS E REFLEXOS',
  '',
  'A jornada de trabalho encontra limite no art. 7º, XIII, da Constituição Federal, que fixa a duração normal em oito horas diárias e quarenta e quatro semanais. O art. 59 da CLT admite a prorrogação mediante acordo, sempre com o acréscimo mínimo de 50% sobre a hora normal (art. 7º, XVI, da CF).',
  '',
  'Cabe à Reclamada, que conta com mais de vinte empregados, a juntada dos controles de frequência, na forma do art. 74, §2º, da CLT. A não apresentação gera presunção relativa de veracidade da jornada declinada na inicial, conforme entendimento consolidado na Súmula 338, I, do TST.',
  '',
  'As horas extras habituais repercutem em aviso prévio, férias acrescidas de um terço, décimo terceiro salário, repouso semanal remunerado e FGTS com a multa de 40%.',
  '',
  'II.2 — DO INTERVALO INTRAJORNADA',
  '',
  'A supressão parcial do intervalo previsto no art. 71 da CLT enseja o pagamento do período suprimido com acréscimo de 50%, na forma do §4º do mesmo artigo, com a redação dada pela Lei 13.467/2017.',
  '',
  'II.3 — DA MULTA DO ART. 477, §8º, DA CLT',
  '',
  '[CONFIRMAR A DATA EFETIVA DO PAGAMENTO RESCISÓRIO] Ultrapassado o prazo de dez dias contados do término do contrato, é devida a multa equivalente a um salário da Reclamante.',
  '',
  '',
  'III — DOS PEDIDOS',
  '',
  'Ante o exposto, requer:',
  '',
  'a) a citação da Reclamada para, querendo, apresentar defesa, sob pena de revelia e confissão;',
  'b) a condenação ao pagamento das horas extraordinárias excedentes à 8ª diária e 44ª semanal, com adicional de 50%, e reflexos;',
  'c) a condenação ao pagamento do intervalo intrajornada suprimido, com adicional de 50%;',
  'd) a condenação ao pagamento da multa do art. 477, §8º, da CLT;',
  'e) a condenação em honorários advocatícios sucumbenciais, na forma do art. 791-A da CLT;',
  'f) a produção de todos os meios de prova em direito admitidos, especialmente documental, testemunhal e depoimento pessoal do preposto, sob pena de confissão.',
  '',
  'Dá-se à causa o valor de R$ [VALOR DA CAUSA].',
  '',
  'Termos em que pede deferimento.',
  '',
  'São Bernardo do Campo, [DATA].',
  '',
  '',
  'NOME DO ADVOGADO',
  'OAB/UF 000.000',
  '',
  '',
  '════════════════════════════════════════',
  'A CONFERIR ANTES DE PROTOCOLAR',
  '════════════════════════════════════════',
  '',
  '1. Todos os [COLCHETES] acima — qualificação, datas, salário e jornada saem da CTPS e dos holerites.',
  '2. Valor da causa: some os pedidos líquidos. Desde a Lei 13.467/2017 o rito exige pedido com valor.',
  '3. Data do pagamento rescisório: a multa do 477 só cabe se passou dos dez dias. Confirme no extrato antes de manter o pedido.',
  '4. Confira o corte da prescrição quinquenal — cobra-se os cinco anos anteriores ao ajuizamento.',
  '5. Testemunhas: a tese de jornada depende delas. Confirme disponibilidade antes de arrolar.',
  '6. Verifique se cabe pedido de justiça gratuita com a declaração de hipossuficiência.'
].join('\n');

/* ---------- WhatsApp imitado ---------- */
/* A demonstração começa DESPAREADA, pra mostrar o fluxo do QR Code.
   Sete segundos depois de abrir a aba do WhatsApp, ela "pareia" sozinha.
   O QR é de verdade, mas o conteúdo é um texto inofensivo: quem escanear
   na apresentação só vê a mensagem, não pareia nada. */
var WPP_SESSAO = {id:1, estado:'qr', qr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASgAAAEoAQMAAADRyf5aAAAABlBMVEUPHjj///++wNSlAAABdUlEQVR42u2awY7DQAhDrf3/f2alZjCGJW216q2eRJHSzOkJjGGKeGfBu7zrv7twrfP6uPKRX37wzvqGXUiwD3BxPfLmF/NqvADG1QFWv8C8nvA6oDLWzOsVL2ameb3SL2iAHYLWr4UXKf25XB8XXs1asDhCDYl5Tf26wKWEMUPPq3l1XpSvjLMSf+v9youePjBDzPG18RLhaubevDY/AVC6QHCg6pvXqI+ZkaX/AZE081JeKfCZjGViszEyr8YL0jEeVN1emNfkxZiCJCdT1by63mdfFEO3Ep95DX8fEBcmyQn7ib3fLkg6bj2l0ryGnwDHqhVhmpjmNfw9MpLkvCOHhea16hfQe26xZea1zCfaILoFnnmt/SOH0BzwZMyZ1+wfaz7I6Ao5jTSv6SfoT1FnQ0xH85r5yF4RoR1SejPzGvVRXUTTrzCve14tqNgZmdcNr2iaJnMd89r0q9/Q9tu8lvpYXj8kKV0f7/yX/znoXR/f9Qs2FEDyAwl3XQAAAABJRU5ErkJggg==',
                  numero:null, visto_at:new Date().toISOString(), erro:null};
var lidasSessao = 0, pareando = false;

var CONTATOS = [
  {id:'w1', telefone:'5511987654321', nome:'Maria Aparecida da Silva', nome_wpp:'Maria Aparecida',
   cidade:'São Bernardo do Campo', etiquetas:['cliente'], notas:null, caso_id:'d1', foto:null},
  {id:'w2', telefone:'5511996321478', nome:null, nome_wpp:'Antônio Marcos',
   cidade:null, etiquetas:['cliente','prazo curto'], notas:'Prefere ligação de manhã.',
   caso_id:'d3', foto:null},
  {id:'w3', telefone:'5511974185296', nome:'Joselaine Ferreira', nome_wpp:'Jô',
   cidade:'Diadema', etiquetas:['lead'], notas:null, caso_id:null, foto:null},
  {id:'w4', telefone:'5511963254789', nome:null, nome_wpp:'Roberto RH Metalúrgica',
   cidade:null, etiquetas:['parte contrária'], notas:null, caso_id:null, foto:null},
  {id:'w5', telefone:'5511912345678', nome:'José Carlos Ferreira', nome_wpp:'José Carlos',
   cidade:'Santo André', etiquetas:['cliente'], notas:null, caso_id:'d5', foto:null}
];

var CONVERSAS_WPP = [
  {conversa_id:'k1', contato_id:'w2', ultima_at:hora(0.02), nao_lidas:2, arquivada:false,
   ultima_previa:'Doutor, consegui o extrato do FGTS. Mando por aqui?'},
  {conversa_id:'k2', contato_id:'w3', ultima_at:hora(0.2), nao_lidas:1, arquivada:false,
   ultima_previa:'Boa tarde! Vi seu site e queria tirar uma dúvida sobre demissão'},
  {conversa_id:'k3', contato_id:'w1', ultima_at:hora(0.9), nao_lidas:0, arquivada:false,
   ultima_previa:'Você: Recebi, Maria. Vou analisar e te retorno até amanhã.'},
  {conversa_id:'k4', contato_id:'w5', ultima_at:hora(2), nao_lidas:0, arquivada:false,
   ultima_previa:'Você: Perfeito. A perícia ficou marcada, te aviso a data.'},
  {conversa_id:'k5', contato_id:'w4', ultima_at:hora(5), nao_lidas:0, arquivada:false,
   ultima_previa:'Podemos conversar sobre um acordo?'}
];

var MSGS_WPP = {
  k1:[
    {id:'x1', de_mim:false, texto:'Doutor, boa tarde', criado_at:hora(0.06)},
    {id:'x2', de_mim:true,  texto:'Boa tarde, Antônio. Tudo bem?', criado_at:hora(0.055)},
    {id:'x3', de_mim:false, texto:'Tudo. O senhor tinha pedido o extrato do FGTS, lembra?', criado_at:hora(0.05)},
    {id:'x4', de_mim:true,  texto:'Lembro sim. Conseguiu tirar?', criado_at:hora(0.04)},
    {id:'x5', de_mim:false, texto:'Consegui na Caixa hoje de manhã', criado_at:hora(0.025)},
    {id:'x6', de_mim:false, texto:'Doutor, consegui o extrato do FGTS. Mando por aqui?', criado_at:hora(0.02)}
  ],
  k2:[
    {id:'y1', de_mim:false, texto:'Boa tarde! Vi seu site e queria tirar uma dúvida sobre demissão', criado_at:hora(0.2)}
  ],
  k3:[
    {id:'z1', de_mim:false, texto:'Doutor, mandei os holerites no e-mail', criado_at:hora(1)},
    {id:'z2', de_mim:true,  texto:'Recebi, Maria. Vou analisar e te retorno até amanhã.', criado_at:hora(0.9)}
  ],
  k4:[
    {id:'v1', de_mim:false, texto:'Doutor, o INSS marcou alguma coisa?', criado_at:hora(2.1)},
    {id:'v2', de_mim:true,  texto:'Perfeito. A perícia ficou marcada, te aviso a data.', criado_at:hora(2)}
  ],
  k5:[
    {id:'u1', de_mim:false, texto:'Podemos conversar sobre um acordo?', criado_at:hora(5)}
  ]
};

function caixaWpp(){
  return CONVERSAS_WPP.map(function(c){
    var ct = null;
    CONTATOS.forEach(function(x){ if(x.id === c.contato_id) ct = x; });
    var caso = null;
    CASOS.forEach(function(x){ if(ct && x.id === ct.caso_id) caso = x; });
    return Object.assign({}, c, {
      contato_id:ct.id, telefone:ct.telefone, nome:ct.nome, nome_wpp:ct.nome_wpp,
      exibir: ct.nome || ct.nome_wpp || ct.telefone, foto:ct.foto,
      etiquetas:ct.etiquetas, cidade:ct.cidade, notas:ct.notas, caso_id:ct.caso_id,
      caso_nome: caso ? caso.nome : null, caso_etapa: caso ? caso.etapa : null
    });
  }).sort(function(a,b){ return new Date(b.ultima_at) - new Date(a.ultima_at); });
}

/* ---------- o dublê do fetch ---------- */
var real = window.fetch;

function resposta(corpo, ms){
  return new Promise(function(ok){
    setTimeout(function(){
      ok(corpo === null
        ? new Response(null, {status:204})
        : new Response(JSON.stringify(corpo), {status:200, headers:{'content-type':'application/json'}}));
    }, ms || 160);
  });
}
function acha(id){
  for(var i=0;i<CASOS.length;i++) if(CASOS[i].id === id) return CASOS[i];
  return null;
}
function idDe(u){ var m = /id=eq\.([^&]+)/.exec(u); return m ? m[1] : null; }
function novoId(){ return 'x' + Math.random().toString(36).slice(2,9); }

window.fetch = function(url, op){
  var u = String(url), m = (op && op.method) || 'GET', corpo = null;
  /* o upload manda o arquivo cru, não JSON — só tenta ler o que é texto */
  if(op && typeof op.body === 'string'){
    try{ corpo = JSON.parse(op.body); }catch(e){ corpo = null; }
  }

  if(u.indexOf('supabase.co') === -1 && u.indexOf('demo.local') === -1) return real.apply(this, arguments);

  if(u.indexOf('/auth/v1/token') > -1)
    return resposta({access_token:'demo', refresh_token:'demo', expires_in:3600,
                     user:{email:(corpo && corpo.email) || 'demonstracao'}}, 450);
  if(u.indexOf('/auth/v1/logout') > -1) return resposta(null);

  if(u.indexOf('/rest/v1/casos_com_prazo') > -1)
    return resposta(CASOS.map(prazo).slice().sort(function(a,b){
      return new Date(b.criado_at) - new Date(a.criado_at);
    }));

  if(u.indexOf('/rest/v1/casos') > -1){
    if(m === 'POST'){
      var nc2 = prazo(Object.assign({
        id:novoId(), criado_at:new Date().toISOString(),
        nome:'', whatsapp:'', cidade:null, horario:null, area:'Trabalhista',
        situacao:null, saida:null, pontos:null, beneficio:null, inss:null,
        documentos:null, relato:null, origem:'manual', etapa:'triagem',
        notas:null, data_saida:null, ia:null, ia_at:null
      }, corpo));
      CASOS.unshift(nc2);
      return resposta([nc2]);
    }
    var c = acha(idDe(u));
    if(m === 'PATCH' && c){ for(var k in corpo) c[k] = corpo[k]; prazo(c); }
    if(m === 'DELETE'){
      var alvo = idDe(u);
      CASOS   = CASOS.filter(function(x){ return x.id !== alvo; });
      MOVS    = MOVS.filter(function(x){ return x.caso_id !== alvo; });
      TAREFAS = TAREFAS.filter(function(x){ return x.caso_id !== alvo; });
    }
    return resposta(null);
  }

  if(u.indexOf('/rest/v1/movimentacoes') > -1){
    if(m === 'POST'){
      MOVS.unshift({id:novoId(), caso_id:corpo.caso_id, criado_at:new Date().toISOString(),
                    tipo:corpo.tipo || 'nota', texto:corpo.texto});
      return resposta(null);
    }
    var alvoM = /caso_id=eq\.([^&]+)/.exec(u);
    var lista = MOVS.slice().sort(function(a,b){ return new Date(b.criado_at) - new Date(a.criado_at); });
    if(alvoM) lista = lista.filter(function(x){ return x.caso_id === alvoM[1]; });
    return resposta(lista);
  }

  if(u.indexOf('/rest/v1/tarefas') > -1){
    if(m === 'POST'){
      TAREFAS.push({id:novoId(), caso_id:corpo.caso_id, criado_at:new Date().toISOString(),
                    titulo:corpo.titulo, quando:corpo.quando, tipo:corpo.tipo || 'tarefa',
                    feita:false, feita_at:null});
      return resposta(null);
    }
    if(m === 'PATCH'){
      var alvoT = idDe(u);
      TAREFAS.forEach(function(t){ if(t.id === alvoT){ for(var k2 in corpo) t[k2] = corpo[k2]; } });
      return resposta(null);
    }
    if(m === 'DELETE'){
      var apagaT = idDe(u);
      TAREFAS = TAREFAS.filter(function(t){ return t.id !== apagaT; });
      return resposta(null);
    }
    var alvoC = /caso_id=eq\.([^&]+)/.exec(u);
    var lt = TAREFAS.slice().sort(function(a,b){ return new Date(a.quando) - new Date(b.quando); });
    if(alvoC) lt = lt.filter(function(x){ return x.caso_id === alvoC[1]; });
    return resposta(lt);
  }

  /* a mesma agregação que a view processos_oab faz no banco */
  if(u.indexOf('/rest/v1/processos_oab') > -1){
    var por = {};
    PUBS.forEach(function(p){
      if(!p.processo) return;
      var x = por[p.processo] || (por[p.processo] = {
        processo:p.processo, processo_num:p.processo_num, tribunal:p.tribunal,
        orgao:p.orgao, classe:p.classe, partes:p.partes, caso_id:p.caso_id,
        publicacoes:0, ultima:'', primeira:'9999', nao_lidas:0
      });
      x.publicacoes++;
      if(!p.lida) x.nao_lidas++;
      if(String(p.disponibilizada) > x.ultima)   x.ultima   = p.disponibilizada;
      if(String(p.disponibilizada) < x.primeira) x.primeira = p.disponibilizada;
    });
    return resposta(Object.keys(por).map(function(k){ return por[k]; })
      .sort(function(a,b){ return String(b.ultima).localeCompare(String(a.ultima)); }));
  }

  if(u.indexOf('/rest/v1/publicacoes') > -1){
    if(m === 'PATCH'){
      var alvoP = /id_cnj=eq\.([^&]+)/.exec(u);
      if(alvoP) PUBS.forEach(function(p){
        if(String(p.id_cnj) === alvoP[1]){ for(var k3 in corpo) p[k3] = corpo[k3]; }
      });
      return resposta(null);
    }
    return resposta(PUBS.slice().sort(function(a,b){
      return String(b.disponibilizada).localeCompare(String(a.disponibilizada));
    }));
  }

  if(u.indexOf('/rest/v1/wpp_sessao') > -1){
    lidasSessao++;
    /* A primeira leitura vem do carregamento geral, no login. Da segunda em
       diante é a vigia da tela do WhatsApp — ou seja, ele está OLHANDO o QR.
       Só aí começa a contagem, senão o código já teria sumido se ele
       demorasse um minuto pra abrir a aba. */
    if(WPP_SESSAO.estado === 'qr' && !pareando && lidasSessao > 1){
      pareando = true;
      setTimeout(function(){
        WPP_SESSAO.estado = 'conectado';
        WPP_SESSAO.qr = null;
        WPP_SESSAO.numero = '5511900000000';
        /* o Supabase publicaria este UPDATE; aqui o dublê publica igual */
        emitirTR('wpp_sessao', 'UPDATE', WPP_SESSAO);
      }, 7000);
    }
    return resposta([WPP_SESSAO]);
  }
  if(u.indexOf('/rest/v1/wpp_caixa')  > -1) return resposta(caixaWpp());

  if(u.indexOf('/rest/v1/mensagens_wpp') > -1){
    var alvoW = /conversa_id=eq\.([^&]+)/.exec(u);
    return resposta(alvoW ? (MSGS_WPP[alvoW[1]] || []) : []);
  }

  if(u.indexOf('/rest/v1/conversas_wpp') > -1){
    if(m === 'PATCH'){
      var alvoC = /id=eq\.([^&]+)/.exec(u);
      if(alvoC) CONVERSAS_WPP.forEach(function(c){
        if(c.conversa_id === alvoC[1]) for(var k in corpo) c[k] = corpo[k];
      });
    }
    return resposta(null);
  }

  if(u.indexOf('/rest/v1/contatos') > -1){
    if(m === 'PATCH'){
      var alvoT = /id=eq\.([^&]+)/.exec(u);
      if(alvoT) CONTATOS.forEach(function(x){
        if(x.id === alvoT[1]) for(var k2 in corpo) x[k2] = corpo[k2];
      });
    }
    return resposta(null);
  }

  /* a fila: na demonstração a "ponte" entrega em 1,2s */
  if(u.indexOf('/rest/v1/wpp_fila') > -1){
    if(m === 'POST'){
      var alvoF = null;
      CONTATOS.forEach(function(x){ if(x.telefone === corpo.telefone) alvoF = x; });
      CONVERSAS_WPP.forEach(function(c){
        if(alvoF && c.contato_id === alvoF.id){
          setTimeout(function(){
            (MSGS_WPP[c.conversa_id] = MSGS_WPP[c.conversa_id] || []).push({
              id:novoId(), de_mim:true, texto:corpo.texto, criado_at:new Date().toISOString()
            });
            c.ultima_at = new Date().toISOString();
            c.ultima_previa = 'Você: ' + corpo.texto.slice(0,120);
          }, 1200);
        }
      });
    }
    return resposta(null);
  }

  if(u.indexOf('/rest/v1/documentos') > -1){
    if(m === 'POST'){
      var nd = {id:novoId(), caso_id:corpo.caso_id || null, criado_at:new Date().toISOString(),
                nome:corpo.nome, caminho:corpo.caminho, tamanho:corpo.tamanho,
                tipo:null, analise:null, analise_at:null};
      DOCS.unshift(nd);
      return resposta([nd]);
    }
    return resposta(DOCS);
  }

  if(u.indexOf('/rest/v1/conversas') > -1){
    if(m === 'POST'){
      var nc = {id:novoId(), criado_at:new Date().toISOString(), mexida_at:new Date().toISOString(),
                caso_id:corpo.caso_id || null, documento_id:corpo.documento_id || null, titulo:null};
      CONVERSAS.unshift(nc);
      return resposta([nc]);
    }
    return resposta(CONVERSAS.slice().sort(function(x,y){
      return new Date(y.mexida_at) - new Date(x.mexida_at); }));
  }

  if(u.indexOf('/rest/v1/mensagens') > -1){
    var alvoMs = /conversa_id=eq\.([^&]+)/.exec(u);
    return resposta(MENSAGENS.filter(function(x){ return !alvoMs || x.conversa_id === alvoMs[1]; }));
  }

  if(u.indexOf('/storage/v1/object/') > -1)
    return resposta({Key:'documentos/demonstracao'}, 500);

  if(u.indexOf('/functions/v1/advogado') > -1 && corpo && corpo.acao === 'conversar'){
    var texto = RESPOSTA_FALSA, i = 0;
    CONVERSAS.forEach(function(c){
      if(c.id === corpo.conversa_id && !c.titulo) c.titulo = String(corpo.mensagem).slice(0,70);
      if(c.id === corpo.conversa_id) c.mexida_at = new Date().toISOString();
    });
    MENSAGENS.push({id:novoId(), conversa_id:corpo.conversa_id,
                    criado_at:new Date().toISOString(), papel:'user', texto:corpo.mensagem, fontes:null});

    var enc = new TextEncoder();
    var fluxo = new ReadableStream({
      start: function(ctrl){
        function evento(nome, dados){
          ctrl.enqueue(enc.encode('event: ' + nome + '\ndata: ' + JSON.stringify(dados) + '\n\n'));
        }
        setTimeout(function(){ evento('buscando', {q:'súmula 338 TST controle de ponto'}); }, 700);
        setTimeout(function(){ evento('buscando', {q:'art. 483 CLT rescisão indireta'}); }, 1900);

        setTimeout(function passo(){
          if(i >= texto.length){
            MENSAGENS.push({id:novoId(), conversa_id:corpo.conversa_id,
                            criado_at:new Date().toISOString(), papel:'assistant',
                            texto:texto, fontes:FONTES_FALSAS});
            evento('fim', {fontes:FONTES_FALSAS, uso:{entrada:4100, saida:1350, buscas:2}});
            ctrl.close();
            return;
          }
          var n = 3 + Math.floor(Math.random()*7);
          evento('texto', {t: texto.slice(i, i+n)});
          i += n;
          setTimeout(passo, 14);
        }, 2600);
      }
    });
    return Promise.resolve(new Response(fluxo, {
      status:200, headers:{'content-type':'text/event-stream'}
    }));
  }

  if(u.indexOf('/functions/v1/advogado') > -1 && corpo && corpo.acao === 'resumir'){
    return resposta({ok:true, para:corpo.para, resumo: corpo.para === 'cliente'
      ? RESUMO_CLIENTE_FALSO : RESUMO_ESCRITORIO_FALSO}, 2400);
  }

  if(u.indexOf('/functions/v1/advogado') > -1){
    if(corpo.acao === 'ler'){
      DOCS.forEach(function(d){
        if(d.id === corpo.documento_id){
          d.analise = LEITURA_FALSA; d.analise_at = new Date().toISOString();
          d.tipo = LEITURA_FALSA.tipo_documento;
        }
      });
      return resposta({ok:true, analise:LEITURA_FALSA,
        uso:{entrada:38400, saida:1720, cache_lido:1180}}, 4200);
    }
    if(corpo.acao === 'minutar')
      return resposta({ok:true, peca:MINUTA_FALSA, fontes:FONTES_FALSAS,
        uso:{entrada:6200, saida:5840}}, 6000);

    var q = {id:novoId(), caso_id:corpo.caso_id || null, criado_at:new Date().toISOString(),
             pergunta:corpo.pergunta, resposta:RESPOSTA_FALSA, fontes:FONTES_FALSAS};
    CONSULTAS.unshift(q);
    return resposta({ok:true, resposta:RESPOSTA_FALSA, fontes:FONTES_FALSAS,
      uso:{entrada:4100, saida:1350, buscas:3}}, 3800);
  }

  if(u.indexOf('/functions/v1/agenda') > -1)
    return resposta({url:'https://demonstracao.supabase.co/functions/v1/agenda?u=exemplo-de-endereco-privado'}, 700);

  if(u.indexOf('/functions/v1/cnj') > -1){
    if(corpo && corpo.acao === 'andamento'){
      return resposta({
        ok:true, encontrado:true,
        classe:'Ação Trabalhista - Rito Ordinário',
        orgao:'3ª Vara do Trabalho de São Bernardo do Campo',
        movimentos: movimentosFalsos()
      }, 1400);
    }
    /* varredura: na segunda vez não acha nada, que é o normal do dia a dia */
    var jaVarreu = PUBS.some(function(p){ return p.id_cnj > 900000000; });
    if(!jaVarreu){
      PUBS.unshift({
        id_cnj:900000001, visto_em:new Date().toISOString(), disponibilizada:dia(0),
        tribunal:'TRT2', orgao:'4ª Vara do Trabalho de São Bernardo do Campo',
        classe:'Ação Trabalhista - Rito Ordinário', tipo:'Intimação',
        processo:'1002233-91.2026.5.02.0464', processo_num:'10022339120265020464',
        texto:'PODER JUDICIÁRIO  JUSTIÇA DO TRABALHO  TRIBUNAL REGIONAL DO TRABALHO DA 2ª REGIÃO  4ª VARA DO TRABALHO DE SÃO BERNARDO DO CAMPO  Fica V. Sa. intimado para, no prazo de 15 (quinze) dias, manifestar-se sobre o laudo pericial de insalubridade juntado aos autos.',
        link:'https://pje.trt2.jus.br/pjekz/validacao/26081411404873500000479999123',
        partes:[{nome:'CLEITON SOUZA BARBOSA', polo:'A'}],
        lida:false, caso_id:'d8'
      });
      return resposta({ok:true, achadas:6, novas:1}, 2000);
    }
    return resposta({ok:true, achadas:6, novas:0}, 1800);
  }

  if(u.indexOf('/functions/v1/triagem') > -1){
    var caso = acha(corpo.caso_id);
    if(caso){ caso.ia = analiseFalsa(caso); caso.ia_at = new Date().toISOString(); }
    /* demora de propósito: na vida real a IA leva alguns segundos */
    return resposta({ok:true}, 2600);
  }

  return real.apply(this, arguments);
};

/* ---------- websocket de mentira ----------
   O painel abre um websocket pro Supabase pra receber as mudanças na hora.
   Aqui ele não existe, então o dublê responde o aperto de mão do Phoenix e,
   depois que o WhatsApp está pareado, entrega uma mensagem "nova" — que é o
   momento de mostrar que a tela se move sozinha. */
var WSReal = window.WebSocket;
var ouvintesTR = [];
function emitirTR(tabela, tipo, linha){
  ouvintesTR.forEach(function(f){ try{ f(tabela, tipo, linha); }catch(e){} });
}

window.WebSocket = function(url){
  if(String(url).indexOf('demo.local') === -1 && String(url).indexOf('supabase.co') === -1)
    return new WSReal(url);

  var eu = this;
  this.readyState = 0;
  this.send = function(){};                      /* join e heartbeat: engole */
  this.close = function(){
    eu.readyState = 3;
    if(typeof eu.onclose === 'function') eu.onclose({});
  };

  function entrega(tabela, linha, tipo){
    if(typeof eu.onmessage !== 'function') return;
    eu.onmessage({data: JSON.stringify({
      event:'postgres_changes',
      payload:{data:{table:tabela, type:tipo || 'INSERT', record:linha}}
    })});
  }
  ouvintesTR.push(entrega);

  setTimeout(function(){
    eu.readyState = 1;
    if(typeof eu.onopen === 'function') eu.onopen({});

    /* espera o pareamento acontecer e então entrega a mensagem */
    var espera = setInterval(function(){
      if(WPP_SESSAO.estado !== 'conectado') return;
      clearInterval(espera);

      setTimeout(function(){
        var conv = null;
        CONVERSAS_WPP.forEach(function(c){ if(c.conversa_id === 'k2') conv = c; });
        var nova = {
          id: novoId(), conversa_id: 'k2', de_mim: false, tipo: 'texto',
          texto: 'Fui demitida semana passada e acho que não recebi tudo. Posso te explicar?',
          criado_at: new Date().toISOString(), entregue: true
        };
        (MSGS_WPP.k2 = MSGS_WPP.k2 || []).push(nova);
        if(conv){
          conv.ultima_at = nova.criado_at;
          conv.ultima_previa = nova.texto.slice(0,120);
          conv.nao_lidas = (conv.nao_lidas || 0) + 1;
        }
        entrega('mensagens_wpp', nova);
      }, 9000);
    }, 500);
  }, 260);
};
/* NÃO herdar de WSReal.prototype: lá `readyState`, `onopen` e `onmessage`
   são getters, e como este arquivo roda em modo estrito, atribuir a eles
   estoura TypeError — o painel cai calado no plano B e nada chega. */
for(var k in WSReal) if(Object.prototype.hasOwnProperty.call(WSReal, k)) window.WebSocket[k] = WSReal[k];
window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3;

/* ---------- avisos de que isto é uma demonstração ---------- */
document.addEventListener('DOMContentLoaded', function(){
  try{ localStorage.removeItem('sena_sessao'); }catch(e){}

  var e = document.getElementById('email'), s = document.getElementById('senha');
  if(e && !e.value) e.value = 'demonstracao@escritorio.adv.br';
  if(s && !s.value) s.value = 'demonstracao';

  var nota = document.createElement('p');
  nota.style.cssText = 'font-size:12.5px;color:#7A8399;text-align:center;margin-top:16px;line-height:1.45';
  nota.innerHTML = 'Versão de <b>demonstração</b>.<br>É só apertar Entrar — os casos são fictícios.';
  var form = document.getElementById('formEntrada');
  if(form) form.appendChild(nota);

  var fita = document.createElement('div');
  fita.textContent = 'DEMONSTRAÇÃO · dados fictícios';
  fita.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:90;background:#0F1E38;' +
    'color:#E0B959;font-size:10.5px;font-weight:600;letter-spacing:.12em;padding:8px 13px;' +
    'border-radius:999px;box-shadow:0 8px 24px rgba(10,22,40,.3);pointer-events:none';
  document.body.appendChild(fita);
});
})();
