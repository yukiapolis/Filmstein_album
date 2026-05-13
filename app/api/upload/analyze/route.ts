import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { analyzeUploadMetadata } from '@/lib/uploadDirect'

export async function POST(req: Request) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const body = await req.json().catch(() => null)
    const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : ''
    const checksumSha256 = typeof body?.checksumSha256 === 'string' ? body.checksumSha256.trim().toLowerCase() : ''

    if (!projectId || !fileName || !checksumSha256) {
      return Response.json({ success: false, error: 'Missing projectId, fileName, or checksumSha256' }, { status: 400 })
    }

    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const result = await analyzeUploadMetadata({ projectId, fileName, checksumSha256 })
    return Response.json({ success: true, data: result })
  } catch (error) {
    console.error('[upload/analyze] error:', error)
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
