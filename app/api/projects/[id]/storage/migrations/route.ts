import { headers } from 'next/headers'

import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { cancelActiveStorageOperation, createPullToCurrentNodeOperation, createReturnToR2Operation, getStorageOperationPanel, kickProjectStorageOperation } from '@/lib/storageOperations'

type RouteContext = { params: Promise<{ id: string }> }

async function getRequestOrigin(req: Request) {
  const headerStore = await headers()
  const forwardedProto = headerStore.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = headerStore.get('x-forwarded-host')?.split(',')[0]?.trim() || headerStore.get('host')?.trim()
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`
  return new URL(req.url).origin
}

export async function GET(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)

    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.isSuperAdmin) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const data = await getStorageOperationPanel(projectId, await getRequestOrigin(req))
    return Response.json({ success: true, data: { activeMigration: data.activeOperation, migrations: data.operations, currentNode: data.currentNode, projectStorageState: data.projectStorageState, permissions: data.permissions } })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)

    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.isSuperAdmin) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const body = await req.json().catch(() => null) as { branchTypes?: string[]; operationType?: string } | null
    const branchTypes = Array.isArray(body?.branchTypes)
      ? body!.branchTypes.filter((value) => value === 'thumb' || value === 'display' || value === 'original')
      : []
    const operationType = body?.operationType === 'return_to_r2' ? 'return_to_r2' : 'pull_to_current_node'

    if (branchTypes.length === 0) {
      return Response.json({ success: false, error: 'Select at least one branch type' }, { status: 400 })
    }

    const origin = await getRequestOrigin(req)
    const result = operationType === 'return_to_r2'
      ? await createReturnToR2Operation({ projectId, requestedByAdminUserId: auth.id, branchTypes, requestOrigin: origin })
      : await createPullToCurrentNodeOperation({ projectId, requestedByAdminUserId: auth.id, branchTypes, requestOrigin: origin })

    if (result.operation?.id) {
      void kickProjectStorageOperation(result.context.currentNode.publicBaseUrl || origin, result.operation.id)
    }

    const data = await getStorageOperationPanel(projectId, origin)
    return Response.json({ success: true, data: { activeMigration: data.activeOperation, migrations: data.operations, currentNode: data.currentNode, projectStorageState: data.projectStorageState, permissions: data.permissions, createdOperation: result.operation } }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error'
    const lower = message.toLowerCase()
    const status = lower.includes('forbidden') ? 403
      : lower.includes('not found') ? 404
      : lower.includes('already') || lower.includes('in progress') ? 409
      : lower.includes('required') || lower.includes('not allowed') || lower.includes('cannot') || lower.includes('insufficient') || lower.includes('public base url') ? 400
      : 500

    return Response.json({ success: false, error: message }, { status })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)

    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.isSuperAdmin) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const origin = await getRequestOrigin(req)
    const result = await cancelActiveStorageOperation({ projectId, requestOrigin: origin })
    const data = await getStorageOperationPanel(projectId, origin)
    return Response.json({ success: true, data: { activeMigration: data.activeOperation, migrations: data.operations, currentNode: data.currentNode, projectStorageState: data.projectStorageState, permissions: data.permissions, cancelledOperationId: result.cancelledOperationId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error'
    const lower = message.toLowerCase()
    const status = lower.includes('forbidden') ? 403 : lower.includes('not found') ? 404 : lower.includes('no active') ? 409 : 500
    return Response.json({ success: false, error: message }, { status })
  }
}
