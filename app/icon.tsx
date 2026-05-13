import { ImageResponse } from 'next/og'

export const size = {
  width: 64,
  height: 64,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
        }}
      >
        <svg width="52" height="52" viewBox="0 0 120 62" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M28 35C28 21.4 39.6 10 54 10C68.4 10 80 21.4 80 35" stroke="#000000" strokeWidth="6" strokeLinecap="round" />
          <path d="M8 49C36 45 64 40 112 38C80 43 48 50 20 55H8V49Z" fill="#000000" />
        </svg>
      </div>
    ),
    size,
  )
}
