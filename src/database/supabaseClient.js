const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://flxbfttgjdbqbqsjycoo.supabase.co';
const supabaseKey = 'sb_publishable_pM7PNMreo0QX7v9GCDCg1A_-yfuw7zK';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
