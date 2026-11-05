import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
import {parseYahooWithHistory,parseExtended,vixSession,parseYahoo,verifiedPriorClose,parseNight,failedQuote,instruments} from './collect.mjs';
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

// Exercise the exact browser calculation so the deployed template cannot drift from these cases.
const template=readFileSync(new URL('./index.template.html',import.meta.url),'utf8');
const browserSource=template.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
new Script(browserSource);
const periodChange=runInNewContext(browserSource.slice(browserSource.indexOf('function periodChange('),browserSource.indexOf('function selectedChange('))+';periodChange');
const periodQuote={id:'kosdaq',price:714.95,previousClose:704.39,change:10.56,changePct:1.499169494,asOf:'2026-11-04T06:30:00Z'};
const points=(start,end=700)=>[{t:Date.parse('2026-10-30T00:00:00Z'),v:start},{t:Date.parse('2026-11-04T06:00:00Z'),v:end}];

test('one-day view preserves the corrected prior-close return instead of intraday return',()=>{
 const p=periodChange(periodQuote,'1d',points(730),'1일');
 assert.equal(p.basis,704.39);assert.equal(p.change,10.56);assert.equal(p.changePct.toFixed(2),'1.50');assert.match(p.label,/전일 대비/);
});
test('every longer range uses its own first chart value and the displayed current quote',()=>{
 for(const [range,base] of [['5d',730],['1mo',680],['3mo',650],['6mo',600],['1y',550],['5y',500]]){
  const p=periodChange(periodQuote,range,points(base),range);
  assert.equal(p.basis,base);assert.equal(p.change,714.95-base);assert.equal(p.changePct,(714.95-base)/base*100);assert.equal(p.basisAt,points(base)[0].t);
 }
 assert.equal(periodQuote.change,10.56);
});
test('all instruments use the selected period, including negative, flat and yield changes',()=>{
 for(const instrument of instruments){
  const q={...periodQuote,...instrument,price:instrument.id==='us10y'?4.894:100};
  const p=periodChange(q,instrument.id==='night'?'1h':'1mo',points(instrument.id==='us10y'?4.952:110),'선택 기간');
  assert.ok(p.change<0);assert.equal(p.basis,instrument.id==='us10y'?4.952:110);
  if(instrument.id==='us10y')assert.ok(Math.abs(p.change+.058)<1e-9);
 }
 assert.equal(periodChange({...periodQuote,price:100},'5d',points(100),'5일').change,0);
});
test('missing or failed period requests never fall back to the daily percentage',()=>{
 for(const entry of [{},{loading:true},{error:true}]){
  const p=periodChange(periodQuote,'1mo',undefined,'1개월',entry);assert.equal(p.change,null);assert.equal(p.changePct,null);assert.match(p.label,/1개월/);assert.ok(p.message);
 }
 const p=periodChange(periodQuote,'1mo',points(680),'1개월',{error:true});assert.equal(p.warning,true);assert.equal(p.basis,680);
});
test('invalid baselines, insufficient history and bars after the quote cannot produce returns',()=>{
 for(const series of [points(0),points(-1),[points(100)[0]],points(100).map(p=>({...p,t:Date.parse('2026-11-05T00:00:00Z')}))]){
  assert.equal(periodChange(periodQuote,'5d',series,'5일').change,null);
 }
 assert.equal(periodChange({...periodQuote,price:null},'5d',points(100),'5일').change,null);
});
test('night full-session and hourly selection use distinct comparison baselines',()=>{
 const q={...periodQuote,id:'night',price:875.1,previousClose:889.85,change:-14.75,changePct:-14.75/889.85*100};
 assert.equal(periodChange(q,'1d',points(880),'야간장 전체').basis,889.85);
 for(const range of ['1h','3h','6h']){const p=periodChange(q,range,points(880),range);assert.equal(p.basis,880);assert.ok(Math.abs(p.change+4.9)<1e-9);}
});
test('range changes and quote refreshes recompute without leaking a previous period',()=>{
 const five=periodChange(periodQuote,'5d',points(730),'5일'),month=periodChange(periodQuote,'1mo',points(680),'1개월');
 assert.ok(five.change<0);assert.ok(month.change>0);
 assert.equal(periodChange({...periodQuote,price:720},'1mo',points(680),'1개월').change,40);
 assert.equal(periodChange(periodQuote,'1d',points(730),'1일').change,10.56);
});
test('period charts end at the displayed latest quote without mutating cached history',()=>{
 const align=runInNewContext(browserSource.slice(browserSource.indexOf('function alignPeriodSeries('),browserSource.indexOf('function chartSeries('))+';alignPeriodSeries');
 const source=points(730),aligned=align(periodQuote,source);
 assert.equal(aligned.at(-1).v,714.95);assert.equal(aligned.at(-1).t,Date.parse(periodQuote.asOf));assert.equal(source.length,2);assert.equal(source.at(-1).v,700);
 assert.equal(align(periodQuote,aligned).length,aligned.length);
 assert.equal(align(periodQuote,[source[0]]).length,1);
});

