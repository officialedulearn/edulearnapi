import * as path from 'path';
import { config } from 'dotenv';
import db from '../drizzle';
import { sql } from 'drizzle-orm';

config({ path: path.resolve(__dirname, '../.env') });

async function syncQuizCompletedFromActivities() {
  await db.execute(sql`
    UPDATE "user" AS u
    SET "quizCompleted" = (
      SELECT COUNT(*)::integer
      FROM activity AS a
      WHERE a."userId" = u.id AND a.type = 'quiz'
    );
  `);

  console.log('quizCompleted synced from activity rows where type = quiz.');
}

syncQuizCompletedFromActivities()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
