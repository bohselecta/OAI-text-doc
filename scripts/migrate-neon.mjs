import { createNeonStore, migrateNeon } from '../src/adapters/neon/index.mjs';
// Explicit operator action only; never run during build or a function request.
const store=await createNeonStore({checkSchema:false});
try{await migrateNeon(store.pool);console.log('Document PostgreSQL schema migrated.');}finally{await store.close();}
