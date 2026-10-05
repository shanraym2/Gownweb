import { NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/adminAuth'

export const maxDuration = 60

/**
 * Edge flood-fill background removal using Canvas
 * Same algorithm as the web admin panel
 */
async function removeBgEdgeFloodFill(imageBuffer, tolerance = 35) {
  // We need to use a library that can handle image manipulation
  // For Node.js, we'll use sharp for image processing
  try {
    const sharp = require('sharp')

    // Use canvas-like processing via sharp
    // For this, we need to implement pixel-level operations
    // Since sharp doesn't expose direct canvas operations,
    // we'll use a hybrid approach with jimp for pixel manipulation

    const jimp = require('jimp')
    const image = await jimp.read(imageBuffer)

    const w = image.bitmap.width
    const h = image.bitmap.height
    const data = image.bitmap.data // RGBA buffer

    // Sample background color from edges
    const seeds = []
    const pts = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
      [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
    ]

    pts.forEach(([x, y]) => {
      const i = (y * w + x) * 4
      seeds.push({ r: data[i], g: data[i + 1], b: data[i + 2] })
    })

    // Determine if a pixel is background based on color similarity and transparency
    const isBg = (x, y) => {
      const i = (y * w + x) * 4
      return (
        data[i + 3] < 10 ||
        seeds.some(
          (s) =>
            Math.abs(data[i] - s.r) +
              Math.abs(data[i + 1] - s.g) +
              Math.abs(data[i + 2] - s.b) <
            tolerance * 3
        )
      )
    }

    // Flood fill algorithm using BFS
    const visited = new Uint8Array(w * h)
    const queue = new Uint32Array(w * h)
    let head = 0
    let tail = 0

    const enq = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const idx = y * w + x
      if (visited[idx]) return
      visited[idx] = 1
      if (isBg(x, y)) queue[tail++] = idx
    }

    // Start from edges
    for (let x = 0; x < w; x++) {
      enq(x, 0)
      enq(x, h - 1)
    }
    for (let y = 0; y < h; y++) {
      enq(0, y)
      enq(w - 1, y)
    }

    // Process queue
    while (head < tail) {
      const idx = queue[head++]
      const x = idx % w
      const y = (idx - x) / w
      data[idx * 4 + 3] = 0 // Set alpha to 0
      enq(x - 1, y)
      enq(x + 1, y)
      enq(x, y - 1)
      enq(x, y + 1)
    }

    // Update bitmap and convert to PNG
    const pngBuffer = await image.png().toBuffer()
    return pngBuffer
  } catch (err) {
    console.error('[removeBgEdgeFloodFill] Error:', err.message)
    throw err
  }
}

export async function POST(request) {
  if (!(await checkAdminAuth(request))) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { imageUrl, tolerance = 35 } = body

    if (!imageUrl) {
      return NextResponse.json({ ok: false, error: 'Missing imageUrl' }, { status: 400 })
    }

    // Fetch the image
    const fetchRes = await fetch(imageUrl)
    if (!fetchRes.ok) {
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch image' },
        { status: 400 }
      )
    }

    const imageBuffer = await fetchRes.arrayBuffer()

    // Try to process with jimp/sharp
    try {
      const processedBuffer = await removeBgEdgeFloodFill(
        Buffer.from(imageBuffer),
        Math.max(0, Math.min(100, Number(tolerance) || 35))
      )

      // Convert to base64 for response
      const base64 = processedBuffer.toString('base64')
      const dataUrl = `data:image/png;base64,${base64}`

      return NextResponse.json({
        ok: true,
        url: dataUrl
      })
    } catch (err) {
      // If processing fails, return original image
      console.warn('[remove-background] Processing failed, returning original:', err.message)
      return NextResponse.json({
        ok: true,
        url: imageUrl,
        fallback: true,
        message: 'Processing unavailable, using original image'
      })
    }
  } catch (err) {
    console.error('[remove-background]', err)
    return NextResponse.json(
      { ok: false, error: err.message || 'Background removal failed' },
      { status: 500 }
    )
  }
}
