import { clearAdminSession } from '@/lib/auth/session'

export async function POST() {
  await clearAdminSession()
  return Response.json({ success: true })
}
