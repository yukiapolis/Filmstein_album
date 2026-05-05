export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { r2 } from '@/lib/r2/client'
import { supabase } from '@/lib/supabase/server'
import type { ProjectAssetKey } from '@/lib/projectAssetUrl'

const ALLOWED_ASSET_TYPES = new Set<ProjectAssetKey>(['cover', 'banner', 'splash_poster', 'loading_gif', 'watermark_logo'])

function normalizeBaseUrl(value: string | undefined) {
  return (value || '').replace(/\/+$/, '')
}

function resolveAssetObjectKey(projectId: string, assetType: ProjectAssetKey, asset: Record<string, unknown> | null | undefined) {
  const rawUrl = typeof asset?.url === 'string' ? asset.url.trim() : ''
  const publicBase = normalizeBaseUrl(process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL)

  if (rawUrl && publicBase && rawUrl.startsWith(`${publicBase}/`)) {
    return rawUrl.slice(publicBase.length + 1)
  }

  const fileName = typeof asset?.file_name === 'string' ? asset.file_name.trim() : ''
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : ''
  return `projects/${projectId}/assets/${assetType}${ext}`
}

async function loadAsset(projectId: string, assetType: ProjectAssetKey) {
  const { data: projectRow, error } = await supabase
    .from('projects')
    .select('project_assets')
    .eq('id', projectId)
    .maybeSingle()

  if (error) {
    return { error: Response.json({ success: false, error: error.message }, { status: 500 }) }
  }

  const projectAssets = (projectRow?.project_assets && typeof projectRow.project_assets === 'object')
    ? projectRow.project_assets as Record<string, unknown>
    : {}

  const asset = (projectAssets[assetType] && typeof projectAssets[assetType] === 'object')
    ? projectAssets[assetType] as Record<string, unknown>
    : null

  if (!asset) {
    return { error: Response.json({ success: false, error: 'Asset not configured' }, { status: 404 }) }
  }

  const key = resolveAssetObjectKey(projectId, assetType, asset)
  return { asset, key }
}

function buildHeaders(params: { contentType?: string; contentLength?: number; fileName?: string; etag?: string }) {
  return {
    'Content-Type': params.contentType || 'application/octet-stream',
    'Content-Length': String(params.contentLength || 0),
    'Cache-Control': 'public, max-age=300',
    ...(params.fileName ? { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(params.fileName)}` } : {}),
    ...(params.etag ? { ETag: params.etag } : {}),
  }
}

export async function HEAD(_request: NextRequest, context: { params: Promise<{ id: string; assetType: string }> }) {
  try {
    const { id, assetType } = await context.params
    if (!ALLOWED_ASSET_TYPES.has(assetType as ProjectAssetKey)) {
      return Response.json({ success: false, error: 'Unsupported asset type' }, { status: 400 })
    }

    const loaded = await loadAsset(id, assetType as ProjectAssetKey)
    if ('error' in loaded) return loaded.error

    const res = await r2.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: loaded.key,
    }))

    return new Response(null, { headers: buildHeaders({
      contentType: res.ContentType || (typeof loaded.asset.mime_type === 'string' ? loaded.asset.mime_type : undefined),
      contentLength: Number(res.ContentLength || loaded.asset.file_size_bytes || 0),
      fileName: typeof loaded.asset.file_name === 'string' ? loaded.asset.file_name : undefined,
      etag: res.ETag,
    }) })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string; assetType: string }> }) {
  try {
    const { id, assetType } = await context.params
    if (!ALLOWED_ASSET_TYPES.has(assetType as ProjectAssetKey)) {
      return Response.json({ success: false, error: 'Unsupported asset type' }, { status: 400 })
    }

    const loaded = await loadAsset(id, assetType as ProjectAssetKey)
    if ('error' in loaded) return loaded.error

    const res = await r2.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: loaded.key,
    }))

    if (!res.Body) {
      return Response.json({ success: false, error: 'Asset body missing' }, { status: 404 })
    }

    const bytes = await res.Body.transformToByteArray()

    return new Response(Buffer.from(bytes), {
      headers: buildHeaders({
        contentType: res.ContentType || (typeof loaded.asset.mime_type === 'string' ? loaded.asset.mime_type : undefined),
        contentLength: bytes.byteLength,
        fileName: typeof loaded.asset.file_name === 'string' ? loaded.asset.file_name : undefined,
        etag: res.ETag,
      }),
    })
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
