export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolvePhotoPublicUrl } from "@/lib/resolvePhotoPublicUrl";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase env");
  }

  return createClient(supabaseUrl, supabaseKey);
}

async function resolveDownload(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  options?: { headOnly?: boolean }
) {
  try {
    const { id } = await context.params;
    const variant = request.nextUrl.searchParams.get("variant") === "original" ? "original" : "display";
    const branchType = variant === "original" ? "original" : "display";
    const supabase = getSupabaseAdmin();

    const { data: file, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name, version_no, created_at")
      .eq("photo_id", id)
      .eq("branch_type", branchType)
      .order('version_no', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!file) {
      return Response.json({ error: `No ${branchType} file found` }, { status: 404 });
    }

    const sourceName =
      file.original_file_name || file.file_name || file.object_key?.split("/").pop() || `${id}.jpg`;
    const ext = path.extname(sourceName).toLowerCase() || '.jpg';
    const readableBase = path.basename(sourceName, ext).replace(/\s+/g, '_');
    const filename = variant === 'original'
      ? `${id}_original_${readableBase}${ext}`
      : `${id}_${readableBase}${ext}`;

    if (file.storage_provider === "local" && typeof file.object_key === "string" && file.object_key.trim()) {
      const localPath = path.isAbsolute(file.object_key)
        ? file.object_key
        : path.join(process.cwd(), file.object_key);
      const buffer = await readFile(localPath);
      const localExt = path.extname(filename).toLowerCase();
      const contentType =
        localExt === ".png" ? "image/png" :
        localExt === ".webp" ? "image/webp" :
        localExt === ".gif" ? "image/gif" :
        localExt === ".tif" || localExt === ".tiff" ? "image/tiff" :
        localExt === ".jpg" || localExt === ".jpeg" ? "image/jpeg" :
        "application/octet-stream";

      return new Response(options?.headOnly ? null : buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    }

    const src = resolvePhotoPublicUrl(file as unknown as Record<string, unknown>);
    if (!src) {
      return Response.json({ error: "Download source unavailable" }, { status: 404 });
    }

    const upstream = await fetch(src);
    if (!upstream.ok) {
      return Response.json({ error: `Upstream download failed: ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    return new Response(options?.headOnly ? null : upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
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
