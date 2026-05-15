import { processProjectStorageOperation } from '@/lib/storageOperations'

function isAuthorized(req: Request) {
  const expected = process.env.WEBHOOK_SECRET || ''
  if (!expected) return true

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
  const operationId = typeof body?.operationId === 'string' && body.operationId.trim()
    ? body.operationId.trim()
    : typeof url.searchParams.get('operationId') === 'string' && url.searchParams.get('operationId')?.trim()
      ? String(url.searchParams.get('operationId')).trim()
      : ''

  if (!operationId) {
    return Response.json({ success: false, error: 'operationId is required' }, { status: 400 })
  }

  const operation = await processProjectStorageOperation(operationId)
  return Response.json({ success: true, data: { operation } })
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
