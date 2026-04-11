/**
 * Sets up a local PostgreSQL database: creates DB, runs schema, seeds gowns.
 * Prerequisites: PostgreSQL server running locally.
 *
 * 1. Install PostgreSQL on your PC (https://www.postgresql.org/download/)
 * 2. Add to .env.local: DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/gownweb
 * 3. Run: node database/setup-local.js
 */

const { Client } = require('pg')
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
    port: u.port || 5432,
    user: u.username,
    password: u.password,
    database: u.pathname?.slice(1) || 'gownweb',
  }
}

async function main() {
  const url = loadEnv()
  if (!url) {
    console.error('DATABASE_URL not found. Add it to .env.local:')
    console.error('  DATABASE_URL=postgresql://postgres:password@localhost:5432/gownweb')
    process.exit(1)
  }

  const config = parseUrl(url)
  const dbName = config.database

  // Connect to default 'postgres' database first to create our DB
  console.log('Connecting to PostgreSQL...')
  const adminClient = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: 'postgres', // connect to default db first
  })

  try {
    await adminClient.connect()
  } catch (err) {
    console.error('Cannot connect to PostgreSQL. Is it running? Error:', err.message)
    process.exit(1)
  }

  try {
    // Check if DB exists, create if not
    console.log(`Creating database "${dbName}" if not exists...`)
    const { rows } = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    )
    if (rows.length === 0) {
      // Can't use parameters for CREATE DATABASE, but dbName comes from our own .env so this is safe
      await adminClient.query(`CREATE DATABASE "${dbName}"`)
      console.log(`Database "${dbName}" created.`)
    } else {
      console.log(`Database "${dbName}" already exists, skipping creation.`)
    }
  } catch (err) {
    console.error('Failed to create database:', err.message)
    await adminClient.end()
    process.exit(1)
  } finally {
    await adminClient.end()
  }

  // Now connect to the actual database to run schema and seed
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: dbName,
  })

  try {
    await client.connect()

    console.log('Running schema.sql...')
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)

    console.log('Running seed-gowns.sql...')
    const seed = readFileSync(join(__dirname, 'seed-gowns.sql'), 'utf8')
    await client.query(seed)

    // List created tables
    const { rows: tables } = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    console.log('Tables created:', tables.map((t) => t.tablename).join(', '))
    console.log('Done. Local database is ready.')
  } catch (err) {
    console.error('Setup failed:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()