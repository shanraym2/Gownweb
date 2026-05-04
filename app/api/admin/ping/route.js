import { NextResponse } from 'next/server'
import { checkAdminAuth } from '@/lib/adminAuth'

export async function GET(request) {
  if (!await checkAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}