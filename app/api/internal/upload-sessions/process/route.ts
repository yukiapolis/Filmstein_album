import { claimUploadSessionForProcessing, processDirectUploadSession, runDirectUploadProcessingBatch } from '@/lib/uploadDirect'

function isAuthorized(req: Request) {
  const expected = process.env.WEBHOOK_SECRET || ''
  if (!expected) return false

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const token = req.headers.get('x-webhook-secret') || req.headers.get('x-openclaw-internal-token') || bearer
  return token === expected
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const body = req.method === 'POST' ? await req.json().catch(() => null) : null
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : typeof url.searchParams.get('sessionId') === 'string' && url.searchParams.get('sessionId')?.trim()
      ? String(url.searchParams.get('sessionId')).trim()
      : ''
  const requestedLimit = Number(body?.limit ?? url.searchParams.get('limit') ?? 3)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 20)) : 3

  if (sessionId) {
    const claimed = await claimUploadSessionForProcessing(sessionId)
    if (!claimed) {
      return Response.json({ success: true, data: { claimed: false, sessionId } })
    }

    try {
      await processDirectUploadSession(sessionId, { alreadyClaimed: true })
      return Response.json({ success: true, data: { claimed: true, processed: 1, results: [{ sessionId, success: true }] } })
    } catch (error) {
      return Response.json({
        success: true,
        data: {
          claimed: true,
          processed: 1,
          results: [{ sessionId, success: false, error: error instanceof Error ? error.message : 'Server error' }],
        },
      })
    }
  }

  const results = await runDirectUploadProcessingBatch(limit)
  return Response.json({
    success: true,
    data: {
      processed: results.length,
      succeeded: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    },
  })
}

export async function GET(req: Request) {
  try {
    return await run(req)
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    return await run(req)
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Server error' }, { status: 500 })
  }
}
