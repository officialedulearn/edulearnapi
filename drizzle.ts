import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import * as postgres from "postgres";

config({
  path: '.env',
});



const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
console.log(process.env.POSTGRES_URL, "Database URL used for connection");
const db = drizzle(client);

export default db;