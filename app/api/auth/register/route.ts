import { createAdminSession } from '@/lib/auth/session'
import { hashLegacyMd5 } from '@/lib/auth/password'
import { supabase, hasSupabaseServiceRoleKey } from '@/lib/supabase/server'

const REGISTER_INVITE_CODE = 'SF-26-VAULT-9XK7Q2'

function normalizeNextPath(nextPath: unknown) {
  if (typeof nextPath !== 'string' || !nextPath.startsWith('/')) return '/'
  if (nextPath.startsWith('//')) return '/'
  return nextPath
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const inviteCode = typeof body?.inviteCode === 'string' ? body.inviteCode.trim() : ''
    const nextPath = normalizeNextPath(body?.next)

    if (!username || !password || !inviteCode) {
      return Response.json({ success: false, error: 'Username, password, and invite code are required' }, { status: 400 })
    }

    if (hasSupabaseServiceRoleKey) {
      if (inviteCode !== REGISTER_INVITE_CODE) {
        return Response.json({ success: false, error: 'Invalid invite code' }, { status: 403 })
      }

      const normalizedUsername = username.toLowerCase()
      const { data: existingUser, error: existingUserError } = await supabase
        .from('admin_users')
        .select('id')
        .ilike('username', normalizedUsername)
        .maybeSingle()

      if (existingUserError) {
        return Response.json({ success: false, error: existingUserError.message }, { status: 500 })
      }
      if (existingUser) {
        return Response.json({ success: false, error: 'Username already exists' }, { status: 409 })
      }

      const hashedPassword = hashLegacyMd5(password)
      const { data, error } = await supabase
        .from('admin_users')
        .insert([{ username, password: hashedPassword, role: 'admin', is_active: true }])
        .select('id, short_id, username, role, is_active')
        .maybeSingle()

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }
      if (!data || data.is_active !== true) {
        return Response.json({ success: false, error: 'Registration failed' }, { status: 500 })
      }

      await createAdminSession({
        id: String(data.id),
        shortId: typeof data.short_id === 'string' ? data.short_id : '',
        username: typeof data.username === 'string' ? data.username : username,
        role: data.role === 'super_admin' ? 'super_admin' : 'admin',
      })

      return Response.json({ success: true, next: nextPath })
    }

    const { data, error } = await supabase.rpc('register_admin_user', {
      input_username: username,
      input_password: password,
      input_invite_code: inviteCode,
    })

    if (error) {
      if (error.message.includes('INVITE_CODE_INVALID')) {
        return Response.json({ success: false, error: 'Invalid invite code' }, { status: 403 })
      }
      if (error.message.includes('USERNAME_TAKEN')) {
        return Response.json({ success: false, error: 'Username already exists' }, { status: 409 })
      }
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      return Response.json({ success: false, error: 'Registration failed' }, { status: 500 })
    }

    await createAdminSession({
      id: String(row.id ?? ''),
      shortId: typeof row.short_id === 'string' ? row.short_id : '',
      username: typeof row.username === 'string' ? row.username : username,
      role: row.role === 'super_admin' ? 'super_admin' : 'admin',
    })

    return Response.json({ success: true, next: nextPath })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
