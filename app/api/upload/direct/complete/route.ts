import { HeadObjectCommand } from '@aws-sdk/client-s3'

import { requireAdminApiAuth } from '@/lib/auth/session'
import { getProjectPermissionContext } from '@/lib/auth/projectPermissions'
import { r2 } from '@/lib/r2/client'
import { supabase } from '@/lib/supabase/server'
import { claimUploadSessionForProcessing, processDirectUploadSession, setPhotoPendingUploadState } from '@/lib/uploadDirect'

export async function POST(req: Request) {
  const auth = await requireAdminApiAuth()
  if (auth instanceof Response) return auth

  try {
    const body = await req.json().catch(() => null)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sessionId) {
      return Response.json({ success: false, error: 'Missing sessionId' }, { status: 400 })
    }

    const { data: session, error: sessionError } = await supabase
      .from('upload_sessions')
      .select('id, project_id, target_photo_id, file_name, source_bucket_name, source_object_key, file_size_bytes, status, classification, upload_decision, matched_photo_id')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError) {
      return Response.json({ success: false, error: sessionError.message }, { status: 500 })
    }
    if (!session) {
      return Response.json({ success: false, error: 'Upload session not found' }, { status: 404 })
    }

    const permission = await getProjectPermissionContext(auth, String(session.project_id))
    if (!permission.exists) {
      return Response.json({ success: false, error: 'Project not found' }, { status: 404 })
    }
    if (!permission.canManageProject) {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    if (session.status === 'completed') {
      return Response.json({ success: true, data: { sessionId, status: 'completed' } })
    }
    if (session.status === 'processing') {
      return Response.json({ success: true, data: { sessionId, status: 'processing' } })
    }
    if (session.status === 'uploaded') {
      return Response.json({ success: true, data: { sessionId, status: 'uploaded' } })
    }

    if (!session.source_bucket_name || !session.source_object_key) {
      return Response.json({ success: false, error: 'Upload source is missing' }, { status: 400 })
    }

    const head = await r2.send(new HeadObjectCommand({
      Bucket: String(session.source_bucket_name),
      Key: String(session.source_object_key),
    }))

    const remoteSize = Number(head.ContentLength ?? 0)
    if (remoteSize > 0 && Number(session.file_size_bytes) > 0 && remoteSize !== Number(session.file_size_bytes)) {
      return Response.json({ success: false, error: `Uploaded object size mismatch (${remoteSize} != ${session.file_size_bytes})` }, { status: 409 })
    }

    const { error: markUploadedError } = await supabase
      .from('upload_sessions')
      .update({ status: 'uploaded', processing_error: null })
      .eq('id', sessionId)

    const shouldUsePlaceholderState = Boolean(session.target_photo_id)
      && session.upload_decision !== 'overwrite'
      && session.classification !== 'retouch_upload'
      && !session.matched_photo_id

    if (!markUploadedError && shouldUsePlaceholderState && session.target_photo_id) {
      await setPhotoPendingUploadState({
        photoId: String(session.target_photo_id),
        sessionId,
        fileName: String(session.file_name || 'untitled'),
        status: 'uploaded',
        message: 'Upload complete. Waiting for background processing…',
      }).catch(() => undefined)
    }

    if (markUploadedError) {
      return Response.json({ success: false, error: markUploadedError.message }, { status: 500 })
    }

    void (async () => {
      try {
        const claimed = await claimUploadSessionForProcessing(sessionId)
        if (!claimed) return
        await processDirectUploadSession(sessionId, { alreadyClaimed: true })
      } catch (error) {
        console.error('[upload/direct/complete] background trigger failed:', error)
      }
    })()

    return Response.json({
      success: true,
      data: {
        sessionId,
        status: 'uploaded',
        acceptedForBackgroundProcessing: true,
      },
    })
  } catch (error) {
    console.error('[upload/direct/complete] error:', error)
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
