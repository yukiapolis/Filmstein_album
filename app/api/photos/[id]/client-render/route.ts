export const runtime = 'nodejs';

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import { resolvePhotoPublicUrl } from '@/lib/resolvePhotoPublicUrl'

type RouteContext = { params: Promise<{ id: string }> }

type CacheEntry = {
  buffer: Buffer
  contentType: string
  filename: string
  expiresAt: number
}

const watermarkedImageCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 1000 * 60 * 10

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase env')
  }

  return createClient(supabaseUrl, supabaseKey)
}

function getCacheKey(input: {
  photoId: string
  mode: 'preview' | 'download'
  versionNo: number
  logoUrl?: string
  position: string
  offsetX: number
  offsetY: number
  scale: number
  opacity: number
}) {
  return JSON.stringify(input)
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
      .select('project_assets, visual_settings')
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
      : latestVersion?.byBranch.display ?? null

    if (mode === 'preview' && !targetFile) {
      return Response.json({ error: 'No display preview file found' }, { status: 404 })
    }

    if (!targetFile) return Response.json({ error: 'No file found' }, { status: 404 })

    const versionNo = Number(targetFile.version_no ?? latestVersion?.versionNo ?? 1)
    const imageUrl = resolvePhotoPublicUrl(targetFile as unknown as Record<string, unknown>)
    if (!imageUrl) return Response.json({ error: 'Image source unavailable' }, { status: 404 })

    const cacheKey = getCacheKey({
      photoId: id,
      mode,
      versionNo,
      logoUrl,
      position: String(watermark.position || 'bottom-right'),
      offsetX: Number(watermark.offset_x ?? 0),
      offsetY: Number(watermark.offset_y ?? 0),
      scale: Number(watermark.scale ?? 1),
      opacity: Number(watermark.opacity ?? 1),
    })

    const cached = watermarkedImageCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(headOnly ? null : new Uint8Array(cached.buffer), {
        headers: {
          'Content-Type': cached.contentType,
          'Content-Disposition': mode === 'download'
            ? `attachment; filename*=UTF-8''${encodeURIComponent(cached.filename)}`
            : `inline; filename*=UTF-8''${encodeURIComponent(cached.filename)}`,
          'Cache-Control': 'public, max-age=600',
          'X-Watermark-Cache': 'HIT',
        },
      })
    }

    if (!watermarkEnabled) {
      const upstream = await fetch(imageUrl)
      if (!upstream.ok) return Response.json({ error: 'Failed to fetch image source' }, { status: 502 })
      return new Response(headOnly ? null : upstream.body, {
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
          'Content-Disposition': mode === 'download'
            ? `attachment; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`
            : `inline; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`,
          'Cache-Control': 'public, max-age=300',
          'X-Watermark-Cache': 'BYPASS',
        },
      })
    }

    const [imageRes, logoRes] = await Promise.all([
      fetch(imageUrl),
      fetch(logoUrl!),
    ])

    if (!imageRes.ok) {
      if (mode === 'download' && latestVersion?.byBranch.display) {
        const displayUrl = resolvePhotoPublicUrl(latestVersion.byBranch.display as unknown as Record<string, unknown>)
        if (displayUrl) {
          const fallbackRes = await fetch(displayUrl)
          if (fallbackRes.ok) {
            const fallbackBuffer = Buffer.from(await fallbackRes.arrayBuffer())
            return new Response(headOnly ? null : new Uint8Array(fallbackBuffer), {
              headers: {
                'Content-Type': fallbackRes.headers.get('content-type') || 'image/jpeg',
                'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${photoRow.global_photo_id}-display-fallback.jpg`)}`,
                'Cache-Control': 'public, max-age=300',
                'X-Watermark-Cache': 'FALLBACK',
              },
            })
          }
        }
      }
      return Response.json({ error: 'Failed to fetch image source' }, { status: 502 })
    }
    if (!logoRes.ok) return Response.json({ error: 'Failed to fetch watermark logo' }, { status: 502 })

    const [imageBuffer, logoBuffer] = await Promise.all([
      imageRes.arrayBuffer().then((buffer) => Buffer.from(buffer)),
      logoRes.arrayBuffer().then((buffer) => Buffer.from(buffer)),
    ])

    const baseMeta = await sharp(imageBuffer).metadata()
    const width = baseMeta.width || 1600
    const height = baseMeta.height || 1200
    const scale = Math.max(0.2, Number(watermark.scale ?? 1))
    const opacity = Math.min(1, Math.max(0, Number(watermark.opacity ?? 1)))
    const offsetXRatio = Number(watermark.offset_x ?? 0) / 100
    const offsetYRatio = Number(watermark.offset_y ?? 0) / 100
    const sizeBasis = Math.min(width, height)
    const logoWidth = Math.max(80, Math.round(sizeBasis * (mode === 'download' ? 0.18 : 0.16) * scale))
    const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidth }).png().toBuffer()
    const resizedMeta = await sharp(resizedLogo).metadata()
    const wmWidth = resizedMeta.width || logoWidth
    const wmHeight = resizedMeta.height || Math.round(logoWidth / 2)
    const position = String(watermark.position || 'bottom-right')

    const marginX = Math.round(sizeBasis * 0.04)
    const marginY = Math.round(sizeBasis * 0.04)
    const offsetXPx = Math.round(width * offsetXRatio)
    const offsetYPx = Math.round(height * offsetYRatio)

    let left = Math.max(16, width - wmWidth - marginX + offsetXPx)
    let top = Math.max(16, height - wmHeight - marginY + offsetYPx)

    if (position === 'top-left') {
      left = marginX + offsetXPx
      top = marginY + offsetYPx
    } else if (position === 'top-right') {
      left = width - wmWidth - marginX + offsetXPx
      top = marginY + offsetYPx
    } else if (position === 'bottom-left') {
      left = marginX + offsetXPx
      top = height - wmHeight - marginY + offsetYPx
    } else if (position === 'custom') {
      left = Math.round(width / 2 - wmWidth / 2 + offsetXPx)
      top = Math.round(height / 2 - wmHeight / 2 + offsetYPx)
    }

    const logoWithOpacity = await sharp(resizedLogo).ensureAlpha(opacity).png().toBuffer()
    const outputBuffer = Buffer.from(await sharp(imageBuffer)
      .composite([{ input: logoWithOpacity, left: Math.max(0, left), top: Math.max(0, top), blend: 'over' }])
      .jpeg({ quality: mode === 'download' ? 92 : 84, mozjpeg: true })
      .toBuffer())

    const filename = `${photoRow.global_photo_id}-${mode === 'download' ? 'watermarked-large' : 'watermarked-preview'}.jpg`
    watermarkedImageCache.set(cacheKey, {
      buffer: outputBuffer,
      contentType: 'image/jpeg',
      filename,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    return new Response(headOnly ? null : new Uint8Array(outputBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': mode === 'download'
          ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
          : `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'public, max-age=600',
        'X-Watermark-Cache': 'MISS',
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
