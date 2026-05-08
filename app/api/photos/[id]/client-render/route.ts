export const runtime = 'nodejs';

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import fs from 'node:fs/promises'
import { buildLegacyCopyFromPhotoFile, isPhotoFileCopyRow, resolveCopyPublicUrl, selectReadableCopy } from '@/lib/photoFileCopies'
import type { PhotoFileCopyRow } from '@/lib/photoFileCopies'
import { buildWatermarkedClientPreview } from '@/lib/clientPreviewAsset'
import { getWatermarkVersionSignature } from '@/lib/clientWatermark'
import type { Project } from '@/data/mockData'

type RouteContext = { params: Promise<{ id: string }> }

type JsonObject = Record<string, unknown>

type CacheEntry = {
  buffer: Buffer
  contentType: string
  filename: string
  expiresAt: number
}

type LogoCacheEntry = {
  buffer: Buffer
  aspectRatio: number
  expiresAt: number
}

type OriginalCopyFailureEntry = {
  reason: string
  expiresAt: number
}

const watermarkedImageCache = new Map<string, CacheEntry>()
const watermarkLogoCache = new Map<string, LogoCacheEntry>()
const watermarkLogoInflightCache = new Map<string, Promise<{ buffer: Buffer | null, cacheHit: boolean, status?: number, aspectRatio?: number }>>()
const originalCopyFailureCache = new Map<string, OriginalCopyFailureEntry>()
const CACHE_TTL_MS = 1000 * 60 * 10
const ORIGINAL_COPY_FAILURE_TTL_MS = 1000 * 60 * 30

function msSince(startedAt: number) {
  return Date.now() - startedAt
}

function isDebugEnabled(request: NextRequest) {
  return request.nextUrl.searchParams.get('debug') === '1'
}

