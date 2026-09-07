import {describe,it,expect,afterEach} from 'vitest';
import {fetchDiscoveryEntries} from '../src/ingest/discovery.js';
import type {SignalSource} from '../src/types.js';
const original=process.env.SERPER_API_KEY;
afterEach(()=>{if(original===undefined)delete process.env.SERPER_API_KEY;else process.env.SERPER_API_KEY=original;});
const source:SignalSource={id:'test',tenantId:'test',name:'Test restaurant',sourceType:'web',url:'https://google.serper.dev/reviews',enabled:true,reliability:.7,intervalMinutes:21600,maxItemsPerFetch:50,timeoutSeconds:20,failureCount:0,metadata:{provider:'serper',mode:'discovery',queries:['ChIJtest'],max_pages:3}};
const review=(id:number)=>({text:`Dish review ${id}`,link:`https://www.google.com/maps/reviews/data=${id}`,rating:4,user:{name:'Fixture author'}});
describe('Google review collection',()=>{
 it('paginates beyond five, deduplicates original reviews and marks coverage',async()=>{
  process.env.SERPER_API_KEY='test-key';const bodies:Record<string,unknown>[]=[];
  const fake=(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(bodies.length===1?{reviews:Array.from({length:10},(_,i)=>review(i)),nextPageToken:'next'}:{reviews:[review(9),review(10)]}));}) as typeof fetch;
  const result=await fetchDiscoveryEntries(source,fake,new AbortController().signal);
  expect(result.entries).toHaveLength(11);expect(bodies[1]?.nextPageToken).toBe('next');
  expect(result.entries[0]?.raw.collection).toMatchObject({pagesFetched:2,recordsReceived:12,reviewsReturned:11,partial:false});
 });
 it('reports bounded partial collection rather than full coverage',async()=>{
  process.env.SERPER_API_KEY='test-key';const fake=(async()=>new Response(JSON.stringify({reviews:[review(1),review(2)],nextPageToken:'more'}))) as typeof fetch;
  const result=await fetchDiscoveryEntries({...source,maxItemsPerFetch:1},fake,new AbortController().signal);
  expect(result.entries).toHaveLength(1);expect(result.entries[0]?.raw.collection).toMatchObject({partial:true});
 });
 it('fails on exhausted credit and malformed payload rather than returning empty success',async()=>{
  process.env.SERPER_API_KEY='test-key';
  for(const response of [new Response('{}',{status:400}),new Response('{"organic":[]}')]){
   await expect(fetchDiscoveryEntries(source,(async()=>response) as typeof fetch,new AbortController().signal)).rejects.toThrow();
  }
 });
 it('rejects duplicate cursors and non-review links',async()=>{
  process.env.SERPER_API_KEY='test-key';
  await expect(fetchDiscoveryEntries(source,(async()=>new Response(JSON.stringify({reviews:[review(1)],nextPageToken:'same'}))) as typeof fetch,new AbortController().signal)).rejects.toThrow('cursor repeated');
  await expect(fetchDiscoveryEntries(source,(async()=>new Response(JSON.stringify({reviews:[{text:'Fake',link:'https://other.example/'}]}))) as typeof fetch,new AbortController().signal)).rejects.toThrow('no usable');
 });
});
it('allows Exa general-web research without its legacy news-only filter',async()=>{
 const key=process.env.EXA_API_KEY;process.env.EXA_API_KEY='test';let sent:Record<string,unknown>={};
 try {
  await fetchDiscoveryEntries({...source,url:'https://api.exa.ai/search',metadata:{provider:'exa',category:'general',queries:['restaurant']}},(async(_u,init)=>{sent=JSON.parse(String(init?.body));return new Response('{"results":[]}');}) as typeof fetch,new AbortController().signal);
  expect(sent).not.toHaveProperty('category');
 }finally{if(key===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=key;}
});
