export const runtime = 'nodejs';

import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import fs from 'node:fs/promises'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow, resolveCopyPublicUrl, selectReadableCopy } from '@/lib/photoFileCopies'

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
  sourceKey?: string
}) {
  return JSON.stringify(input)
}

async function loadPreferredImageSource(params: {
  mode: 'preview' | 'download'
  latestVersion: ReturnType<typeof getLatestVersionFiles>
}) {
  if (!params.latestVersion) {
    return { buffer: null as Buffer | null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: null as string | null }
  }

  if (params.mode === 'preview') {
    const displayFile = params.latestVersion.byBranch.display
    if (!displayFile) return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'No display preview file found' }
    const selectedDisplayCopy = selectReadableCopy(displayFile.file_copies?.length ? displayFile.file_copies : [buildLegacyCopyFromPhotoFile(displayFile)].filter(isPhotoFileCopyRow)).copy
    if (selectedDisplayCopy?.storage_provider === 'local' && selectedDisplayCopy.storage_key) {
      try {
        const buffer = await fs.readFile(selectedDisplayCopy.storage_key)
        return { buffer, sourceKey: selectedDisplayCopy.storage_key, sourceType: 'display-local' as const, fallbackMessage: null }
      } catch {
        // continue to URL fallback
      }
    }
    const displayUrl = resolveCopyPublicUrl(selectedDisplayCopy)
    if (!displayUrl) return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'Display preview source unavailable' }
    const res = await fetch(displayUrl)
    if (!res.ok) return { buffer: null, sourceKey: displayUrl, sourceType: 'display' as const, fallbackMessage: 'Failed to fetch display preview' }
    return { buffer: Buffer.from(await res.arrayBuffer()), sourceKey: displayUrl, sourceType: 'display' as const, fallbackMessage: null }
  }

  const originalFile = params.latestVersion.byBranch.original
  const selectedOriginalCopy = originalFile
    ? selectReadableCopy(originalFile.file_copies?.length ? originalFile.file_copies : [buildLegacyCopyFromPhotoFile(originalFile)].filter(isPhotoFileCopyRow)).copy
    : null
  if (selectedOriginalCopy?.storage_provider === 'local' && selectedOriginalCopy.storage_key) {
    try {
      const buffer = await fs.readFile(selectedOriginalCopy.storage_key)
      return { buffer, sourceKey: selectedOriginalCopy.storage_key, sourceType: 'local-original' as const, fallbackMessage: null }
    } catch {
      // continue to fallback chain
    }
  }

  if (selectedOriginalCopy) {
    const originalUrl = resolveCopyPublicUrl(selectedOriginalCopy)
    if (originalUrl) {
      const res = await fetch(originalUrl)
      if (res.ok) {
        return { buffer: Buffer.from(await res.arrayBuffer()), sourceKey: originalUrl, sourceType: 'remote-original' as const, fallbackMessage: null }
      }
    }
  }

  const displayFile = params.latestVersion.byBranch.display
  if (displayFile) {
    const selectedDisplayCopy = selectReadableCopy(displayFile.file_copies?.length ? displayFile.file_copies : [buildLegacyCopyFromPhotoFile(displayFile)].filter(isPhotoFileCopyRow)).copy
    if (selectedDisplayCopy?.storage_provider === 'local' && selectedDisplayCopy.storage_key) {
      try {
        const buffer = await fs.readFile(selectedDisplayCopy.storage_key)
        return {
          buffer,
          sourceKey: selectedDisplayCopy.storage_key,
          sourceType: 'display-fallback' as const,
          fallbackMessage: 'High-resolution original unavailable, using highest available display version',
        }
      } catch {
        // continue to url fallback
      }
    }
    const displayUrl = resolveCopyPublicUrl(selectedDisplayCopy)
    if (displayUrl) {
      const res = await fetch(displayUrl)
      if (res.ok) {
        return {
          buffer: Buffer.from(await res.arrayBuffer()),
          sourceKey: displayUrl,
          sourceType: 'display-fallback' as const,
          fallbackMessage: 'High-resolution original unavailable, using highest available display version',
        }
      }
    }
  }

  return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'High-resolution original unavailable, current preview is the highest available quality' }
}

async function buildClientImage(request: NextRequest, context: RouteContext, headOnly = false) {
  try {
    const { id } = await context.params
    const supabase = getSupabaseAdmin()
    const mode = request.nextUrl.searchParams.get('mode') === 'download' ? 'download' : 'preview'
    const disposition = request.nextUrl.searchParams.get('disposition') === 'attachment' ? 'attachment' : 'inline'

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
      .select('id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at, file_size_bytes, checksum_sha256, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)')
      .eq('photo_id', id)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (fileError) return Response.json({ error: fileError.message }, { status: 500 })

    const latestVersion = getLatestVersionFiles((fileRows ?? []) as PhotoFileRow[])
    if (!latestVersion) return Response.json({ error: 'No file found' }, { status: 404 })

    const source = await loadPreferredImageSource({ mode, latestVersion })
    if (!source.buffer) {
      return Response.json({ error: source.fallbackMessage || 'Image source unavailable' }, { status: 404 })
    }

    const versionNo = Number(latestVersion.versionNo ?? 1)
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
      sourceKey: source.sourceKey,
    })

    const cached = watermarkedImageCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return new Response(headOnly ? null : new Uint8Array(cached.buffer), {
        headers: {
          'Content-Type': cached.contentType,
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(cached.filename)}`,
          'Cache-Control': 'public, max-age=600',
          'X-Watermark-Cache': 'HIT',
          'X-Image-Source': source.sourceType,
          ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
        },
      })
    }

    if (!watermarkEnabled) {
      return new Response(headOnly ? null : new Uint8Array(source.buffer), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`,
          'Cache-Control': 'public, max-age=300',
          'X-Watermark-Cache': 'BYPASS',
          'X-Image-Source': source.sourceType,
          ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
        },
      })
    }

    const logoRes = await fetch(logoUrl!)
    if (!logoRes.ok) {
      return new Response(headOnly ? null : new Uint8Array(source.buffer), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`,
          'Cache-Control': 'public, max-age=300',
          'X-Watermark-Cache': 'BYPASS',
          'X-Image-Source': source.sourceType,
          'X-Watermark-Fallback': 'logo-fetch-failed',
          ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
        },
      })
    }
    const logoBuffer = Buffer.from(await logoRes.arrayBuffer())

    const baseMeta = await sharp(source.buffer).metadata()
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
    const outputBuffer = Buffer.from(await sharp(source.buffer)
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
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'public, max-age=600',
        'X-Watermark-Cache': 'MISS',
        'X-Image-Source': source.sourceType,
        ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
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
