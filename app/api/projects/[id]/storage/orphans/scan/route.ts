import { loadProjectStorageScanScope, scanProjectStorageOrphans } from '@/lib/projectStorageOrphans'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const scope = await loadProjectStorageScanScope(id)
    if (!scope) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }

    const result = await scanProjectStorageOrphans({
      projectId: id,
      project: scope.project,
      photoFiles: scope.photoFiles,
      photos: scope.photos,
    })

    return Response.json({ success: true, data: result })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
