import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

function getGownsPath() {
  return join(process.cwd(), 'data', 'gowns.json')
}

function loadGownsFromFile() {
  const path = getGownsPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

export async function GET() {
  const gowns = loadGownsFromFile()
  return NextResponse.json(Array.isArray(gowns) ? gowns : [])
}
