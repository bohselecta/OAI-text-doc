import { PGlite } from '@electric-sql/pglite';
/** Local development only: serializes one embedded PostgreSQL connection. */
export async function pglitePool(path){
  const db=new PGlite(path);await db.waitReady;
  let tail=Promise.resolve();
  const pool={
    async connect(){
      const before=tail;let unlock;tail=new Promise(resolve=>{unlock=resolve;});await before;
      let released=false;
      return {query:async(sql,params)=>params?.length?db.query(sql,params):(await db.exec(sql)).at(-1)??{rows:[]},release(){if(!released){released=true;unlock();}}};
    },
    async query(sql,params){const client=await pool.connect();try{return await client.query(sql,params);}finally{client.release();}},
    async end(){await tail;await db.close();}
  };
  return pool;
}
