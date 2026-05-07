import { NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/adminAuth'

export const maxDuration = 30

export async function GET(request) {
  if (!(await checkAdminAuth(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }

  // Only allow your own Spaces CDN — prevents this becoming an open proxy
  const cdnUrl = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')
  if (!cdnUrl || !url.startsWith(cdnUrl)) {
    return NextResponse.json({ error: 'Disallowed origin' }, { status: 403 })
  }

  try {
    const upstream = await fetch(url)
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
    }

    const buffer = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') || 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[proxy-img]', err)
    return NextResponse.json({ error: err.message || 'Proxy failed' }, { status: 500 })
  }
}