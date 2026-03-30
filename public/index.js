const formatUptime = (ms) => {
  if (!ms) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  let parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
};

const formatColor = (bar, percentage) => {
  if (percentage < 60) bar.style.backgroundColor = "var(--success-color)";
  else if (percentage < 85)
    bar.style.backgroundColor = "var(--warning-color)";
  else bar.style.backgroundColor = "var(--danger-color)";
};

const formatBandwidth = (bytesPerSec) => {
  if (bytesPerSec < 1024) return bytesPerSec.toFixed(1) + " B/s";
  if (bytesPerSec < 1024 * 1024)
    return (bytesPerSec / 1024).toFixed(2) + " KB/s";
  if (bytesPerSec < 1024 * 1024 * 1024)
    return (bytesPerSec / 1024 / 1024).toFixed(2) + " MB/s";
  return (bytesPerSec / 1024 / 1024 / 1024).toFixed(2) + " GB/s";
};

const renderNetworkUsage = (networkUsage) => {
  if (!networkUsage) return;
  document.getElementById("rxSpeedTxt").innerText = formatBandwidth(
    networkUsage.rxSpeed,
  );
  document.getElementById("txSpeedTxt").innerText = formatBandwidth(
    networkUsage.txSpeed,
  );
};

const fetchMcInfo = async () => {
  try {
    const res = await fetch("/api/mcstatus");
    if (!res.ok) return;

    const data = await res.json();
    const statusText = document.getElementById("mcStatusText");
    const playersText = document.getElementById("mcPlayersText");
    const playersBar = document.getElementById("mcPlayersBar");
    const versionText = document.getElementById("mcVersionText");
    const motdText = document.getElementById("mcMotdText");
    const playersList = document.getElementById("mcPlayersList");
    const mapText = document.getElementById("mcMapText");
    const pluginsText = document.getElementById("mcPluginsText");
    const pluginsCount = document.getElementById("mcPluginsCount");

    if (data.online) {
      statusText.innerText = "Online";
      statusText.style.color = "var(--success-color)";

      playersText.innerText = `${data.players.online} / ${data.players.max}`;
      const percentage =
        data.players.max > 0
          ? (data.players.online / data.players.max) * 100
          : 0;
      playersBar.style.width = `${percentage}%`;

      versionText.innerText = data.version || "--";
      mapText.innerText = data.map || "world";
      motdText.innerText = data.motd || "--";

      const pluginsList =
        data.plugins && data.plugins.length > 0
          ? data.plugins
              .map((p) => {
                let name = typeof p === "string" ? p : p.name || "Plugin";
                // Remove a versão (geralmente tudo após o primeiro espaço ou padrões como v1.0)
                return name
                  .split(" ")[0]
                  .replace(/v\d+\..*/, "")
                  .trim();
              })
              .join(", ")
          : "--";

      pluginsText.innerText = pluginsList;
      pluginsCount.innerText = data.plugins ? data.plugins.length : "0";

      // Uptime e World
      document.getElementById("mcUptime").innerText = formatUptime(
        data.uptime,
      );
      document.getElementById("mcWorldTime").innerText = data.world
        ? data.world.combined
        : "--";

      if (data.players.list && data.players.list.length > 0) {
        playersList.style.display = "flex";
        playersList.innerHTML =
          '<span class="metric-title" style="margin-bottom: 5px;">Jogadores Conectados:</span>';
        data.players.list.forEach((name) => {
          playersList.innerHTML += `
            <div class="network-badge" style="border-left-color: var(--accent); padding: 5px 10px; flex-direction: row; align-items: center; gap: 10px;">
              <img src="https://minotar.net/helm/${name}/24.png" alt="${name}" style="border-radius: 4px; width: 24px; height: 24px;">
              <span class="net-ip" style="font-size: 0.9rem;">${name}</span>
            </div>
          `;
        });
      } else {
        playersList.style.display = "none";
      }
    } else {
      statusText.innerText = "Offline";
      statusText.style.color = "var(--danger-color)";
      playersText.innerText = "-- / --";
      playersBar.style.width = "0%";
      versionText.innerText = "--";
      mapText.innerText = "--";
      pluginsCount.innerText = "0";
      pluginsText.innerText = "--";
      motdText.innerText = data.error || "Servidor indisponível";
      playersList.style.display = "none";
    }
  } catch (err) {
    console.error("Erro ao buscar info do MC:", err);
  }
};

const fetchSysInfo = async () => {
  try {
    const res = await fetch("/api/sysinfo");
    if (!res.ok) throw new Error("Falha na resposta da API");

    const data = await res.json();

    // RAM Refresh
    document.getElementById("ramText").innerText =
      `${data.ram.usedGB} / ${data.ram.totalGB} GB (${data.ram.percentage}%)`;
    const ramBar = document.getElementById("ramBar");
    ramBar.style.width = `${data.ram.percentage}%`;
    formatColor(ramBar, parseFloat(data.ram.percentage));

    // CPU Ticks Refresh
    document.getElementById("cpuCores").innerText = data.cpu.cores;
    document.getElementById("cpuText").innerText =
      `${data.cpu.loadPercentage}%`;
    const cpuBar = document.getElementById("cpuBar");
    cpuBar.style.width = `${data.cpu.loadPercentage}%`;
    formatColor(cpuBar, parseFloat(data.cpu.loadPercentage));

    // Network List Refresh
    if (data.networkUsage) renderNetworkUsage(data.networkUsage);

    // LED Status
    const dot = document.getElementById("serverStatus");
    dot.style.backgroundColor = "var(--success-color)";
    dot.style.boxShadow = "0 0 10px var(--success-color)";
  } catch (err) {
    console.error("Erro ao buscar sysinfo:", err);
    const dot = document.getElementById("serverStatus");
    dot.style.backgroundColor = "var(--danger-color)";
    dot.style.boxShadow = "0 0 10px var(--danger-color)";
  } finally {
    const now = new Date();
    document.getElementById("lastUpdate").innerText =
      `Última sincronização online: ${now.toLocaleTimeString()}`;
  }

  fetchMcInfo();
};

// Bootstrap: Executa instantaneamente na primeira montagem DOM
fetchSysInfo();

// Loop: A cada 10 segundos
setInterval(fetchSysInfo, 10000);
