const { Pool } = require('pg');

async function inspectHafsql() {
  const pool = new Pool({
    user: 'hafsql_public',
    password: 'hafsql_public',
    host: 'hafsql-sql.mahdiyari.info',
    database: 'haf_block_log',
    ssl: false
  });

  try {    
    const tables = ['mutes', 'blacklists', 'mute_follows', 'blacklist_follows'];
    
    for (const table of tables) {
      console.log(`\\n--- COLUMNS IN ${table} ---`);
      const query = `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '${table}' AND table_schema = 'hafsql';
      `;
      const res = await pool.query(query);
      console.table(res.rows);
      
      const sampleQuery = `SELECT * FROM hafsql.${table} LIMIT 1;`;
      try {
        const sampleRes = await pool.query(sampleQuery);
        console.log(`\\nSample from ${table}:`);
        console.log(sampleRes.rows[0]);
      } catch (e) {
        console.log(`Could not query sample from ${table}`);
      }
    }

  } catch (error) {
    console.error('Error inspecting database:', error);
  } finally {
    await pool.end();
  }
}

inspectHafsql();
