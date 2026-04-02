export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";

const MAX_PHOTOS = 50;

type FileRow = {
  id: string;
  file_name: string | null;
  original_file_name: string | null;
  object_key: string | null;
  storage_provider: string | null;
  bucket_name: string | null;
};

type PhotoRow = {
  global_photo_id: string;
  original_file: FileRow | FileRow[] | null;
  retouched_file: FileRow | FileRow[] | null;
};

function firstFile(value: FileRow | FileRow[] | null | undefined): FileRow | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { photoIds } = body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return Response.json({ error: "photoIds is required and must be a non-empty array" }, { status: 400 });
    }

    if (photoIds.length > MAX_PHOTOS) {
      return Response.json({ error: `Maximum ${MAX_PHOTOS} photos allowed, got ${photoIds.length}` }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return Response.json({ error: "Missing Supabase env" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: photos, error } = await supabase
      .from("photos")
      .select("global_photo_id, original_file_id, retouched_file_id")
      .in("global_photo_id", photoIds);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!photos || photos.length === 0) {
      return Response.json({ error: "No photos found for the given IDs" }, { status: 404 });
    }

    const fileIds = Array.from(
      new Set(
        photos
          .flatMap((photo) => [photo.original_file_id, photo.retouched_file_id])
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    let fileMap = new Map<string, FileRow>();
    if (fileIds.length > 0) {
      const { data: fileRows, error: fileError } = await supabase
        .from("photo_files")
        .select("id, file_name, original_file_name, object_key, storage_provider, bucket_name")
        .in("id", fileIds);

      if (fileError) {
        return Response.json({ error: fileError.message }, { status: 500 });
      }

      fileMap = new Map((fileRows ?? []).map((row) => [row.id, row as FileRow]));
    }

    const joinedPhotos: PhotoRow[] = photos.map((photo) => ({
      global_photo_id: photo.global_photo_id,
      original_file: photo.original_file_id ? fileMap.get(photo.original_file_id) ?? null : null,
      retouched_file: photo.retouched_file_id ? fileMap.get(photo.retouched_file_id) ?? null : null,
    }));

    const zip = new JSZip();
    let successCount = 0;

    for (const photo of joinedPhotos) {
      const activeFile = firstFile(photo.retouched_file) ?? firstFile(photo.original_file);
      if (!activeFile) continue;

      const src = resolvePhotoPublicUrl(activeFile as unknown as Record<string, unknown>);
      if (!src) continue;

      try {
        const res = await fetch(src);
        if (!res.ok) continue;

        const buffer = await res.arrayBuffer();
        const fileName =
          activeFile.file_name ||
          activeFile.original_file_name ||
          activeFile.object_key?.split("/").pop() ||
          `${photo.global_photo_id}.jpg`;

        zip.file(fileName, buffer);
        successCount++;
      } catch {
        // skip failed image
      }
    }

    if (successCount === 0) {
      return Response.json({ error: "No valid images - all images failed to download" }, { status: 400 });
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
