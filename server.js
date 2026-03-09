const http = require('http');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec } = require('child_process');
const util = require('minecraft-server-util');
const { Rcon } = require('rcon-client');
const dashboard = require('./dashboard');
const { readStats } = require('./statistics');

// Variável em memória para cachear o IP público da VPS, evitando travar a API fazendo request toda hora
let publicIpCache = "Desconhecido";

// Minecraft Uptime Tracking (Persistent via Windows Process)
let mcUptimeStart = null;
let lastMcOnlineStatus = false;

const getMcProcessStartTime = () => {
    return new Promise((resolve) => {
        const isWindows = os.platform() === 'win32';

        if (isWindows) {
            // Busca o processo java no Windows
            exec('wmic process where "name=\'java.exe\'" get CreationDate /value', (err, stdout) => {
                if (err || !stdout) return resolve(null);
                const match = stdout.match(/CreationDate=(\d+)/);
                if (match && match[1]) {
                    const dateStr = match[1];
                    const year = dateStr.substring(0, 4);
                    const month = dateStr.substring(4, 6) - 1;
                    const day = dateStr.substring(6, 8);
                    const hour = dateStr.substring(8, 10);
                    const minute = dateStr.substring(10, 12);
                    const second = dateStr.substring(12, 14);
                    resolve(new Date(year, month, day, hour, minute, second).getTime());
                } else {
                    resolve(null);
                }
            });
        } else {
            // Busca o processo java no Linux (Ubuntu)
            // 'ps -C java -o lstart=' retorna a data de início (ex: Mon Mar 9 10:00:00 2026)
            exec('ps -C java -o lstart= || ps -ef | grep "[j]ava" | awk \'{print $5}\'', (err, stdout) => {
                if (err || !stdout) return resolve(null);
                const dateStr = stdout.trim().split('\n')[0]; // Pega a primeira linha
                if (dateStr) {
                    const startTime = new Date(dateStr).getTime();
                    resolve(isNaN(startTime) ? null : startTime);
                } else {
                    resolve(null);
                }
            });
        }
    });
};

// Helpers do Hardware
const getCpuTicks = () => {
    const cpus = os.cpus();
    let totalTick = 0;
    let totalIdle = 0;
    for (let i = 0, len = cpus.length; i < len; i++) {
        const cpu = cpus[i];
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }
    return { idle: totalIdle, total: totalTick };
};

let previousCpuInfo = getCpuTicks();

// Helper de Rede (Bandwidth Windows)
let previousNetInfo = { rx: 0, tx: 0, time: Date.now() };
let currentNetUsage = { rxSpeed: 0, txSpeed: 0 }; // Bytes per second

