import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANNO_KEY;

if (!supabaseUrl) throw new Error("supabase url is missing");
if (!supabaseKey) throw new Error("supabase key is missing");

const supabase = createClient(supabaseUrl, supabaseKey);

export { supabase };