function buildDebugHeaders(debugEnabled: boolean, entries: Record<string, string | number | undefined>) {
  if (!debugEnabled) return {}
  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)])
  )
}

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
  watermarkVersionSignature?: string
  sourceKey?: string
}) {
  return JSON.stringify(input)
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

async function getNormalizedWatermarkLogoBuffer(input: {
  cacheKey: string
  logoUrl: string
}) {
  const cached = watermarkLogoCache.get(input.cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { buffer: cached.buffer, aspectRatio: cached.aspectRatio, cacheHit: true }
  }

  const inflight = watermarkLogoInflightCache.get(input.cacheKey)
  if (inflight) {
    return inflight
  }

  const promise = (async () => {
    const logoRes = await fetch(input.logoUrl)
    if (!logoRes.ok) {
      return { buffer: null, cacheHit: false, status: logoRes.status }
    }

    const rawBuffer = Buffer.from(await logoRes.arrayBuffer())
    const normalized = sharp(rawBuffer).rotate().ensureAlpha().resize({ width: 1200, withoutEnlargement: true })
    const metadata = await normalized.metadata()
    const normalizedBuffer = await normalized
      .png({ compressionLevel: 6, adaptiveFiltering: false })
      .toBuffer()

    const aspectRatio = (metadata.width || 1) / Math.max(1, metadata.height || 1)

    watermarkLogoCache.set(input.cacheKey, {
      buffer: normalizedBuffer,
      aspectRatio,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    return { buffer: normalizedBuffer, aspectRatio, cacheHit: false }
  })()

  watermarkLogoInflightCache.set(input.cacheKey, promise)
  try {
    return await promise
  } finally {
    watermarkLogoInflightCache.delete(input.cacheKey)
  }
}

function getOriginalCopyFailureKey(copy: PhotoFileCopyRow) {
  return [copy.storage_provider, copy.bucket_name || '', copy.storage_key].join('|')
}

function getCachedOriginalCopyFailure(copy: PhotoFileCopyRow) {
  const cached = originalCopyFailureCache.get(getOriginalCopyFailureKey(copy))
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    originalCopyFailureCache.delete(getOriginalCopyFailureKey(copy))
    return null
  }
  return cached
}

function rememberOriginalCopyFailure(copy: PhotoFileCopyRow, reason: string) {
  originalCopyFailureCache.set(getOriginalCopyFailureKey(copy), {
    reason,
    expiresAt: Date.now() + ORIGINAL_COPY_FAILURE_TTL_MS,
  })
}

function orderReadableCopies(copies: PhotoFileCopyRow[]): PhotoFileCopyRow[] {
  const available = copies.filter((copy) => copy.status === 'available' && typeof copy.storage_key === 'string' && copy.storage_key.trim())
  return [...available].sort((a, b) => {
    const suppressedDiff = Number(Boolean(getCachedOriginalCopyFailure(a))) - Number(Boolean(getCachedOriginalCopyFailure(b)))
    if (suppressedDiff !== 0) return suppressedDiff

    const primaryDiff = Number(Boolean(b.is_primary_read_source)) - Number(Boolean(a.is_primary_read_source))
    if (primaryDiff !== 0) return primaryDiff

    const healthScore = (copy: PhotoFileCopyRow) => {
      let score = 0
      if (!copy.last_error) score += 4
      if (copy.checksum_verified !== false) score += 2
      if (copy.size_verified !== false) score += 2
      return score
    }
    const healthDiff = healthScore(b) - healthScore(a)
    if (healthDiff !== 0) return healthDiff

    const providerRank = (copy: PhotoFileCopyRow) => {
      if (copy.storage_provider === 'local') return 2
      if (copy.storage_provider === 'r2') return 1
      return 0
    }
    const providerDiff = providerRank(b) - providerRank(a)
    if (providerDiff !== 0) return providerDiff

    return (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
  })
}

async function loadPreferredImageSource(params: {
  mode: 'preview' | 'download'
  latestVersion: ReturnType<typeof getLatestVersionFiles>
}) {
  const selectionStartedAt = Date.now()
  if (!params.latestVersion) {
    return {
      buffer: null as Buffer | null,
      sourceKey: '',
      sourceType: 'none' as const,
      fallbackMessage: null as string | null,
      timing: { sourceSelectMs: Date.now() - selectionStartedAt, sourceReadMs: 0 },
      debug: { hasOriginalBranch: false, originalCopyCount: 0, selectedOriginalCopy: null as Record<string, unknown> | null, originalReadFailure: null as string | null }
    }
  }

  if (params.mode === 'preview') {
    const displayFile = params.latestVersion.byBranch.display
    if (!displayFile) return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'No display preview file found', timing: { sourceSelectMs: Date.now() - selectionStartedAt, sourceReadMs: 0 }, debug: { hasOriginalBranch: Boolean(params.latestVersion.byBranch.original), originalCopyCount: 0, selectedOriginalCopy: null, originalReadFailure: null } }
    const selectedDisplayCopy = selectReadableCopy(displayFile.file_copies?.length ? displayFile.file_copies : [buildLegacyCopyFromPhotoFile(displayFile)].filter(isPhotoFileCopyRow)).copy
    const sourceSelectMs = Date.now() - selectionStartedAt
    if (selectedDisplayCopy?.storage_provider === 'local' && selectedDisplayCopy.storage_key) {
      try {
        const readStartedAt = Date.now()
        const buffer = await fs.readFile(selectedDisplayCopy.storage_key)
        return { buffer, sourceKey: selectedDisplayCopy.storage_key, sourceType: 'display-local' as const, fallbackMessage: null, timing: { sourceSelectMs, sourceReadMs: Date.now() - readStartedAt }, debug: { hasOriginalBranch: Boolean(params.latestVersion.byBranch.original), originalCopyCount: 0, selectedOriginalCopy: null, originalReadFailure: null } }
      } catch {
        // continue to URL fallback
      }
    }
    const displayUrl = resolveCopyPublicUrl(selectedDisplayCopy)
    if (!displayUrl) return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'Display preview source unavailable', timing: { sourceSelectMs, sourceReadMs: 0 }, debug: { hasOriginalBranch: Boolean(params.latestVersion.byBranch.original), originalCopyCount: 0, selectedOriginalCopy: null, originalReadFailure: null } }
    const readStartedAt = Date.now()
    const res = await fetch(displayUrl)
    if (!res.ok) return { buffer: null, sourceKey: displayUrl, sourceType: 'display' as const, fallbackMessage: 'Failed to fetch display preview', timing: { sourceSelectMs, sourceReadMs: Date.now() - readStartedAt }, debug: { hasOriginalBranch: Boolean(params.latestVersion.byBranch.original), originalCopyCount: 0, selectedOriginalCopy: null, originalReadFailure: null } }
    return { buffer: Buffer.from(await res.arrayBuffer()), sourceKey: displayUrl, sourceType: 'display' as const, fallbackMessage: null, timing: { sourceSelectMs, sourceReadMs: Date.now() - readStartedAt }, debug: { hasOriginalBranch: Boolean(params.latestVersion.byBranch.original), originalCopyCount: 0, selectedOriginalCopy: null, originalReadFailure: null } }
  }

  const originalFile = params.latestVersion.byBranch.original
  const originalCopies = originalFile?.file_copies?.length
    ? originalFile.file_copies
    : [buildLegacyCopyFromPhotoFile(originalFile ?? {})].filter(isPhotoFileCopyRow)
  const orderedOriginalCopies = orderReadableCopies(originalCopies)
    .filter((copy) => !getCachedOriginalCopyFailure(copy))
  const selectedOriginalCopy = originalFile
    ? selectReadableCopy(originalCopies).copy
    : null
  let originalReadFailure: string | null = null
  let attemptedOriginalCopyDebug: Record<string, unknown> | null = null

  for (const candidateCopy of orderedOriginalCopies) {
    attemptedOriginalCopyDebug = {
      storage_provider: candidateCopy.storage_provider,
      status: candidateCopy.status,
      is_primary_read_source: candidateCopy.is_primary_read_source,
      storage_key: candidateCopy.storage_key,
    }

    if (candidateCopy.storage_provider === 'local' && candidateCopy.storage_key) {
      try {
        const readStartedAt = Date.now()
        const buffer = await fs.readFile(candidateCopy.storage_key)
        return { buffer, sourceKey: candidateCopy.storage_key, sourceType: 'local-original' as const, fallbackMessage: null, timing: { sourceSelectMs: msSince(selectionStartedAt), sourceReadMs: msSince(readStartedAt) }, debug: { hasOriginalBranch: Boolean(originalFile), originalCopyCount: originalCopies.length, selectedOriginalCopy: attemptedOriginalCopyDebug, originalReadFailure: null } }
      } catch (error) {
        originalReadFailure = error instanceof Error ? error.message : String(error)
        rememberOriginalCopyFailure(candidateCopy, originalReadFailure)
        console.warn('[client-render] original local copy read failed, trying next copy', {
          storageKey: candidateCopy.storage_key,
          error: originalReadFailure,
        })
        continue
      }
    }

    const originalUrl = resolveCopyPublicUrl(candidateCopy)
    if (!originalUrl) {
      originalReadFailure = 'original copy resolved to empty URL'
      continue
    }

    try {
      const readStartedAt = Date.now()
      const res = await fetch(originalUrl)
      if (res.ok) {
        return { buffer: Buffer.from(await res.arrayBuffer()), sourceKey: originalUrl, sourceType: 'remote-original' as const, fallbackMessage: null, timing: { sourceSelectMs: msSince(selectionStartedAt), sourceReadMs: msSince(readStartedAt) }, debug: { hasOriginalBranch: Boolean(originalFile), originalCopyCount: originalCopies.length, selectedOriginalCopy: attemptedOriginalCopyDebug, originalReadFailure: null } }
      }
      originalReadFailure = `remote original fetch failed (${res.status})`
      if (res.status === 404 || res.status === 410) {
        rememberOriginalCopyFailure(candidateCopy, originalReadFailure)
      }
      console.warn('[client-render] original remote copy fetch failed, trying next copy', {
        storageKey: candidateCopy.storage_key,
        status: res.status,
      })
    } catch (error) {
      originalReadFailure = error instanceof Error ? error.message : String(error)
      rememberOriginalCopyFailure(candidateCopy, originalReadFailure)
      console.warn('[client-render] original remote copy request threw, trying next copy', {
        storageKey: candidateCopy.storage_key,
        error: originalReadFailure,
      })
    }
  }

  const sourceSelectMs = Date.now() - selectionStartedAt

  const originalCopyDebug = attemptedOriginalCopyDebug ?? (selectedOriginalCopy
    ? {
        storage_provider: selectedOriginalCopy.storage_provider,
        status: selectedOriginalCopy.status,
        is_primary_read_source: selectedOriginalCopy.is_primary_read_source,
        storage_key: selectedOriginalCopy.storage_key,
      }
    : null)

  const displayFile = params.latestVersion.byBranch.display
  if (displayFile) {
    const selectedDisplayCopy = selectReadableCopy(displayFile.file_copies?.length ? displayFile.file_copies : [buildLegacyCopyFromPhotoFile(displayFile)].filter(isPhotoFileCopyRow)).copy
    if (selectedDisplayCopy?.storage_provider === 'local' && selectedDisplayCopy.storage_key) {
      try {
        const readStartedAt = Date.now()
        const buffer = await fs.readFile(selectedDisplayCopy.storage_key)
        return {
          buffer,
          sourceKey: selectedDisplayCopy.storage_key,
          sourceType: 'display-fallback' as const,
          fallbackMessage: 'High-resolution original unavailable, using highest available display version',
          timing: { sourceSelectMs, sourceReadMs: Date.now() - readStartedAt },
          debug: { hasOriginalBranch: Boolean(originalFile), originalCopyCount: originalCopies.length, selectedOriginalCopy: originalCopyDebug, originalReadFailure },
        }
      } catch {
        // continue to url fallback
      }
    }
    const displayUrl = resolveCopyPublicUrl(selectedDisplayCopy)
    if (displayUrl) {
      const readStartedAt = Date.now()
      const res = await fetch(displayUrl)
      if (res.ok) {
        return {
          buffer: Buffer.from(await res.arrayBuffer()),
          sourceKey: displayUrl,
          sourceType: 'display-fallback' as const,
          fallbackMessage: 'High-resolution original unavailable, using highest available display version',
          timing: { sourceSelectMs, sourceReadMs: Date.now() - readStartedAt },
          debug: { hasOriginalBranch: Boolean(originalFile), originalCopyCount: originalCopies.length, selectedOriginalCopy: originalCopyDebug, originalReadFailure },
        }
      }
    }
  }

  return { buffer: null, sourceKey: '', sourceType: 'none' as const, fallbackMessage: 'High-resolution original unavailable, current preview is the highest available quality', timing: { sourceSelectMs, sourceReadMs: 0 }, debug: { hasOriginalBranch: Boolean(originalFile), originalCopyCount: originalCopies.length, selectedOriginalCopy: originalCopyDebug, originalReadFailure } }
}

async function buildClientImage(request: NextRequest, context: RouteContext, headOnly = false) {
  const requestStartedAt = Date.now()
  const debugEnabled = isDebugEnabled(request)
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

    const visualSettings = asRecord(projectRow?.visual_settings)
    const projectAssets = asRecord(projectRow?.project_assets)
    const watermark = asRecord(visualSettings?.watermark) ?? {}
    const watermarkLogo = asRecord(projectAssets?.watermark_logo)
    const logoUrl = typeof watermarkLogo?.url === 'string' ? watermarkLogo.url : undefined
    const watermarkVersionSignature = getWatermarkVersionSignature({
      project_assets: (projectRow?.project_assets as Project['project_assets']) || undefined,
      visual_settings: (projectRow?.visual_settings as Project['visual_settings']) || undefined,
    } as Project)
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
    const debugSourceMeta = Buffer.from(JSON.stringify(source.debug ?? {})).toString('base64url')
    if (!source.buffer) {
      return Response.json({ error: source.fallbackMessage || 'Image source unavailable' }, { status: 404, headers: {
        'X-Debug-Source-Meta': debugSourceMeta,
        ...buildDebugHeaders(debugEnabled, {
          'X-Debug-Preview-Path': 'client-render',
          'X-Debug-Render-Mode': mode,
          'X-Debug-Image-Source': source.sourceType,
          'X-Debug-Watermark-Version': watermarkVersionSignature,
          'X-Debug-Source-Select-Ms': source.timing?.sourceSelectMs,
          'X-Debug-Source-Read-Ms': source.timing?.sourceReadMs,
          'X-Debug-Total-Ms': msSince(requestStartedAt),
        }),
      } })
    }

    if (debugEnabled) {
      console.debug('[client-render]', {
        photoId: id,
        mode,
        sourceType: source.sourceType,
        sourceKey: source.sourceKey,
        sourceSelectMs: source.timing?.sourceSelectMs ?? null,
        sourceReadMs: source.timing?.sourceReadMs ?? null,
      })
    }

    const sourceBuffer = source.buffer
    const versionNo = Number(latestVersion.versionNo ?? 1)
    const cacheKey = getCacheKey({
      photoId: id,
      mode,
      versionNo,
      watermarkVersionSignature,
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
          'X-Debug-Source-Meta': debugSourceMeta,
          ...buildDebugHeaders(debugEnabled, {
            'X-Debug-Preview-Path': 'client-render',
            'X-Debug-Preview-Source-Url': source.sourceKey,
            'X-Debug-Render-Mode': mode,
            'X-Debug-Image-Source': source.sourceType,
            'X-Debug-Watermark-Version': watermarkVersionSignature,
            'X-Debug-Source-Select-Ms': source.timing?.sourceSelectMs,
            'X-Debug-Source-Read-Ms': source.timing?.sourceReadMs,
            'X-Debug-Watermark-Fetch-Ms': 0,
            'X-Debug-Composite-Ms': 0,
            'X-Debug-Total-Ms': msSince(requestStartedAt),
          }),
          ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
        },
      })
    }

    if (!watermarkEnabled) {
      return new Response(headOnly ? null : new Uint8Array(sourceBuffer), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`,
          'Cache-Control': 'public, max-age=300',
          'X-Watermark-Cache': 'BYPASS',
          'X-Image-Source': source.sourceType,
          'X-Debug-Source-Meta': debugSourceMeta,
          ...buildDebugHeaders(debugEnabled, {
            'X-Debug-Preview-Path': 'client-render',
            'X-Debug-Preview-Source-Url': source.sourceKey,
            'X-Debug-Render-Mode': mode,
            'X-Debug-Image-Source': source.sourceType,
            'X-Debug-Watermark-Version': watermarkVersionSignature,
            'X-Debug-Source-Select-Ms': source.timing?.sourceSelectMs,
            'X-Debug-Source-Read-Ms': source.timing?.sourceReadMs,
            'X-Debug-Watermark-Fetch-Ms': 0,
            'X-Debug-Composite-Ms': 0,
            'X-Debug-Total-Ms': msSince(requestStartedAt),
          }),
          ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
        },
      })
    }

    const logoFetchUrl = logoUrl?.startsWith('http')
      ? `${request.nextUrl.origin}/api/projects/${photoRow.project_id}/assets/watermark_logo`
      : logoUrl!

    const buildBypassResponse = (fallbackReason: string, watermarkFetchMs = 0, compositeMs = 0) => new Response(headOnly ? null : new Uint8Array(sourceBuffer), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(`${id}-${mode}.jpg`)}`,
        'Cache-Control': 'public, max-age=300',
        'X-Watermark-Cache': 'BYPASS',
        'X-Image-Source': source.sourceType,
        'X-Debug-Source-Meta': debugSourceMeta,
        'X-Watermark-Fallback': fallbackReason,
        'X-Watermark-Logo-Url': logoFetchUrl,
        ...buildDebugHeaders(debugEnabled, {
          'X-Debug-Preview-Path': 'client-render',
          'X-Debug-Preview-Source-Url': source.sourceKey,
          'X-Debug-Render-Mode': mode,
          'X-Debug-Image-Source': source.sourceType,
          'X-Debug-Watermark-Version': watermarkVersionSignature,
          'X-Debug-Source-Select-Ms': source.timing?.sourceSelectMs,
          'X-Debug-Source-Read-Ms': source.timing?.sourceReadMs,
          'X-Debug-Watermark-Url': logoFetchUrl,
          'X-Debug-Watermark-Fetch-Ms': watermarkFetchMs,
          'X-Debug-Composite-Ms': compositeMs,
          'X-Debug-Total-Ms': msSince(requestStartedAt),
        }),
        ...(source.fallbackMessage ? { 'X-Image-Fallback': source.fallbackMessage } : {}),
      },
    })

    let logoResult: Awaited<ReturnType<typeof getNormalizedWatermarkLogoBuffer>>
    const watermarkFetchStartedAt = Date.now()
    const logoCacheKey = `${photoRow.project_id}:${watermarkVersionSignature}`
    try {
      logoResult = await getNormalizedWatermarkLogoBuffer({
        cacheKey: logoCacheKey,
        logoUrl: logoFetchUrl,
      })
    } catch {
      return buildBypassResponse('logo-fetch-threw', msSince(watermarkFetchStartedAt), 0)
    }
    const watermarkFetchMs = msSince(watermarkFetchStartedAt)
    if (!logoResult.buffer) {
      return buildBypassResponse('logo-fetch-failed', watermarkFetchMs, 0)
    }
    const logoBuffer = logoResult.buffer

    let outputBuffer: Buffer
    const compositeStartedAt = Date.now()
    try {
      outputBuffer = await buildWatermarkedClientPreview({
        sourceBuffer,
        logoBuffer,
        logoAspectRatio: logoResult.aspectRatio,
        watermark,
        mode,
      })
    } catch {
      return buildBypassResponse('watermark-composite-failed', watermarkFetchMs, msSince(compositeStartedAt))
    }

    const compositeMs = msSince(compositeStartedAt)

    if (debugEnabled) {
      console.debug('[client-render]', {
        photoId: id,
        mode,
        sourceType: source.sourceType,
        sourceUrl: source.sourceKey,
        watermarkUrl: logoFetchUrl,
        watermarkCacheHit: logoResult.cacheHit,
        sourceSelectMs: source.timing?.sourceSelectMs ?? null,
        sourceReadMs: source.timing?.sourceReadMs ?? null,
        watermarkFetchMs,
        compositeMs,
        totalMs: msSince(requestStartedAt),
      })
    }

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
        'X-Debug-Source-Meta': debugSourceMeta,
        ...buildDebugHeaders(debugEnabled, {
          'X-Debug-Preview-Path': 'client-render',
          'X-Debug-Preview-Source-Url': source.sourceKey,
          'X-Debug-Render-Mode': mode,
          'X-Debug-Image-Source': source.sourceType,
          'X-Debug-Watermark-Version': watermarkVersionSignature,
          'X-Debug-Source-Select-Ms': source.timing?.sourceSelectMs,
          'X-Debug-Source-Read-Ms': source.timing?.sourceReadMs,
          'X-Debug-Watermark-Url': logoFetchUrl,
          'X-Debug-Watermark-Fetch-Ms': watermarkFetchMs,
          'X-Debug-Composite-Ms': compositeMs,
          'X-Debug-Total-Ms': msSince(requestStartedAt),
        }),
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
