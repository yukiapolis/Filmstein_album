import { supabase } from '../../../src/lib/supabase/server'
import { r2 } from '../../../src/lib/r2/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'


export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("projectId") as string | null;

    if (!file) {
      return new Response(JSON.stringify({
        success: false,
        error: "Missing file",
      }), { status: 400 });
    }

    // Upload to R2 with an optional projectId prefix
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = projectId
      ? `${projectId}/covers/${Date.now()}-${file.name.replace(/\s+/g, "_")}`
      : `misc/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || "application/octet-stream",
    }));

    const url = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;

    // Only insert into photos table when a projectId is provided (photo upload path)
    if (projectId) {
      const { error } = await supabase
        .from("photos")
        .insert([{
          project_id: projectId,
          file_name: file.name,
          file_url: url,
        }]);

      if (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message,
        }), { status: 500 });
      }
    }

    return new Response(JSON.stringify({ success: true, url }), { status: 200 });
  } catch (err) {
    console.error("upload error:", err);
    return new Response(JSON.stringify({
      success: false,
      error: "Server error",
    }), { status: 500 });
  }
}