test('extended ETF quotes compare premarket to the preceding regular close across DST',()=>{
 const ms=s=>Date.parse(s),sec=s=>ms(s)/1000,reference={symbol:'SPY',name:'S&P 500 추종 ETF'};
 const prior={start:sec('2026-10-30T13:30:00Z'),end:sec('2026-10-30T20:00:00Z')},pre={start:sec('2026-11-02T09:00:00Z'),end:sec('2026-11-02T14:30:00Z')};
 const j={chart:{result:[{meta:{symbol:'SPY',instrumentType:'ETF',hasPrePostMarketData:true,regularMarketPrice:100,regularMarketTime:prior.end,tradingPeriods:{regular:[[prior]],pre:[[pre]],post:[]}},timestamp:[prior.end-300,pre.start,pre.start+300],indicators:{quote:[{close:[99,101,102]}]}}]}};
 const q=parseExtended(j,reference,ms('2026-11-02T09:10:00Z'));
 assert.equal(q.session,'PRE');assert.equal(q.price,102);assert.equal(q.regularClose,100);assert.equal(q.change,2);assert.equal(q.changePct,2);assert.equal(q.series.length,2);
 j.chart.result[0].meta.symbol='^GSPC';assert.throws(()=>parseExtended(j,reference),/Unsupported/);
});
test('after-hours uses the same-day regular close, including early market closes',()=>{
 const sec=s=>Date.parse(s)/1000,regular={start:sec('2026-11-27T14:30:00Z'),end:sec('2026-11-27T18:00:00Z')},post={start:regular.end,end:sec('2026-11-27T22:00:00Z')};
 const j={chart:{result:[{meta:{symbol:'SOXQ',instrumentType:'ETF',hasPrePostMarketData:true,regularMarketPrice:80,regularMarketTime:regular.end+1,previousClose:75,tradingPeriods:{regular:[[regular]],post:[[post]]}},timestamp:[regular.end-300,post.start+300,post.start+600],indicators:{quote:[{close:[79,78,77]}]}}]}};
 const q=parseExtended(j,{symbol:'SOXQ'},Date.parse('2026-11-27T19:00:00Z'));assert.equal(q.session,'POST');assert.equal(q.change,-3);assert.equal(q.regularClose,80);
 j.chart.result[0].meta.regularMarketTime=regular.end+86400;j.chart.result[0].meta.regularMarketPrice=150;
 assert.equal(parseExtended(j,{symbol:'SOXQ'},Date.parse('2026-11-27T19:00:00Z')).regularClose,79);
 j.chart.result[0].indicators.quote[0].close[0]=null;assert.throws(()=>parseExtended(j,{symbol:'SOXQ'},Date.parse('2026-11-27T19:00:00Z')),/close/);
});
test('old after-hours quotes retain their actual session and timestamp; missing data is rejected',()=>{
 const end=Date.parse('2026-11-04T21:00:00Z')/1000;
 const j={chart:{result:[{meta:{symbol:'ONEQ',instrumentType:'ETF',hasPrePostMarketData:true,regularMarketPrice:100,regularMarketTime:end,tradingPeriods:{regular:[[{start:end-23400,end}]],post:[[{start:end,end:end+14400}]],pre:[[{start:end+43200,end:end+63000}]]}},timestamp:[end+300],indicators:{quote:[{close:[101]}]}}]}};
 const q=parseExtended(j,{symbol:'ONEQ'},(end+45000)*1000);assert.equal(q.session,'POST');assert.equal(q.asOf,new Date((end+300)*1000).toISOString());assert.equal(q.sessionEnd,new Date((end+14400)*1000).toISOString());
 assert.throws(()=>parseExtended(j,{symbol:'ONEQ'},(end+8*86400)*1000),/recent/);
 j.chart.result[0].indicators.quote[0].close=[null];assert.throws(()=>parseExtended(j,{symbol:'ONEQ'},(end+45000)*1000),/recent/);
});
test('VIX is marked as extended calculation only with a recent quote in its calculation window',()=>{
 const now=Date.parse('2026-11-05T09:20:00Z'),m={regularMarketTime:now/1000-60,currentTradingPeriod:{regular:{start:Date.parse('2026-11-05T14:30:00Z')/1000,end:Date.parse('2026-11-05T21:00:00Z')/1000}}};
 assert.equal(vixSession(m,now).marketSession,'EXTENDED');assert.equal(vixSession(m,now).marketState,'OPEN');
 assert.equal(vixSession({...m,regularMarketTime:m.regularMarketTime-86400},now).marketState,'CLOSED');
 assert.equal(vixSession(m,Date.parse('2026-11-05T14:27:00Z')).marketState,'CLOSED');
 const after=Date.parse('2026-11-05T21:10:00Z');assert.equal(vixSession({...m,regularMarketTime:after/1000-60},after).marketSession,'REGULAR');
});

