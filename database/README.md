# PostgreSQL setup

## Local database

1. Install PostgreSQL on your PC and start the PostgreSQL service.
2. Add to `.env.local`:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/gownweb
   ```
3. Run:
   ```bash
   npm run db:setup
   ```
   This creates the database, runs the schema, and seeds sample gowns.
4. Import existing JSON data (`data/gowns.json` and `data/orders.json`) into PostgreSQL:
   ```bash
   npm run db:import-json
   ```
5. Ensure `.env.local` has:
   ```bash
   USE_DB=true
   ```

---

## Hosted database (Railway, Supabase, Neon, etc.)

1. Create the database:
   ```sql
   CREATE DATABASE gownweb;
   ```

2. Run the schema:
   ```bash
   psql "$DATABASE_URL" -f database/schema.sql
   ```

3. (Optional) Seed sample gowns:
   ```bash
   psql "$DATABASE_URL" -f database/seed-gowns.sql
   ```

4. Add your connection string to `.env.local`:
   ```
   DATABASE_URL=postgresql://postgres:password@localhost:5432/gownweb
   ```

6. Restart the dev server. With `USE_DB=true`, the app reads and writes gowns and orders from PostgreSQL.
