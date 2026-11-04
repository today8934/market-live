import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const instruments = [
 {id:'kospi',name:'코스피',symbol:'^KS11',group:'kr',unit:'pt',sourceUrl:'https://finance.naver.com/sise/sise_index.naver?code=KOSPI'},
 {id:'kosdaq',name:'코스닥',symbol:'^KQ11',group:'kr',unit:'pt',sourceUrl:'https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ'},
 {id:'night',name:'코스피200 야간선물',symbol:'KOSPI200NF',group:'kr',unit:'pt',sourceUrl:'https://kred.dev/en/kospi-200-night-futures'},
 {id:'nasdaq',name:'나스닥 종합',symbol:'^IXIC',group:'us',unit:'pt',sourceUrl:'https://finance.yahoo.com/quote/%5EIXIC/'},
 {id:'sp500',name:'S&P 500',symbol:'^GSPC',group:'us',unit:'pt',sourceUrl:'https://finance.yahoo.com/quote/%5EGSPC/'},
 {id:'sox',name:'필라델피아 반도체 지수',symbol:'^SOX',group:'us',unit:'pt',sourceUrl:'https://finance.yahoo.com/quote/%5ESOX/'},
 {id:'nq',name:'나스닥100 선물',symbol:'NQ=F',group:'us',unit:'pt',sourceUrl:'https://finance.yahoo.com/quote/NQ%3DF/'},
 {id:'vix',name:'VIX',symbol:'^VIX',group:'macro',unit:'pt',sourceUrl:'https://finance.yahoo.com/quote/%5EVIX/'},
 {id:'us10y',name:'미국 10년 국채금리',symbol:'^TNX',group:'macro',unit:'%',sourceUrl:'https://finance.yahoo.com/quote/%5ETNX/'},
 {id:'wti',name:'WTI',symbol:'CL=F',group:'macro',unit:'USD/bbl',sourceUrl:'https://finance.yahoo.com/quote/CL%3DF/'},
 {id:'brent',name:'브렌트유',symbol:'BZ=F',group:'macro',unit:'USD/bbl',sourceUrl:'https://finance.yahoo.com/quote/BZ%3DF/'}
];

const finite = n => typeof n === 'number' && Number.isFinite(n);
export function validateQuote(q, now=Date.now()) {
 if(!finite(q.price)||!finite(q.previousClose)||q.previousClose===0) throw new Error('Invalid price or previous close');
 if(!Number.isFinite(Date.parse(q.asOf))||Date.parse(q.asOf)>now+60000) throw new Error('Invalid or future source timestamp');
 if(!finite(q.change)||!finite(q.changePct)) throw new Error('Invalid change');
 return q;
}
function sample(series,limit=90) {
 const valid=series.filter(x=>finite(x.t)&&finite(x.v));
 if(valid.length<=limit)return valid;
 return Array.from({length:limit},(_,i)=>valid[Math.round(i*(valid.length-1)/(limit-1))]);
}
// Chart metadata can retain an older close even while the current quote updates.
// Use the provider's paired daily price/change first, then cross-check its percent.
export function yahooDayChange(m) {
 const price=m.regularMarketPrice;
 const sameFullDayPrice=finite(m.fulldayPrice)&&finite(price)&&Math.abs(m.fulldayPrice-price)<=Math.max(1e-8,Math.abs(price)*1e-10);
 let change,previousClose,changeBasis;
 if(finite(m.regularMarketChange)){
  change=m.regularMarketChange;previousClose=price-change;changeBasis='regularMarketChange';
 }else if(sameFullDayPrice&&finite(m.fulldayChange)){
  change=m.fulldayChange;previousClose=price-change;changeBasis='fulldayChange';
 }else{
  previousClose=finite(m.previousClose)?m.previousClose:m.range==='1d'?m.chartPreviousClose:undefined;
  change=price-previousClose;changeBasis='previousClose';
 }
 if(!finite(price)||!finite(previousClose)||previousClose<=0||!finite(change))throw Error('Invalid daily change basis');
 const changePct=change/previousClose*100;
 const reportedPercents=[m.regularMarketChangePercent,...(sameFullDayPrice?[m.fulldayChangePercent]:[])].filter(finite);
 // Providers may round percentages to two decimals. Larger disagreement is unsafe.
 if(reportedPercents.some(p=>Math.abs(p-changePct)>.0051)){const error=Error('Daily change disagrees with reported percentage');error.code='DAY_CHANGE_MISMATCH';throw error;}
 return {previousClose,change,changePct,changeBasis};
}

