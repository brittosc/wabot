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
        const BACKEND_URL = 'https://api.grupobritto.com.br';

        let rawDB = {};
        let passengers = [];
        let isPollSentToday = false;
        let capacities = {};
        let groupAliases = {};
        let skipDates = {};
        let pollTime = '05:30';
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

// Arquivos processados (substituição de URL aplicada)
const jsFiles = [
    'estatisticas.js',
    'estatisticas-feed.js',
    'estatisticas-capacity.js',
    'estatisticas-charts.js',
    'estatisticas-lifecycle.js',
];

// Arquivos copiados diretamente (sem processamento)
const cssFiles = [
    'estatisticas.css',
    'estatisticas-feed.css',
];

jsFiles.forEach(file => {
    const src = 'public/' + file;
    const dest = 'frontend/' + file;
    if (fs.existsSync(src)) {
        let content = fs.readFileSync(src, 'utf8');
        // Substitui fetch relativo pelo fetch com BACKEND_URL
        content = content.split("fetch('/api/stats')").join("fetch(BACKEND_URL + '/api/stats')");
        fs.writeFileSync(dest, content, 'utf8');
        console.log('Processado:', dest);
    } else {
        console.warn('Arquivo não encontrado, ignorado:', src);
    }
});

cssFiles.forEach(file => {
    const src = 'public/' + file;
    const dest = 'frontend/' + file;
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('Copiado:', dest);
    } else {
        console.warn('Arquivo não encontrado, ignorado:', src);
    }
});
