import { createClient } from "@supabase/supabase-js";
import { SupabaseFloodRepository, type FloodRepository } from "@floodograph/core";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let instance: FloodRepository | null = null;

/** Single read-only data access point for the web app (Repository pattern). */
export function floodRepository(): FloodRepository {
  if (instance) return instance;
  if (!url || !key) throw new Error("Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  instance = new SupabaseFloodRepository(createClient(url, key, { auth: { persistSession: false } }));
  return instance;
}
