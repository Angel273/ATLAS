import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createPool,withTenant} from '@atlas/database';
import {IngestionService,startImportWorker} from '@atlas/ingestion';
import {KpiService} from '@atlas/kpi';
import {roleCapabilities,type DataActor,type DatasetVersion,type Mapping,type Regional} from '@atlas/contracts';
describe('real ingestion, immutable snapshots and governed KPI queries',()=>{
 const admin=createPool(process.env.ADMIN_DATABASE_URL), data=new IngestionService(), kpis=new KpiService(data);
 const tenant=randomUUID(),otherTenant=randomUUID(),user=randomUUID();
 const actor:DataActor={tenantId:tenant,userId:user,capabilities:[...roleCapabilities.admin]}, other={...actor,tenantId:otherTenant};
 const regional:Regional={decimalSeparator:',',thousandsSeparator:'.',dateFormat:'DD/MM/YYYY',timezone:'America/Guatemala',delimiter:';'};
 let worker:ReturnType<typeof startImportWorker>, datasetId:string, first:DatasetVersion, kpiId:string;
 const mapping:Mapping={sheet:'CSV',strategy:'replace',regional,keyFields:['id'],fields:[{source:'id',target:'id',type:'string',required:true},{source:'importe',target:'importe',type:'decimal',required:false},{source:'fecha',target:'fecha',type:'date',required:false},{source:'equipo',target:'equipo',type:'string',required:false}]};
 async function wait(id:string,states:string[]) { const deadline=Date.now()+15000; while(Date.now()<deadline){const version=await data.get(actor,id);if(states.includes(version.state))return version;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('IMPORT_TEST_TIMEOUT'); }
 async function upload(csv:string,strategy:Mapping['strategy']='replace') {
  const bytes=Buffer.from(csv); const result=await data.upload(actor,datasetId,{filename:'synthetic.csv',format:'csv',bytes:bytes.length,regional},randomUUID(),randomUUID());
  expect((await fetch(result.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes})).ok).toBe(true);
  await data.confirm(actor,result.version.id); const profile=await wait(result.version.id,['awaiting_mapping','failed']); expect(profile.errorCode).toBeNull();
  await data.map(actor,result.version.id,{...mapping,strategy}); return wait(result.version.id,['ready','failed']);
 }
 beforeAll(async()=>{
  await admin.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',[tenant,'Ingest Synthetic',otherTenant,'Isolated Synthetic']);
  await admin.query("INSERT INTO identity.users(id,email,password_hash,mfa_enabled,mfa_secret) VALUES($1,$2,$3,true,'synthetic-unusable-secret')",[user,`${user}@example.invalid`,'unusable-synthetic-hash']);
  await admin.query("INSERT INTO identity.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenant,user]);
  await data.onModuleInit();worker=startImportWorker();await worker.waitUntilReady();
  datasetId=(await data.create(actor,{name:'Synthetic calls',slug:'calls'},randomUUID(),randomUUID())).id;
 });
 afterAll(async()=>{
  await worker?.close();await kpis.onModuleDestroy();await data.onModuleDestroy();
  // Keep immutable synthetic evidence in the isolated test database; never disable triggers.
  await admin.end();
 });
 it('processes regional CSV through S3 and BullMQ, preserving hash and exact decimals',async()=>{
  first=await upload('id;importe;fecha;equipo\na;1.234,56;03/04/2026;A\nb;2,44;04/04/2026;B\n');
  expect(first.state).toBe('ready');expect(first.rows).toBe(2);expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await data.preview(actor,first.id)).rows[0]).toEqual({id:'a',importe:'1234.56',fecha:'2026-04-03',equipo:'A'});
  const key=randomUUID();first=await data.publish(actor,first.id,key,randomUUID());expect((await data.publish(actor,first.id,key,randomUUID())).publishedAt).toBe(first.publishedAt);
 });
 it('binds KPI versions and filters to published snapshots using actual numeric SQL',async()=>{
  const input={name:'Total importe',slug:'total',description:'Synthetic',datasetVersionId:first.id,formula:'SUM(calls.importe)',unit:'number',precision:2,dimensions:['equipo','fecha']};const key=randomUUID();
  const kpi=await kpis.create(actor,input,key,randomUUID()); kpiId=kpi.id;
  expect((await kpis.create(actor,input,key,randomUUID())).id).toBe(kpi.id);
  await kpis.publish(actor,kpi.id,randomUUID());
  const result=await kpis.query(actor,{kpiVersionId:kpi.id},randomUUID());expect(result.rows).toEqual([{dimensions:{},value:'1237.00'}]);expect(result.datasetVersionId).toBe(first.id);
  const filtered=await kpis.query(actor,{kpiVersionId:kpi.id,dimensions:['equipo'],filters:[{field:'fecha',op:'gte',value:'2026-04-04'}]},randomUUID());expect(filtered.rows).toEqual([{dimensions:{equipo:'B'},value:'2.44'}]);
  await expect(kpis.query(actor,{kpiVersionId:kpi.id,filters:[{field:'equipo',op:'eq',value:"A' OR TRUE --"}]},randomUUID())).resolves.toMatchObject({rows:[{value:null}]});
 });
 it('rejects crossed tenants, unprivileged writes and mutation of published rows',async()=>{
  await expect(data.get(other,first.id)).rejects.toMatchObject({code:'VERSION_NOT_FOUND'});
  await expect(data.preview(other,first.id)).rejects.toMatchObject({code:'VERSION_NOT_FOUND'});
  await expect(data.versions(other,datasetId)).rejects.toMatchObject({code:'DATASET_NOT_FOUND'});
  await expect(kpis.query(other,{kpiVersionId:kpiId},randomUUID())).rejects.toMatchObject({code:'KPI_NOT_FOUND'});
  await expect(data.create({...actor,capabilities:[...roleCapabilities.ceo]},{name:'Denied',slug:'denied'},randomUUID(),randomUUID())).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(withTenant(data.pool,tenant,client=>client.query('UPDATE dataset_rows SET values=$2 WHERE version_id=$1',[first.id,{id:'tamper'}]))).rejects.toMatchObject({code:'23514'});
  expect((await withTenant(data.pool,otherTenant,client=>client.query('SELECT * FROM dataset_rows WHERE version_id=$1',[first.id]))).rowCount).toBe(0);
 });
 it('blocks duplicate keys and incompatible regional values from publication',async()=>{
  const bad=await upload('id;importe;fecha;equipo\na;1,2;03/04/2026;A\na;2,3;03/04/2026;A\nc;1.23,4;31/02/2026;A\n');
  expect(bad.state).toBe('failed');expect(bad.issueCount).toBeGreaterThanOrEqual(3);expect(bad.issues.some(issue=>issue.code==='DUPLICATE_KEY')).toBe(true);
  await expect(data.publish(actor,bad.id,randomUUID(),randomUUID())).rejects.toMatchObject({code:'VERSION_NOT_READY'});
 });
 it('upserts by key with lineage while historical KPI remains unchanged',async()=>{
  const next=await upload('id;importe;fecha;equipo\na;10,00;03/04/2026;A\nc;5,00;04/04/2026;C\n','upsert');
  expect(next.state).toBe('ready');expect(next.rows).toBe(3);await data.publish(actor,next.id,randomUUID(),randomUUID());
  expect((await kpis.query(actor,{kpiVersionId:kpiId},randomUUID())).rows[0]?.value).toBe('1237.00');
  expect((await data.preview(actor,next.id)).rows.map(row=>row.importe)).toEqual(['2.44','10','5']);
  await data.publish(actor,first.id,randomUUID(),randomUUID(),true);
  expect((await data.list(actor)).items[0]?.currentVersionId).toBe(first.id);
 });
 it('cancels an upload before execution and prevents publication',async()=>{
  const upload=await data.upload(actor,datasetId,{filename:'cancel.csv',format:'csv',bytes:10,regional},randomUUID(),randomUUID());
  expect((await data.cancel(actor,upload.version.id,randomUUID())).state).toBe('cancelled');
  await expect(data.confirm(actor,upload.version.id)).rejects.toMatchObject({code:'INVALID_IMPORT_STATE'});
 });
 it('hard deletes draft datasets and protects published datasets with archiving and PostgreSQL triggers',async()=>{
  // 1. Create a draft dataset and delete it permanently
  const draft = await data.create(actor, { name: 'Draft to delete', slug: 'draft_del' }, randomUUID(), randomUUID());
  const delResult = await data.deleteOrArchive(actor, draft.id, randomUUID());
  expect(delResult).toEqual({ action: 'deleted', id: draft.id });
  await expect(data.versions(actor, draft.id)).rejects.toMatchObject({ code: 'DATASET_NOT_FOUND' });

  // 2. Archive published dataset
  const archResult = await data.deleteOrArchive(actor, datasetId, randomUUID());
  expect(archResult).toEqual({ action: 'archived', id: datasetId });
  expect((await data.list(actor, false)).items.some(d => d.id === datasetId)).toBe(false);
  expect((await data.list(actor, true)).items.some(d => d.id === datasetId)).toBe(true);

  // 3. PostgreSQL trigger blocks direct DELETE on published dataset
  await expect(
    withTenant(data.pool, tenant, client => client.query('DELETE FROM datasets WHERE id = $1', [datasetId]))
  ).rejects.toMatchObject({ code: '23514' });

  // 4. Reactivate archived dataset
  const unarchResult = await data.unarchive(actor, datasetId, randomUUID());
  expect(unarchResult).toEqual({ action: 'unarchived', id: datasetId });
  expect((await data.list(actor, false)).items.some(d => d.id === datasetId)).toBe(true);
 });
 it('hard deletes draft KPIs and deprecates published KPIs with PostgreSQL trigger protection',async()=>{
  // 1. Create draft KPI and delete it permanently
  const draftKpi = await kpis.create(actor, {
    name: 'Draft KPI', slug: 'draft_kpi', description: 'Draft',
    datasetVersionId: first.id, formula: 'COUNT(calls.id)', unit: 'number', precision: 0, dimensions: []
  }, randomUUID(), randomUUID());
  const delKpi = await kpis.deleteOrDeprecate(actor, draftKpi.id, randomUUID());
  expect(delKpi).toEqual({ action: 'deleted', id: draftKpi.id });

  // 2. Deprecate published KPI
  const depKpi = await kpis.deleteOrDeprecate(actor, kpiId, randomUUID());
  expect(depKpi).toEqual({ action: 'deprecated', id: kpiId });
  expect((await kpis.list(actor, false)).items.some(k => k.id === kpiId)).toBe(false);
  expect((await kpis.list(actor, true)).items.some(k => k.id === kpiId)).toBe(true);

  // 3. PostgreSQL trigger blocks direct DELETE on published KPI
  await expect(
    withTenant(data.pool, tenant, client => client.query('DELETE FROM kpi_versions WHERE id = $1', [kpiId]))
  ).rejects.toMatchObject({ code: '23514' });
 });
});
