import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahoo,verifiedPriorClose,parseNight,failedQuote,instruments} from './collect.mjs';
const now=Date.parse('2026-11-02T22:00:00Z');
const fixture=(symbol,price=100,previous=110,time=now/1000-60)=>({chart:{result:[{meta:{symbol,regularMarketPrice:price,previousClose:previous,regularMarketTime:time,shortName:'Test',currentTradingPeriod:{regular:{start:now/1000-3600,end:now/1000+3600}}},timestamp:[now/1000-600,now/1000-300,now/1000-60],indicators:{quote:[{close:[110,null,price]}]}}]}});
test('price changes use previous close and preserve original timestamps',()=>{const q=parseYahoo(fixture('^GSPC'),instruments.find(x=>x.id==='sp500'),now);assert.equal(q.change,-10);assert.equal(q.changePct,-10/110*100);assert.equal(q.asOf,'2026-11-02T21:59:00.000Z');assert.equal(q.series.length,2)});
test('10-year yield remains a percent, not divided by ten',()=>{const q=parseYahoo(fixture('^TNX',4.894,4.929),instruments.find(x=>x.id==='us10y'),now);assert.equal(q.price,4.894);assert.ok(Math.abs(q.change+.035)<1e-10);assert.equal(q.unit,'%')});
test('reject missing values, future timestamps, and wrong symbols',()=>{const i=instruments[0];assert.throws(()=>parseYahoo(fixture('^KQ11'),i,now));assert.throws(()=>parseYahoo(fixture('^KS11',null),i,now));assert.throws(()=>parseYahoo(fixture('^KS11',10,11,now/1000+500),i,now))});
test('failed fetch never stamps an old quote as newly collected',()=>{const i=instruments[0],q=parseYahoo(fixture(i.symbol),i,now);const failed=failedQuote(i,q);assert.equal(failed.asOf,q.asOf);assert.equal(failed.collectedAt,q.collectedAt);assert.equal(failed.collectionError,true);assert.equal(failed.price,q.price)});
test('no previous data stays empty rather than becoming zero',()=>{const q=failedQuote(instruments[0]);assert.equal(q.price,null);assert.equal(q.asOf,null);assert.equal(q.unavailable,true)});
test('night session uses bar UTC timestamp, including the next Korean date',()=>{const initial={bars:[{time:1793653200,open:883.4,high:883.4,low:883.4,close:883.4}],status:{instrument:'K200',futures_code:'A01612',day_close:918.65,session_date:'20261103',is_active:false}};const text='2c:'+JSON.stringify(['$','$L30',null,{initial}])+'\n';const html='<script>self.__next_f.push('+JSON.stringify([1,text])+')</script>';const q=parseNight(html,now);assert.equal(q.asOf,'2026-11-02T21:00:00.000Z');assert.equal(q.price,883.4);assert.equal(q.change,-35.25);assert.equal(q.marketState,'CLOSED')});
test('changed night source format fails explicitly',()=>assert.throws(()=>parseNight('<html>maintenance</html>',now)));
test('US futures daily 17:00 ET pause is not shown as trading',()=>{const q=parseYahoo(fixture('NQ=F'),instruments.find(x=>x.id==='nq'),now);assert.equal(q.marketState,'CLOSED')});

