/**
 * Script de migração única: history.json → Supabase (tabela poll_history)
 *
 * USO:
 *   node utils/migrate_history.js
 *
 * Lê o arquivo config/history.json e insere cada data registrada
 * na tabela poll_history do Supabase. Datas já existentes são ignoradas
 * (upsert com onConflict na poll_date).
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const supabase = require('../src/database/supabaseClient');

const historyPath = path.join(__dirname, '../config/history.json');

async function migrate() {
    // Verifica se o arquivo existe
    if (!fs.existsSync(historyPath)) {
        console.log('ℹ️  Arquivo history.json não encontrado. Nada a migrar.');
        return;
    }

    let history = {};
    try {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
        console.error('❌ Erro ao ler history.json:', e.message);
        process.exit(1);
    }

    const dates = Object.keys(history).filter(k => history[k] === true);

    if (dates.length === 0) {
        console.log('ℹ️  history.json está vazio. Nada a migrar.');
        return;
    }

    console.log(`\n🚀 Migrando ${dates.length} data(s) para o Supabase...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const dateStr of dates) {
        const { error } = await supabase
            .from('poll_history')
            .upsert({ poll_date: dateStr }, { onConflict: 'poll_date' });

        if (error) {
            console.error(`   ❌ ${dateStr} — Erro: ${error.message}`);
            errorCount++;
        } else {
            console.log(`   ✅ ${dateStr}`);
            successCount++;
        }
    }

    console.log(`\n✨ Migração concluída! ${successCount} inserida(s), ${errorCount} com erro.`);

    if (errorCount === 0) {
        console.log('\n💡 O arquivo config/history.json pode ser removido com segurança.');
    }
}

migrate()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('❌ Erro inesperado:', e.message);
        process.exit(1);
    });
