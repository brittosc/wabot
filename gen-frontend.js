const fs = require('fs');
let html = fs.readFileSync('public/estatisticas.html', 'utf8');

const dataBlockStart = '\n        let rawDB = ';
const dataBlockEnd = '\n        \n        // Previsão do Tempo (Open-Meteo via Backend)';
const startIdx = html.indexOf(dataBlockStart);
const endIdx = html.indexOf(dataBlockEnd);

if (startIdx === -1 || endIdx === -1) {
  console.error('Blocos não encontrados. startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const newDataBlock = `
        // === CONFIGURAÇÃO DO BACKEND ===
        // Altere este valor para o endereço da sua VPS antes do deploy no Cloudflare Pages
        const BACKEND_URL = 'https://SEU_DOMINIO_OU_IP_AQUI';

        let rawDB = {};
        let passengers = [];
        let isPollSentToday = false;
        let capacities = {};
        let groupAliases = {};
        let skipDates = {};
        let pollTime = '06:00';
        let targetGroups = [];

`;

html = html.substring(0, startIdx) + newDataBlock + html.substring(endIdx);

html = html.split("const res = await fetch('/api/stats');")
           .join("const res = await fetch(BACKEND_URL + '/api/stats');");

if (html.indexOf("rel='manifest'") === -1 && html.indexOf('rel="manifest"') === -1) {
    html = html.replace('</head>', "    <link rel='manifest' href='/manifest.json'>\n</head>");
}

if (!fs.existsSync('frontend')) {
    fs.mkdirSync('frontend');
}
fs.writeFileSync('frontend/index.html', html, 'utf8');
console.log('frontend/index.html criado com sucesso!');
console.log('Tamanho:', html.length, 'chars');
