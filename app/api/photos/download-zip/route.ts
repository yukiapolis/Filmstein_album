export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";

const MAX_PHOTOS = 50;
const BRANCH_TYPE_DISPLAY = 'display';

type FileRow = {
  id: string;
  photo_id: string;
  branch_type: string | null;
  file_name: string | null;
  original_file_name: string | null;
  object_key: string | null;
  storage_provider: string | null;
  bucket_name: string | null;
};

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

    const { data: files, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name")
      .in("photo_id", photoIds)
      .eq("branch_type", BRANCH_TYPE_DISPLAY);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!files || files.length === 0) {
      return Response.json({ error: "No display files found for the given photo IDs" }, { status: 404 });
    }

    const zip = new JSZip();
    let successCount = 0;

    for (const file of files as FileRow[]) {
      const src = resolvePhotoPublicUrl(file as unknown as Record<string, unknown>);
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
