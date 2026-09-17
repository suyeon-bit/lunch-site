import assert from 'node:assert/strict';
import { test } from 'node:test';
import { amount, calculate } from '../dist/settlement-core.js';

const people=[{id:'m',name:'민디언니'},{id:'y',name:'윤지언니'},{id:'e',name:'예지언니'},{id:'s',name:'수연'}];
const base=()=>({participants:people,groups:[]});
const group=(payerId,personal=[],shared=[])=>({id:crypto.randomUUID(),title:'점심',payerId,personal,shared});
const line=(participantId,name,price)=>({id:crypto.randomUUID(),participantId,name,amount:price});

test('숫자 입력과 빈 금액',()=>{assert.equal(amount('15,000원'),15000);assert.equal(amount(''),0);assert.equal(amount('abc'),0)});
test('요청한 단일 결제 예시',()=>{
  const s=base();s.groups=[group('e',[line('m','에그',25550),line('y','파스타',32450),line('e','점심',19050),line('s','국수',23550)])];
  const result=calculate(s);assert.equal(result.grandTotal,100600);assert.deepEqual(result.transfers.map(t=>[t.from,t.to,t.amount]),[['m','e',25550],['y','e',32450],['s','e',23550]]);
  assert.equal(result.people.find(p=>p.id==='e').net,81550);
});
test('공용 메뉴 나머지 1원은 참여자 순서대로, 합은 정확히 일치',()=>{
  const s=base();s.groups=[group('e',[],[{id:'a',name:'떡볶이',amount:10001,participantIds:['m','y','s']}])];
  const r=calculate(s);assert.deepEqual(r.people.map(p=>p.shared),[3334,3334,0,3333]);assert.equal(r.people.reduce((n,p)=>n+p.owed,0),10001);
});
test('여러 결제자 상계',()=>{
  const s=base();s.groups=[group('e',[line('m','밥',20000),line('e','밥',20000)]),group('s',[line('m','커피',5000),line('s','커피',5000)])];
  const r=calculate(s);assert.equal(r.grandTotal,50000);assert.deepEqual(r.transfers.map(t=>[t.from,t.to,t.amount]),[['m','e',20000],['m','s',5000]]);
});
test('중복 메뉴는 별도 행으로 합산하고 빈 금액은 0원',()=>{
  const s=base();s.groups=[group('e',[line('m','에그',15000),line('m','에그',15000),line('m','망고','')])];
  const r=calculate(s);assert.equal(r.grandTotal,30000);assert.equal(r.people[0].personal,30000);
});
test('참여자 삭제 뒤 남은 공용 메뉴는 재배분',()=>{
  const s=base();s.participants=people.filter(p=>p.id!=='y');s.groups=[group('e',[],[{id:'a',name:'공용',amount:10000,participantIds:['m','y','s']}])];
  const r=calculate(s);assert.equal(r.errors.length,0);assert.equal(r.people[0].shared,5000);assert.equal(r.people[2].shared,5000);
});
test('공용 메뉴 참여자나 결제자 누락 시 송금 결과를 막음',()=>{
  const s=base();s.groups=[group('',[],[{id:'a',name:'공용',amount:10000,participantIds:[]}])];
  const r=calculate(s);assert.ok(r.errors.length);assert.deepEqual(r.transfers,[]);
});
