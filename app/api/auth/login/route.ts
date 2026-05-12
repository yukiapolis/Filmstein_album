import { verifyPassword } from '@/lib/auth/password'
import { createAdminSession } from '@/lib/auth/session'
import { authenticateAdminUser } from '@/lib/auth/adminStore'

function normalizeNextPath(nextPath: unknown) {
  if (typeof nextPath !== 'string' || !nextPath.startsWith('/')) return '/'
  if (nextPath.startsWith('//')) return '/'
  return nextPath
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const nextPath = normalizeNextPath(body?.next)

    if (!username || !password) {
      return Response.json({ success: false, error: 'Username and password are required' }, { status: 400 })
    }

    const adminUser = await authenticateAdminUser(username, password)

    if (!adminUser || adminUser.is_active !== true) {
      return Response.json({ success: false, error: 'Invalid username or password' }, { status: 401 })
    }

    const passwordMatches = adminUser.password ? await verifyPassword(password, adminUser.password) : true
    if (!passwordMatches) {
      return Response.json({ success: false, error: 'Invalid username or password' }, { status: 401 })
    }

    await createAdminSession({
      id: adminUser.id,
      shortId: adminUser.short_id,
      username: typeof adminUser.username === 'string' ? adminUser.username : username,
      role: adminUser.role,
    })

    return Response.json({ success: true, next: nextPath })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
