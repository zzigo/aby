import pg from 'pg';
import { proposeAvDestination } from '../src/lib/server/av-tree';

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('DATABASE_URL is required');
const apply=process.argv.includes('--apply');
const client=new pg.Client({connectionString:databaseUrl});
await client.connect();
try {
  const result=await client.query(`SELECT i.id,i.source_object_key,i.title,i.year,i.tree_strategy,i.tree_value,i.destination_object_key,o.id operation_id,o.destination_object_key operation_destination
    FROM aby.av_catalog_items i JOIN aby.storage_operations o ON o.av_item_id=i.id
    WHERE o.state='pending' ORDER BY i.created_at`);
  const changes=result.rows.flatMap((row)=>{
    const destination=proposeAvDestination({sourceObjectKey:row.source_object_key,title:row.title,year:row.year??undefined,strategy:row.tree_strategy,treeValue:row.tree_value});
    return destination===row.destination_object_key&&destination===row.operation_destination?[]:[{...row,destination}];
  });
  console.log(JSON.stringify({mode:apply?'apply':'preview',changes:changes.map(({id,title,destination_object_key,destination})=>({id,title,from:destination_object_key,to:destination}))},null,2));
  if(apply&&changes.length){
    await client.query('BEGIN');
    for(const change of changes){
      await client.query('UPDATE aby.av_catalog_items SET destination_object_key=$1,updated_at=now() WHERE id=$2',[change.destination,change.id]);
      await client.query("UPDATE aby.storage_operations SET destination_object_key=$1 WHERE id=$2 AND state='pending'",[change.destination,change.operation_id]);
    }
    await client.query('COMMIT');
  }
} catch(error) { if(apply) await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }
