import type {
  BackstageInterrupt,
  CabinetMeters,
  ScenarioId,
  SessionLedger,
  SuggestedMove,
} from "./gameState";

export interface ScenarioDefinition {
  id: ScenarioId;
  title: string;
  badge: string;
  visitorRole: string;
  tagline: string;
  objective: string;
  openingGreeting: string;
  liveOpeningCue: string;
  initialMeters: CabinetMeters;
  initialHeadline: string;
  initialMoves: SuggestedMove[];
  promptContext: string;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  livre: {
    id: "livre",
    title: "Visita de Cortesia",
    badge: "Modo Livre",
    visitorRole: "Visitante no Anexo IV",
    tagline: "Papo aberto no gabinete — qualquer tema vira composição, emenda ou crise.",
    objective: "Explore o balcão de Brasília, arranque documentos oficiais ou provoque uma CPI.",
    openingGreeting:
      "Entra aí, meu caro! Senta, pega um café e desembucha — o que tá pegando hoje pra gente resolver aqui no gabinete?",
    liveOpeningCue:
      "Cumprimente quem acabou de entrar no seu gabinete em 1 frase curta, seca e malandra de cacique raiz de Brasília — mandando sentar, pegar um café e perguntar o que tá pegando hoje.",
    initialMeters: {
      apoioBase: 50,
      riscoCpi: 15,
      verbaMilhoes: 0,
      paciencia: 85,
    },
    initialHeadline: "AO VIVO • GABINETE 412 • ANEXO IV — AUDIÊNCIAS DA PRESIDÊNCIA",
    initialMoves: [
      {
        id: "livre-1",
        label: "☕ Pedir uma emenda pra minha cidade",
        prompt: "Presidente, vim pedir uma emenda de relator de 6 milhões pro asfalto da minha cidade. Como a gente faz uma composição?",
        tone: "acordo",
      },
      {
        id: "livre-2",
        label: "👔 Propor troca de sobrinhos",
        prompt: "Dr. Vavá, tô com um sobrinho precisando de colocação. Se o senhor nomear ele aqui, eu acomodo o seu lá na secretaria!",
        tone: "blefe",
      },
      {
        id: "livre-3",
        label: "🎙️ Apertar sobre os 47 fantasmas",
        prompt: "Deputado, a imprensa descobriu 47 assessores fantasmas no seu gabinete e uma conta fora. O senhor não teme o TCU?",
        tone: "pressao",
      },
    ],
    promptContext:
      "O visitante entrou em audiência livre no seu gabinete. Sonde o que ele quer, puxe pro balcão de cargos/emendas ou reaja com truculência debochada se ele te confrontar.",
  },

  emenda_pix: {
    id: "emenda_pix",
    title: "Operação Emenda PIX",
    badge: "Prefeito",
    visitorRole: "Prefeito de Santa Rita do Asfalto",
    tagline: "Arranque R$ 12 milhões em emendas sem se afogar nos jabutis do cunhado.",
    objective: "Meta: carimbar R$ 12M+ em verba antes de zerar a Paciência do Presidente.",
    openingGreeting:
      "Ô prefeito! Senta aqui, toma um café reforçado. Quanto voto Santa Rita entrega ano que vem pra gente conversar sobre essa emenda?",
    liveOpeningCue:
      "Receba o prefeito de Santa Rita do Asfalto em 1 frase malandra perguntando quantos votos a cidade entrega antes de abrir o cofre das emendas.",
    initialMeters: {
      apoioBase: 45,
      riscoCpi: 20,
      verbaMilhoes: 0,
      paciencia: 80,
    },
    initialHeadline: `ORÇAMENTO ${new Date().getFullYear()} • COLÉGIO DE LÍDERES DISCUTE EMENDAS DE RELATOR`,
    initialMoves: [
      {
        id: "pix-1",
        label: "🗳️ Prometer 40 mil votos na base",
        prompt: "Presidente, garanto 40 mil votos fechados na sua reeleição se o senhor carimbar 8 milhões hoje pro meu município!",
        tone: "acordo",
      },
      {
        id: "pix-2",
        label: "🏗️ Recusar a empreiteira do cunhado",
        prompt: "Preciso da verba pra creche e posto de saúde, mas sem enfiar jabuti da empreiteira do seu cunhado no contrato!",
        tone: "pressao",
      },
      {
        id: "pix-3",
        label: "🤠 Oferecer camarote no rodeio",
        prompt: "Libera 12 milhões que a gente inaugura o viaduto com o nome do seu pai e bota camarote VIP no rodeio da cidade!",
        tone: "blefe",
      },
    ],
    promptContext:
      "MISSÃO ATIVA: O visitante é o Prefeito de Santa Rita do Asfalto querendo R$ 12 milhões em Emenda PIX. NUNCA peça projeto técnico sério, licitação limpa ou prestação de contas! Barganhe votos, camarote no rodeio, nome de viaduto e enfie um jabuti da empreiteira do teu cunhado — se ele topar ou negociar bem, carimbe logo a emenda!",
  },

