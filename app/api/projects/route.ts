import { supabase } from '../../../src/lib/supabase/client'
import { mapRowToProject } from '@/lib/mapProject'

const PROJECT_TYPES = new Set(['Wedding', 'Event', 'Campaign'])

export async function GET() {
  try {
    const { data, error } = await supabase.from('projects').select('*')

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const projects = (data ?? []).map((row) =>
      mapRowToProject(row as Record<string, unknown>)
    )

    return Response.json({
      success: true,
      data: projects,
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
    const type = typeof body.type === 'string' && PROJECT_TYPES.has(body.type)
      ? body.type
      : 'Campaign'

    if (!name) {
      return Response.json({ success: false, error: 'Project name is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('projects')
      .insert([
        {
          name,
          client_name: clientName,
          type,
        },
      ])
      .select()

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      )
    }

    const project = data && data[0]
      ? mapRowToProject(data[0] as Record<string, unknown>)
      : null
    return Response.json({ success: true, data: project })
  } catch {
    return Response.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}
