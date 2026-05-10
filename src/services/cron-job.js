const cron = require("node-cron");
const moment = require("moment-timezone");
const { Poll } = require("whatsapp-web.js");
const dashboard = require("./dashboard");
const configService = require("./configService");
const supabase = require("../database/supabaseClient");

const INFO_MESSAGE = `Prezados alunos, 

Informamos que o registro de participação na enquete disponibilizada no grupo é *OBRIGATÓRIO*, uma vez que ela constitui a relação oficial de passageiros do transporte. Mesmo que você não vá a faculdade, participe e selecione a opção que representa a sua situação para que a lista esteja correta.

Solicitamos que a confirmação seja realizada *sem falta, impreterivelmente até as 18h*. As manifestações efetuadas após esse horário *NÃO SERÃO* consideradas para fins de composição da lista de passageiros, em razão da necessidade de observância dos procedimentos administrativos e das exigências legais aplicáveis ao serviço de transporte.

Contamos com a colaboração de todos para o adequado funcionamento do serviço.`;

let isSending = false;

const getDaysOfWeekDesc = (dayNumber) => {
  const days = [
    "domingo",
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
  ];
  return days[dayNumber];
};

/**
 * Verifica no Supabase se as enquetes já foram enviadas na data informada.
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {string} groupName - Nome do grupo
 * @returns {Promise<boolean>}
 */
const hasSentToday = async (dateStr, groupName) => {
  const { data, error } = await supabase
    .from("poll_history")
    .select("poll_date")
    .eq("poll_date", dateStr)
    .eq("group_name", groupName)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
};

/**
 * Registra no Supabase que as enquetes foram enviadas na data informada.
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 * @param {string} groupName - Nome do grupo
 */
const markAsSent = async (dateStr, groupName) => {
  const { error } = await supabase
    .from("poll_history")
    .upsert(
      { poll_date: dateStr, group_name: groupName },
      { onConflict: "poll_date, group_name" },
    );

  if (error) throw error;
};

const sendPolls = async (sock) => {
  if (isSending) {
    dashboard.addLog("Tentativa de envio ignorada: processo já em andamento.");
    return;
  }
  isSending = true;
  try {
    const config = configService.getConfig();

    const now = moment().tz("America/Sao_Paulo");
    const todayStr = now.format("YYYY-MM-DD");
    const todayBR = now.format("DD/MM/YYYY");
    const dayOfWeek = now.day();

    const ignoreWeekend = process.argv.includes("--fim");
    const forceNow = process.argv.includes("--now");
    const skipDates = config.skipDates || {};

    // Verifica datas ignoradas via config
    if (skipDates[todayBR] && !forceNow) {
      dashboard.addLog(
        `Data ignorada via config (${todayBR}): ${skipDates[todayBR]}. Nenhuma enquete programada.`,
      );
      return;
    }

    // Ignora fins de semana (1-5 = segunda a sexta)
    if ((dayOfWeek === 0 || dayOfWeek === 6) && !ignoreWeekend && !forceNow) {
      dashboard.addLog("Fim de semana. Nenhuma enquete programada para envio.");
      return;
    }

    dashboard.addLog("Iniciando o envio de enquetes...");

    const chats = await sock.getChats();
    const allGroups = chats.filter((c) => c.isGroup);

    const targetGroupNames = config.targetGroups || [];
    let sentCount = 0;

    for (const targetName of targetGroupNames) {
      // Verifica no Supabase se já foi enviado para ESTE grupo hoje
      const alreadySent = await hasSentToday(todayStr, targetName);
      if (alreadySent && !forceNow) {
        dashboard.addLog(`Enquete já enviada hoje para o grupo ${targetName}. Pulando.`);
        continue;
      }

      const group = allGroups.find((g) => g.name === targetName);
      if (group) {
        const ptDay = getDaysOfWeekDesc(dayOfWeek);
        const dateStr = now.format("DD/MM");
        const pollName = `Bom dia. Você irá hoje, ${ptDay}, ${dateStr}?`;

        try {
          const poll = new Poll(
            pollName,
            [
              "Irei, ida e volta.",
              "Irei, mas não retornarei.",
              "Não irei, apenas retornarei.",
              "Não irei à faculdade hoje.",
            ],
            { allowMultipleAnswers: false },
          );

          await group.sendMessage(poll);
          await group.sendMessage(INFO_MESSAGE);

          if (dayOfWeek === 5) {
            await group.sendMessage(
              "Se possível, *votem até as 14h00m*, para que o motorista consiga se organizar com antecedência quanto à ida de um ou dois veículos.",
            );
          }

          // Registra no Supabase o envio individual para este grupo
          await markAsSent(todayStr, targetName);

          dashboard.addLog(`Enquete enviada para o grupo: ${targetName}`);
          dashboard.incrementTotalSent();
          sentCount++;
        } catch (sendErr) {
          dashboard.addLog(
            `Erro ao enviar para o grupo ${targetName}: ${sendErr.message}`,
          );
        }
      } else {
        dashboard.addLog(`Grupo não encontrado na lista: ${targetName}`);
      }
    }

    if (sentCount > 0) {
      dashboard.addLog(`Envios do dia ${todayStr} concluídos com sucesso!`);
    } else {
      dashboard.addLog(
        "Nenhuma enquete foi enviada (nenhum grupo válido encontrado ou já enviados hoje).",
      );
    }
  } catch (error) {
    dashboard.addLog(`Erro no cronJob: ${error.message}`);
  } finally {
    isSending = false;
  }
};

