import { supabase, hasSupabaseServiceRoleKey } from '@/lib/supabase/server'

export type AdminRole = 'super_admin' | 'admin'

export type AdminUserRecord = {
  id: string
  short_id: string
  username: string
  password: string
  is_active: boolean
  role: AdminRole
}

export type AdminUserPublicRecord = Omit<AdminUserRecord, 'password'>

function normalizeRole(value: unknown): AdminRole {
  return value === 'super_admin' ? 'super_admin' : 'admin'
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeDbUser(row: Record<string, unknown>): AdminUserRecord {
  const password = typeof row.password === 'string'
    ? row.password
    : typeof row.password_hash === 'string'
      ? row.password_hash
      : ''

  return {
    id: String(row.id ?? ''),
    short_id: typeof row.short_id === 'string' ? row.short_id : '',
    username: typeof row.username === 'string' ? row.username : '',
    password,
    is_active: row.is_active !== false,
    role: normalizeRole(row.role),
  }
}

function normalizePublicUser(row: Record<string, unknown>): AdminUserPublicRecord {
  return {
    id: String(row.id ?? ''),
    short_id: typeof row.short_id === 'string' ? row.short_id : '',
    username: typeof row.username === 'string' ? row.username : '',
    is_active: row.is_active !== false,
    role: normalizeRole(row.role),
  }
}

export async function authenticateAdminUser(username: string, password: string) {
  const normalizedUsername = username.trim().toLowerCase()

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .ilike('username', normalizedUsername)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('authenticate_admin_user', {
    input_username: normalizedUsername,
    input_password: password,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? normalizeDbUser(row as Record<string, unknown>) : null
}

export async function findAdminUserById(id: string) {
  const normalizedId = id.trim()
  if (!isUuid(normalizedId)) {
    return null
  }

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .eq('id', normalizedId)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('get_admin_user_by_id', {
    input_id: normalizedId,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { ...normalizePublicUser(row as Record<string, unknown>), password: '' } : null
}

export async function findAdminUserByShortId(shortId: string) {
  const normalizedShortId = shortId.trim().toUpperCase()
  if (!normalizedShortId) return null

  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, password, password_hash, is_active, role')
      .eq('short_id', normalizedShortId)
      .maybeSingle()

    if (error) throw error
    return data ? normalizeDbUser(data as Record<string, unknown>) : null
  }

  const { data, error } = await supabase.rpc('get_admin_user_by_short_id', {
    input_short_id: normalizedShortId,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ? { ...normalizePublicUser(row as Record<string, unknown>), password: '' } : null
}

export async function listAdminUsers() {
  if (hasSupabaseServiceRoleKey) {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, short_id, username, is_active, role')
      .order('username', { ascending: true })

    if (error) throw error

    return (data ?? []).map((row) => normalizePublicUser(row as Record<string, unknown>))
  }

  const { data, error } = await supabase.rpc('list_admin_users_public')
  if (error) throw error
  return (Array.isArray(data) ? data : []).map((row) => normalizePublicUser(row as Record<string, unknown>))
}
