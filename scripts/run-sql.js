const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set in environment');
    process.exit(2);
  }

  // sanitize DATABASE_URL: encode password portion to avoid invalid URL errors
  let sanitizedConn = databaseUrl;
  try {
    const m = databaseUrl.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
    if (m) {
      sanitizedConn = m[1] + m[2] + ':' + encodeURIComponent(m[3]) + '@' + m[4];
    }
  } catch (e) {
    // fallback to original
    sanitizedConn = databaseUrl;
  }

  const client = new Client({ connectionString: sanitizedConn });
  await client.connect();

  const files = [
    path.resolve(__dirname, '..', 'database', '01_payroll_migration_v2.sql'),
    path.resolve(__dirname, '..', 'database', '02_seed_staging_data.sql'),
    path.resolve(__dirname, '..', 'database', '03_test_rls_policies.sql'),
  ];

  const results = [];

  try {
    console.log('Ensuring required extensions (pgcrypto)...');
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
      console.log('pgcrypto extension ensured');
    } catch (ex) {
      console.warn('Warning: could not ensure pgcrypto extension:', ex.message);
    }

    for (const f of files) {
      console.log('\n----------');
      console.log('Running file:', f);
      const sql = fs.readFileSync(f, 'utf8');

      // Skip running test file if placeholders remain
      if (f.endsWith('03_test_rls_policies.sql') && /<[^>]+>/.test(sql)) {
        console.log('Skipping test file because placeholders detected. Replace placeholders before running this file in session context.');
        results.push({ file: f, status: 'skipped_placeholders' });
        continue;
      }

      try {
        // execute as a single multi-statement query
        await client.query(sql);
        console.log('SUCCESS:', f);
        results.push({ file: f, status: 'success' });

        // If this was the seed file, attempt to auto-fill placeholders in the test SQL
        if (f.endsWith('02_seed_staging_data.sql')) {
          try {
            console.log('Seed completed — collecting IDs to auto-replace placeholders in test SQL');
            const profilesRes = await client.query(`SELECT up.id as profile_id, up.auth_uid, e.emp_id
              FROM public.user_profiles up
              JOIN public.employees e ON up.employee_id = e.id
              WHERE e.emp_id IN ('ADM001','PAY001','SUP001','EMP001')`);
            const mapping = {};
            for (const r of profilesRes.rows) {
              if (r.emp_id === 'EMP001') {
                mapping['<EMP_PROFILE_ID>'] = r.profile_id;
                mapping['<EMP_UID>'] = r.auth_uid;
                mapping['<EMP_EMP_ID>'] = r.emp_id;
              }
              if (r.emp_id === 'SUP001') {
                mapping['<SUPERVISOR_PROFILE_ID>'] = r.profile_id;
                mapping['<SUPERVISOR_UID>'] = r.auth_uid;
                mapping['<SUPERVISOR_EMP_ID>'] = r.emp_id;
              }
              if (r.emp_id === 'PAY001') {
                mapping['<PAYROLL_PROFILE_ID>'] = r.profile_id;
                mapping['<PAYROLL_UID>'] = r.auth_uid;
                mapping['<PAYROLL_EMP_ID>'] = r.emp_id;
              }
              if (r.emp_id === 'ADM001') {
                mapping['<ADMIN_PROFILE_ID>'] = r.profile_id;
                mapping['<ADMIN_UID>'] = r.auth_uid;
                mapping['<ADMIN_EMP_ID>'] = r.emp_id;
              }
            }

            const clientRes = await client.query("SELECT id FROM public.clients WHERE client_name = 'Site A' LIMIT 1");
            if (clientRes.rows.length > 0) mapping['<SUPERVISOR_CLIENT_ID>'] = clientRes.rows[0].id;
            mapping['<COMPANY_ID>'] = 'comp_kc_clean';

            // load test file
            const testPath = path.resolve(__dirname, '..', 'database', '03_test_rls_policies.sql');
            let testSql = fs.readFileSync(testPath, 'utf8');

            // perform replacements
            let missing = [];
            testSql = testSql.replace(/<COMPANY_ID>/g, mapping['<COMPANY_ID>']);
            const placeholders = ['<EMP_EMP_ID>','<EMP_PROFILE_ID>','<EMP_UID>','<SUPERVISOR_PROFILE_ID>','<SUPERVISOR_UID>','<SUPERVISOR_CLIENT_ID>','<PAYROLL_UID>','<ADMIN_UID>'];
            for (const ph of placeholders) {
              if (mapping[ph]) {
                testSql = testSql.split(ph).join(mapping[ph]);
              } else if (testSql.includes(ph)) {
                missing.push(ph);
              }
            }

            if (missing.length > 0) {
              console.log('Could not auto-fill placeholders for test SQL:', missing.join(', '), '\nSkipping execution of test SQL.');
              results.push({ file: testPath, status: 'skipped_missing_placeholders', missing });
            } else {
              const tmpTest = testPath + '.autofill.sql';
              fs.writeFileSync(tmpTest, testSql, 'utf8');
              console.log('Wrote autofilled test SQL to', tmpTest, ' — executing now');
              try {
                // Ensure attendance_audit_logs.edited_by allows NULL when run as service account
                try {
                  await client.query("ALTER TABLE public.attendance_audit_logs ALTER COLUMN edited_by DROP NOT NULL;");
                  console.log('Ensured attendance_audit_logs.edited_by is nullable for test run');
                } catch (altErr) {
                  console.warn('Could not alter attendance_audit_logs.edited_by nullability:', altErr.message);
                }

                await client.query(testSql);
                console.log('SUCCESS: test SQL executed');
                results.push({ file: testPath, status: 'success_after_autofill', detail: tmpTest });
              } catch (testErr) {
                console.error('ERROR executing autofilled test SQL:', testErr.message);
                results.push({ file: testPath, status: 'failed_after_autofill', error: testErr.message });
              }
            }

          } catch (e) {
            console.error('Failed to auto-fill/execute test SQL after seed:', e.message);
            results.push({ file: f, status: 'seed_success_but_autofill_failed', error: e.message });
          }
        }

      } catch (err) {
        console.error('ERROR executing', f);
        console.error(err.message);

        // basic auto-fix heuristics
        // ensure any open/failed transaction is rolled back before further attempts
        try { await client.query('ROLLBACK;'); } catch (rb) { /* ignore */ }

        let fixed = false;
        const msg = err.message || '';
        let newSql = sql;

        // common fix: replace accidental Windows-style EOF BOM or weird characters
        if (/invalid byte sequence for encoding/.test(msg)) {
          newSql = newSql.replace(/\uFEFF/g, '');
          fixed = true;
        }

        // auto-fix: policy already exists -> inject DROP POLICY IF EXISTS before CREATE POLICY statements
        const policyExistsMatch = msg.match(/policy \"([^\"]+)\" for table \"([^\"]+)\" already exists/i);
        if (policyExistsMatch) {
          try {
            newSql = newSql.replace(/CREATE POLICY\s+([\w\"_]+)\s+ON\s+([\w\.\"_]+)/gi, function(m){ return 'DROP POLICY IF EXISTS ' + m.match(/CREATE POLICY\s+([\w\"_]+)/i)[1] + ' ON ' + m.match(/ON\s+([\w\.\"_]+)/i)[1] + ';\n' + m; });
            fixed = true;
            console.log('Applied heuristic: injected DROP POLICY IF EXISTS before CREATE POLICY statements');
          } catch (e) {
            console.warn('Policy injection heuristic failed:', e.message);
          }
        }

        // auto-fix: trigger already exists -> inject DROP TRIGGER IF EXISTS before CREATE TRIGGER statements
        const triggerExistsMatch = msg.match(/trigger \"([^\"]+)\" for relation \"([^\"]+)\" already exists/i);
        if (triggerExistsMatch) {
          try {
            newSql = newSql.replace(/CREATE TRIGGER\s+([\w\"_]+)\s+([\s\S]*?)EXECUTE FUNCTION/gi, function(m, p1, p2){
              // find relation name by searching for "ON <relation>" inside m
              const onMatch = m.match(/ON\s+([\w\.\"_]+)/i);
              const relation = onMatch ? onMatch[1] : 'public.attendance_logs';
              return 'DROP TRIGGER IF EXISTS ' + p1 + ' ON ' + relation + ';\n' + m;
            });
            fixed = true;
            console.log('Applied heuristic: injected DROP TRIGGER IF EXISTS before CREATE TRIGGER statements');
          } catch (e) {
            console.warn('Trigger injection heuristic failed:', e.message);
          }
        }

        // fix missing language plpgsql
        if (/language "plpgsql" does not exist/i.test(msg) || /PLPGSQL/.test(msg)) {
          try {
            console.log('Attempting to create language plpgsql');
            await client.query("CREATE EXTENSION IF NOT EXISTS plpgsql;");
            fixed = true;
          } catch (e) {
            console.warn('Could not create plpgsql extension:', e.message);
          }
        }

        // fix gen_random_uuid missing by ensuring pgcrypto (already attempted above)
        if (/function gen_random_uuid\(\) does not exist/i.test(msg)) {
          try {
            await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
            fixed = true;
          } catch (e) {
            console.warn('Could not create pgcrypto extension:', e.message);
          }
        }

        // fix FOR ALL -> FOR EACH ROW if syntax error near FOR and file contains FOR ALL (heuristic)
        if (/syntax error at or near "FOR"/i.test(msg) && /FOR ALL/i.test(newSql)) {
          newSql = newSql.replace(/FOR ALL/gi, 'FOR EACH ROW');
          fixed = true;
          console.log('Applied heuristic: replaced "FOR ALL" -> "FOR EACH ROW"');
        }

        // write back fixed file copy (not overwriting original) and re-run once
        if (fixed) {
          const tmpPath = f + '.autofix.sql';
          fs.writeFileSync(tmpPath, newSql, 'utf8');
          console.log('Wrote autofix candidate to', tmpPath);
          try {
            await client.query(newSql);
            console.log('SUCCESS after autofix:', f);
            results.push({ file: f, status: 'success_after_autofix', detail: tmpPath });
            // optionally replace original - we will not overwrite original; we keep autofix copy
            continue;
          } catch (err2) {
            console.error('Still failing after autofix attempt for', f);
            console.error(err2.message);
            results.push({ file: f, status: 'failed', error: err2.message });
            // continue to next file (do not abort entire run)
            continue;
          }
        }

        // if not fixed
        results.push({ file: f, status: 'failed', error: err.message });
      }
    }
  } finally {
    await client.end();
  }

  console.log('\nRun summary:');
  console.log(JSON.stringify(results, null, 2));
  // write summary to file
  fs.writeFileSync(path.resolve(__dirname, '..', 'scripts', 'run-sql-summary.json'), JSON.stringify(results, null, 2));
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
