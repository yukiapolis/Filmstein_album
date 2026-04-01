export const runtime = 'nodejs';

import { NextRequest } from "next/server";
import JSZip from "jszip";

const MAX_PHOTOS = 50;

export async function POST(request: NextRequest) {
  console.log("[download-zip] === START ===");
  console.log("[download-zip] Request method:", request.method);

  try {
    const body = await request.json();
    console.log("[download-zip] Request body:", JSON.stringify(body, null, 2));

    const { photoIds } = body;
    console.log("[download-zip] photoIds:", photoIds);
    console.log("[download-zip] photoIds length:", photoIds?.length);

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      const err = "photoIds is required and must be a non-empty array";
      console.log("[download-zip] Validation failed:", err);
      return Response.json({ error: err }, { status: 400 });
    }

    if (photoIds.length > MAX_PHOTOS) {
      const err = `Maximum ${MAX_PHOTOS} photos allowed, got ${photoIds.length}`;
      console.log("[download-zip] Validation failed:", err);
      return Response.json({ error: err }, { status: 400 });
    }

    console.log("[download-zip] Creating Supabase client...");
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("[download-zip] Missing Supabase env:", {
        SUPABASE_URL: supabaseUrl ? "set" : "MISSING",
        SUPABASE_SERVICE_ROLE_KEY: supabaseKey ? "set" : "MISSING",
      });
      return Response.json({ error: "Missing Supabase env" }, { status: 500 });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[download-zip] Querying Supabase for photos...");
    const { data: photos, error } = await supabase
      .from("photos")
      .select("id, file_url, file_name")
      .in("id", photoIds);

    console.log("[download-zip] Supabase query result:");
    console.log("[download-zip]   - error:", error);
    console.log("[download-zip]   - photos count:", photos?.length ?? 0);
    console.log("[download-zip]   - photos:", JSON.stringify(photos, null, 2));

    if (error) {
      const errMsg = `Supabase error: ${error.message}`;
      console.log("[download-zip] Returning error:", errMsg);
      return Response.json({ error: errMsg }, { status: 500 });
    }

    if (!photos || photos.length === 0) {
      const errMsg = "No photos found for the given IDs";
      console.log("[download-zip] Returning error:", errMsg);
      return Response.json({ error: errMsg }, { status: 404 });
    }

    const zip = new JSZip();
    let successCount = 0;
    let failCount = 0;

    console.log("[download-zip] === Starting image downloads ===");

    for (const photo of photos) {
      console.log(`[download-zip] Processing photo:`);
      console.log(`[download-zip]   - id: ${photo.id}`);
      console.log(`[download-zip]   - file_url: ${photo.file_url}`);
      console.log(`[download-zip]   - file_name: ${photo.file_name}`);

      try {
        if (!photo.file_url) {
          console.warn(`[download-zip] Skip: no file_url for photo ${photo.id}`);
          failCount++;
          continue;
        }

        console.log(`[download-zip] Fetching: ${photo.file_url}`);
        const res = await fetch(photo.file_url);
        console.log(`[download-zip]   fetch status: ${res.status}`);

        if (!res.ok) {
          console.warn(`[download-zip] Skip: HTTP ${res.status} for ${photo.file_url}`);
          failCount++;
          continue;
        }

        const buffer = await res.arrayBuffer();
        console.log(`[download-zip]   buffer size: ${buffer.byteLength} bytes`);

        const fileName =
          photo.file_name ||
          decodeURIComponent(photo.file_url.split("/").pop() || "image.jpg");

        console.log(`[download-zip]   adding to zip as: ${fileName}`);
        zip.file(fileName, buffer);
        successCount++;
        console.log(`[download-zip]   successCount now: ${successCount}`);
      } catch (err) {
        console.warn(`[download-zip] Skip failed image: ${photo.file_url}`, err);
        failCount++;
      }
    }

    console.log("[download-zip] === Image downloads complete ===");
    console.log(`[download-zip] successCount: ${successCount}, failCount: ${failCount}`);

    if (successCount === 0) {
      const errMsg = "No valid images - all images failed to download";
      console.log("[download-zip] Returning error:", errMsg);
      return Response.json({ error: errMsg }, { status: 400 });
    }

    console.log("[download-zip] Generating zip buffer...");
    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    console.log(`[download-zip] Zip buffer size: ${zipBuffer.length} bytes`);

    if (!zipBuffer || zipBuffer.length === 0) {
      console.error("[download-zip] Zip buffer is empty");
      return new Response("Zip generation failed", { status: 500 });
    }

    console.log("[download-zip] === SUCCESS - returning zip ===");
    return new Response(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=photos.zip",
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("[download-zip] === ERROR ===");
    console.error("[download-zip] download zip failed:", err);
    console.error("[download-zip] error message:", err instanceof Error ? err.message : String(err));
    console.error("[download-zip] error stack:", err instanceof Error ? err.stack : "no stack");

    return Response.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
        detail: String(err),
      },
      { status: 500 }
    );
  }
}