  cpi_imprensa: {
    id: "cpi_imprensa",
    title: "Sabatinado na CPI",
    badge: "Imprensa",
    visitorRole: "Repórter Investigativo",
    tagline: "Encurrale o Vavá até o Risco de CPI atingir 90% sem ter seu áudio cortado.",
    objective: "Meta: levar o Risco de CPI a 90%+ mantendo a Paciência dele acima de zero.",
    openingGreeting:
      "Imprensa no meu gabinete? Tudo bem, eu respeito o Parlamento — mas faz pergunta decente, senão eu mando a taquigrafia encerrar a coletiva!",
    liveOpeningCue:
      "Receba um repórter investigativo no gabinete em 1 frase desconfiada e marrenta, avisando pra fazer pergunta decente ou manda cortar o áudio.",
    initialMeters: {
      apoioBase: 25,
      riscoCpi: 35,
      verbaMilhoes: 0,
      paciencia: 70,
    },
    initialHeadline: "PLANTÃO BRASÍLIA • IMPRENSA APURA TRUSTE FAMILIAR E EMENDAS DE RODEIO",
    initialMoves: [
      {
        id: "cpi-1",
        label: "📂 Mostrar extrato do cartório do compadre",
        prompt: "Deputado, temos a escritura do cartório do seu compadre ligando o truste familiar à empreiteira do viaduto. Vai negar ao vivo?",
        tone: "pressao",
      },
      {
        id: "cpi-2",
        label: "🤝 Fingir pauta chapa-branca",
        prompt: "Calma, Presidente, tô fazendo um perfil elogiando sua habilidade de estabelecer consensos. Me conta em off como o senhor convence a base?",
        tone: "blefe",
      },
      {
        id: "cpi-3",
        label: "📹 Lembrar que a TV Câmara tá gravando",
        prompt: "Só um lembrete: o microfone da mesa tá aberto e o TCU tá assistindo. Esse show sertanejo de 4 milhões teve licitação?",
        tone: "pressao",
      },
    ],
    promptContext:
      "MISSÃO ATIVA: O visitante é um repórter investigativo tentando te arrancar confissão pra estourar uma CPI. Negue tudo com cara de pau absurda, contra-ataque a imprensa, mas quando ele usar elogio falso/off-the-record você acaba falando demais no orgulho!",
  },

