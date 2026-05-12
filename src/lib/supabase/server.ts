import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const hasSupabaseServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabaseServerKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseServerKey)

export type SupabaseServerClient = typeof supabase
