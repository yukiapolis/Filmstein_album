export const runtime = 'nodejs';

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import { resolvePhotoPublicUrl } from '@/lib/resolvePhotoPublicUrl'

type RouteContext = { params: Promise<{ id: string }> }

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env')
  }

  return createClient(supabaseUrl, supabaseKey)
}

async function buildClientImage(request: NextRequest, context: RouteContext, headOnly = false) {
  try {
    const { id } = await context.params
    const supabase = getSupabaseAdmin()
    const mode = request.nextUrl.searchParams.get('mode') === 'download' ? 'download' : 'preview'

    const { data: photoRow, error: photoError } = await supabase
      .from('photos')
      .select('global_photo_id, project_id, is_published')
      .eq('global_photo_id', id)
      .maybeSingle()

    if (photoError) return Response.json({ error: photoError.message }, { status: 500 })
    if (!photoRow || photoRow.is_published !== true) return Response.json({ error: 'Photo is not available' }, { status: 403 })

    const { data: projectRow, error: projectError } = await supabase
      .from('projects')
      .select('project_assets, visual_settings, name')
      .eq('id', photoRow.project_id)
      .maybeSingle()

    if (projectError) return Response.json({ error: projectError.message }, { status: 500 })

    const watermark = (projectRow?.visual_settings as Record<string, any> | null)?.watermark || {}
    const logoUrl = (projectRow?.project_assets as Record<string, any> | null)?.watermark_logo?.url as string | undefined
    const watermarkEnabled = Boolean(watermark.enabled && logoUrl)

    const { data: fileRows, error: fileError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at')
      .eq('photo_id', id)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (fileError) return Response.json({ error: fileError.message }, { status: 500 })

    const latestVersion = getLatestVersionFiles((fileRows ?? []) as PhotoFileRow[])
    const targetFile = mode === 'download'
      ? latestVersion?.byBranch.original ?? latestVersion?.byBranch.display ?? null
      : latestVersion?.byBranch.display ?? latestVersion?.byBranch.original ?? null

    if (!targetFile) return Response.json({ error: 'No file found' }, { status: 404 })

    const imageUrl = resolvePhotoPublicUrl(targetFile as unknown as Record<string, unknown>)
    if (!imageUrl) return Response.json({ error: 'Image source unavailable' }, { status: 404 })

    const imageRes = await fetch(imageUrl)
    if (!imageRes.ok) return Response.json({ error: 'Failed to fetch image source' }, { status: 502 })
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

    let outputBuffer = imageBuffer
    if (watermarkEnabled && logoUrl) {
      const logoRes = await fetch(logoUrl)
      if (logoRes.ok) {
        const logoBuffer = Buffer.from(await logoRes.arrayBuffer())
        const baseMeta = await sharp(imageBuffer).metadata()
        const width = baseMeta.width || 1600
        const height = baseMeta.height || 1200
        const scale = Math.max(0.2, Number(watermark.scale ?? 1))
        const opacity = Math.min(1, Math.max(0, Number(watermark.opacity ?? 1)))
        const offsetX = Number(watermark.offset_x ?? 0)
        const offsetY = Number(watermark.offset_y ?? 0)
        const logoWidth = Math.max(80, Math.round(width * 0.18 * scale))
        const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidth }).png().toBuffer()
        const resizedMeta = await sharp(resizedLogo).metadata()
        const wmWidth = resizedMeta.width || logoWidth
        const wmHeight = resizedMeta.height || Math.round(logoWidth / 2)
        const position = String(watermark.position || 'bottom-right')

        let left = Math.max(16, width - wmWidth - 24 + offsetX)
        let top = Math.max(16, height - wmHeight - 24 + offsetY)

        if (position === 'top-left') {
          left = 24 + offsetX
          top = 24 + offsetY
        } else if (position === 'top-right') {
          left = width - wmWidth - 24 + offsetX
          top = 24 + offsetY
        } else if (position === 'bottom-left') {
          left = 24 + offsetX
          top = height - wmHeight - 24 + offsetY
        } else if (position === 'custom') {
          left = Math.round(width / 2 - wmWidth / 2 + offsetX)
          top = Math.round(height / 2 - wmHeight / 2 + offsetY)
        }

        const logoWithOpacity = await sharp(resizedLogo)
          .ensureAlpha(opacity)
          .png()
          .toBuffer()

        outputBuffer = Buffer.from(await sharp(imageBuffer)
          .composite([{ input: logoWithOpacity, left: Math.max(0, left), top: Math.max(0, top), blend: 'over' }])
          .jpeg({ quality: mode === 'download' ? 95 : 88 })
          .toBuffer())
      }
    }

    const filename = `${photoRow.global_photo_id}-${mode === 'download' ? 'watermarked-large' : 'watermarked-preview'}.jpg`
    return new Response(headOnly ? null : outputBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': mode === 'download'
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return buildClientImage(request, context, false)
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return buildClientImage(request, context, true)
}
