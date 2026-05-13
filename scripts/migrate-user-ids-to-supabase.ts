import * as dotenv from 'dotenv';
import * as path from 'path';
import postgres from 'postgres';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { supabaseAdmin } from '../lib/supabase';

type AuthUser = {
  id: string;
  email?: string | null;
};

type DbUserRow = {
  id: string;
  email: string;
};

type UserIdMapping = {
  oldId: string;
  newId: string;
  email: string;
};

type ForeignKeyReference = {
  table_schema: string;
  table_name: string;
  column_name: string;
  constraint_name: string;
  constraint_def: string;
};

type CountRow = {
  count: number | string;
};

const APPLY_CONFIRMATION = 'MIGRATE_USER_IDS_TO_SUPABASE';
const DEFAULT_SKIPPED_SYSTEM_EMAILS = new Set([
  'marketplace@edulearn.com',
  'playreview@edulearn.com',
]);

const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const allowMissingAuth = args.has('--allow-missing-auth');
const includeSystemUsers = args.has('--include-system-users');
const confirmationArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--confirm='));
const confirmation = confirmationArg?.split('=').slice(1).join('=');

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function fetchAllSupabaseUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw new Error(`Failed to fetch Supabase users: ${error.message}`);
    }

    const pageUsers = data.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) {
      break;
    }

    page += 1;
  }

  return users;
}

function buildAuthUserByEmail(authUsers: AuthUser[]): Map<string, AuthUser> {
  const byEmail = new Map<string, AuthUser>();
  const duplicateEmails = new Set<string>();

  for (const authUser of authUsers) {
    const email = normalizeEmail(authUser.email);
    if (!email) continue;

    if (byEmail.has(email)) {
      duplicateEmails.add(email);
      continue;
    }

    byEmail.set(email, authUser);
  }

  if (duplicateEmails.size > 0) {
    throw new Error(
      `Supabase Auth has duplicate email entries: ${Array.from(
        duplicateEmails,
      ).join(', ')}`,
    );
  }

  return byEmail;
}

function buildMappings(
  dbUsers: DbUserRow[],
  authUsersByEmail: Map<string, AuthUser>,
) {
  const mappings: UserIdMapping[] = [];
  const alreadyAligned: DbUserRow[] = [];
  const missingAuthUsers: DbUserRow[] = [];
  const skippedSystemUsers: DbUserRow[] = [];
  const dbIds = new Map<string, DbUserRow>();

  for (const dbUser of dbUsers) {
    dbIds.set(dbUser.id, dbUser);
  }

  for (const dbUser of dbUsers) {
    const email = normalizeEmail(dbUser.email);

    if (!includeSystemUsers && DEFAULT_SKIPPED_SYSTEM_EMAILS.has(email)) {
      skippedSystemUsers.push(dbUser);
      continue;
    }

    const authUser = authUsersByEmail.get(email);
    if (!authUser) {
      missingAuthUsers.push(dbUser);
      continue;
    }

    if (!isUuid(authUser.id)) {
      throw new Error(`Supabase id for ${email} is not a UUID: ${authUser.id}`);
    }

    if (dbUser.id === authUser.id) {
      alreadyAligned.push(dbUser);
      continue;
    }

    const existingDbUserWithNewId = dbIds.get(authUser.id);
    if (existingDbUserWithNewId) {
      throw new Error(
        `Cannot map ${email} from ${dbUser.id} to ${authUser.id}; that id already belongs to ${existingDbUserWithNewId.email}`,
      );
    }

    mappings.push({
      oldId: dbUser.id,
      newId: authUser.id,
      email,
    });
  }

  const uniqueNewIds = new Set(mappings.map((mapping) => mapping.newId));
  if (uniqueNewIds.size !== mappings.length) {
    throw new Error('Two or more database users map to the same Supabase id');
  }

  if (missingAuthUsers.length > 0 && !allowMissingAuth) {
    throw new Error(
      `Missing Supabase Auth users for ${missingAuthUsers.length} database users. Re-run with --allow-missing-auth to skip them. First missing emails: ${missingAuthUsers
        .slice(0, 10)
        .map((u) => u.email)
        .join(', ')}`,
    );
  }

  return {
    mappings,
    alreadyAligned,
    missingAuthUsers,
    skippedSystemUsers,
  };
}

