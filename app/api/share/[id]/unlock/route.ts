import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase/server'
import { buildProjectShareAccessCookie, extractProjectShareAccessConfig, verifySharePassword } from '@/lib/shareAccess'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const password = typeof body?.password === 'string' ? body.password : ''

    const { data: projectRow, error } = await supabase
      .from('projects')
      .select('id, visual_settings')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 })
    }

    if (!projectRow) {
      return Response.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const shareAccess = extractProjectShareAccessConfig(projectRow.visual_settings)
    if (shareAccess.enabled !== true || !shareAccess.password_hash) {
      return Response.json({ success: true, data: { unlocked: true } })
    }

    if (!password.trim()) {
      return Response.json({ success: false, error: 'Password is required' }, { status: 400 })
    }

    if (!verifySharePassword(password, shareAccess.password_hash)) {
      return Response.json({ success: false, error: 'Incorrect password' }, { status: 403 })
    }

    return new Response(JSON.stringify({ success: true, data: { unlocked: true } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': buildProjectShareAccessCookie(id, shareAccess.password_hash),
      },
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}
