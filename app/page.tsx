'use client'

import { useState } from 'react'

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [projectId, setProjectId] = useState('')
  const [message, setMessage] = useState('')

  async function handleUpload() {
    if (!file || !projectId) {
      setMessage('请先选择文件并输入 projectId')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('projectId', projectId)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    const result = await res.json()

    if (result.success) {
      setMessage('上传成功')
      console.log(result)
    } else {
      setMessage(`上传失败: ${result.error}`)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>测试上传</h1>

      <input
        type="text"
        placeholder="输入 projectId"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      />

      <br />
      <br />

      <input
        type="file"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            setFile(e.target.files[0])
          }
        }}
      />

      <br />
      <br />

      <button onClick={handleUpload}>上传</button>

      <p>{message}</p >
    </div>
  )
}