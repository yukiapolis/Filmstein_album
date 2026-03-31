import { supabase } from '../../../src/lib/supabase/client'

export async function GET() {
  try {
    const { data, error } = await supabase.from('projects').select('*')

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 },
      )
    }

    return Response.json({ success: true, data: data ?? [] })
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

    return Response.json({ success: true, data })
  } catch {
    return Response.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    )
  }
}