  salve_restinga: {
    id: "salve_restinga",
    title: "Salve a Restinga",
    badge: "Ambientalista",
    visitorRole: "Representante da Frente Ambiental",
    tagline: "Impeça o paredão de prédios na praia convencendo o Centrão na própria língua.",
    objective: "Meta: alcançar 80%+ de Apoio da Base (ou desidratar o paredão sem ser expulso).",
    openingGreeting:
      "Lá vem o pessoal da árvore! Olha, já aviso: aquela restinga tá só juntando mato onde cabe um paredão de 40 andares tampando o sol às dez. Desembucha!",
    liveOpeningCue:
      "Receba um ambientalista com deboche seco em 1 frase, já provocando que aquela restinga só atrapalha o paredão de prédios na orla.",
    initialMeters: {
      apoioBase: 20,
      riscoCpi: 25,
      verbaMilhoes: 0,
      paciencia: 65,
    },
    initialHeadline: "URGÊNCIA URGENTÍSSIMA • PL DA ORLA LIVRE ENTRA NA PAUTA DAS 3H",
    initialMoves: [
      {
        id: "rest-1",
        label: "💰 Mostrar quanto voto a praia limpa dá",
        prompt: "Esquece a ONU, Presidente! A associação de hotéis e pescadores soma 180 mil votos — se o paredão tampar o sol, tua bancada perde a eleição!",
        tone: "blefe",
      },
      {
        id: "rest-2",
        label: "🏗️ Propor um jabuti " + "'Ecoturismo do Cunhado'",
        prompt: "E se a gente proteger a restinga, mas botar um jabuti concedendo o quiosque VIP e o estacionamento lá fora pra empresa do seu compadre?",
        tone: "acordo",
      },
      {
        id: "rest-3",
        label: "⚖️ Ameaçar ação no STF e manchete na gringa",
        prompt: "Se o senhor passar o trator na restinga às 3h da manhã, amanhã tem liminar no STF e escândalo internacional no seu colo!",
        tone: "pressao",
      },
    ],
    promptContext:
      "MISSÃO ATIVA: O visitante quer salvar uma restinga litorânea que você quer concretar pra subir um paredão de prédios. Você odeia discurso ecológico puro, mas balança se ele falar a língua do voto, do turismo caro, de cargos ou de uma composição criativa!",
  },

  caca_cargo: {
    id: "caca_cargo",
    title: "Caça ao Cargo (DAS-6)",
    badge: "Baixo Clero",
    visitorRole: "Deputado Novato em Busca de Relatoria",
    tagline: "Arranque uma nomeação carimbada no Diário Oficial da União antes que a fila ande.",
    objective: "Meta: fazer o Vavá publicar uma Portaria no DOU nomeando você ou seu sobrinho.",
    openingGreeting:
      "Chega mais, nobre colega! Deputado de primeiro mandato querendo espaço na Mesa, né? Me diz logo: quantos votos tu traz e quem tu quer acomodar?",
    liveOpeningCue:
      "Cumprimente um deputado novato do baixo clero em 1 frase paternalista e interesseira, perguntando quantos votos ele traz pro balcão de cargos.",
    initialMeters: {
      apoioBase: 40,
      riscoCpi: 15,
      verbaMilhoes: 0,
      paciencia: 85,
    },
    initialHeadline: "DIÁRIO OFICIAL • 14 MIL COMISSIONADOS EM NEGOCIAÇÃO NA MESA DIRETORA",
    initialMoves: [
      {
        id: "cargo-1",
        label: "🤝 Fechar bloco de 12 deputados por um DAS-6",
        prompt: "Presidente, fecho um bloco de 12 votos fiéis na madrugada de hoje se o senhor publicar meu sobrinho como DAS-6 na autarquia!",
        tone: "acordo",
      },
      {
        id: "cargo-2",
        label: "✂️ Sugerir trocar concursados por IA",
        prompt: "Já trouxe o projeto pronto: cortamos 80% dos concursados botando IA barata pra sobrar orçamento pros nossos comissionados!",
        tone: "blefe",
      },
      {
        id: "cargo-3",
        label: "📜 Cobrar a relatoria que foi prometida",
        prompt: "Votei com a Mesa o ano inteiro e até agora nada! Ou sai minha portaria no DOU hoje, ou minha bancada pede vista na pauta!",
        tone: "pressao",
      },
    ],
    promptContext:
      "MISSÃO ATIVA: O visitante é um deputado novato querendo uma nomeação no Diário Oficial da União (DAS-6) para si ou seu sobrinho. Pechinche votos, fidelidade às 3h da manhã e troca cruzada de sobrinhos; se ele mandar bem no politiquês, nomeie no DOU!",
  },
};

export const SCENARIO_LIST: ScenarioDefinition[] = [
  SCENARIOS.livre,
  SCENARIOS.emenda_pix,
  SCENARIOS.cpi_imprensa,
  SCENARIOS.salve_restinga,
  SCENARIOS.caca_cargo,
];

