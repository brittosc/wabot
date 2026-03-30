// Barra de lotação do ônibus por grupo

const updateCapacityCard = (targetGroup) => {
  const todayStr = moment().startOf("day").format("YYYY-MM-DD");
  const capacitySection = document.getElementById("capacitySection");
  const capacityList = document.getElementById("capacityList");
  const totalLabel = document.getElementById("totalBusVotes");
  capacityList.innerHTML = "";
  let totalVotes = 0;
  let hasAnyCapacity = false;
  const dayEntry = rawDB[todayStr] || { Version2: true, grupos: {} };
  const groupsToShow =
    targetGroup === "Todos"
      ? Object.keys(capacities)
      : capacities[targetGroup]
        ? [targetGroup]
        : [];
  groupsToShow.forEach((gName) => {
    let confirmations = 0;
    const groupData = dayEntry.grupos ? dayEntry.grupos[gName] : null;
    const votedCount =
      groupData && groupData.votes ? Object.keys(groupData.votes).length : 0;
    if (groupData && groupData.votes) {
      Object.values(groupData.votes).forEach((vData) => {
        const opt = typeof vData === "object" ? vData.option : vData;
        if (
          [
            "Irei, ida e volta.",
            "Irei, mas não retornarei.",
            "Não irei, apenas retornarei.",
          ].includes(opt)
        )
          confirmations++;
      });
    }
    const busIdx = targetGroups.indexOf(gName) + 1;
    const totalPassengers = passengers.filter(
      (p) => p.bus_number === busIdx,
    ).length;
    totalVotes += confirmations;
    renderCompactBar(
      gName,
      confirmations,
      capacities[gName],
      Math.max(0, totalPassengers - votedCount),
    );
    hasAnyCapacity = true;
  });
  capacitySection.style.display = hasAnyCapacity ? "block" : "none";
};

const renderCompactBar = (name, count, cap, pending) => {
  const capacityList = document.getElementById("capacityList");
  const percentage = Math.round(Math.min(100, (count / cap) * 100));
  const isFull = count >= cap;
  const excess = count > cap ? count - cap : 0;
  const busColors = [
    { grad: "linear-gradient(90deg, #2196f3, #4caf50)" },
    { grad: "linear-gradient(90deg, #9c27b0, #00bcd4)" },
    { grad: "linear-gradient(90deg, #fb8c00, #ffeb3b)" },
    { grad: "linear-gradient(90deg, #f44336, #e91e63)" },
    { grad: "linear-gradient(90deg, #3f51b5, #2196f3)" },
  ];
  const barGrad = isFull
    ? "linear-gradient(90deg, #f44336, #ff5252)"
    : busColors[Object.keys(capacities).indexOf(name) % busColors.length].grad;

  const container = document.createElement("div");
  container.style.marginBottom = "18px";
  const headerEl = document.createElement("div");
  headerEl.style.cssText =
    "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";
  const nameSpan = document.createElement("span");
  nameSpan.style.cssText =
    "font-size: 0.9rem; font-weight: 600; color: #fff; opacity: 0.9;";
  nameSpan.innerText = groupAliases[name] || name;
  const infoDiv = document.createElement("div");
  infoDiv.style.cssText =
    "font-size: 0.9rem; font-weight: 500; color: #888; text-align: right;";
  let statusText = percentage + "% / " + count + " Votos";
  if (excess > 0) statusText = "Excesso: +" + excess + " / " + count + " Votos";
  else if (count === cap) statusText = "Lotado! / " + count + " Votos";
  infoDiv.innerText = statusText;
  if (isFull) {
    infoDiv.style.color = "#ff5252";
    infoDiv.style.fontWeight = "700";
  }
  headerEl.appendChild(nameSpan);
  headerEl.appendChild(infoDiv);
  const progressContainer = document.createElement("div");
  progressContainer.style.cssText =
    "width: 100%; height: 8px; background: #222; border-radius: 4px; overflow: visible;";
  const progressBar = document.createElement("div");
  progressBar.style.cssText =
    "height: 100%; background: " +
    barGrad +
    "; border-radius: 4px; transition: width 1s cubic-bezier(0.4, 0, 0.2, 1); position: relative;";
  progressBar.style.width = percentage + "%";
  progressContainer.appendChild(progressBar);
  container.appendChild(headerEl);
  container.appendChild(progressContainer);
  capacityList.appendChild(container);
};
