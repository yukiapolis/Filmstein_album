import { supabase } from '../../../src/lib/supabase/server'
import { r2 } from '../../../src/lib/r2/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'

function buildGlobalPhotoId() {
  return `GP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function parseIntField(value: FormDataEntryValue | null, fallback: number) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const folderId = formData.get('folderId') as string | null;
    const photoId = formData.get('photoId') as string | null;
    const branchType = parseIntField(formData.get('branchType'), 1);
    const versionNo = parseIntField(formData.get('versionNo'), 1);
    const variantType = parseIntField(formData.get('variantType'), 1);

    if (!file) {
      return new Response(JSON.stringify({ success: false, error: 'Missing file' }), { status: 400 });
    }

    if (!projectId && !photoId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing projectId or photoId' }), { status: 400 });
    }

    let targetPhotoId = photoId?.trim() || null;

    if (targetPhotoId) {
      const { data: existingPhoto, error: existingPhotoError } = await supabase
        .from('photos')
        .select('global_photo_id')
        .eq('global_photo_id', targetPhotoId)
        .maybeSingle();

      if (existingPhotoError) {
        return new Response(JSON.stringify({ success: false, error: existingPhotoError.message }), { status: 500 });
      }

      if (!existingPhoto) {
        return new Response(JSON.stringify({ success: false, error: 'Photo not found' }), { status: 404 });
      }
    } else {
      targetPhotoId = buildGlobalPhotoId();
      const { error: photoError } = await supabase
        .from('photos')
        .insert([{
          global_photo_id: targetPhotoId,
          project_id: projectId,
          folder_id: folderId || null,
          star_rating: 0,
          status: 1,
          updated_at: new Date().toISOString(),
        }]);

      if (photoError) {
        return new Response(JSON.stringify({ success: false, error: photoError.message }), { status: 500 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const keyPrefix = projectId || 'misc';
    const key = `${keyPrefix}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    }));

    const publicUrl = `${process.env.R2_PUBLIC_BASE_URL}/${key}`;

    const { data: fileRow, error: fileError } = await supabase
      .from('photo_files')
      .insert([{
        photo_id: targetPhotoId,
        source_file_id: null,
        branch_type: branchType,
        version_no: versionNo,
        variant_type: variantType,
        file_name: file.name,
        original_file_name: file.name,
        storage_provider: 'r2',
        bucket_name: process.env.R2_BUCKET_NAME!,
        object_key: publicUrl,
        mime_type: file.type || null,
        file_size_bytes: file.size,
        metadata: {},
        exif: {},
        processing_meta: {},
        created_by: null,
      }])
      .select('id')
      .single();

    if (fileError || !fileRow) {
      return new Response(JSON.stringify({
        success: false,
        error: fileError?.message || 'Failed to create photo file',
      }), { status: 500 });
    }

    const photoUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (branchType === 1 && variantType === 1) {
      photoUpdates.original_file_id = fileRow.id;
      if (!photoId) {
        photoUpdates.retouched_file_id = fileRow.id;
      }
    }

    if (branchType === 2 || branchType === 3) {
      photoUpdates.retouched_file_id = fileRow.id;
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update(photoUpdates)
      .eq('global_photo_id', targetPhotoId);

    if (updateError) {
      return new Response(JSON.stringify({ success: false, error: updateError.message }), { status: 500 });
    }

    return new Response(JSON.stringify({
      success: true,
      url: publicUrl,
      photoId: targetPhotoId,
      fileId: fileRow.id,
    }), { status: 200 });
  } catch (err) {
    console.error('upload error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: 'Server error',
    }), { status: 500 });
  }
}