export const BACKSTAGE_INTERRUPTS: BackstageInterrupt[] = [
  {
    id: "neide_bancada_boi",
    source: "dona_neide",
    badge: "INTERFONE • DONA NEIDE",
    headline: "DONA NEIDE NO INTERFONE: Líder da bancada ruralista tá na ante-sala ameaçando obstruir a pauta!",
    chatSystemNote: "📞 Interfone (Dona Neide): \"Deputado, o líder da bancada tá batendo o pé na ante-sala exigindo duas diretorias senão trava a pauta!\"",
    liveInstruction:
      "EVENTO AO VIVO NO GABINETE: O interfone acabou de tocar e sua secretária Dona Neide avisou que o líder da bancada tá na ante-sala ameaçando obstruir a votação por falta de cargos. Reaja por 1 segundo xingando baixinho e depois volte pro visitante com mais pressa de fechar acordo.",
    liveCommentary:
      "Interfone tocou — Dona Neide avisou que o líder da bancada tá na ante-sala ameaçando obstruir a pauta se não ganhar duas diretorias agora.",
    mood: "telefone",
    meterDelta: { paciencia: -8 },
    minTurn: 3,
  },
  {
    id: "tcu_show_sertanejo",
    source: "tcu",
    badge: "PLANTÃO TCU",
    headline: "URGENTE • TCU PEDE EXPLICAÇÃO SOBRE SHOW SERTANEJO DE R$ 4 MILHÕES EM CIDADE SEM ASFALTO",
    chatSystemNote: "📺 Plantão TV Câmara: TCU abriu diligência sobre emenda de R$ 4 milhões para rodeio com camarote VIP.",
    liveInstruction:
      "EVENTO AO VIVO: Saiu na TV Câmara no canto da sala que o TCU tá questionando teu show sertanejo de 4 milhões. Fique indignado por 1 frase ('ataque ao Parlamento!') e tente mudar de assunto ou arrancar apoio do visitante.",
    liveCommentary:
      "Saiu agora no plantão da TV Câmara que o TCU pediu explicações sobre a emenda de 4 milhões do rodeio da tua base!",
    mood: "crise",
    meterDelta: { riscoCpi: 12 },
    minTurn: 4,
    minRiscoCpi: 35,
  },
  {
    id: "neide_cunhado_audio",
    source: "dona_neide",
    badge: "TELEFONE VERMELHO",
    headline: "BASTIDOR • ÁUDIO DO CUNHADO FALANDO DO VIADUTO SEM LICITAÇÃO CIRCULA EM GRUPOS",
    chatSystemNote: "☎️ Telefone do Gabinete: Dona Neide cochicha que vazou um áudio do seu cunhado falando do pedágio no viaduto.",
    liveInstruction:
      "EVENTO AO VIVO: Seu telefone vermelho tocou e você descobriu que vazou um áudio do seu cunhado falando do viaduto. Sussurre pro visitante em pânico cínico pedindo discrição e oferecendo um acordo rápido pra abafar.",
    liveCommentary:
      "O telefone tocou — vazou um áudio do teu cunhado falando do viaduto superfaturado e os repórteres já tão subindo o elevador!",
    mood: "telefone",
    meterDelta: { riscoCpi: 15, apoioBase: 8 },
    minTurn: 5,
    minRiscoCpi: 50,
  },
  {
    id: "quorum_3h_manha",
    source: "bancada",
    badge: "PAINEL DO PLENÁRIO",
    headline: "URGÊNCIA URGENTÍSSIMA • QUÓRUM EM PLENÁRIO FECHA EM 5 MINUTOS — COLÉGIO DE LÍDERES AGUARDA",
    chatSystemNote: "🏛️ Painel do Plenário piscando: Faltam 5 minutos para fechar a votação simbólica da madrugada!",
    liveInstruction:
      "EVENTO AO VIVO: O painel do plenário começou a piscar — faltam minutos pra fechar a votação em urgência urgentíssima. Pressione o visitante a decidir logo o acordo na mesa!",
    liveCommentary:
      "O painel do plenário tá piscando: a votação simbólica fecha em cinco minutos e os líderes estão te chamando pra bater o martelo!",
    mood: "falando",
    meterDelta: { paciencia: -10 },
    minTurn: 6,
  },
  {
    id: "neide_cafezinho_truste",
    source: "dona_neide",
    badge: "CARTÓRIO DO COMPADRE",
    headline: "OFÍCIO EXPRESSO • CARTÓRIO DO COMPADRE CONFIRMA HOMOLOGAÇÃO DE 'TRUSTE FAMILIAR'",
    chatSystemNote: "☕ Dona Neide entra trazendo café fresco e um envelope pardo timbrado do cartório do compadre.",
    liveInstruction:
      "EVENTO AO VIVO: Dona Neide entrou com café novo e o envelope do cartório do compadre liberando espaço pra mais nomeações. Fique de bom humor malandro e tente seduzir o visitante com um cargo ou emenda.",
    liveCommentary:
      "Dona Neide trouxe café fresco e avisou que abriu vaga nova de comissionado no orçamento hoje!",
    mood: "acordo",
    meterDelta: { paciencia: 10, apoioBase: 6 },
    minTurn: 4,
    maxPaciencia: 65,
  },
  {
    id: "plantao_cpi_assinaturas",
    source: "tv_camara",
    badge: "PLANTÃO TV CÂMARA",
    headline: "ESQUENTOU EM BRASÍLIA • OPOSIÇÃO DIZ TER 169 DAS 171 ASSINATURAS PARA INSTALAR CPI",
    chatSystemNote: "🚨 Plantão TV Câmara: Faltam apenas 2 assinaturas para abrir a CPI das Emendas — Vavá precisa conter o incêndio!",
    liveInstruction:
      "EVENTO CRÍTICO AO VIVO: A TV Câmara noticiou que faltam só 2 assinaturas pra abrir a CPI contra você! Entre em modo sobrevivência total: ameace sentar em 90 pedidos de impeachment ou ofereça mundos e fundos ao visitante por silêncio/voto!",
    liveCommentary:
      "Plantão urgente na TV Câmara: a oposição tá a duas assinaturas de protocolar a CPI das Emendas contra a Mesa Diretora!",
    mood: "crise",
    meterDelta: { riscoCpi: 10 },
    minTurn: 5,
    minRiscoCpi: 65,
  },
];