async function discoverUserForeignKeys(
  sql: postgres.Sql,
): Promise<ForeignKeyReference[]> {
  return sql<ForeignKeyReference[]>`
    select
      source_ns.nspname as table_schema,
      source_class.relname as table_name,
      source_attr.attname as column_name,
      con.conname as constraint_name,
      pg_get_constraintdef(con.oid) as constraint_def
    from pg_constraint con
    join pg_class source_class on source_class.oid = con.conrelid
    join pg_namespace source_ns on source_ns.oid = source_class.relnamespace
    join pg_attribute source_attr
      on source_attr.attrelid = source_class.oid
      and source_attr.attnum = con.conkey[1]
    join pg_class target_class on target_class.oid = con.confrelid
    join pg_namespace target_ns on target_ns.oid = target_class.relnamespace
    join pg_attribute target_attr
      on target_attr.attrelid = target_class.oid
      and target_attr.attnum = con.confkey[1]
    where con.contype = 'f'
      and array_length(con.conkey, 1) = 1
      and array_length(con.confkey, 1) = 1
      and target_ns.nspname = 'public'
      and target_class.relname = 'user'
      and target_attr.attname = 'id'
    order by source_ns.nspname, source_class.relname, source_attr.attname
  `;
}

async function createTempMappingTable(
  tx: postgres.TransactionSql,
  mappings: UserIdMapping[],
) {
  await tx`
    create temporary table user_id_migration_map (
      old_id uuid primary key,
      new_id uuid not null unique,
      email text not null
    ) on commit drop
  `;

  for (const mapping of mappings) {
    await tx`
      insert into user_id_migration_map (old_id, new_id, email)
      values (${mapping.oldId}, ${mapping.newId}, ${mapping.email})
    `;
  }
}

async function getReferenceCounts(
  tx: postgres.TransactionSql,
  references: ForeignKeyReference[],
) {
  const counts: Array<ForeignKeyReference & { count: number }> = [];

  for (const reference of references) {
    const rows = (await tx.unsafe(`
      select count(*)::int as count
      from ${quoteQualified(reference.table_schema, reference.table_name)}
      where ${quoteIdent(reference.column_name)} in (
        select old_id from user_id_migration_map
      )
    `)) as CountRow[];

    counts.push({
      ...reference,
      count: Number(rows[0]?.count ?? 0),
    });
  }

  return counts;
}

async function assertNoOldReferencesRemain(
  tx: postgres.TransactionSql,
  references: ForeignKeyReference[],
) {
  const remainingCounts = await getReferenceCounts(tx, references);
  const remaining = remainingCounts.filter((row) => row.count > 0);

  if (remaining.length > 0) {
    throw new Error(
      `Old user ids remain in references: ${remaining
        .map(
          (row) =>
            `${row.table_schema}.${row.table_name}.${row.column_name}=${row.count}`,
        )
        .join(', ')}`,
    );
  }
}

async function printPlan(
  sql: postgres.Sql,
  mappings: UserIdMapping[],
  references: ForeignKeyReference[],
) {
  await sql.begin(async (tx) => {
    await createTempMappingTable(tx, mappings);
    const referenceCounts = await getReferenceCounts(tx, references);
    const rowsWithReferences = referenceCounts.filter((row) => row.count > 0);

    console.log('\nMigration plan');
    console.log(`Users to migrate: ${mappings.length}`);
    console.log(`Foreign key constraints to recreate: ${references.length}`);
    console.log('Referenced rows to update by column:');

    for (const row of rowsWithReferences) {
      console.log(
        `  ${row.table_schema}.${row.table_name}.${row.column_name}: ${row.count}`,
      );
    }

    if (rowsWithReferences.length === 0) {
      console.log('  none');
    }
  });
}

