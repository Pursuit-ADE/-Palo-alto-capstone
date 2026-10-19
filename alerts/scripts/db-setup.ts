// Migrations, data load and grants for Postgres mode, as the owner login. Run it once per deploy (and after
// pulling new migrations) instead of giving the running server the owner URL:
//   MIGRATION_DATABASE_URL=... npm run db:setup
import { setupDatabase } from '../src/db/client';

const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) {
  console.error('Set MIGRATION_DATABASE_URL (the owner login) to run the alerts database setup.');
  process.exit(1);
}
await setupDatabase(owner);
console.log('Database migrated, loaded and granted. Start the alerts app without MIGRATION_DATABASE_URL.');
