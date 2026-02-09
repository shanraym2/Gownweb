# MySQL setup

## Local database

1. Install MySQL (or XAMPP) on your PC and start the MySQL service.
2. Add to `.env.local`:
   ```
   DATABASE_URL=mysql://root:yourpassword@localhost:3306/gownweb
   ```
3. Run:
   ```bash
   npm run db:setup
   ```
   This creates the database, runs the schema, and seeds sample gowns.

---

## Hosted database (PlanetScale, Railway, etc.)

1. Create the database:
   ```sql
   CREATE DATABASE gownweb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Run the schema:
   ```bash
   mysql -u your_user -p gownweb < database/schema.sql
   ```

3. (Optional) Seed sample gowns:
   ```bash
   mysql -u your_user -p gownweb < database/seed-gowns.sql
   ```

4. Add your connection string to `.env.local`:
   ```
   DATABASE_URL=mysql://user:password@localhost:3306/gownweb
   ```

5. Restart the dev server. When `DATABASE_URL` is set, the app reads and writes gowns and orders from MySQL. If the DB is unavailable, gown routes fall back to `data/gowns.json` and `data/orders.json`.