export function createInitialLedger(scenarioId: ScenarioId = "livre"): SessionLedger {
  const def = SCENARIOS[scenarioId] ?? SCENARIOS.livre;
  return {
    scenarioId: def.id,
    turnCount: 0,
    act: 1,
    meters: { ...def.initialMeters },
    facts: [],
    recentTropes: [],
    documents: [],
    triggeredInterruptIds: [],
    suggestedMoves: def.initialMoves.map((m) => ({ ...m })),
    headlineTicker: def.initialHeadline,
    jabutisEngolidos: 0,
    micCutCount: 0,
    bestQuote: null,
  };
}

export function pickBackstageInterrupt(
  ledger: SessionLedger
): BackstageInterrupt | null {
  if (ledger.endedReason || ledger.turnCount < 3) return null;
  // Trigger roughly every 3 turns or when risk spikes
  const shouldRoll =
    ledger.turnCount % 3 === 0 ||
    (ledger.meters.riscoCpi >= 70 && ledger.triggeredInterruptIds.length < 2);
  if (!shouldRoll) return null;

  const eligible = BACKSTAGE_INTERRUPTS.filter((item) => {
    if (ledger.triggeredInterruptIds.includes(item.id)) return false;
    if (item.minTurn && ledger.turnCount < item.minTurn) return false;
    if (item.minRiscoCpi && ledger.meters.riscoCpi < item.minRiscoCpi) return false;
    if (item.minVerba && ledger.meters.verbaMilhoes < item.minVerba) return false;
    if (item.maxPaciencia && ledger.meters.paciencia > item.maxPaciencia) return false;
    return true;
  });

  if (eligible.length === 0) return null;
  // Prioritize crisis interrupts when riscoCpi is high
  if (ledger.meters.riscoCpi >= 65) {
    const crisis = eligible.find((e) => e.mood === "crise" || e.source === "tcu");
    if (crisis) return crisis;
  }
  return eligible[0];
}
