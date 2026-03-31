import { supabase } from '../../../src/lib/supabase/server'
import { r2 } from '../../../src/lib/r2/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'


export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file || !projectId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing file or projectId',
      }), { status: 400 })
    }

    // 将文件转成 buffer
    const buffer = Buffer.from(await file.arrayBuffer())

    // 为文件生成存储 key
    const key = `${projectId}/${Date.now()}-${file.name}`

    // 上传到 R2
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: file.type || 'application/octet-stream',
    }))

    // 生成文件 URL（根据你的 R2 公共访问域名）
    const fileUrl = `${process.env.R2_PUBLIC_BASE_URL}/${key}`

    // 把文件信息写入 Supabase 数据库
    const { data, error } = await supabase
      .from('photos')
      .insert([
        {
          project_id: projectId,
          file_name: file.name,
          file_url: fileUrl,
        },
      ])
      .select()

    if (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
      }), { status: 500 })
    }

    return new Response(JSON.stringify({
      success: true,
      data,
      fileUrl,
    }), { status: 200 })
  } catch (err) {
    console.error('upload error:', err)
    return new Response(JSON.stringify({
      success: false,
      error: 'Server error',
    }), { status: 500 })
  }
}