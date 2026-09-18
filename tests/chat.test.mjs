import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { handleChat, LUNCH_COMMAND_ID, makeCard, makeLunchCommandCard, roomFromUrl, verifyChatToken } from '../src/chat.js';
import { restaurantNames } from '../src/restaurant-names.js';
import worker from '../src/worker.js';

const site = 'https://lunch-site.suyeon-974.workers.dev';
const id = 'abc123def456';
const session = (kind = 'restaurant', participants = []) => ({ id, kind, title: '금요일 점심', headcount: 5, participants, final_restaurant: null, final_date: null });
const person = (likes = [], dislikes = [], dates = []) => ({ likes, dislikes, dates });
const cardText = result => JSON.stringify(result.cardsV2);
const event = (url, type = 'MESSAGE') => ({ type, message: { matchedUrl: { url }, sender: { type: 'HUMAN' } } });
const req = (body, headers = {}) => new Request(`${site}/api/chat`, { method: 'POST', headers, body: JSON.stringify(body) });

test('restaurant IDs match existing web list', () => {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const source = html.match(/const restaurants=\[([\s\S]*?)\]\.map\(/)?.[1];
  assert.ok(source);
  const names = [...source.matchAll(/\['([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(restaurantNames, names);
});

test('only canonical homepage or single valid room is previewed', () => {
  assert.deepEqual(roomFromUrl(`${site}/`), { id: null });
  assert.deepEqual(roomFromUrl(`${site}/?room=${id}`), { id });
  for (const url of [`http://lunch-site.suyeon-974.workers.dev/?room=${id}`, `${site}.evil.test/?room=${id}`, `${site}/api/sessions/${id}`, `${site}/?room=bad`, `${site}/?room=${id}&room=${id}`]) assert.equal(roomFromUrl(url), null);
});

test('zero participants and missing room have truthful cards', () => {
  const empty = cardText(makeCard(session(), id));
  assert.match(empty, /0 \/ 5명/);
  assert.match(empty, /아직 투표가 없어요/);
  assert.match(cardText(makeCard(null, id)), /모임을 찾을 수 없어요/);
  assert.match(cardText(makeCard(null, null)), /점심 약속을 만들어 보세요/);
});

test('restaurant tally follows site rule: dislikes exclude candidate', () => {
  const result = cardText(makeCard(session('restaurant', [person([1, 2]), person([1, 2]), person([1], [2])]), id));
  assert.match(result, /3 \/ 5명/);
  assert.match(result, /곰국시집 · 3표/);
  assert.doesNotMatch(result, /공차 명동점 · 2표/);
  assert.match(result, /식당 투표/);
});

test('date tally and final decision', () => {
  const s = session('calendar', [person([], [], ['2026-09-22', '2026-09-23']), person([], [], ['2026-09-22'])]);
  const result = cardText(makeCard(s, id));
  assert.match(result, /2026-09-22 · 2표/);
  assert.match(result, /2026-09-23 · 1표/);
  assert.match(result, /날짜 투표/);
  s.final_date = '2026-09-22';
  assert.match(cardText(makeCard(s, id)), /확정: 2026-09-22/);
});

test('unverified requests never read D1; verified previews and refresh read current room', async () => {
  let reads = 0;
  const getSession = async (_, key) => { reads++; assert.equal(key, id); return session('calendar', [person([], [], ['2026-09-22'])]); };
  const noAuth = await handleChat(req(event(`${site}/?room=${id}`)), { DB: {} }, getSession);
  assert.equal(noAuth.status, 401);
  assert.equal(reads, 0);
  const preview = await handleChat(req(event(`${site}/?room=${id}`)), { DB: {} }, getSession, async () => true);
  assert.equal(preview.status, 200);
  assert.match(cardText(await preview.json()), /2026-09-22/);
  const refresh = await handleChat(req({ type: 'CARD_CLICKED', action: { actionMethodName: 'refreshRoom', parameters: [{ key: 'room', value: id }] }, message: { sender: { type: 'HUMAN' } } }), { DB: {} }, getSession, async () => true);
  assert.equal((await refresh.json()).actionResponse.type, 'UPDATE_USER_MESSAGE_CARDS');
  assert.equal(reads, 2);
});

test('invalid event or room never reads D1', async () => {
  const getSession = () => { throw Error('unexpected D1 read'); };
  assert.deepEqual(await (await handleChat(req(event(`${site}/?room=none`)), { DB: {} }, getSession, async () => true)).json(), {});
  assert.deepEqual(await (await handleChat(req(event(`${site}/?room=${id}`, 'ADDED_TO_SPACE')), { DB: {} }, getSession, async () => true)).json(), {});
  assert.deepEqual(await (await handleChat(req(event(`${site}/`)), { DB: {} }, getSession, async () => true)).json().then(x => x.cardsV2[0].card.header.title), '🍴 오늘 점심 어디 갈까요?');
});

test('real verification rejects absent or malformed bearer token', async () => {
  assert.equal(await verifyChatToken(new Request(`${site}/api/chat`)), false);
  assert.equal(await verifyChatToken(new Request(`${site}/api/chat`, { headers: { Authorization: 'Bearer fake.fake.fake' } })), false);
});

test('real verification accepts signed Google-shaped ID token and rejects wrong audience', async () => {
  const keypair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await webcrypto.subtle.exportKey('jwk', keypair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=300' } });
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = async aud => {
    const input = `${enc({ alg: 'RS256', kid: 'test-key' })}.${enc({ aud, iss: 'https://accounts.google.com', email: 'service-183841371578@gcp-sa-gsuiteaddons.iam.gserviceaccount.com', email_verified: true, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 })}`;
    const signature = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', keypair.privateKey, Buffer.from(input));
    return new Request(`${site}/api/chat`, { headers: { Authorization: `Bearer ${input}.${Buffer.from(signature).toString('base64url')}` } });
  };
  try {
    assert.equal(await verifyChatToken(await sign(`${site}/api/chat`)), true);
    assert.equal(await verifyChatToken(await sign(`${site}/wrong`)), false);
  } finally { globalThis.fetch = previousFetch; }
});

test('normal site API and asset routing remain available', async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) }, ASSETS: { fetch: async () => new Response('site') } };
  assert.equal(await (await worker.fetch(new Request(site), env)).text(), 'site');
  assert.equal((await worker.fetch(new Request(`${site}/api/sessions/${id}`), env)).status, 404);
});

test('slash command card has four functional site destinations and no preview action', () => {
  assert.equal(LUNCH_COMMAND_ID, 731);
  const card = makeLunchCommandCard({ name: 'users/12345' });
  assert.equal(card.privateMessageViewer, undefined);
  assert.equal(card.actionResponse, undefined);
  const buttons = card.cardsV2[0].card.sections[0].widgets.flatMap(widget => widget.buttonList.buttons);
  assert.deepEqual(buttons.map(button => [button.text, button.onClick.openLink.url]), [
    ['새 점약 만들기', `${site}/#planning`],
    ['식당 정하기', `${site}/?plan=restaurant#planning`],
    ['날짜 정하기', `${site}/?plan=calendar#planning`],
    ['정산하기', `${site}/#settle`]
  ]);
  assert.equal(makeLunchCommandCard({ name: 'invalid' }).privateMessageViewer, undefined);
});

test('registered MESSAGE slash command and annotation variants return menu before link preview', async () => {
  const getSession = () => { throw Error('slash commands should not read D1'); };
  const variants = [
    { message: { slashCommand: { commandId: 731 }, matchedUrl: { url: `${site}/?room=${id}` } } },
    { message: { annotation: { slashCommand: { commandId: '731' } } } },
    { message: { annotations: [{ slashCommand: { commandId: 731 } }] } },
    { message: {}, appCommandMetadata: { appCommandType: 'SLASH_COMMAND', appCommandId: 731 } }
  ];
  for (const variant of variants) {
    const body = await (await handleChat(req({ type: 'MESSAGE', user: { name: 'users/12345' }, ...variant }), { DB: {} }, getSession, async () => true)).json();
    assert.equal(body.cardsV2[0].cardId, 'lunch-command-menu');
    assert.equal(body.cardsV2[0].card.sections[0].widgets.length, 2);
  }
});

test('APP_COMMAND metadata uses slash type and exact ID, with authentication gate', async () => {
  const command = { type: 'APP_COMMAND', appCommandMetadata: { appCommandId: 731, appCommandType: 'SLASH_COMMAND' }, user: { name: 'users/12345' } };
  const db = { DB: {} }, noRead = () => { throw Error('unexpected D1 read'); };
  assert.equal((await handleChat(req(command), db, noRead)).status, 401);
  assert.equal((await (await handleChat(req(command), db, noRead, async () => true)).json()).cardsV2[0].cardId, 'lunch-command-menu');
  for (const invalid of [
    { type: 'MESSAGE', message: { text: '731' } },
    { type: 'MESSAGE', message: { slashCommand: { commandId: 1 } } },
    { type: 'MESSAGE', message: { slashCommand: { commandId: 2 } } },
    { ...command, appCommandMetadata: { appCommandId: 2, appCommandType: 'SLASH_COMMAND' } },
    { ...command, appCommandMetadata: { appCommandId: 731, appCommandType: 'QUICK_COMMAND' } }
  ]) assert.deepEqual(await (await handleChat(req(invalid), db, noRead, async () => true)).json(), {});
});

test('Workspace Add-ons wrapped slash command returns a createMessageAction card first', async () => {
  const db = { DB: {} }, noRead = () => { throw Error('command should not read D1'); };
  const wrapped = { chat: { user: { name: 'users/12345' }, appCommandPayload: {
    appCommandMetadata: { appCommandId: 731, appCommandType: 'SLASH_COMMAND' }
  } } };
  assert.equal((await handleChat(req(wrapped), db, noRead)).status, 401);
  const result = await (await handleChat(req(wrapped), db, noRead, async () => true)).json();
  const message = result.hostAppDataAction.chatDataAction.createMessageAction.message;
  assert.equal(message.cardsV2[0].cardId, 'lunch-command-menu');
  assert.equal(message.privateMessageViewer, undefined);
  assert.equal(message.cardsV2[0].card.sections[0].widgets.flatMap(w => w.buttonList.buttons).length, 4);
  assert.equal(result.cardsV2, undefined);
  const wrong = { ...wrapped, type: 'MESSAGE', message: { slashCommand: { commandId: 731 } }, chat: { ...wrapped.chat,
    appCommandPayload: { appCommandMetadata: { appCommandId: 2, appCommandType: 'SLASH_COMMAND' } }
  } };
  assert.deepEqual(await (await handleChat(req(wrong), db, noRead, async () => true)).json(), {});
});
