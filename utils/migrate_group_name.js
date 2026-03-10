/**
 * Utilitário para migrar nomes de grupos no banco de dados e na configuração local.
 * 
 * ATENÇÃO: Edite as variáveis 'oldGroupName' e 'newGroupName' abaixo antes de executar.
 * 
 * USO: node utils/migrate_group_name.js
 */

const fs = require('fs');
const path = require('path');
const supabase = require('../src/database/supabaseClient');

// --- CONFIGURAÇÃO DA MIGRAÇÃO ---
const oldGroupName = 'Ônibus unesc 01 2026'; // Ex: 'xxxab'
const newGroupName = 'Linha 01 - UNESC';   // Ex: 'abxxx'
const executeMigration = true;          // Mude para true para executar de fato
// --------------------------------

async function migrate() {
    if (!executeMigration || oldGroupName === 'Ônibus unesc 01 2026') {
        console.log('⚠️  Migração não executada. Edite o arquivo, defina os nomes e mude "executeMigration" para true.');
        process.exit(0);
    }

    console.log(`\n--- Iniciando Migração: "${oldGroupName}" -> "${newGroupName}" ---\n`);

    try {
        // 1. Atualizar no Supabase (Tabela votes)
        console.log('Step 1: Atualizando registros no Supabase...');
        const { data, error, count } = await supabase
            .from('votes')
            .update({ group_name: newGroupName })
            .eq('group_name', oldGroupName);

        if (error) {
            throw new Error(`Erro no Supabase: ${error.message}`);
        }
        console.log(`✅ Supabase atualizado. Registros afetados: ${count || 0}`);

        // 2. Atualizar no config/config.json
        console.log('Step 2: Atualizando config/config.json...');
        const configPath = path.join(__dirname, '../config/config.json');

        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

            // Atualizar targetGroups
            if (config.targetGroups && Array.isArray(config.targetGroups)) {
                const index = config.targetGroups.indexOf(oldGroupName);
                if (index !== -1) {
                    config.targetGroups[index] = newGroupName;
                    console.log('   - Nome atualizado em "targetGroups".');
                }
            }

            // Atualizar groupCapacities
            if (config.groupCapacities && config.groupCapacities[oldGroupName]) {
                config.groupCapacities[newGroupName] = config.groupCapacities[oldGroupName];
                delete config.groupCapacities[oldGroupName];
                console.log('   - Nome atualizado em "groupCapacities".');
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
            console.log('✅ Arquivo de configuração atualizado.');
        } else {
            console.log('⚠️  Aviso: config/config.json não encontrado. Pulando etapa local.');
        }

        console.log('\n✨ Migração concluída com sucesso!');

    } catch (err) {
        console.error(`\n❌ Erro durante a migração: ${err.message}`);
    } finally {
        process.exit(0);
    }
}

migrate();
