/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('node:crypto')
const sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function clampWatermarkScale(value) {
  if (Number.isNaN(value)) return 1
  return Math.min(2.5, Math.max(0.2, value))
}

function clampWatermarkOpacity(value) {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}

function normalizeWatermarkConfig(watermark, asset) {
  const normalized = {
    enabled: Boolean(watermark.enabled && asset?.url),
    position: String(watermark.position || 'bottom-right'),
    offset_x: Number(watermark.offset_x ?? 0),
    offset_y: Number(watermark.offset_y ?? 0),
    scale: clampWatermarkScale(Number(watermark.scale ?? 1)),
    opacity: clampWatermarkOpacity(Number(watermark.opacity ?? 1)),
  }

  const looksLikeLegacyCenteredCustomPlacement = normalized.position === 'custom'
    && Math.abs(normalized.offset_x) <= 5
    && Math.abs(normalized.offset_y) <= 5

  if (looksLikeLegacyCenteredCustomPlacement) {
    normalized.position = 'bottom-right'
    normalized.offset_x = 0
    normalized.offset_y = 0
    normalized.scale = Math.min(normalized.scale, 1)
  }

  return normalized
}

function getWatermarkVersionSignature(project) {
  const watermark = normalizeWatermarkConfig((project.visual_settings || {}).watermark || {}, project.project_assets?.watermark_logo || {})
  const asset = project.project_assets?.watermark_logo || {}
  return [
    'v7',
    watermark.enabled ? '1' : '0',
    asset.url || '',
    asset.version_token || '',
    watermark.position || 'bottom-right',
    Number(watermark.offset_x ?? 0),
    Number(watermark.offset_y ?? 0),
    clampWatermarkScale(Number(watermark.scale ?? 1)),
    clampWatermarkOpacity(Number(watermark.opacity ?? 1)),
  ].join('|')
}

function getClientPreviewKey({ projectId, photoId, versionedBaseName }) {
  return `${projectId}/${photoId}/client-preview/${versionedBaseName}.jpg`
}

function getWatermarkLayout({ width, height, watermark, logoAspectRatio }) {
  const scale = clampWatermarkScale(Number(watermark.scale ?? 1))
  const opacity = clampWatermarkOpacity(Number(watermark.opacity ?? 1))
  const shortSide = Math.max(1, Math.min(width, height))
  const resolvedAspectRatio = Math.max(0.1, logoAspectRatio || 2)
  const margin = Math.max(8, Math.round(shortSide * 0.04))
  const offsetX = Math.round(width * (Number(watermark.offset_x ?? 0) / 100))
  const offsetY = Math.round(height * (Number(watermark.offset_y ?? 0) / 100))
  const requestedWidth = Math.round(shortSide * Math.min(0.5, Math.max(0.04, 0.18 * scale)))
  const maxWidth = Math.max(1, width - margin * 2)
  const maxHeight = Math.max(1, height - margin * 2)

  let logoWidth = Math.max(12, Math.min(maxWidth, requestedWidth))
  let logoHeight = Math.max(6, Math.round(logoWidth / resolvedAspectRatio))

  if (logoHeight > maxHeight) {
    logoHeight = maxHeight
    logoWidth = Math.max(1, Math.min(maxWidth, Math.round(logoHeight * resolvedAspectRatio)))
  }

  if (logoWidth > maxWidth) {
    logoWidth = maxWidth
    logoHeight = Math.max(1, Math.min(maxHeight, Math.round(logoWidth / resolvedAspectRatio)))
  }

  let left = width - logoWidth - margin + offsetX
  let top = height - logoHeight - margin + offsetY
  const position = String(watermark.position || 'bottom-right')

  if (position === 'top-left') {
    left = margin + offsetX
    top = margin + offsetY
  } else if (position === 'top-right') {
    left = width - logoWidth - margin + offsetX
    top = margin + offsetY
  } else if (position === 'bottom-left') {
    left = margin + offsetX
    top = height - logoHeight - margin + offsetY
  } else if (position === 'custom' || position === 'center') {
    left = Math.round((width - logoWidth) / 2) + offsetX
    top = Math.round((height - logoHeight) / 2) + offsetY
  }

  return {
    left: Math.max(0, Math.min(width - logoWidth, left)),
    top: Math.max(0, Math.min(height - logoHeight, top)),
    logoWidth,
    opacity,
  }
}

async function getImageMetadata(buffer) {
  const metadata = await sharp(buffer).metadata()
  return {
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    exif: {
      format: metadata.format ?? null,
      space: metadata.space ?? null,
      channels: metadata.channels ?? null,
      density: metadata.density ?? null,
      hasProfile: metadata.hasProfile ?? null,
      hasAlpha: metadata.hasAlpha ?? null,
      orientation: metadata.orientation ?? null,
    },
  }
}

