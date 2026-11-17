import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCredit,createCreditLoader,CREDIT_TTL} from './credit-source.mjs';
const now=Date.parse('2026-11-17T07:00Z');
const fixture=()=>({ds1:[{TMPV1:'20261113',TMPV2:26000528,TMPV3:20188986,TMPV4:5811542},{TMPV1:'20261112',TMPV2:25772869,TMPV3:20017771,TMPV4:5755098}]});
test('official credit columns convert million KRW to trillion and compare prior published day',()=>{
 const quotes=parseCredit(fixture(),now);
 assert.deepEqual(quotes.map(q=>q.price),[26.000528,20.188986,5.811542]);
 assert.equal(quotes[0].change,.227659);assert.equal(quotes[0].changePct.toFixed(2),'0.88');
 assert.equal(quotes[0].statDate,'2026-11-13');assert.equal(quotes[0].referenceDate,'2026-11-12');
 assert.equal(quotes[0].asOf,'2026-11-12T15:00:00.000Z');
 assert.equal(quotes[0].series.at(-1).v,quotes[0].price);
 assert.ok(Math.abs(quotes[0].price-quotes[1].price-quotes[2].price)<1e-10);
});
test('credit rejects missing data, inconsistent totals, duplicate dates and impossible dates',()=>{
 for(const edit of [j=>j.ds1[0].TMPV2=null,j=>j.ds1[0].TMPV2+=10,j=>j.ds1[0].TMPV1='20270201',j=>j.ds1[0].TMPV1='20260230',j=>j.ds1.push(j.ds1[0])]){const j=fixture();edit(j);assert.throws(()=>parseCredit(j,now));}
 assert.throws(()=>parseCredit({ds1:[]},now));
});
test('credit loader shares requests, explicitly requests million KRW, caches and preserves actual source date',async()=>{
 let clock=now,calls=0;
 const load=createCreditLoader({now:()=>clock,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://freesis.kofia.or.kr/meta/getMetaDataList.do');
  const request=JSON.parse(options.body).dmSearch;
  assert.equal(request.tmpV40,'1000000');assert.equal(request.tmpV1,'D');assert.equal(request.tmpV46,'20261117');assert.equal(request.OBJ_NM,'STATSCU0100000070BO');
  return Response.json(fixture());
 }});
 const [a,b]=await Promise.all([load(),load()]);assert.equal(a,b);assert.equal(calls,1);
 clock+=1000;assert.equal(await load(),a);assert.equal(a[0].collectedAt,new Date(now).toISOString());
 clock+=CREDIT_TTL;const c=await load();assert.equal(calls,2);assert.equal(c[0].asOf,a[0].asOf);assert.notEqual(c[0].collectedAt,a[0].collectedAt);
});
test('previous credit snapshot avoids needless collection and failure cannot silently refresh timestamps',async()=>{
 let clock=now+60000,calls=0;const previous=parseCredit(fixture(),now);
 const load=createCreditLoader({now:()=>clock,fetchImpl:async()=>{calls++;throw Error('offline')}});
 assert.equal((await load(previous))[0].collectedAt,previous[0].collectedAt);assert.equal(calls,0);
 clock+=CREDIT_TTL;await assert.rejects(load(previous),/offline/);assert.equal(calls,1);assert.equal(previous[0].collectedAt,new Date(now).toISOString());
});
