// app/api/admin/proxy-img/route.js
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

  const cdnUrl = process.env.DO_SPACES_CDN_URL?.replace(/\/$/, '')
  const region = process.env.DO_SPACES_REGION
  const bucket = process.env.DO_SPACES_BUCKET

  if (!cdnUrl || !url.startsWith(cdnUrl)) {
    return NextResponse.json({ error: 'Disallowed origin' }, { status: 403 })
  }

  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3')

    const client = new S3Client({
      endpoint: `https://${region}.digitaloceanspaces.com`,
      region,
      credentials: {
        accessKeyId:     process.env.DO_SPACES_KEY,
        secretAccessKey: process.env.DO_SPACES_SECRET,
      },
      forcePathStyle: false,
    })

    // Strip CDN prefix to get the object key
    // e.g. https://jce-bridal.sgp1.cdn.digitaloceanspaces.com/uploads/file.png → uploads/file.png
    const key = url.replace(`${cdnUrl}/`, '')

    const s3res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))

    const chunks = []
    for await (const chunk of s3res.Body) chunks.push(chunk)
    const buffer      = Buffer.concat(chunks)
    const contentType = s3res.ContentType || 'image/png'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':  contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('[proxy-img]', err)
    return NextResponse.json({ error: err.message || 'Proxy failed' }, { status: 500 })
  }
}