import { supabase } from '@/lib/supabase/server'
import { scanProjectStorageOrphans } from '@/lib/projectStorageOrphans'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, cover_url')
      .eq('id', id)
      .maybeSingle()

    if (projectError) {
      return Response.json({ success: false, error: projectError.message }, { status: 500 })
    }
    if (!project) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }

    const { data: photoRows, error: photoError } = await supabase
      .from('photos')
      .select('global_photo_id, original_file_id, retouched_file_id')
      .eq('project_id', id)

    if (photoError) {
      return Response.json({ success: false, error: photoError.message }, { status: 500 })
    }

    const photoIds = (photoRows ?? []).map((row) => row.global_photo_id)
    const { data: photoFiles, error: fileError } = await supabase
      .from('photo_files')
      .select('photo_id, object_key, storage_provider, bucket_name, file_size_bytes, created_at, branch_type')
      .in('photo_id', photoIds.length > 0 ? photoIds : ['__none__'])

    if (fileError) {
      return Response.json({ success: false, error: fileError.message }, { status: 500 })
    }

    const result = await scanProjectStorageOrphans({
      projectId: id,
      project,
      photoFiles: photoFiles ?? [],
      photos: photoRows ?? [],
    })

    return Response.json({ success: true, data: result })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
