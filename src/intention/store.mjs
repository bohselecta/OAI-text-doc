import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateProject, applyCommand, createProject, importProject, fail, uid } from './state.mjs';
/** Local/service persistence is authoritative; all source writes are transactional. */
export class IntentionStore {
 constructor(path=':memory:'){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS intention_projects (id TEXT NOT NULL, tenant TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY (tenant,id));');}
 list(actor){return this.db.prepare('SELECT state FROM intention_projects WHERE tenant=? ORDER BY updated_at DESC').all(actor.tenant).map(row=>{const p=JSON.parse(row.state);return {id:p.id,title:p.title,intention:p.intention.slice(0,180),revision:p.revision,updatedAt:p.updatedAt};});}
 get(actor,id){const row=this.db.prepare('SELECT state FROM intention_projects WHERE tenant=? AND id=?').get(actor.tenant,id);if(!row)fail('NOT_FOUND','Intention not found.',404);return validateProject(JSON.parse(row.state));}
 create(actor,{intention='',title='Untitled intention',source}={}){const project=source?importProject(source):createProject(intention,title);if(source)project.id=uid();validateProject(project);if(this.list(actor).length>=200)fail('LIMIT','This workspace already has 200 intentions.',409);this.db.prepare('INSERT INTO intention_projects VALUES(?,?,?,?,?)').run(project.id,actor.tenant,project.revision,project.updatedAt,JSON.stringify(project));return project;}
 command(actor,id,revision,command){this.db.exec('BEGIN IMMEDIATE');try{const current=this.get(actor,id);const next=applyCommand(current,command,revision);const result=this.db.prepare('UPDATE intention_projects SET state=?,revision=?,updated_at=? WHERE tenant=? AND id=? AND revision=?').run(JSON.stringify(next),next.revision,next.updatedAt,actor.tenant,id,revision);if(result.changes!==1)fail('STALE','A newer version exists. Reload and try again.',409);this.db.exec('COMMIT');return next;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 close(){this.db.close();}
}