const weatherService = require("./weather");

const scheduleJob = (sock) => {
  const config = configService.getConfig();
  const time = config.pollTime || "05:30";
  const [hour, minute] = time.split(":");
  const targetHour = parseInt(hour, 10);
  const targetMinute = parseInt(minute, 10);

  // Cron "* * * * *" com verificação manual de horário via moment-timezone.
  cron.schedule("* * * * *", () => {
    const now = moment().tz("America/Sao_Paulo");
    
    // Envio de enquetes
    if (now.hours() === targetHour && now.minutes() === targetMinute) {
      sendPolls(sock);
    }

    // Atualização de clima às 00:00, 06:00, 12:00, 18:00
    const h = now.hours();
    const m = now.minutes();
    if (m === 0 && [0, 6, 12, 18].includes(h)) {
      weatherService.updateWeather();
    }
  });

  // Atualiza o display de próxima enquete a cada minuto via setInterval nativo
  updateNextPollDisplay(hour, minute);
  setInterval(() => {
    updateNextPollDisplay(hour, minute);
  }, 60_000);
};

const updateNextPollDisplay = (targetHour, targetMinute) => {
  const config = configService.getConfig();
  const skipDates = config.skipDates || {};

  const now = moment().tz("America/Sao_Paulo");
  let nextDate = moment()
    .tz("America/Sao_Paulo")
    .hours(targetHour)
    .minutes(targetMinute)
    .seconds(0);

  // Se o horário já passou hoje, avança para o próximo dia
  if (now.isAfter(nextDate) || now.isSame(nextDate)) {
    nextDate.add(1, "days");
  }

  const ignoreWeekend = process.argv.includes("--fim");

  // Busca o próximo dia válido (ignorando fins de semana e datas puladas)
  let isDayValid = false;
  while (!isDayValid) {
    const isWeekend =
      !ignoreWeekend && (nextDate.day() === 0 || nextDate.day() === 6);
    const isSkipDate = !!skipDates[nextDate.format("DD/MM/YYYY")];

    if (isWeekend || isSkipDate) {
      nextDate.add(1, "days");
    } else {
      isDayValid = true;
    }
  }

  const formatDiffStr = () => {
    const duration = moment.duration(
      nextDate.diff(moment().tz("America/Sao_Paulo")),
    );
    const d = Math.floor(duration.asDays());
    const h = duration.hours();
    const m = duration.minutes();
    return `${d}d ${h}h ${m}m`;
  };

  dashboard.setNextPoll(
    `${nextDate.format("DD/MM/YYYY HH:mm")} (em ${formatDiffStr()})`,
  );
};

/**
 * Verifica se já passou do horário de envio hoje e se a enquete já foi disparada.
 * Caso tenha passado e não tenha sido enviada, dispara agora.
 * @param {object} sock - Cliente do WhatsApp
 */
const checkMissedSends = async (sock) => {
  const config = configService.getConfig();
  const time = config.pollTime || "05:30";
  const [hour, minute] = time.split(":").map(Number);

  const now = moment().tz("America/Sao_Paulo");
  const targetTime = moment()
    .tz("America/Sao_Paulo")
    .hours(hour)
    .minutes(minute)
    .seconds(0);

  // Só dispara se estivermos pelo menos 2 minutos atrasados.
  // Isso evita corrida com o cron regular se o bot inicializar exatamente no minuto do envio.
  if (now.isAfter(targetTime.clone().add(2, "minutes"))) {
    dashboard.addLog("Verificando se houve envio pendente para hoje.");
    await sendPolls(sock);
  }
};

/**
 * Sincroniza o total de enquetes enviadas com o histórico do Supabase.
 */
const syncTotalSent = async () => {
  try {
    // Agora cada linha em poll_history representa um envio individual para um grupo
    const { count, error } = await supabase
      .from("poll_history")
      .select("*", { count: "exact", head: true });

    if (error) throw error;

    const totalHistorical = count || 0;
    dashboard.setTotalSent(totalHistorical);
  } catch (err) {
    dashboard.addLog(`Erro ao sincronizar histórico: ${err.message}`);
  }
};

module.exports = { scheduleJob, sendPolls, checkMissedSends, syncTotalSent };