async function applyMigration(
  sql: postgres.Sql,
  mappings: UserIdMapping[],
  references: ForeignKeyReference[],
) {
  await sql.begin(async (tx) => {
    await createTempMappingTable(tx, mappings);

    const lockTables = Array.from(
      new Set([
        quoteQualified('public', 'user'),
        ...references.map((reference) =>
          quoteQualified(reference.table_schema, reference.table_name),
        ),
      ]),
    ).join(', ');

    await tx.unsafe(`lock table ${lockTables} in access exclusive mode`);

    const conflictingUsers = await tx`
      select u.id::text, u.email
      from "user" u
      join user_id_migration_map m on u.id = m.new_id
    `;

    if (conflictingUsers.length > 0) {
      throw new Error(
        `New Supabase ids already exist in user table: ${conflictingUsers
          .map((row) => `${row.email}:${row.id}`)
          .join(', ')}`,
      );
    }

    for (const reference of references) {
      await tx.unsafe(
        `alter table ${quoteQualified(
          reference.table_schema,
          reference.table_name,
        )} drop constraint ${quoteIdent(reference.constraint_name)}`,
      );
    }

    for (const reference of references) {
      const rows = (await tx.unsafe(`
        with updated as (
          update ${quoteQualified(reference.table_schema, reference.table_name)} t
          set ${quoteIdent(reference.column_name)} = m.new_id
          from user_id_migration_map m
          where t.${quoteIdent(reference.column_name)} = m.old_id
          returning 1
        )
        select count(*)::int as count from updated
      `)) as CountRow[];

      console.log(
        `Updated ${rows[0]?.count ?? 0} rows in ${reference.table_schema}.${reference.table_name}.${reference.column_name}`,
      );
    }

    const migratedUsers = (await tx.unsafe(`
      with updated as (
        update "user" u
        set id = m.new_id
        from user_id_migration_map m
        where u.id = m.old_id
        returning 1
      )
      select count(*)::int as count from updated
    `)) as CountRow[];

    console.log(`Updated ${migratedUsers[0]?.count ?? 0} user primary keys`);

    await assertNoOldReferencesRemain(tx, references);

    for (const reference of references) {
      await tx.unsafe(
        `alter table ${quoteQualified(
          reference.table_schema,
          reference.table_name,
        )} add constraint ${quoteIdent(reference.constraint_name)} ${
          reference.constraint_def
        }`,
      );
    }
  });
}

async function main() {
  if (shouldApply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(
      `Applying requires --confirm=${APPLY_CONFIRMATION}. Run without --apply first and review the plan.`,
    );
  }

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL environment variable is not set');
  }

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    transform: {
      undefined: null,
    },
  });

  try {
    console.log(
      shouldApply
        ? 'Mode: APPLY. This will mutate user ids inside one transaction.'
        : 'Mode: PLAN ONLY. No persistent database changes will be made.',
    );

    const [authUsers, dbUsers, references] = await Promise.all([
      fetchAllSupabaseUsers(),
      sql<DbUserRow[]>`
        select id::text, email
        from "user"
        order by email
      `,
      discoverUserForeignKeys(sql),
    ]);

    const authUsersByEmail = buildAuthUserByEmail(authUsers);
    const { mappings, alreadyAligned, missingAuthUsers, skippedSystemUsers } =
      buildMappings(dbUsers, authUsersByEmail);

    console.log(`Supabase Auth users: ${authUsers.length}`);
    console.log(`Database users: ${dbUsers.length}`);
    console.log(`Already aligned: ${alreadyAligned.length}`);
    console.log(`Skipped system users: ${skippedSystemUsers.length}`);
    console.log(`Missing auth users skipped: ${missingAuthUsers.length}`);

    if (mappings.length === 0) {
      console.log('No user ids need migration.');
      return;
    }

    await printPlan(sql, mappings, references);

    if (!shouldApply) {
      console.log(
        '\nReview this plan, take a database backup, put writes in maintenance mode, then run:',
      );
      console.log(
        `pnpm run migrate:user-ids:apply -- --confirm=${APPLY_CONFIRMATION}`,
      );
      return;
    }

    await applyMigration(sql, mappings, references);
    console.log('User id migration completed successfully.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('User id migration failed:', error);
  process.exit(1);
});
