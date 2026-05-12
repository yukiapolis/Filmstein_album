import { supabase, hasSupabaseServiceRoleKey } from '@/lib/supabase/server'
import type { AuthenticatedAdminUser } from '@/lib/auth/session'
import { findAdminUserById } from '@/lib/auth/adminStore'

export type ProjectPermissionContext = {
  exists: boolean
  projectId: string
  isSuperAdmin: boolean
  isOwner: boolean
  isAssigned: boolean
  canAccessProject: boolean
  canManageProject: boolean
  canManageAssignments: boolean
  canDeleteProject: boolean
  ownerAdminUserId: string | null
}

export type ProjectAssignmentListItem = {
  adminUserId: string
  shortId: string
  username: string
  role: 'super_admin' | 'admin'
  isActive: boolean
  isOwner: boolean
  assignedAt?: string
  assignedBy?: string | null
}

export async function getAccessibleProjectIdsForAdmin(adminUser: AuthenticatedAdminUser) {
  if (adminUser.role === 'super_admin') {
    return null
  }

  if (hasSupabaseServiceRoleKey) {
    const [ownedProjectsResult, assignedProjectsResult] = await Promise.all([
      supabase
        .from('projects')
        .select('id')
        .eq('created_by_admin_user_id', adminUser.id),
      supabase
        .from('project_admin_assignments')
        .select('project_id')
        .eq('admin_user_id', adminUser.id),
    ])

    if (ownedProjectsResult.error) throw ownedProjectsResult.error
    if (assignedProjectsResult.error) throw assignedProjectsResult.error

    const ids = new Set<string>()
    for (const row of ownedProjectsResult.data ?? []) {
      if (typeof row.id === 'string' && row.id) ids.add(row.id)
    }
    for (const row of assignedProjectsResult.data ?? []) {
      if (typeof row.project_id === 'string' && row.project_id) ids.add(row.project_id)
    }
    return Array.from(ids)
  }

  const [ownedProjectsResult, assignedProjectsRpc] = await Promise.all([
    supabase
      .from('projects')
      .select('id')
      .eq('created_by_admin_user_id', adminUser.id),
    supabase.rpc('list_assigned_project_ids_for_admin', {
      input_admin_user_id: adminUser.id,
    }),
  ])

  if (ownedProjectsResult.error) throw ownedProjectsResult.error
  if (assignedProjectsRpc.error) throw assignedProjectsRpc.error

  const ids = new Set<string>()
  for (const row of ownedProjectsResult.data ?? []) {
    if (typeof row.id === 'string' && row.id) ids.add(row.id)
  }
  for (const row of assignedProjectsRpc.data ?? []) {
    if (typeof row.project_id === 'string' && row.project_id) ids.add(row.project_id)
  }
  return Array.from(ids)
}

export async function getProjectPermissionContext(adminUser: AuthenticatedAdminUser, projectId: string): Promise<ProjectPermissionContext> {
  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('id, created_by_admin_user_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) throw projectError
  if (!projectRow) {
    return {
      exists: false,
      projectId,
      isSuperAdmin: adminUser.role === 'super_admin',
      isOwner: false,
      isAssigned: false,
      canAccessProject: false,
      canManageProject: false,
      canManageAssignments: false,
      canDeleteProject: false,
      ownerAdminUserId: null,
    }
  }

  const isSuperAdmin = adminUser.role === 'super_admin'
  const ownerAdminUserId = typeof projectRow.created_by_admin_user_id === 'string' ? projectRow.created_by_admin_user_id : null
  let isAssigned = false

  if (!isSuperAdmin && ownerAdminUserId !== adminUser.id) {
    if (hasSupabaseServiceRoleKey) {
      const { data: assignmentRow, error: assignmentError } = await supabase
        .from('project_admin_assignments')
        .select('project_id')
        .eq('project_id', projectId)
        .eq('admin_user_id', adminUser.id)
        .maybeSingle()

      if (assignmentError) throw assignmentError
      isAssigned = Boolean(assignmentRow)
    } else {
      const { data, error } = await supabase.rpc('is_project_admin_assigned', {
        input_project_id: projectId,
        input_admin_user_id: adminUser.id,
      })

      if (error) throw error
      isAssigned = Boolean(data)
    }
  }

  const isOwner = ownerAdminUserId === adminUser.id
  const canAccessProject = isSuperAdmin || isOwner || isAssigned

  return {
    exists: true,
    projectId,
    isSuperAdmin,
    isOwner,
    isAssigned,
    canAccessProject,
    canManageProject: canAccessProject,
    canManageAssignments: isSuperAdmin || isOwner,
    canDeleteProject: isSuperAdmin || isOwner,
    ownerAdminUserId,
  }
}

export async function listProjectAssignments(projectId: string): Promise<ProjectAssignmentListItem[]> {
  let assignmentRows: Array<{ admin_user_id?: string | null; assigned_by?: string | null; created_at?: string | null }> = []

  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .select('created_by_admin_user_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) throw projectError
  const ownerAdminUserId = typeof projectRow?.created_by_admin_user_id === 'string' ? projectRow.created_by_admin_user_id : null

  if (hasSupabaseServiceRoleKey) {
    const { data, error: assignmentError } = await supabase
      .from('project_admin_assignments')
      .select('admin_user_id, assigned_by, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (assignmentError) throw assignmentError
    assignmentRows = data ?? []
  } else {
    const { data, error } = await supabase.rpc('list_project_admin_assignments_rpc', {
      input_project_id: projectId,
    })

    if (error) throw error
    assignmentRows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      admin_user_id: typeof row.admin_user_id === 'string' ? row.admin_user_id : null,
      assigned_by: typeof row.assigned_by === 'string' ? row.assigned_by : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
    }))
  }

  const ids = new Set<string>()
  if (ownerAdminUserId) ids.add(ownerAdminUserId)
  for (const row of assignmentRows) {
    if (typeof row.admin_user_id === 'string' && row.admin_user_id) ids.add(row.admin_user_id)
  }

  const users = await Promise.all(Array.from(ids).map(async (adminUserId) => ({
    adminUserId,
    user: await findAdminUserById(adminUserId),
  })))
  const usersById = new Map(users.filter((entry) => entry.user).map((entry) => [entry.adminUserId, entry.user!]))
  const assignmentsById = new Map<string, { assignedAt?: string; assignedBy?: string | null }>()
  for (const row of assignmentRows) {
    if (typeof row.admin_user_id !== 'string' || !row.admin_user_id) continue
    assignmentsById.set(row.admin_user_id, {
      assignedAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      assignedBy: typeof row.assigned_by === 'string' ? row.assigned_by : null,
    })
  }

  const list = Array.from(ids)
    .map<ProjectAssignmentListItem | null>((adminUserId) => {
      const user = usersById.get(adminUserId)
      if (!user) return null
      const assignmentMeta = assignmentsById.get(adminUserId)
      return {
        adminUserId,
        shortId: user.short_id,
        username: user.username,
        role: user.role,
        isActive: user.is_active,
        isOwner: ownerAdminUserId === adminUserId,
        assignedAt: assignmentMeta?.assignedAt,
        assignedBy: assignmentMeta?.assignedBy ?? null,
      }
    })
    .filter((value): value is ProjectAssignmentListItem => value !== null)

  return list.sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1
    return a.username.localeCompare(b.username)
  })
}