export function verifiedPriorClose(quoteJson, historyJson, instrument) {
 const m=quoteJson.chart?.result?.[0]?.meta,r=historyJson.chart?.result?.[0];
 if(m?.symbol!==instrument.symbol||m.instrumentType!=='INDEX'||r?.meta?.symbol!==instrument.symbol||r.meta.dataGranularity!=='1d'||!m.exchangeTimezoneName)throw Error('Cannot verify daily reference');
 const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:m.exchangeTimezoneName,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000));
 const quoteDay=day(m.regularMarketTime);
 const rows=(r.timestamp??[]).map((t,i)=>({t,day:day(t),close:r.indicators?.quote?.[0]?.close?.[i]})).filter(b=>finite(b.t)&&finite(b.close)&&b.close>0).sort((a,b)=>a.t-b.t);
 // Require the quote's actual local trading day, not just the last returned bar.
 if(!rows.some(b=>b.day===quoteDay))throw Error('Current trading day absent from history');
 const prior=rows.filter(b=>b.day<quoteDay).at(-1);
 if(!prior||m.regularMarketTime-prior.t>7*86400)throw Error('Prior session not verifiable');
 const decimals=Number.isInteger(m.priceHint)&&m.priceHint>=0&&m.priceHint<=8?m.priceHint:4;
 return {price:Number(prior.close.toFixed(decimals)),date:prior.day};
}

