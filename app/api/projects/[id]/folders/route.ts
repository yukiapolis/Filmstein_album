import { supabase } from '@/lib/supabase/server'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { extractFolderShareAccessConfig, extractProjectShareAccessConfig, hashSharePassword, isFolderShareAccessGranted, isProjectShareAccessGranted } from '@/lib/shareAccess'

type RouteContext = { params: Promise<{ id: string }> }

type FolderRow = {
  id: string
  name: string
  parent_id?: string | null
  access_mode?: string | null
  password_hash?: string | null
  photo_count?: number | null
}

async function loadProjectShareState(request: Request, projectId: string) {
  const { data: projectRow, error } = await supabase
    .from('projects')
    .select('id, visual_settings')
    .eq('id', projectId)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!projectRow) return { notFound: true as const }

  const shareAccess = extractProjectShareAccessConfig(projectRow.visual_settings)
  const unlocked = shareAccess.enabled !== true || !shareAccess.password_hash
    ? true
    : isProjectShareAccessGranted(request, projectId, shareAccess.password_hash)

  return {
    projectRow,
    unlocked,
    requiresPassword: shareAccess.enabled === true && Boolean(shareAccess.password_hash),
  }
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const publishedOnly = url.searchParams.get('publishedOnly') === 'true'

    if (!publishedOnly) {
      const auth = await requireAdminApiAuth()
      if (auth instanceof Response) return auth

      const permission = await getProjectPermissionContext(auth, id)
      if (!permission.exists) return Response.json({ success: false, error: 'Not found' }, { status: 404 })
      if (!permission.canAccessProject) return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })

      const { data, error } = await supabase
        .from('project_folders')
        .select('id, name, parent_id, access_mode, password_hash')
        .eq('project_id', id)
        .order('created_at', { ascending: true })

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }

      return Response.json({
        success: true,
        data: (data ?? []).map((folder) => {
          const access = extractFolderShareAccessConfig(folder)
          return {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
            access_mode: access.access_mode,
            has_password: Boolean(access.password_hash),
          }
        }),
      })
    }

    const projectShare = await loadProjectShareState(req, id)
    if ('error' in projectShare) {
      return Response.json({ success: false, error: projectShare.error }, { status: 500 })
    }
    if ('notFound' in projectShare) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }
    if (!projectShare.unlocked) {
      return Response.json({ success: false, error: 'Project password is required' }, { status: 403 })
    }

    const [{ data: folders, error: foldersError }, { data: photoCounts, error: photoCountsError }] = await Promise.all([
      supabase
        .from('project_folders')
        .select('id, name, parent_id, access_mode, password_hash')
        .eq('project_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('photos')
        .select('folder_id')
        .eq('project_id', id)
        .eq('is_published', true)
        .not('folder_id', 'is', null),
    ])

    if (foldersError) {
      return Response.json({ success: false, error: foldersError.message }, { status: 500 })
    }
    if (photoCountsError) {
      return Response.json({ success: false, error: photoCountsError.message }, { status: 500 })
    }

    const countByFolderId = new Map<string, number>()
    for (const row of photoCounts ?? []) {
      if (!row.folder_id) continue
      countByFolderId.set(row.folder_id, (countByFolderId.get(row.folder_id) ?? 0) + 1)
    }

    const visibleFolders = (folders ?? []).flatMap((folder) => {
      const access = extractFolderShareAccessConfig(folder)
      if (access.access_mode === 'hidden') return []
      const unlocked = access.access_mode !== 'password_protected' || !access.password_hash
        ? true
        : isFolderShareAccessGranted(req, id, folder.id, access.password_hash)

      return [{
        id: folder.id,
        name: folder.name,
        parent_id: folder.parent_id,
        access_mode: access.access_mode,
        unlocked,
        photo_count: countByFolderId.get(folder.id) ?? 0,
      }]
    })

    return Response.json({ success: true, data: visibleFolders })
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

    const payload: { project_id: string; name: string; parent_id?: string | null; access_mode: 'public' } = {
      project_id: id,
      name: name.trim(),
      access_mode: 'public',
    }
    if (typeof parentId === 'string' && parentId.trim()) payload.parent_id = parentId.trim()

    const { data, error } = await supabase
      .from('project_folders')
      .insert([payload])
      .select('id, name, parent_id, access_mode, password_hash')
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
    const { folderId, name, accessMode, password } = await req.json()

    if (!folderId || typeof folderId !== 'string') {
      return Response.json({ success: false, error: 'Invalid folder id' }, { status: 400 })
    }

    const { data: existingFolder, error: existingFolderError } = await supabase
      .from('project_folders')
      .select('id, name, access_mode, password_hash')
      .eq('id', folderId)
      .eq('project_id', id)
      .maybeSingle()

    if (existingFolderError) {
      return Response.json({ success: false, error: existingFolderError.message }, { status: 500 })
    }
    if (!existingFolder) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}

    if (typeof name === 'string') {
      if (!name.trim()) {
        return Response.json({ success: false, error: 'Invalid folder name' }, { status: 400 })
      }
      updates.name = name.trim()
    }

    if (accessMode !== undefined) {
      if (accessMode !== 'public' && accessMode !== 'hidden' && accessMode !== 'password_protected') {
        return Response.json({ success: false, error: 'Invalid access mode' }, { status: 400 })
      }

      const nextPassword = typeof password === 'string' ? password.trim() : ''
      const currentAccess = extractFolderShareAccessConfig(existingFolder)
      const nextPasswordHash = accessMode === 'password_protected'
        ? (nextPassword ? hashSharePassword(nextPassword) : (currentAccess.password_hash || ''))
        : null

      if (accessMode === 'password_protected' && !nextPasswordHash) {
        return Response.json({ success: false, error: 'Album password is required for password-protected mode' }, { status: 400 })
      }

      updates.access_mode = accessMode
      updates.password_hash = nextPasswordHash
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: false, error: 'No fields to update' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('project_folders')
      .update(updates)
      .eq('id', folderId)
      .eq('project_id', id)
      .select('id, name, parent_id, access_mode, password_hash')
      .single()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({
      success: true,
      data: {
        id: data.id,
        name: data.name,
        parent_id: data.parent_id,
        access_mode: data.access_mode,
        has_password: Boolean(data.password_hash),
      },
    })
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
