// KOFIA FreeSIS, 신용공여 잔고 추이: 신용거래융자 only (not 대주/담보융자).
export const creditInstruments = [
 {id:'credit_total',name:'신용융자 잔고 · 전체',column:'TMPV2'},
 {id:'credit_kospi',name:'신용융자 잔고 · 코스피',column:'TMPV3'},
 {id:'credit_kosdaq',name:'신용융자 잔고 · 코스닥',column:'TMPV4'}
].map(q=>({...q,symbol:'KOFIA · 신용거래융자',group:'kr',unit:'조원',kind:'daily-statistic',sourceUrl:'https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000070'}));
export const CREDIT_TTL = 3600000;
const kstDate = now => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));

export function parseCredit(json,now=Date.now()) {
 if(!Array.isArray(json.ds1)||json.ds1.length<2)throw Error('KOFIA history unavailable');
 const unique=new Map();
 for(const row of json.ds1){
  const raw=String(row.TMPV1),date=raw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),t=Date.parse(date+'T00:00:00+09:00');
  const values=creditInstruments.map(q=>row[q.column]);
  if(!/^\d{8}$/.test(raw)||!Number.isFinite(t)||kstDate(t)!==date||t>now||values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<=0)||Math.abs(values[0]-values[1]-values[2])>2)throw Error('Invalid KOFIA credit observation');
  if(unique.has(t))throw Error('Duplicate KOFIA observation');
  unique.set(t,{t,date,values});
 }
 const rows=[...unique.values()].sort((a,b)=>a.t-b.t),last=rows.at(-1),prior=rows.at(-2);
 return creditInstruments.map((instrument,i)=>{
  // The public endpoint is explicitly requested in million KRW; display trillion KRW.
  const price=last.values[i]/1000000,previousClose=prior.values[i]/1000000,change=(last.values[i]-prior.values[i])/1000000;
  return {...instrument,price,previousClose,change,changePct:change/previousClose*100,referenceDate:prior.date,referenceTime:prior.t,statDate:last.date,asOf:new Date(last.t).toISOString(),collectedAt:new Date(now).toISOString(),marketState:'STATISTIC',collectionError:false,source:'금융투자협회',delayNote:'결제일 기준 · 일별 공표',series:rows.map(row=>({t:row.t,v:row.values[i]/1000000}))};
 });
}

export function createCreditLoader({fetchImpl=fetch,now=Date.now}={}) {
 let cached=null,pending=null;
 return async function load(previous=[]) {
  const time=now(),old=creditInstruments.map(i=>previous.find(q=>q.id===i.id));
  const fresh=quotes=>quotes?.length===3&&quotes.every(q=>q?.kind==='daily-statistic'&&!q.collectionError&&Array.isArray(q.series)&&q.series.length>=2&&Number.isFinite(q.price)&&time-Date.parse(q.collectedAt)>=0&&time-Date.parse(q.collectedAt)<CREDIT_TTL);
  if(fresh(cached))return cached;
  if(fresh(old))return (cached=old);
  if(pending)return pending;
  pending=(async()=>{
   const end=kstDate(time).replaceAll('-',''),start=String(Number(end.slice(0,4))-5)+'0101';
   const response=await fetchImpl('https://freesis.kofia.or.kr/meta/getMetaDataList.do',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({dmSearch:{tmpV1:'D',tmpV40:'1000000',tmpV45:start,tmpV46:end,OBJ_NM:'STATSCU0100000070BO'}}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('KOFIA HTTP '+response.status);
   cached=parseCredit(await response.json(),time);return cached;
  })();
  try{return await pending}finally{pending=null}
 };
}
export const loadCreditQuotes=createCreditLoader();