export async function parseYahooWithHistory(j,instrument,now=Date.now()) {
 try{return parseYahoo(j,instrument,now)}catch(error){
  if(error.code!=='DAY_CHANGE_MISMATCH')throw error;
  for(const host of ['query1','query2']){
   try{
    const daily=await request('https://'+host+'.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(instrument.symbol)+'?interval=1d&range=5d');
    const reference=verifiedPriorClose(j,daily,instrument);
    return parseYahoo(j,instrument,now,reference);
   }catch{}
  }
  throw Error('Could not independently verify daily change');
 }
}

export function parseYahoo(j, instrument, now=Date.now(), verifiedReference) {
 const r=j.chart?.result?.[0];const m=r?.meta;
 if(!m||m.symbol!==instrument.symbol)throw new Error('Missing or mismatched instrument');
 const price=m.regularMarketPrice;
 const daily=verifiedReference?{previousClose:verifiedReference.price,change:price-verifiedReference.price,changePct:(price-verifiedReference.price)/verifiedReference.price*100,changeBasis:'dailyHistory',referenceDate:verifiedReference.date}:yahooDayChange(m);
 const {previousClose,change,changePct,changeBasis}=daily;
 const period=m.currentTradingPeriod?.regular;
 let marketState=period&&now/1000>=period.start&&now/1000<period.end?'OPEN':'CLOSED';
 if(instrument.symbol.endsWith('=F')){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));
  const day=parts.find(p=>p.type==='weekday').value,hour=Number(parts.find(p=>p.type==='hour').value);
  if(day==='Sat'||(day==='Sun'&&hour<18)||(day==='Fri'&&hour>=17)||hour===17)marketState='CLOSED';
 }
 const series=sample((r.timestamp??[]).map((t,i)=>({t:t*1000,v:r.indicators?.quote?.[0]?.close?.[i]})));
 return validateQuote({...instrument,price,previousClose,change,changePct,changeBasis,...(daily.referenceDate?{referenceDate:daily.referenceDate}:{}),
  asOf:new Date(m.regularMarketTime*1000).toISOString(),collectedAt:new Date(now).toISOString(),
  high:m.regularMarketDayHigh??null,low:m.regularMarketDayLow??null,
  marketState,sessionEnd:period?new Date(period.end*1000).toISOString():null,
  source:'Yahoo Finance',delayNote:'공개 시세 · 지연 가능',contract:m.shortName??instrument.symbol,
  series,unavailable:false,collectionError:false},now);
}
export function parseNight(html,now=Date.now()) {
 // Read the page's serialized public chart data as JSON, never execute page scripts.
 let initial;
 for(const match of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)) {
  try {
   const text=JSON.parse(match[1])[1];
   if(typeof text!=='string'||!text.includes('futures_code'))continue;
   for(const line of text.split('\n')){
    const start=line.indexOf(':'); if(start<0)continue;
    try{const tree=JSON.parse(line.slice(start+1));const candidate=tree?.[3]?.initial;
     if(candidate?.status?.instrument==='K200'&&Array.isArray(candidate.bars)) initial=candidate;
    }catch{}
   }
  }catch{}
 }
 if(!initial?.bars.length)throw new Error('Night futures source format changed or no bars');
 const bars=initial.bars.filter(x=>finite(x.time)&&finite(x.close)).sort((a,b)=>a.time-b.time);
 const last=bars.at(-1),s=initial.status,previousClose=s.day_close,change=last.close-previousClose;
 return validateQuote({...instruments.find(x=>x.id==='night'),price:last.close,previousClose,
  change,changePct:change/previousClose*100,asOf:new Date(last.time*1000).toISOString(),
  collectedAt:new Date(now).toISOString(),marketState:s.is_active?'OPEN':'CLOSED',
  high:Math.max(...bars.map(b=>b.high).filter(finite)),low:Math.min(...bars.map(b=>b.low).filter(finite)),
  source:'KRED',contract:s.futures_code,delayNote:'외부 참고 시세 · 주간 종가 대비',
  sessionDate:s.session_date,series:sample(bars.map(b=>({t:b.time*1000,v:b.close}))),unavailable:false,collectionError:false},now);
}
export function failedQuote(instrument, previous) {
 if(previous&&previous.id===instrument.id&&finite(previous.price))return {...previous,collectionError:true,error:'수집 실패 · 이전 시세 유지'};
 return {...instrument,price:null,previousClose:null,change:null,changePct:null,asOf:null,collectedAt:null,series:[],unavailable:true,collectionError:true,error:'시세를 불러오지 못했습니다'};
}
async function request(url,asJson=true) {
 const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MarketMonitor/1.0)','Accept':asJson?'application/json':'text/html'},signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw new Error('HTTP '+r.status);
 return asJson?r.json():r.text();
}
export async function collect() {
 const root=fileURLToPath(new URL('./site/',import.meta.url));await mkdir(root,{recursive:true});
 let previous={quotes:[]};
 if(process.env.PREVIOUS_DATA_URL){try{previous=await request(process.env.PREVIOUS_DATA_URL)}catch{}}
 else{try{previous=JSON.parse(await readFile(root+'/quotes.json','utf8'))}catch{}}
 const quotes=await Promise.all(instruments.map(async instrument=>{
  try{
   let q;
   if(instrument.id==='night')q=parseNight(await request(instrument.sourceUrl,false));
   else{
    let j;
    for(const host of ['query1','query2']){try{j=await request(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}?interval=5m&range=1d`);break}catch{}}
    if(!j)throw new Error('Both price endpoints failed');q=await parseYahooWithHistory(j,instrument);
   }
   console.log(`${q.id}: ${q.price} / ${q.asOf}`);return q;
  }catch(e){console.warn(`${instrument.id}: ${e.message}`);return failedQuote(instrument,previous.quotes?.find(q=>q.id===instrument.id));}
 }));
 const output={schemaVersion:1,generatedAt:new Date().toISOString(),targetIntervalMinutes:5,quotes};
 await writeFile(root+'/quotes.json',JSON.stringify(output));
 let template=await readFile(new URL('./index.template.html',import.meta.url),'utf8');
 await writeFile(root+'/index.html',template.replace('__INITIAL_DATA__',JSON.stringify(output).replaceAll('<','\\u003c')));
 if(quotes.every(q=>q.collectionError)){console.error('All sources failed; retained original quote timestamps.');process.exitCode=1;}
 return output;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))await collect();
