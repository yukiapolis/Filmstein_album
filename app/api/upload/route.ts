import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { supabase } from '../../../src/lib/supabase/server'
import { r2 } from '../../../src/lib/r2/client'
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { extractPhotoIdFromFileName, extractVersionNoFromFileName, looksLikeRetouchFile, normalizeBaseName, type UploadAnalysisResult } from '@/lib/uploadAnalysis'

const BRANCH_TYPE_ORIGINAL = 'original';
const BRANCH_TYPE_RAW = 'raw';
const BRANCH_TYPE_THUMB = 'thumb';
const BRANCH_TYPE_DISPLAY = 'display';
const GLOBAL_PHOTO_ID_RE = /GP-[A-Z0-9]{12,}/i;

function buildGlobalPhotoId() {
  return `GP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function appendVersionSuffix(fileName: string, versionNo: number) {
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length) || fileName;
  return `${sanitizeFileName(base)}_v${versionNo}${ext}`;
}

function detectUploadKind(file: File): 'raw' | 'image' {
  const lower = file.name.toLowerCase();
  if (/\.(cr2|cr3|nef|arw|dng|raf|rw2|orf|pef|srw)$/.test(lower)) return 'raw';
  if (/\.(jpg|jpeg|png|webp)$/.test(lower)) return 'image';
  return 'image';
}


function getOriginalsRoot() {
  return process.env.LOCAL_ORIGINALS_DIR || path.join(process.cwd(), 'storage', 'originals');
}

function sha256(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function getImageMetadata(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();
  const exifPayload: Record<string, unknown> = {
    format: metadata.format ?? null,
    space: metadata.space ?? null,
    channels: metadata.channels ?? null,
    density: metadata.density ?? null,
    hasProfile: metadata.hasProfile ?? null,
    hasAlpha: metadata.hasAlpha ?? null,
    orientation: metadata.orientation ?? null,
  };

  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    exif: exifPayload,
  };
}

async function saveLocalAsset(params: {
  projectId: string;
  photoId: string;
  branchDir: 'original' | 'raw' | 'display';
  fileName: string;
  buffer: Buffer;
}) {
  const dir = path.join(getOriginalsRoot(), params.projectId, params.photoId, params.branchDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, sanitizeFileName(params.fileName));
  await fs.writeFile(filePath, params.buffer);
  return filePath;
}

async function buildThumb(buffer: Buffer) {
  let quality = 82;
  let output = await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (output.length > 100 * 1024 && quality > 40) {
    quality -= 8;
    output = await sharp(buffer)
      .rotate()
      .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  return output;
}

async function buildDisplay(buffer: Buffer, preset: 'original' | '6000' | '4000') {
  const TARGET_MAX_BYTES = 1024 * 1024;

  if (preset === 'original') {
    let quality = 92;
    let output = await sharp(buffer).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();
    while (output.length > TARGET_MAX_BYTES && quality > 55) {
      quality -= 6;
      output = await sharp(buffer).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();
    }
    return output;
  }

  const maxEdge = preset === '6000' ? 6000 : 4000;
  let quality = 82;
  let output = await sharp(buffer)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (output.length > TARGET_MAX_BYTES && quality > 50) {
    quality -= 6;
    output = await sharp(buffer)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  return output;
}

async function uploadToR2(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: params.key,
    Body: params.body,
    ContentType: params.contentType,
  }));

  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/${params.key}`;
}