async function buildWatermarkedClientPreview({ sourceBuffer, logoBuffer, watermark }) {
  const normalizedSource = sharp(sourceBuffer).rotate()
  const baseMeta = await normalizedSource.metadata()
  const width = baseMeta.width || 1600
  const height = baseMeta.height || 1200
  const logoMeta = await sharp(logoBuffer).metadata()
  const layout = getWatermarkLayout({
    width,
    height,
    watermark,
    logoAspectRatio: (logoMeta.width || 1) / Math.max(1, logoMeta.height || 1),
  })

  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: layout.logoWidth, withoutEnlargement: true })
    .png()
    .toBuffer()

  const logoWithOpacity = await sharp(resizedLogo).ensureAlpha(layout.opacity).png().toBuffer()
  return normalizedSource
    .clone()
    .composite([
      { input: logoWithOpacity, left: layout.left, top: layout.top, blend: 'over' },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer()
}

async function uploadToR2(key, body, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))

  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  return `${base}/${key}`
}

async function removeR2Object(url) {
  const base = (process.env.R2_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_PHOTO_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  const key = base && url.startsWith(base + '/') ? url.slice(base.length + 1) : url
  await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }))
}

function groupLatestByPhoto(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const list = grouped.get(row.photo_id) || []
    list.push(row)
    grouped.set(row.photo_id, list)
  }

  const latest = []
  for (const [photoId, files] of grouped.entries()) {
    const versionNo = Math.max(...files.map((row) => Number(row.version_no) || 1))
    const byBranch = {}
    for (const row of files.filter((file) => (Number(file.version_no) || 1) === versionNo)) {
      if (!byBranch[row.branch_type]) byBranch[row.branch_type] = row
    }
    latest.push({ photoId, versionNo, byBranch })
  }
  return latest
}

async function main() {
  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, name, project_assets, visual_settings')

  if (projectError) throw projectError

  const created = []
  const skipped = []

  for (const project of projects || []) {
    const watermark = normalizeWatermarkConfig((project.visual_settings || {}).watermark || {}, project.project_assets?.watermark_logo || {})
    const logoUrl = project.project_assets?.watermark_logo?.url
    const watermarkSignature = getWatermarkVersionSignature(project)
    const watermarkEnabled = Boolean(watermark.enabled && logoUrl)
    if (!watermarkEnabled) continue

    const logoRes = await fetch(logoUrl)
    if (!logoRes.ok) {
      skipped.push({ projectId: project.id, reason: `logo fetch failed (${logoRes.status})` })
      continue
    }
    const logoBuffer = Buffer.from(await logoRes.arrayBuffer())
    const logoMeta = await sharp(logoBuffer).metadata()
    const logoAspectRatio = (logoMeta.width || 1) / Math.max(1, logoMeta.height || 1)

    const { data: photos, error: photoError } = await supabase
      .from('photos')
      .select('global_photo_id')
      .eq('project_id', project.id)
    if (photoError) throw photoError
    const photoIds = (photos || []).map((row) => row.global_photo_id)
    if (photoIds.length === 0) continue

    const { data: files, error: fileError } = await supabase
      .from('photo_files')
      .select('id, photo_id, branch_type, version_no, file_name, original_file_name, object_key, storage_provider, bucket_name, created_at')
      .in('photo_id', photoIds)
    if (fileError) throw fileError

    for (const bundle of groupLatestByPhoto(files || [])) {
      if (bundle.byBranch.client_preview || !bundle.byBranch.display) continue
      const displayRow = bundle.byBranch.display
      const displayRes = await fetch(displayRow.object_key)
      if (!displayRes.ok) {
        skipped.push({ photoId: bundle.photoId, reason: `display fetch failed (${displayRes.status})` })
        continue
      }
      const displayBuffer = Buffer.from(await displayRes.arrayBuffer())
      const outputBuffer = await buildWatermarkedClientPreview({ sourceBuffer: displayBuffer, logoBuffer, watermark, logoAspectRatio })
      const versionedBaseName = sanitizeFileName((displayRow.file_name || 'preview').replace(/\.[^.]+$/, ''))
      const key = getClientPreviewKey({ projectId: project.id, photoId: bundle.photoId, versionedBaseName })
      const url = await uploadToR2(key, outputBuffer, 'image/jpeg')
      const metadata = await getImageMetadata(outputBuffer)
      const row = {
        photo_id: bundle.photoId,
        branch_type: 'client_preview',
        version_no: bundle.versionNo,
        variant_type: 1,
        file_name: `${versionedBaseName}.jpg`,
        original_file_name: displayRow.original_file_name || displayRow.file_name || `${bundle.photoId}.jpg`,
        storage_provider: 'r2',
        bucket_name: process.env.R2_BUCKET_NAME,
        object_key: url,
        mime_type: 'image/jpeg',
        file_size_bytes: outputBuffer.length,
        width: metadata.width,
        height: metadata.height,
        checksum_sha256: sha256(outputBuffer),
        exif: metadata.exif,
        processing_meta: { derived_from: 'display', preset: 'client-preview-watermarked-v1', watermark_signature: watermarkSignature, backfilled_at: new Date().toISOString() },
        created_by: null,
      }
      const { data: inserted, error: insertError } = await supabase
        .from('photo_files')
        .insert([row])
        .select('id')
        .single()

      if (insertError || !inserted) {
        await removeR2Object(url).catch(() => undefined)
        skipped.push({ photoId: bundle.photoId, reason: insertError?.message || 'insert failed' })
        continue
      }
      created.push({ projectId: project.id, photoId: bundle.photoId, fileId: inserted.id })
    }
  }

  console.log(JSON.stringify({ createdCount: created.length, created, skipped }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
