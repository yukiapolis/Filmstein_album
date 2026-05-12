import { requireAdminApiAuth } from '@/lib/auth/session'

export async function GET() {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  return Response.json({
    success: true,
    data: {
      id: auth.id,
      shortId: auth.shortId,
      username: auth.username,
      role: auth.role,
    },
  })
}