async function deleteStoredAsset(file: { storage_provider?: string | null; bucket_name?: string | null; object_key?: string | null }) {
  if (file.storage_provider === 'r2' && file.bucket_name && file.object_key) {
    const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
    const key = base && file.object_key.startsWith(base + '/')
      ? file.object_key.slice(base.length + 1)
      : file.object_key

    await r2.send(new DeleteObjectCommand({
      Bucket: file.bucket_name,
      Key: key,
    }))
    return
  }

  if (file.storage_provider === 'local' && file.object_key) {
    await fs.rm(file.object_key, { force: true })
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('analyze') === 'true') {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const projectId = formData.get('projectId') as string | null;

      if (!file) {
        return new Response(JSON.stringify({ success: false, error: 'Missing file' }), { status: 400 });
      }

      const checksum = sha256(Buffer.from(await file.arrayBuffer()));
      const embeddedPhotoId = extractPhotoIdFromFileName(file.name);
      const embeddedVersionNo = extractVersionNoFromFileName(file.name);
      const hasSystemPhotoIdPrefix = Boolean(embeddedPhotoId);
      const normalizedBaseName = normalizeBaseName(file.name);

      let matchedPhotoId: string | null = null;
      let matchedVersionNo: number | null = embeddedVersionNo;
      let nextVersionNo: number | null = null;
      let classification: UploadAnalysisResult['classification'] = 'unknown';
      let reason = 'no matching rule';

      if (embeddedPhotoId) {
        const { data: matchedPhoto, error: matchedPhotoError } = await supabase
          .from('photos')
          .select('global_photo_id, project_id')
          .eq('global_photo_id', embeddedPhotoId)
          .maybeSingle();

        if (matchedPhotoError) {
          return new Response(JSON.stringify({ success: false, error: matchedPhotoError.message }), { status: 500 });
        }

        if (matchedPhoto) {
          matchedPhotoId = String(matchedPhoto.global_photo_id);
        }
      }

      if (hasSystemPhotoIdPrefix) {
        if (matchedPhotoId) {
          const { data: existingVersions } = await supabase
            .from('photo_files')
            .select('version_no')
            .eq('photo_id', matchedPhotoId);
          const maxVersion = Math.max(0, ...((existingVersions ?? []).map((row) => Number(row.version_no) || 0)));
          nextVersionNo = maxVersion + 1;
          classification = 'retouch_upload';
          reason = 'matched system photoId prefix';
        } else {
          classification = 'invalid_retouch_reference';
          reason = 'system photoId prefix found but target photo not found';
        }
      } else {
        const { data: duplicateFileRows } = await supabase
          .from('photo_files')
          .select('photo_id, version_no, checksum_sha256')
          .eq('checksum_sha256', checksum)
          .limit(5);

        if (duplicateFileRows && duplicateFileRows.length > 0) {
          matchedPhotoId = String(duplicateFileRows[0].photo_id);
          matchedVersionNo = Number(duplicateFileRows[0].version_no) || null;
          classification = 'duplicate_original';
          reason = 'exact checksum duplicate';
        } else {
          const candidateOriginalNames = Array.from(new Set([file.name, `${normalizedBaseName}${file.name.match(/\.[^.]+$/)?.[0] ?? ''}`]));
          const { data: duplicateNameRows } = await supabase
            .from('photo_files')
            .select('photo_id, version_no, original_file_name')
            .in('original_file_name', candidateOriginalNames)
            .eq('branch_type', 'original')
            .limit(5);

          if (duplicateNameRows && duplicateNameRows.length > 0) {
            matchedPhotoId = String(duplicateNameRows[0].photo_id)
            matchedVersionNo = Number(duplicateNameRows[0].version_no) || null
            classification = 'duplicate_original'
            reason = 'matched existing original filename'
          } else if (looksLikeRetouchFile(file.name) && matchedPhotoId) {
            classification = 'retouch_upload'
            reason = 'retouch hint matched existing photo'
          } else {
            classification = 'new_original'
            reason = 'no system prefix and no duplicate match'
          }
        }
      }

      const diagnostics = {
        fileName: file.name,
        embeddedPhotoId,
        embeddedVersionNo,
        normalizedBaseName,
      }

      return new Response(JSON.stringify({
        success: true,
        data: {
          fileName: file.name,
          checksumSha256: checksum,
          classification,
          matchedPhotoId,
          matchedVersionNo,
          normalizedBaseName,
          reason,
          nextVersionNo,
          diagnostics,
        },
      }), { status: 200 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const folderId = formData.get('folderId') as string | null;
    const photoId = formData.get('photoId') as string | null;
    const displayPresetRaw = formData.get('displayPreset');
    const uploadCategory = formData.get('uploadCategory') as string | null;
    const overwriteOriginal = uploadCategory === 'overwrite-original';
    const displayPreset =
      displayPresetRaw === 'original' || displayPresetRaw === '6000' || displayPresetRaw === '4000'
        ? displayPresetRaw
        : '4000';

    if (!file) {
      return new Response(JSON.stringify({ success: false, error: 'Missing file' }), { status: 400 });
    }

    if (!projectId && !photoId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing projectId or photoId' }), { status: 400 });
    }

    let targetPhotoId = photoId?.trim() || null;
    let targetProjectId = projectId?.trim() || null;

    if (!targetPhotoId) {
      const embeddedPhotoId = file.name.match(GLOBAL_PHOTO_ID_RE)?.[0]?.toUpperCase() || null;
      if (embeddedPhotoId) {
        let existingPhotoQuery = supabase
          .from('photos')
          .select('global_photo_id, project_id')
          .eq('global_photo_id', embeddedPhotoId);

        if (targetProjectId) {
          existingPhotoQuery = existingPhotoQuery.eq('project_id', targetProjectId);
        }

        const { data: matchedPhoto, error: matchedPhotoError } = await existingPhotoQuery.maybeSingle();
        if (matchedPhotoError) {
          return new Response(JSON.stringify({ success: false, error: matchedPhotoError.message }), { status: 500 });
        }

        if (matchedPhoto) {
          targetPhotoId = String(matchedPhoto.global_photo_id);
          targetProjectId = String(matchedPhoto.project_id);
        }
      }
    }

    if (targetPhotoId) {
      const { data: existingPhoto, error: existingPhotoError } = await supabase
        .from('photos')
        .select('global_photo_id, project_id')
        .eq('global_photo_id', targetPhotoId)
        .maybeSingle();

      if (existingPhotoError) {
        return new Response(JSON.stringify({ success: false, error: existingPhotoError.message }), { status: 500 });
      }

      if (!existingPhoto) {
        return new Response(JSON.stringify({ success: false, error: 'Photo not found' }), { status: 404 });
      }

      targetProjectId = String(existingPhoto.project_id);
    } else {
      targetPhotoId = buildGlobalPhotoId();
      const { error: photoError } = await supabase
        .from('photos')
        .insert([{
          global_photo_id: targetPhotoId,
          project_id: targetProjectId,
          folder_id: folderId || null,
          star_rating: 0,
          status: 1,
          is_published: false,
          updated_at: new Date().toISOString(),
        }]);

      if (photoError) {
        return new Response(JSON.stringify({ success: false, error: photoError.message }), { status: 500 });
      }
    }

    if (!targetProjectId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing resolved projectId' }), { status: 400 });
    }

    const uploadKind = detectUploadKind(file);
    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const checksum = sha256(originalBuffer);
    const hasSystemPhotoIdPrefix = Boolean(file.name.match(GLOBAL_PHOTO_ID_RE)?.[0]?.toUpperCase());
    const originalBranchType = uploadKind === 'raw' ? BRANCH_TYPE_RAW : BRANCH_TYPE_ORIGINAL;

    const { data: duplicateFileRows, error: duplicateCheckError } = await supabase
      .from('photo_files')
      .select('id, photo_id, version_no, checksum_sha256')
      .eq('checksum_sha256', checksum)
      .limit(5);

    if (duplicateCheckError) {
      return new Response(JSON.stringify({ success: false, error: duplicateCheckError.message }), { status: 500 });
    }

    if (!hasSystemPhotoIdPrefix && duplicateFileRows && duplicateFileRows.length > 0) {
      if (overwriteOriginal) {
        targetPhotoId = photoId?.trim() || String(duplicateFileRows[0].photo_id)
      } else {
        return new Response(JSON.stringify({
          success: false,
          error: 'Exact duplicate detected',
          code: 'EXACT_DUPLICATE',
          duplicateOf: {
            photoId: duplicateFileRows[0].photo_id,
            versionNo: Number(duplicateFileRows[0].version_no) || null,
          },
        }), { status: 409 });
      }
    }

    let nextVersionNo = 1;
    let overwrittenVersionCleanupCount = 0;
    if (targetPhotoId) {
      const { data: existingVersions, error: existingVersionsError } = await supabase
        .from('photo_files')
        .select('id, version_no, storage_provider, bucket_name, object_key')
        .eq('photo_id', targetPhotoId);

      if (existingVersionsError) {
        return new Response(JSON.stringify({ success: false, error: existingVersionsError.message }), { status: 500 });
      }

      const versionNos = Array.from(new Set((existingVersions ?? []).map((row) => Number(row.version_no) || 0).filter(Boolean))).sort((a, b) => a - b)

      if (overwriteOriginal && versionNos.length > 0) {
        const versionsToDelete = versionNos.filter((versionNo) => versionNo > 1)
        if (versionsToDelete.length > 0) {
          const filesToDelete = (existingVersions ?? []).filter((row) => versionsToDelete.includes(Number(row.version_no) || 0))
          const { error: deleteVersionRowsError } = await supabase
            .from('photo_files')
            .delete()
            .eq('photo_id', targetPhotoId)
            .in('version_no', versionsToDelete)

          if (deleteVersionRowsError) {
            return new Response(JSON.stringify({ success: false, error: deleteVersionRowsError.message }), { status: 500 });
          }

          for (const fileRow of filesToDelete) {
            await deleteStoredAsset(fileRow)
          }
          overwrittenVersionCleanupCount = versionsToDelete.length
        }

        nextVersionNo = 1
        const { error: deleteOriginalRowsError } = await supabase
          .from('photo_files')
          .delete()
          .eq('photo_id', targetPhotoId)
          .eq('version_no', 1)

        if (deleteOriginalRowsError) {
          return new Response(JSON.stringify({ success: false, error: deleteOriginalRowsError.message }), { status: 500 });
        }

        const originalFilesToDelete = (existingVersions ?? []).filter((row) => (Number(row.version_no) || 0) === 1)
        for (const fileRow of originalFilesToDelete) {
          await deleteStoredAsset(fileRow)
        }
      } else {
        const maxVersion = Math.max(0, ...((existingVersions ?? []).map((row) => Number(row.version_no) || 0)));
        nextVersionNo = maxVersion + 1;
      }
    }
    const originalStorageName = appendVersionSuffix(file.name, nextVersionNo);
    const originalLocalPath = await saveLocalAsset({
      projectId: targetProjectId,
      photoId: targetPhotoId,
      branchDir: originalBranchType === BRANCH_TYPE_RAW ? 'raw' : 'original',
      fileName: originalStorageName,
      buffer: originalBuffer,
    });

    let originalWidth: number | null = null;
    let originalHeight: number | null = null;
    let originalExif: Record<string, unknown> = {};

    if (uploadKind === 'image') {
      const originalMeta = await getImageMetadata(originalBuffer);
      originalWidth = originalMeta.width;
      originalHeight = originalMeta.height;
      originalExif = originalMeta.exif;
    }

    const originalInsert = {
      photo_id: targetPhotoId,
      branch_type: originalBranchType,
      version_no: nextVersionNo,
      variant_type: 1,
      file_name: originalStorageName,
      original_file_name: file.name,
      storage_provider: 'local',
      bucket_name: 'local-originals',
      object_key: originalLocalPath,
      mime_type: file.type || null,
      file_size_bytes: file.size,
      width: originalWidth,
      height: originalHeight,
      checksum_sha256: checksum,
      exif: originalExif,
      processing_meta: {},
      created_by: null,
    };

    const createdFileIds: Record<string, string | null> = {
      original: null,
      thumb: null,
      display: null,
    };

    const { data: originalFileRow, error: originalFileError } = await supabase
      .from('photo_files')
      .insert([originalInsert])
      .select('id')
      .single();

    if (originalFileError || !originalFileRow) {
      return new Response(JSON.stringify({ success: false, error: originalFileError?.message || 'Failed to create original file row' }), { status: 500 });
    }

    createdFileIds.original = originalFileRow.id;

    let displayUrl = '';

    if (uploadKind === 'image') {
      const isRetouchUpload = uploadCategory === 'retouch' || (hasSystemPhotoIdPrefix && targetPhotoId !== null) || (targetPhotoId !== null && (looksLikeRetouchFile(file.name) || extractVersionNoFromFileName(file.name) !== null));
      const thumbBuffer = await buildThumb(originalBuffer);
      const displayBuffer = isRetouchUpload ? originalBuffer : await buildDisplay(originalBuffer, displayPreset);
      const thumbMeta = await getImageMetadata(thumbBuffer);
      const displayMeta = await getImageMetadata(displayBuffer);
      const safeName = sanitizeFileName(file.name.replace(/\.[^.]+$/, ''));
      const versionedBaseName = `${safeName}_v${nextVersionNo}`;
      const displayExt = isRetouchUpload ? (path.extname(file.name) || '.bin') : '.jpg';
      const displayFileName = `${versionedBaseName}${displayExt}`;
      const baseKey = `${targetProjectId}/${targetPhotoId}`;
      const thumbKey = `${baseKey}/thumb/${versionedBaseName}.jpg`;
      const displayKey = `${baseKey}/display/${displayFileName}`;

      const thumbUrl = await uploadToR2({
        key: thumbKey,
        body: thumbBuffer,
        contentType: 'image/jpeg',
      });

      displayUrl = await uploadToR2({
        key: displayKey,
        body: displayBuffer,
        contentType: isRetouchUpload ? (file.type || 'application/octet-stream') : 'image/jpeg',
      });

      if (!isRetouchUpload && displayPreset === 'original') {
        await saveLocalAsset({
          projectId: targetProjectId,
          photoId: targetPhotoId,
          branchDir: 'display',
          fileName: displayFileName,
          buffer: displayBuffer,
        });
      }

      const { data: thumbRow, error: thumbError } = await supabase
        .from('photo_files')
        .insert([{
          photo_id: targetPhotoId,
          branch_type: BRANCH_TYPE_THUMB,
          version_no: nextVersionNo,
          variant_type: 1,
          file_name: `${versionedBaseName}.jpg`,
          original_file_name: file.name,
          storage_provider: 'r2',
          bucket_name: process.env.R2_BUCKET_NAME!,
          object_key: thumbUrl,
          mime_type: 'image/jpeg',
          file_size_bytes: thumbBuffer.length,
          width: thumbMeta.width,
          height: thumbMeta.height,
          checksum_sha256: sha256(thumbBuffer),
          exif: thumbMeta.exif,
          processing_meta: { derived_from: 'original', preset: 'thumb-400px-100kb' },
          created_by: null,
        }])
        .select('id')
        .single();

      if (thumbError || !thumbRow) {
        return new Response(JSON.stringify({ success: false, error: thumbError?.message || 'Failed to create thumb row' }), { status: 500 });
      }
      createdFileIds.thumb = thumbRow.id;

      const { data: displayRow, error: displayError } = await supabase
        .from('photo_files')
        .insert([{
          photo_id: targetPhotoId,
          branch_type: BRANCH_TYPE_DISPLAY,
          version_no: nextVersionNo,
          variant_type: 1,
          file_name: displayFileName,
          original_file_name: file.name,
          storage_provider: 'r2',
          bucket_name: process.env.R2_BUCKET_NAME!,
          object_key: displayUrl,
          mime_type: isRetouchUpload ? (file.type || null) : 'image/jpeg',
          file_size_bytes: displayBuffer.length,
          width: displayMeta.width,
          height: displayMeta.height,
          checksum_sha256: isRetouchUpload ? originalInsert.checksum_sha256 : sha256(displayBuffer),
          exif: displayMeta.exif,
          processing_meta: isRetouchUpload ? { derived_from: 'original', preset: 'retouch-direct-display', reused_original_buffer: true } : { derived_from: 'original', preset: displayPreset },
          created_by: null,
        }])
        .select('id')
        .single();

      if (displayError || !displayRow) {
        return new Response(JSON.stringify({ success: false, error: displayError?.message || 'Failed to create display row' }), { status: 500 });
      }
      createdFileIds.display = displayRow.id;
    }

    const photoUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (createdFileIds.original) {
      photoUpdates.original_file_id = createdFileIds.original;
    }
    if (createdFileIds.display) {
      photoUpdates.retouched_file_id = createdFileIds.display;
    } else if (!photoId && createdFileIds.original) {
      photoUpdates.retouched_file_id = createdFileIds.original;
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
      url: displayUrl || null,
      photoId: targetPhotoId,
      originalFileId: createdFileIds.original,
      thumbFileId: createdFileIds.thumb,
      displayFileId: createdFileIds.display,
      overwriteOriginal,
      overwrittenVersionCleanupCount,
    }), { status: 200 });
  } catch (err) {
    console.error('upload error:', err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : 'Server error',
    }), { status: 500 });
  }
}
