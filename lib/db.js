import pg from 'pg'

const { Pool } = pg

let _pool = null

function getPool() {
  if (_pool) return _pool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is not set')
  _pool = new Pool({ connectionString: url })
  return _pool
}

export async function query(sql, params = []) {
  const pool = getPool()
  const { rows } = await pool.query(sql, params)
  return rows
}

export async function getClient() {
  const pool = getPool()
  const client = await pool.connect()
  return client
}

// Default export for routes that do: import pool from '@/lib/db'
const poolProxy = {
  query:   (...args) => getPool().query(...args),
  connect: ()        => getPool().connect(),
}

export default poolProxy