test('VIX extended quotes always verify the prior daily close even when stale reported changes agree',async t=>{
 const now=Date.parse('2026-11-05T09:20:00Z'),j=fixture('^VIX',17.15,20.83,now/1000-60),m=j.chart.result[0].meta;
 Object.assign(m,{instrumentType:'INDEX',exchangeTimezoneName:'America/New_York',priceHint:2,fulldayPrice:17.15,fulldayChange:-3.68,regularMarketChangePercent:-17.66683,currentTradingPeriod:{regular:{start:Date.parse('2026-11-05T14:30:00Z')/1000,end:Date.parse('2026-11-05T21:00:00Z')/1000}}});
 j.chart.result[0].timestamp=[Date.parse('2026-11-04T20:55:00Z')/1000,Date.parse('2026-11-04T21:00:00Z')/1000];j.chart.result[0].indicators.quote[0].close=[16.78,17.15];
 const daily={chart:{result:[{meta:{symbol:'^VIX',dataGranularity:'1d'},timestamp:['2026-11-03T14:30:00Z','2026-11-04T14:30:00Z','2026-11-05T09:17:00Z'].map(x=>Date.parse(x)/1000),indicators:{quote:[{close:[20.83,16.61000061,17.15]}]}}]}};
 t.mock.method(globalThis,'fetch',async()=>Response.json(daily));const q=await parseYahooWithHistory(j,instruments.find(i=>i.id==='vix'),now);
 assert.equal(q.previousClose,16.61);assert.equal(q.changePct.toFixed(2),'3.25');assert.equal(q.marketSession,'EXTENDED');assert.equal(q.series.length,0);assert.match(q.chartNote,/분봉 미제공/);
});
