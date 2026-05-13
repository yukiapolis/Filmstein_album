export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { getFirstVersionFiles, getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import { extractFolderShareAccessConfig, extractProjectShareAccessConfig, isFolderShareAccessGranted, isProjectShareAccessGranted } from '@/lib/shareAccess'

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function stripLegacyDownloadPrefixes(photoId: string, baseName: string): string {
  let name = baseName.trim()

  const escapedPhotoId = photoId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^${escapedPhotoId}_v\\d+_`, 'i'),
    new RegExp(`^${escapedPhotoId}_(?:original|retouched_original)_`, 'i'),
    new RegExp(`^${escapedPhotoId}_`, 'i'),
    /^\d+_(?:original|retouched_original)_/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of patterns) {
      const next = name.replace(pattern, '')
      if (next !== name) {
        name = next
        changed = true
      }
    }
  }

  return name || 'photo'
}

async function resolveDownload(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  options?: { headOnly?: boolean }
) {
  try {
    const { id } = await context.params;
    const variantRaw = request.nextUrl.searchParams.get("variant")
    const clientSafe = request.nextUrl.searchParams.get('clientSafe') === 'true'
    const variant = variantRaw === 'original' || variantRaw === 'retouched-original' || variantRaw === 'current' || variantRaw === 'client-original'
      ? variantRaw
      : 'original'
    if (clientSafe && variant !== 'current' && variant !== 'client-original') {
      return Response.json({ error: 'Client-safe downloads only allow public variants' }, { status: 403 });
    }

    if (!clientSafe && variant === 'client-original') {
      return Response.json({ error: 'client-original is only available in client-safe mode' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();

    if (clientSafe) {
      const { data: photoRow, error: photoError } = await supabase
        .from('photos')
        .select('global_photo_id, is_published, project_id, folder_id, projects:project_id(visual_settings), project_folders:folder_id(access_mode, password_hash)')
        .eq('global_photo_id', id)
        .maybeSingle()

      if (photoError) {
        return Response.json({ error: photoError.message }, { status: 500 });
      }

      if (!photoRow || photoRow.is_published !== true) {
        return Response.json({ error: 'Photo is not available for client download' }, { status: 403 });
      }

      const projectRow = Array.isArray(photoRow.projects) ? photoRow.projects[0] : photoRow.projects
      const shareAccess = extractProjectShareAccessConfig(projectRow?.visual_settings)
      if (shareAccess.enabled === true && shareAccess.password_hash && !isProjectShareAccessGranted(request, photoRow.project_id, shareAccess.password_hash)) {
        return Response.json({ error: 'Project password is required before downloading this photo' }, { status: 403 })
      }

      const folderRow = Array.isArray(photoRow.project_folders) ? photoRow.project_folders[0] : photoRow.project_folders
      const folderAccess = extractFolderShareAccessConfig(folderRow)
      if (folderAccess.access_mode === 'hidden') {
        return Response.json({ error: 'Photo is not available for client download' }, { status: 403 })
      }
      if (folderAccess.access_mode === 'password_protected' && folderAccess.password_hash && photoRow.folder_id && !isFolderShareAccessGranted(request, photoRow.project_id, photoRow.folder_id, folderAccess.password_hash)) {
        return Response.json({ error: 'Album password is required before downloading this photo' }, { status: 403 })
      }
    }

    const { data: fileRows, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at, file_size_bytes, checksum_sha256, file_copies:photo_file_copies(id, photo_file_id, storage_provider, bucket_name, storage_key, status, checksum_verified, size_bytes, size_verified, is_primary_read_source, last_verified_at, last_error, created_at, updated_at)")
      .eq("photo_id", id)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (fileRows ?? []) as PhotoFileRow[]
    const latestVersion = getLatestVersionFiles(rows)
    const firstVersion = getFirstVersionFiles(rows)
    const versionCount = latestVersion && firstVersion ? new Set(rows.map((row) => Number(row.version_no) || 1)).size : 0

    const file = variant === 'current'
      ? latestVersion?.byBranch.display ?? null
      : variant === 'retouched-original' || variant === 'client-original'
        ? latestVersion?.byBranch.original ?? null
        : firstVersion?.byBranch.original ?? null

    const versionNo = variant === 'original'
      ? firstVersion?.versionNo ?? null
      : latestVersion?.versionNo ?? null

    if (!file) {
      return Response.json({ error: `No downloadable file found for variant ${variant}` }, { status: 404 });
    }

    const sourceName =
      file.original_file_name || file.file_name || file.object_key?.split("/").pop() || `${id}.jpg`;
    const ext = path.extname(sourceName).toLowerCase() || '.jpg';
    const readableBase = stripLegacyDownloadPrefixes(id, path.basename(sourceName, ext).replace(/\s+/g, '_'));
    const safeVersionNo = versionNo ?? 1
    const filename = `${id}_v${safeVersionNo}_${readableBase}${ext}`;

    const shouldUseWatermarkedHighRes = variant === 'original' || variant === 'retouched-original' || variant === 'client-original'

    if (shouldUseWatermarkedHighRes) {
      const origin = request.nextUrl.origin
      const renderUrl = `${origin}/api/photos/${id}/client-render?mode=download&disposition=attachment`
      const upstream = await fetch(renderUrl, { method: options?.headOnly ? 'HEAD' : 'GET' })
      if (!upstream.ok) {
        const errorText = await upstream.text().catch(() => '')
        return Response.json({ error: errorText || `Watermarked download failed: ${upstream.status}` }, { status: 502 })
      }

      const contentType = upstream.headers.get("content-type") || "image/jpeg"
      return new Response(options?.headOnly ? null : upstream.body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "X-Download-Route-Version": "phase1-debug-v2",
          "X-Download-Variant-Raw": variantRaw ?? '(default)',
          "X-Download-Variant": variant,
          "X-Download-Branch": "highres",
          "X-Download-Target": "client-render-download",
          "X-Download-Source": "client-render-download",
          ...(upstream.headers.get('x-image-source') ? { "X-Image-Source": upstream.headers.get('x-image-source')! } : {}),
          ...(upstream.headers.get('x-image-fallback') ? { "X-Image-Fallback": upstream.headers.get('x-image-fallback')! } : {}),
          ...(upstream.headers.get('x-watermark-fallback') ? { "X-Watermark-Fallback": upstream.headers.get('x-watermark-fallback')! } : {}),
        },
      })
    }

    const displayFile = latestVersion?.byBranch.display ?? null
    if (!displayFile) {
      return Response.json({ error: "Download source unavailable" }, { status: 404 });
    }

    const fallbackSupabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data: renderablePhoto, error: renderablePhotoError } = await fallbackSupabase
      .from('photos')
      .select('global_photo_id, is_published')
      .eq('global_photo_id', id)
      .maybeSingle()

    if (renderablePhotoError) {
      return Response.json({ error: renderablePhotoError.message }, { status: 500 })
    }

    if (!renderablePhoto || renderablePhoto.is_published !== true) {
      return Response.json({ error: 'Photo is not available for watermarked download' }, { status: 403 })
    }

    const origin = request.nextUrl.origin
    const renderUrl = `${origin}/api/photos/${id}/client-render?mode=preview&disposition=attachment`
    const upstream = await fetch(renderUrl, { method: options?.headOnly ? 'HEAD' : 'GET' })
    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => '')
      return Response.json({ error: errorText || `Preview download failed: ${upstream.status}` }, { status: 502 })
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg"
    return new Response(options?.headOnly ? null : upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Download-Route-Version": "phase1-debug-v2",
        "X-Download-Variant-Raw": variantRaw ?? '(default)',
        "X-Download-Variant": variant,
        "X-Download-Branch": "preview",
        "X-Download-Target": "client-render-preview",
        "X-Download-Source": "client-render-preview",
        ...(upstream.headers.get('x-image-source') ? { "X-Image-Source": upstream.headers.get('x-image-source')! } : {}),
        ...(upstream.headers.get('x-image-fallback') ? { "X-Image-Fallback": upstream.headers.get('x-image-fallback')! } : {}),
        ...(upstream.headers.get('x-watermark-fallback') ? { "X-Watermark-Fallback": upstream.headers.get('x-watermark-fallback')! } : {}),
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return resolveDownload(request, context, { headOnly: true });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return resolveDownload(request, context, { headOnly: false });
}
