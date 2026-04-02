import { supabase } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params

    const { data, error } = await supabase
      .from('project_folders')
      .select('id, name')
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
  try {
    const { id } = await context.params
    const { name } = await req.json()

    if (!name || typeof name !== 'string' || !name.trim()) {
      return Response.json({ success: false, error: 'Invalid folder name' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('project_folders')
      .insert([{ project_id: id, name: name.trim() }])
      .select('id, name')
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
  try {
    const { id } = await context.params
    const { folderId } = await req.json()

    if (!folderId || typeof folderId !== 'string') {
      return Response.json({ success: false, error: 'Invalid folder id' }, { status: 400 })
    }

    const { error } = await supabase
      .from('project_folders')
      .delete()
      .eq('id', folderId)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
