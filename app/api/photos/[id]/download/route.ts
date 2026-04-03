export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const variant = request.nextUrl.searchParams.get("variant") === "original" ? "original" : "display";
    const branchType = variant === "original" ? "original" : "display";
    const supabase = getSupabaseAdmin();

    const { data: file, error } = await supabase
      .from("photo_files")
      .select("id, photo_id, branch_type, file_name, original_file_name, object_key, storage_provider, bucket_name")
      .eq("photo_id", id)
      .eq("branch_type", branchType)
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!file) {
      return Response.json({ error: `No ${branchType} file found` }, { status: 404 });
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
    const filename =
      file.original_file_name || file.file_name || file.object_key?.split("/").pop() || `${id}.${variant === "original" ? "jpg" : "jpg"}`;

    return new Response(upstream.body, {
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
