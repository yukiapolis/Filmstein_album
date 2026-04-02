import { supabase } from '@/lib/supabase/server'

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { photoIds, folderId } = body

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ success: false, error: 'No photo IDs provided' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (folderId === null || folderId === 'null') {
      updates.folder_id = null
    } else if (folderId) {
      updates.folder_id = folderId
    }

    const { error } = await supabase
      .from('photos')
      .update(updates)
      .in('global_photo_id', photoIds)

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
