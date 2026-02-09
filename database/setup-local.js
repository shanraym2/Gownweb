/**
 * Sets up a local MySQL database: creates DB, runs schema, seeds gowns.
 * Prerequisites: MySQL server running locally.
 *
 * 1. Install MySQL (or XAMPP) on your PC
 * 2. Add to .env.local: DATABASE_URL=mysql://root:yourpassword@localhost:3306/gownweb
 * 3. Run: node database/setup-local.js
 */

const mysql = require('mysql2/promise')
const { readFileSync } = require('fs')
const { join } = require('path')

function loadEnv() {
  try {
    const envPath = join(process.cwd(), '.env.local')
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(/DATABASE_URL=(.+)/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return process.env.DATABASE_URL
}

function parseUrl(url) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port || 3306,
    user: u.username,
    password: u.password,
    database: u.pathname?.slice(1) || 'gownweb',
  }
}

async function main() {
  const url = loadEnv()
  if (!url) {
    console.error('DATABASE_URL not found. Add it to .env.local:')
    console.error('  DATABASE_URL=mysql://root:password@localhost:3306/gownweb')
    process.exit(1)
  }

  const config = parseUrl(url)
  const dbName = config.database

  console.log('Connecting to MySQL...')
  let conn
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
    })
  } catch (err) {
    console.error('Cannot connect to MySQL. Is it running? Error:', err.message)
    process.exit(1)
  }

  try {
    console.log(`Creating database "${dbName}" if not exists...`)
    await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await conn.changeUser({ database: dbName })

    console.log('Running schema.sql...')
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
    await conn.query(schema)

    console.log('Running seed-gowns.sql...')
    const seed = readFileSync(join(__dirname, 'seed-gowns.sql'), 'utf8')
    await conn.query(seed)

    const [tables] = await conn.execute('SHOW TABLES')
    console.log('Tables created:', tables.map((t) => Object.values(t)[0]).join(', '))
    console.log('Done. Local database is ready.')
  } catch (err) {
    console.error('Setup failed:', err.message)
    process.exit(1)
  } finally {
    await conn.end()
  }
}

main()
