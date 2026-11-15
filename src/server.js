'use strict';
const { openDb } = require('./db');
const { createApp } = require('./app');

const port = process.env.PORT || 3000;
openDb()
  .then((db) => {
    const app = createApp(db);
    app.listen(port, () => console.log(`Ajaia Docs on :${port} (db: ${db.kind})`));
  })
  .catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
