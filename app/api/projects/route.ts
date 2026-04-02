import { supabase } from '../../../src/lib/supabase/client'
import { mapRowToProject } from '@/lib/mapProject'

export async function GET() {
  try {
    const { data, error } = await supabase.from('projects').select('*')

    console.log('[DEBUG /api/projects] Supabase raw row keys:', data && data[0] ? Object.keys(data[0]) : 'empty');
    console.log('[DEBUG /api/projects] Supabase raw row[0]:', data && data[0]);

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
      _rawKeys: data && data[0] ? Object.keys(data[0]) : [],
      _rawFirst: data && data[0] ? data[0] : null,
    })
  } catch {
    return Response.json({ success: false, error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const { data, error } = await supabase
      .from('projects')
      .insert([
        {
          name: body.name,
          client_name: body.clientName,
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
