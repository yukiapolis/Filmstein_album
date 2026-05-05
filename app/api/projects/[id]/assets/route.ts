import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2/client'
import { supabase } from '@/lib/supabase/server'

const ASSET_RULES: Record<string, { maxBytes: number; mime: RegExp }> = {
  cover: { maxBytes: 1024 * 1024, mime: /^image\/(jpeg|jpg|png|webp)$/i },
  banner: { maxBytes: 1024 * 1024, mime: /^image\/(jpeg|jpg|png|webp)$/i },
  splash_poster: { maxBytes: 5 * 1024 * 1024, mime: /^image\/(jpeg|jpg|png|webp)$/i },
  loading_gif: { maxBytes: 10 * 1024 * 1024, mime: /^image\/gif$/i },
  watermark_logo: { maxBytes: 5 * 1024 * 1024, mime: /^(image\/png|image\/svg\+xml)$/i },
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const form = await req.formData()
    const file = form.get('file') as File | null
    const assetType = String(form.get('assetType') || '')

    if (!file || !ASSET_RULES[assetType]) {
      return Response.json({ success: false, error: 'Invalid asset upload request' }, { status: 400 })
    }

    const rule = ASSET_RULES[assetType]
    if (file.size > rule.maxBytes) {
      return Response.json({ success: false, error: 'File too large' }, { status: 400 })
    }
    if (!rule.mime.test(file.type || '')) {
      return Response.json({ success: false, error: 'Invalid file type' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : ''
    const key = `projects/${id}/assets/${assetType}${ext}`
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    }))

    const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const url = `${base}/${key}`

    const { data: projectRow, error: projectError } = await supabase
      .from('projects')
      .select('project_assets')
      .eq('id', id)
      .maybeSingle()

    if (projectError) {
      return Response.json({ success: false, error: projectError.message }, { status: 500 })
    }

    const projectAssets = typeof projectRow?.project_assets === 'object' && projectRow.project_assets !== null
      ? projectRow.project_assets as Record<string, unknown>
      : {}

    const previousAsset = typeof projectAssets[assetType] === 'object' && projectAssets[assetType] !== null
      ? projectAssets[assetType] as Record<string, unknown>
      : {}

    const versionToken = new Date().toISOString()

    const nextProjectAssets = {
      ...projectAssets,
      [assetType]: {
        ...previousAsset,
        url,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        version_token: versionToken,
      },
    }

    const updates: Record<string, unknown> = { project_assets: nextProjectAssets }
    if (assetType === 'cover') {
      updates.cover_url = url
    }

    const { error: updateError } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', id)

    if (updateError) {
      return Response.json({ success: false, error: updateError.message }, { status: 500 })
    }

    return Response.json({ success: true, data: { assetType, url, fileName: file.name, size: file.size, versionToken } })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
