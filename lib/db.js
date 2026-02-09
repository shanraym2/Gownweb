import mysql from 'mysql2/promise'

let pool = null

function getPool() {
  if (pool) return pool
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set')
  }
  const parsed = new URL(url)
  pool = mysql.createPool({
    host: parsed.hostname,
    port: parsed.port || 3306,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname?.slice(1) || 'gownweb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })
  return pool
}

export async function query(sql, params = []) {
  const p = getPool()
  const [rows] = await p.execute(sql, params)
  return rows
}

export async function getConnection() {
  const p = getPool()
  return p.getConnection()
}
