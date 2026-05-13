export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";
import { getFirstVersionFiles, getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'
import { requireAdminApiAuth } from '@/lib/auth/session'
import { getAccessibleProjectIdsForAdmin } from '@/lib/auth/projectPermissions'
import { extractFolderShareAccessConfig, extractProjectShareAccessConfig, isFolderShareAccessGranted, isProjectShareAccessGranted } from '@/lib/shareAccess'

const MAX_PHOTOS = 50;
const BRANCH_TYPE_DISPLAY = 'display';
const BRANCH_TYPE_ORIGINAL = 'original';

type FileRow = PhotoFileRow;
type DownloadVariant = 'preview' | 'original'

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env");
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function readFileBytes(file: FileRow) {
  if (file.storage_provider === 'local' && file.object_key) {
    const buffer = await fs.readFile(file.object_key)
    return buffer
  }

  const src = resolvePhotoPublicUrl(file as unknown as Record<string, unknown>)
  if (!src) {
    throw new Error('No downloadable source URL')
  }

  const res = await fetch(src)
  if (!res.ok) {
    throw new Error(`Failed to fetch source (${res.status})`)
  }

  return Buffer.from(await res.arrayBuffer())
}

function buildZipFileName(file: FileRow, variant: DownloadVariant) {
  const fallbackName = variant === 'preview' ? `${file.photo_id}-preview.jpg` : `${file.photo_id}-original.jpg`
  const sourceName = file.original_file_name || file.file_name || file.object_key?.split('/').pop() || fallbackName
  return path.basename(sourceName)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { photoIds, clientSafe } = body;
    const variant: DownloadVariant = body?.variant === 'original' ? 'original' : 'preview'

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ error: "photoIds is required and must be a non-empty array" }, { status: 400 });
    }

    if (photoIds.length > MAX_PHOTOS) {
      return Response.json({ error: `Maximum ${MAX_PHOTOS} photos allowed, got ${photoIds.length}` }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    let allowedPhotoIds = photoIds as string[];

    if (clientSafe === true) {
      const { data: publishedPhotos, error: publishedError } = await supabase
        .from('photos')
        .select('global_photo_id, project_id, folder_id, projects:project_id(visual_settings), project_folders:folder_id(access_mode, password_hash)')
        .in('global_photo_id', photoIds)
        .eq('is_published', true);

      if (publishedError) {
        return Response.json({ error: publishedError.message }, { status: 500 });
      }

      const accessiblePublishedPhotos = (publishedPhotos ?? []).filter((row) => {
        const projectRow = Array.isArray(row.projects) ? row.projects[0] : row.projects
        const shareAccess = extractProjectShareAccessConfig(projectRow?.visual_settings)
        if (shareAccess.enabled === true && shareAccess.password_hash && !isProjectShareAccessGranted(request, row.project_id, shareAccess.password_hash)) {
          return false
        }

        const folderRow = Array.isArray(row.project_folders) ? row.project_folders[0] : row.project_folders
        const folderAccess = extractFolderShareAccessConfig(folderRow)
        if (folderAccess.access_mode === 'hidden') return false
        if (folderAccess.access_mode === 'password_protected' && folderAccess.password_hash && row.folder_id) {
          return isFolderShareAccessGranted(request, row.project_id, row.folder_id, folderAccess.password_hash)
        }
        return true
      })

      allowedPhotoIds = accessiblePublishedPhotos.map((row) => row.global_photo_id);
      if (allowedPhotoIds.length === 0) {
        return Response.json({ error: 'No published photos available for client download' }, { status: 403 });
      }
    } else {
      const auth = await requireAdminApiAuth()
      if (auth instanceof Response) return auth

      const accessibleProjectIds = await getAccessibleProjectIdsForAdmin(auth)
      let photosQuery = supabase
        .from('photos')
        .select('global_photo_id, project_id')
        .in('global_photo_id', photoIds)

      if (Array.isArray(accessibleProjectIds)) {
        if (accessibleProjectIds.length === 0) {
          return Response.json({ error: 'No accessible photos available for download' }, { status: 403 })
        }
        photosQuery = photosQuery.in('project_id', accessibleProjectIds)
      }

      const { data: manageablePhotos, error: manageablePhotosError } = await photosQuery
      if (manageablePhotosError) {
        return Response.json({ error: manageablePhotosError.message }, { status: 500 })
      }

      allowedPhotoIds = (manageablePhotos ?? []).map((row) => row.global_photo_id)
      if (allowedPhotoIds.length === 0) {
        return Response.json({ error: 'No accessible photos available for download' }, { status: 403 })
      }
    }

    const branchType = variant === 'original' ? BRANCH_TYPE_ORIGINAL : BRANCH_TYPE_DISPLAY
    const { data: files, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at")
      .in("photo_id", allowedPhotoIds)
      .eq("branch_type", branchType);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!files || files.length === 0) {
      return Response.json({ error: variant === 'original' ? 'No original files found for the given photo IDs' : 'No preview files found for the given photo IDs' }, { status: 404 });
    }

    const filesByPhotoId = new Map<string, FileRow[]>();
    for (const file of files as FileRow[]) {
      const list = filesByPhotoId.get(file.photo_id) ?? [];
      list.push(file);
      filesByPhotoId.set(file.photo_id, list);
    }

    const selectedFiles: FileRow[] = [];
    for (const photoId of allowedPhotoIds) {
      const rows = filesByPhotoId.get(photoId) ?? [];
      const versionBundle = variant === 'original' ? getFirstVersionFiles(rows) : getLatestVersionFiles(rows)
      const file = variant === 'original' ? versionBundle?.byBranch.original : versionBundle?.byBranch.display
      if (file) {
        selectedFiles.push(file)
      }
    }

    if (selectedFiles.length === 0) {
      return Response.json({ error: variant === 'original' ? 'No original files found for the given photo IDs' : 'No preview files found for the given photo IDs' }, { status: 404 });
    }

    const zip = new JSZip();
    let successCount = 0;
    let skippedCount = 0

    for (const file of selectedFiles) {
      try {
        const bytes = await readFileBytes(file)
        zip.file(buildZipFileName(file, variant), bytes)
        successCount++
      } catch {
        skippedCount++
      }
    }

    if (successCount === 0) {
      return Response.json({ error: "No valid files - all selected images failed to download" }, { status: 400 });
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const baseName = variant === 'original' ? 'photos-original.zip' : 'photos-preview.zip'

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=${baseName}`,
        "Content-Length": zipBuffer.length.toString(),
        "X-Zip-Included-Count": String(successCount),
        "X-Zip-Skipped-Count": String(skippedCount),
      },
    });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        detail: String(err),
      },
      { status: 500 }
    );
  }
}
