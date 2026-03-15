const { Pool } = require('pg');

async function testMutes() {
  const pool = new Pool({
    user: 'hafsql_public',
    password: 'hafsql_public',
    host: 'hafsql-sql.mahdiyari.info',
    database: 'haf_block_log',
    ssl: false
  });

  try {
    console.log('Connecting to HAFSQL...');
    
    // Test native mutes table
    const query = `
      SELECT muted_name 
      FROM hafsql.mutes 
      WHERE muter_name = 'vaipraonde';
    `;
    const res = await pool.query(query);
    console.log('\\n--- MUTES FOR vaipraonde (hafsql.mutes) ---');
    console.table(res.rows);

    // Also check hivemind_app.muted just in case
    const query2 = `
      SELECT account_id FROM hivemind_app.muted WHERE observer_id = (SELECT id FROM hivemind_app.hive_accounts WHERE name = 'vaipraonde');
    `;
    // We might not have access or standard schema, but worth a try if the first is empty.
    
  } catch (error) {
    console.error('Error querying mutes:', error);
  } finally {
    await pool.end();
  }
}

testMutes();
