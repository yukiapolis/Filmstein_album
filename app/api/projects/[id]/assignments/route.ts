import { requireAdminApiAuth } from '@/lib/auth/session'
import { findAdminUserById, findAdminUserByShortId } from '@/lib/auth/adminStore'
import { getProjectPermissionContext, listProjectAssignments } from '@/lib/auth/projectPermissions'
import { supabase, hasSupabaseServiceRoleKey } from '@/lib/supabase/server'

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
    if (!permission.canAccessProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const assignments = await listProjectAssignments(projectId)
    return Response.json({
      success: true,
      data: {
        assignments,
        permissions: {
          canManageAssignments: permission.canManageAssignments,
          canDeleteProject: permission.canDeleteProject,
          isOwner: permission.isOwner,
          isAssigned: permission.isAssigned,
          isSuperAdmin: permission.isSuperAdmin,
          ownerAdminUserId: permission.ownerAdminUserId,
        },
      },
    })
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
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }
    if (!permission.canManageAssignments) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const adminUserShortId = typeof body?.adminUserShortId === 'string' ? body.adminUserShortId.trim().toUpperCase() : ''
    if (!adminUserShortId) {
      return Response.json({ success: false, error: 'Admin user short ID is required' }, { status: 400 })
    }

    const targetUser = await findAdminUserByShortId(adminUserShortId)
    if (!targetUser) {
      return Response.json({ success: false, error: 'Admin user short ID not found' }, { status: 404 })
    }
    if (targetUser.is_active !== true) {
      return Response.json({ success: false, error: 'Admin user is inactive' }, { status: 400 })
    }
    if (permission.ownerAdminUserId && targetUser.id === permission.ownerAdminUserId) {
      const assignments = await listProjectAssignments(projectId)
      return Response.json({ success: true, data: { assignments } })
    }

    if (hasSupabaseServiceRoleKey) {
      const { error } = await supabase
        .from('project_admin_assignments')
        .upsert({
          project_id: projectId,
          admin_user_id: targetUser.id,
          assigned_by: auth.id,
        }, { onConflict: 'project_id,admin_user_id', ignoreDuplicates: false })

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase.rpc('assign_project_admin_user', {
        input_project_id: projectId,
        input_admin_user_id: targetUser.id,
        input_assigned_by: auth.id,
      })

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }
    }

    const assignments = await listProjectAssignments(projectId)
    return Response.json({ success: true, data: { assignments } })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const { id: projectId } = await context.params
    const permission = await getProjectPermissionContext(auth, projectId)
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }
    if (!permission.canManageAssignments) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const adminUserId = typeof body?.adminUserId === 'string' ? body.adminUserId.trim() : ''
    if (!adminUserId) {
      return Response.json({ success: false, error: 'Admin user id is required' }, { status: 400 })
    }

    const targetUser = await findAdminUserById(adminUserId)
    if (!targetUser) {
      return Response.json({ success: false, error: 'Admin user not found' }, { status: 404 })
    }
    if (permission.ownerAdminUserId && adminUserId === permission.ownerAdminUserId) {
      return Response.json({ success: false, error: 'Project creator cannot be removed' }, { status: 400 })
    }

    if (hasSupabaseServiceRoleKey) {
      const { error } = await supabase
        .from('project_admin_assignments')
        .delete()
        .eq('project_id', projectId)
        .eq('admin_user_id', adminUserId)

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }
    } else {
      const { error } = await supabase.rpc('remove_project_admin_user', {
        input_project_id: projectId,
        input_admin_user_id: adminUserId,
      })

      if (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 })
      }
    }

    const assignments = await listProjectAssignments(projectId)
    return Response.json({ success: true, data: { assignments } })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
