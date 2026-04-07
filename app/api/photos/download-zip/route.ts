export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";
import { getLatestVersionFiles, type PhotoFileRow } from '@/lib/photoVersions'

const MAX_PHOTOS = 50;
const BRANCH_TYPE_DISPLAY = 'display';

type FileRow = PhotoFileRow;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { photoIds, clientSafe } = body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ error: "photoIds is required and must be a non-empty array" }, { status: 400 });
    }

    if (photoIds.length > MAX_PHOTOS) {
      return Response.json({ error: `Maximum ${MAX_PHOTOS} photos allowed, got ${photoIds.length}` }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "Missing Supabase env" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let allowedPhotoIds = photoIds as string[];

    if (clientSafe === true) {
      const { data: publishedPhotos, error: publishedError } = await supabase
        .from('photos')
        .select('global_photo_id')
        .in('global_photo_id', photoIds)
        .eq('is_published', true);

      if (publishedError) {
        return Response.json({ error: publishedError.message }, { status: 500 });
      }

      allowedPhotoIds = (publishedPhotos ?? []).map((row) => row.global_photo_id);
      if (allowedPhotoIds.length === 0) {
        return Response.json({ error: 'No published photos available for client download' }, { status: 403 });
      }
    }

    const { data: files, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at")
      .in("photo_id", allowedPhotoIds)
      .eq("branch_type", BRANCH_TYPE_DISPLAY);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!files || files.length === 0) {
      return Response.json({ error: "No display files found for the given photo IDs" }, { status: 404 });
    }

    const filesByPhotoId = new Map<string, FileRow[]>();
    for (const file of files as FileRow[]) {
      const list = filesByPhotoId.get(file.photo_id) ?? [];
      list.push(file);
      filesByPhotoId.set(file.photo_id, list);
    }

    const latestDisplayFiles: FileRow[] = [];
    for (const photoId of allowedPhotoIds) {
      const rows = filesByPhotoId.get(photoId) ?? [];
      const latestVersion = getLatestVersionFiles(rows);
      const displayFile = latestVersion?.byBranch.display;
      if (displayFile) {
        latestDisplayFiles.push(displayFile);
      }
    }

    if (latestDisplayFiles.length === 0) {
      return Response.json({ error: "No latest display files found for the given photo IDs" }, { status: 404 });
    }

    const zip = new JSZip();
    let successCount = 0;
    const origin = request.nextUrl.origin;

    for (const file of latestDisplayFiles) {
      const src = clientSafe === true
        ? `${origin}/api/photos/${file.photo_id}/client-render?mode=download`
        : resolvePhotoPublicUrl(file as unknown as Record<string, unknown>);
      if (!src) continue;

      try {
        const res = await fetch(src);
        if (!res.ok) continue;

        const buffer = await res.arrayBuffer();
        const fileName =
          file.file_name ||
          file.original_file_name ||
          file.object_key?.split("/").pop() ||
          `${file.photo_id}.jpg`;

        zip.file(fileName, buffer);
        successCount++;
      } catch {
        // skip failed image
      }
    }

    if (successCount === 0) {
      return Response.json({ error: "No valid display images - all images failed to download" }, { status: 400 });
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=photos.zip",
        "Content-Length": zipBuffer.length.toString(),
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