const startServer = () => {
    const port = process.env.PORT || 3000;

    // Iniciar poller de rede (a cada 2 segundos)
    setInterval(() => {
        const isWindows = os.platform() === 'win32';

        if (isWindows) {
            exec('netstat -e', (err, stdout) => {
                if (err) return;
                const lines = stdout.split('\n');
                const bytesLine = lines.find(line => line.toLowerCase().includes('bytes'));
                if (bytesLine) {
                    const parts = bytesLine.trim().split(/\s+/);
                    const rx = parseInt(parts[1], 10) || 0;
                    const tx = parseInt(parts[2], 10) || 0;
                    updateNetUsage(rx, tx);
                }
            });
        } else {
            // Linux (Ubuntu) - Lê do /proc/net/dev (mais eficiente)
            fs.readFile('/proc/net/dev', 'utf8', (err, data) => {
                if (err) return;
                const lines = data.split('\n');
                let totalRx = 0;
                let totalTx = 0;
                // Pular as 2 primeiras linhas de cabeçalho
                for (let i = 2; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    const parts = line.split(/\s+/);
                    // RX bytes está no índice 1, TX bytes no índice 9 (geralmente)
                    if (parts.length > 10) {
                        totalRx += parseInt(parts[1], 10) || 0;
                        totalTx += parseInt(parts[9], 10) || 0;
                    }
                }
                updateNetUsage(totalRx, totalTx);
            });
        }
    }, 2000);

    const updateNetUsage = (rx, tx) => {
        const now = Date.now();
        const timeDiff = (now - previousNetInfo.time) / 1000;

        if (timeDiff > 0 && previousNetInfo.rx > 0) {
            currentNetUsage.rxSpeed = Math.max(0, (rx - previousNetInfo.rx) / timeDiff);
            currentNetUsage.txSpeed = Math.max(0, (tx - previousNetInfo.tx) / timeDiff);
        }

        previousNetInfo = { rx, tx, time: now };
    };

    // Buscar IP Público assincronamente logo quando o server inicia
    https.get('https://api.ipify.org', (res) => {
        let rawData = '';
        res.on('data', (chunk) => rawData += chunk);
        res.on('end', () => {
            publicIpCache = rawData.trim();
        });
    }).on('error', (e) => {
        console.error(`Falha ao obter IP Público: ${e.message}`);
    });

    const server = http.createServer((req, res) => {

        // Rota API de Monitoramento da Máquina (SysInfo)
        if (req.url === '/api/sysinfo') {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            const usedMemGB = (usedMem / 1024 / 1024 / 1024).toFixed(2);
            const totalMemGB = (totalMem / 1024 / 1024 / 1024).toFixed(2);
            const ramPercentage = ((usedMem / totalMem) * 100).toFixed(1);

            // CPU Load: Usando medição por ticks (compatível com Windows/Linux)
            const cores = os.cpus().length;
            const currentCpuInfo = getCpuTicks();
            const idleDifference = currentCpuInfo.idle - previousCpuInfo.idle;
            const totalDifference = currentCpuInfo.total - previousCpuInfo.total;
            let cpuPercentage = 100 - Math.floor((100 * idleDifference) / totalDifference);
            previousCpuInfo = currentCpuInfo;

            if (isNaN(cpuPercentage) || cpuPercentage < 0) cpuPercentage = 0;
            if (cpuPercentage > 100) cpuPercentage = 100.0;
            cpuPercentage = cpuPercentage.toFixed(1);

            const sysInfo = {
                publicIp: publicIpCache,
                ram: {
                    usedGB: usedMemGB,
                    totalGB: totalMemGB,
                    percentage: ramPercentage
                },
                cpu: {
                    cores: cores,
                    loadPercentage: cpuPercentage
                },
                networkUsage: currentNetUsage
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sysInfo));
            return;
        }

        // Rota API de rawDB para o Auto-Refresh do frontend das Estatísticas
        if (req.url === '/api/stats') {
            try {
                const data = readStats();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(data));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
            return;
        }

        // Rota API de Status do Minecraft (GameSpy4 Query)
        if (req.url === '/api/mcstatus') {
            const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

            util.queryFull('0.0.0.0', 25565, { timeout: 5000 })
                .then(async (result) => {
                    // Update Uptime Tracker (Persistent)
                    if (!lastMcOnlineStatus || !mcUptimeStart) {
                        const processStart = await getMcProcessStartTime();
                        mcUptimeStart = processStart || Date.now();
                        lastMcOnlineStatus = true;
                    }

                    // Limpeza de caracteres de cor do Minecraft (§ ou Â)
                    const cleanString = (str) => {
                        if (!str) return '';
                        return str.replace(/§[0-9a-fk-or]/gi, '').replace(/Â/g, '').trim();
                    };

                    // Simplificar a versão
                    let version = result.version;
                    if (version && version.toLowerCase().includes('paper')) {
                        version = 'Paper';
                    }

                    // RCON Data (Opcional)
                    let worldStats = { time: 'Desconhecido', weather: 'Limpo', combined: '--' };
                    if (config.minecraft && config.minecraft.rcon && config.minecraft.rcon.enabled) {
                        try {
                            const rcon = await Rcon.connect({
                                host: config.minecraft.rcon.host,
                                port: config.minecraft.rcon.port,
                                password: config.minecraft.rcon.password,
                                timeout: 2000
                            });

                            const timeOutput = await rcon.send('time query daytime');
                            const timeTicks = parseInt(timeOutput.match(/\d+/)[0], 10) % 24000;

                            // Ciclo Solar Minecraft (Regras Oficiais):
                            if (timeTicks >= 23000 || timeTicks < 1000)
                                worldStats.time = 'Amanhecer 🌅';
                            else if (timeTicks >= 1000 && timeTicks < 12000)
                                worldStats.time = 'Dia ☀️';
                            else if (timeTicks >= 12000 && timeTicks < 13000)
                                worldStats.time = 'Entardecer 🌇';
                            else if (timeTicks >= 13000 && timeTicks < 18000)
                                worldStats.time = 'Noite 🌙';
                            else
                                worldStats.time = 'Madrugada 🌙';

                            await rcon.send('execute store success score #rain weatherCheck if predicate {condition:"weather_check","raining":true}');
                            await rcon.send('execute store success score #thunder weatherCheck if predicate {condition:"weather_check","thundering":true}');

                            const rainScore = await rcon.send('scoreboard players get #rain weatherCheck');
                            const thunderScore = await rcon.send('scoreboard players get #thunder weatherCheck');

                            const isRain = rainScore.includes('1');
                            const isThunder = thunderScore.includes('1');

                            let weatherLabel = 'Limpo ☁️';
                            let weatherIcon = '';

                            if (isThunder) { weatherLabel = 'Tempestade'; weatherIcon = '⛈️'; }
                            else if (isRain) { weatherLabel = 'Chuvoso'; weatherIcon = '🌧️'; }

                            // Frase Dinâmica
                            // Exemplos: "Dia ☀️ com Chuvoso 🌧️", "Noite 🌃" (se limpo)
                            if (weatherLabel === 'Limpo ☁️') {
                                worldStats.combined = `${timeLabel} ${timeIcon}`;
                            } else {
                                worldStats.combined = `${timeLabel} ${timeIcon} com ${weatherLabel} ${weatherIcon}`;
                            }

                            rcon.end();
                        } catch (rconErr) {
                            console.error("Erro RCON:", rconErr.message);
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        online: true,
                        version: version,
                        software: result.software,
                        map: result.map,
                        plugins: result.plugins || [],
                        players: {
                            online: result.players.online,
                            max: result.players.max,
                            list: result.players.list || []
                        },
                        motd: cleanString(result.motd.clean),
                        uptime: mcUptimeStart ? (Date.now() - mcUptimeStart) : 0,
                        world: worldStats
                    }));
                })
                .catch((err) => {
                    lastMcOnlineStatus = false;
                    mcUptimeStart = null;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        online: false,
                        error: err.message
                    }));
                });
            return;
        }

        // Rota Raiz (Dashboard Root da VPS)
        if (req.url === '/') {
            fs.readFile('./index.html', 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Erro: Arquivo index.html (Dashboard da VPS) não encontrado na pasta raiz.');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
            return;
        }

        // Rota Estatísticas do WhatsApp
        if (req.url === '/estatisticas' || req.url === '/estatisticas.html') {
            fs.readFile('./estatisticas.html', 'utf8', (err, data) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        // Arquivo não existe ainda
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aguardando Dados</title>
    <link rel="icon" href="https://dayz.com/favicon.ico">
    <style>
        :root {
            --bg-color: #121212;
            --card-bg: #1e1e1e;
            --text-color: #e0e0e0;
            --accent: #2196f3;
            --border-color: #333; /* Adicionado para o container */
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            text-align: center;
            background-color: var(--bg-color);
            color: var(--text-color);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
        }
        .container {
            max-width: 600px;
            width: 100%;
            background-color: var(--card-bg);
            padding: 40px 20px;
            border-radius: 12px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            border: 1px solid var(--border-color);
            box-sizing: border-box;
        }
        h1 {
            color: #ffffff;
            font-size: 1.8rem;
            margin-bottom: 15px;
            font-weight: 600;
        }
        p {
            color: #aaa;
            font-size: 1.05rem;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .loader {
            width: 50px;
            height: 50px;
            border: 4px solid #333;
            border-top: 4px solid var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 25px auto;
        }
        .illustration {
            font-size: 4rem;
            margin-bottom: 20px;
            display: inline-block;
            animation: float 3s ease-in-out infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
            0% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
            100% { transform: translateY(0px); }
        }
        .waiting-text {
            display: inline-block;
            color: var(--accent);
            font-weight: 500;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="illustration">📊</div>
        <div class="loader"></div>
        <h1>Sem dados disponíveis</h1>
        <p>As estatísticas das enquetes ainda não foram geradas.</p>
        <div class="waiting-text">Aguardando interações...</div>
    </div>
    <script>
        // Refresh fallback dynamically to avoid screen flickers
        setInterval(() => window.location.reload(), 10000);
    </script>
</body>
</html>
                        `);
                    } else {
                        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Erro ao carregar a página de estatísticas.');
                    }
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
            });
            return;
        }

        // Endpoint Padrão Isolado
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Página não encontrada.');
    });

    server.listen(port, '0.0.0.0', () => {
        dashboard.addLog(`Servidor Web iniciado na porta ${port}`);
        dashboard.setServerUrl(`http://0.0.0.0:${port}`);
    });
};

module.exports = { startServer };