test('KOSDAQ stale Nov 2 chart close cannot replace Nov 3 daily reference',()=>{
 const j=fixture('^KQ11',714.95,734.36),m=j.chart.result[0].meta;
 Object.assign(m,{range:'1d',chartPreviousClose:734.36,regularMarketChangePercent:1.499,fulldayPrice:714.95,fulldayChange:10.56,fulldayChangePercent:1.499});
 const q=parseYahoo(j,instruments.find(x=>x.id==='kosdaq'),now);
 assert.ok(Math.abs(q.previousClose-704.39)<1e-8);assert.equal(q.change,10.56);assert.equal(q.changePct.toFixed(2),'1.50');assert.equal(q.changeBasis,'fulldayChange');
});
test('a stale or unmatched quote bundle cannot silently produce the wrong daily direction',()=>{
 const j=fixture('^KQ11',714.95,734.36),m=j.chart.result[0].meta;
 Object.assign(m,{regularMarketChangePercent:1.499,fulldayPrice:704.39,fulldayChange:10.56});
 assert.throws(()=>parseYahoo(j,instruments.find(x=>x.id==='kosdaq'),now),/disagrees/);
 m.fulldayPrice=714.95;m.fulldayChange=-19.41;
 assert.throws(()=>parseYahoo(j,instruments.find(x=>x.id==='kosdaq'),now),/disagrees/);
});
test('daily reported change supports zero, negative moves and yield units',()=>{
 for(const [id,symbol,price,change,pct] of [['sp500','^GSPC',100,0,0],['vix','^VIX',19.16,-1.67,-8.013],['us10y','^TNX',4.952,.058,1.185]]){
  const j=fixture(symbol,price,999);Object.assign(j.chart.result[0].meta,{fulldayPrice:price,fulldayChange:change,fulldayChangePercent:pct});
  const q=parseYahoo(j,instruments.find(x=>x.id===id),now);assert.equal(q.change,change);assert.ok(Math.abs(q.previousClose-(price-change))<1e-8);
 }
});
test('multi-day chart baseline is never treated as the prior session close',()=>{
 const j=fixture('^GSPC',100);delete j.chart.result[0].meta.previousClose;
 Object.assign(j.chart.result[0].meta,{range:'5d',chartPreviousClose:80});
 assert.throws(()=>parseYahoo(j,instruments.find(x=>x.id==='sp500'),now),/basis/);
});

test('daily history verifies the preceding local session when reported percentage conflicts',()=>{
 const quote=fixture('^VIX',16.93,20.83,Date.parse('2026-11-04T21:10:00Z')/1000),m=quote.chart.result[0].meta;
 Object.assign(m,{instrumentType:'INDEX',exchangeTimezoneName:'America/Chicago',priceHint:2,regularMarketChangePercent:-18.768,fulldayPrice:16.93,fulldayChange:-3.9});
 const daily={chart:{result:[{meta:{symbol:'^VIX',dataGranularity:'1d'},timestamp:['2026-11-02T08:00:00Z','2026-11-03T08:00:00Z','2026-11-04T08:00:00Z'].map(t=>Date.parse(t)/1000),indicators:{quote:[{close:[21.1499996,20.8299999,16.93]}]}}]}};
 const instrument=instruments.find(x=>x.id==='vix'),reference=verifiedPriorClose(quote,daily,instrument);
 assert.deepEqual(reference,{price:20.83,date:'2026-11-03'});
 const q=parseYahoo(quote,instrument,Date.parse('2026-11-04T21:11:00Z'),reference);
 assert.equal(q.changeBasis,'dailyHistory');assert.equal(q.previousClose,20.83);assert.equal(q.changePct.toFixed(2),'-18.72');
 daily.chart.result[0].timestamp.pop();daily.chart.result[0].indicators.quote[0].close.pop();
 assert.throws(()=>verifiedPriorClose(quote,daily,instrument),/absent/);
 daily.chart.result[0].meta.symbol='^GSPC';assert.throws(()=>verifiedPriorClose(quote,daily,instrument),/reference/);
});
test('daily-history fallback must not substitute a futures close for its settlement reference',()=>{
 const quote=fixture('NQ=F');Object.assign(quote.chart.result[0].meta,{instrumentType:'FUTURE',exchangeTimezoneName:'America/New_York'});
 assert.throws(()=>verifiedPriorClose(quote,{chart:{result:[{meta:{symbol:'NQ=F',dataGranularity:'1d'}}]}},instruments.find(x=>x.id==='nq')),/reference/);
});
