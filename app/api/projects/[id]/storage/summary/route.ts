import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { loadProjectStorageSummary } from '@/lib/storageManagement'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)

    if (!permission.exists) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }
    if (!permission.isSuperAdmin) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const summary = await loadProjectStorageSummary(projectId)
    return Response.json({ success: true, data: summary })
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Server error' },
      { status: 500 },
    )
  }
}
