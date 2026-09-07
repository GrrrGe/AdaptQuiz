// One-off DB initialiser: `npm run db:init`. Creates data/adaptquiz.db + tables.
import { getDb } from "./db";

const db = getDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as { name: string }[];
console.log("OK tables:", tables.map((t) => t.name));
db.close();
