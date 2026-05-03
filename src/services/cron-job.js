const cron = require("node-cron");
const moment = require("moment-timezone");
const { Poll } = require("whatsapp-web.js");
const dashboard = require("./dashboard");
const configService = require("./configService");
const supabase = require("../database/supabaseClient");

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
 * @returns {Promise<boolean>}
 */
const hasSentToday = async (dateStr) => {
  const { data, error } = await supabase
    .from("poll_history")
    .select("poll_date")
    .eq("poll_date", dateStr)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
};

/**
 * Registra no Supabase que as enquetes foram enviadas na data informada.
 * @param {string} dateStr - Data no formato YYYY-MM-DD
 */
const markAsSent = async (dateStr) => {
  const { error } = await supabase
    .from("poll_history")
    .upsert({ poll_date: dateStr }, { onConflict: "poll_date" });

  if (error) throw error;
};

const sendPolls = async (sock) => {
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

    // Verifica no Supabase se já foi enviado hoje
    const alreadySent = await hasSentToday(todayStr);
    if (alreadySent && !forceNow) {
      dashboard.addLog(`Enquete já enviada hoje (${todayStr}). Pulando.`);
      return;
    }

    dashboard.addLog("Iniciando o envio de enquetes...");

    const chats = await sock.getChats();
    const allGroups = chats.filter((c) => c.isGroup);

    const targetGroupNames = config.targetGroups || [];
    let sentCount = 0;

    for (const targetName of targetGroupNames) {
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

          if (dayOfWeek === 5) {
            await group.sendMessage(
              "Se possível, *votem até as 14h00m*, para que o motorista consiga se organizar com antecedência quanto à ida de um ou dois veículos.",
            );
          }

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
      // Registra no Supabase que o envio foi realizado hoje
      await markAsSent(todayStr);
      dashboard.addLog(`Envios do dia ${todayStr} registrados com sucesso!`);
    } else {
      dashboard.addLog(
        "Nenhuma enquete foi enviada (nenhum grupo válido encontrado).",
      );
    }
  } catch (error) {
    dashboard.addLog(`Erro no cronJob: ${error.message}`);
  }
};

const scheduleJob = (sock) => {
  const config = configService.getConfig();
  const time = config.pollTime || "05:30";
  const [hour, minute] = time.split(":");

  // Cron principal: dispara apenas no horário exato de envio
  cron.schedule(`${minute} ${hour} * * *`, () => {
    sendPolls(sock);
  }, { timezone: "America/Sao_Paulo" });

  // Atualiza o display de próxima enquete a cada minuto via setInterval nativo
  // (não usa node-cron para evitar o aviso de "Possible Blocking IO")
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

  if (now.isAfter(targetTime)) {
    dashboard.addLog("Verificando se houve envio pendente para hoje.");
    await sendPolls(sock);
  }
};

module.exports = { scheduleJob, sendPolls, checkMissedSends };
