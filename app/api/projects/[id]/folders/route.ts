import { supabase } from '@/lib/supabase/server'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { requireAdminApiAuth } from '@/lib/auth/session'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const { data, error } = await supabase
      .from('project_folders')
      .select('id, name, parent_id')
      .eq('project_id', id)
      .order('created_at', { ascending: true })

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: data ?? [],
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    const { name, parentId } = await req.json()

    if (!name || typeof name !== 'string' || !name.trim()) {
      return Response.json({ success: false, error: 'Invalid folder name' }, { status: 400 })
    }

    const payload: { project_id: string; name: string; parent_id?: string | null } = {
      project_id: id,
      name: name.trim(),
    }
    if (typeof parentId === 'string' && parentId.trim()) payload.parent_id = parentId.trim()

    const { data, error } = await supabase
      .from('project_folders')
      .insert([payload])
      .select('id, name, parent_id')
      .single()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, data })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    const { folderId, name } = await req.json()

    if (!folderId || typeof folderId !== 'string') {
      return Response.json({ success: false, error: 'Invalid folder id' }, { status: 400 })
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      return Response.json({ success: false, error: 'Invalid folder name' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('project_folders')
      .update({ name: name.trim() })
      .eq('id', folderId)
      .eq('project_id', id)
      .select('id, name, parent_id')
      .single()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, data })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id } = await context.params
    const permission = await getProjectPermissionContext(auth, id)
    if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    if (!permission.canManageProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    const { folderIds, folderId } = await req.json()

    const seedIds = Array.isArray(folderIds)
      ? folderIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : typeof folderId === 'string' && folderId
        ? [folderId]
        : []

    if (seedIds.length === 0) {
      return Response.json({ success: false, error: 'Invalid folder id' }, { status: 400 })
    }

    const { data: allFolders, error: allFoldersError } = await supabase
      .from('project_folders')
      .select('id, parent_id')
      .eq('project_id', id)

    if (allFoldersError) {
      return Response.json({ success: false, error: allFoldersError.message }, { status: 500 })
    }

    const childrenByParent = new Map<string, string[]>()
    for (const folder of allFolders ?? []) {
      if (!folder.parent_id) continue
      const list = childrenByParent.get(folder.parent_id) ?? []
      list.push(folder.id)
      childrenByParent.set(folder.parent_id, list)
    }

    const idsToDelete = new Set(seedIds)
    const queue = [...seedIds]
    while (queue.length > 0) {
      const currentId = queue.shift()!
      const childIds = childrenByParent.get(currentId) ?? []
      for (const childId of childIds) {
        if (idsToDelete.has(childId)) continue
        idsToDelete.add(childId)
        queue.push(childId)
      }
    }

    const resolvedIds = Array.from(idsToDelete)

    const { error: clearPhotosError } = await supabase
      .from('photos')
      .update({ folder_id: null })
      .in('folder_id', resolvedIds)
      .eq('project_id', id)

    if (clearPhotosError) {
      return Response.json({ success: false, error: clearPhotosError.message }, { status: 500 })
    }

    const { error } = await supabase
      .from('project_folders')
      .delete()
      .in('id', resolvedIds)
      .eq('project_id', id)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true, deletedFolderIds: resolvedIds })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
