const { createClient } = require("@supabase/supabase-js");

const path = require("path");
// Tenta carregar o .env se as variáveis não estiverem no ambiente (útil para scripts isolados)
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  require("dotenv").config({ path: path.join(__dirname, "../../.env") });
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Validação antecipada — falha rápida e com mensagem clara
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "[supabaseClient] Variáveis de ambiente SUPABASE_URL e SUPABASE_KEY são obrigatórias.\n" +
      "Crie um arquivo .env na raiz do projeto com base no .env.example.",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
