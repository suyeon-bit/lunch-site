import { restaurantNames } from './restaurant-names.js';

const SITE = 'https://lunch-site.suyeon-974.workers.dev';
const ENDPOINT = `${SITE}/api/chat`;
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const CHAT_EMAIL = 'service-183841371578@gcp-sa-gsuiteaddons.iam.gserviceaccount.com';
export const LUNCH_COMMAND_ID = 731;
let cachedCerts, certsUntil = 0;

const response = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const base64url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));

async function googleCerts() {
  if (cachedCerts && Date.now() < certsUntil) return cachedCerts;
  const res = await fetch(CERTS);
  if (!res.ok) throw new Error('Google certificates unavailable');
  const { keys } = await res.json();
  if (!Array.isArray(keys)) throw new Error('Invalid Google certificates');
  const maxAge = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300);
  cachedCerts = keys;
  certsUntil = Date.now() + Math.min(maxAge, 3600) * 1000;
  return keys;
}

export async function verifyChatToken(request) {
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(request.headers.get('authorization') || '');
  if (!match) return false;
  try {
    const [head, body, signature, extra] = match[1].split('.');
    if (!head || !body || !signature || extra) return false;
    const header = JSON.parse(new TextDecoder().decode(base64url(head)));
    const claims = JSON.parse(new TextDecoder().decode(base64url(body)));
    const now = Date.now() / 1000;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        claims.aud !== ENDPOINT || !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) ||
        claims.email !== CHAT_EMAIL || claims.email_verified !== true ||
        !Number.isFinite(claims.exp) || claims.exp <= now ||
        !Number.isFinite(claims.iat) || claims.iat > now + 60) return false;
    const jwk = (await googleCerts()).find(key => key.kid === header.kid && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(signature), new TextEncoder().encode(`${head}.${body}`));
  } catch { return false; }
}

export function roomFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.origin !== SITE || url.pathname !== '/') return null;
    const ids = url.searchParams.getAll('room');
    if (ids.length === 0) return { id: null };
    if (ids.length !== 1 || !/^[a-f0-9]{12}$/.test(ids[0])) return null;
    return { id: ids[0] };
  } catch { return null; }
}

function voteRows(session) {
  if (session.kind === 'calendar') {
    const counts = new Map();
    for (const person of session.participants) for (const date of person.dates) counts.set(date, (counts.get(date) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([date, count]) => `${date} · ${count}표`);
  }
  const counts = new Map();
  const rejected = new Set(session.participants.flatMap(p => p.dislikes));
  for (const person of session.participants) for (const id of person.likes) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts].filter(([id]) => !rejected.has(id) && restaurantNames[id - 1])
    .sort((a, b) => b[1] - a[1] || restaurantNames[a[0] - 1].localeCompare(restaurantNames[b[0] - 1], 'ko'))
    .slice(0, 3).map(([id, count]) => `${restaurantNames[id - 1]} · ${count}표`);
}

function button(text, url) { return { text, onClick: { openLink: { url } } }; }
function row(label, value) { return { decoratedText: { topLabel: label, text: escapeHtml(value) } }; }

export function makeLunchCommandCard(user) {
  const card = { cardsV2: [{ cardId: 'lunch-command-menu', card: {
    header: { title: '🍴 점심, 뭐 먹지?', subtitle: '원하는 기능을 선택해 주세요' },
    sections: [{ widgets: [
      { buttonList: { buttons: [
        button('새 점약 만들기', `${SITE}/#planning`),
        button('식당 정하기', `${SITE}/?plan=restaurant#planning`)
      ] } },
      { buttonList: { buttons: [
        button('날짜 정하기', `${SITE}/?plan=calendar#planning`),
        button('정산하기', `${SITE}/#settle`)
      ] } }
    ] }]
  } }] };
  if (typeof user?.name === 'string' && /^users\/[^/]+$/.test(user.name)) card.privateMessageViewer = { name: user.name };
  return card;
}

function isLunchCommand(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.type === 'MESSAGE') {
    const annotations = Array.isArray(event.message?.annotations) ? event.message.annotations : [];
    const commands = [event.message?.slashCommand, event.message?.annotation?.slashCommand, ...annotations.map(a => a?.slashCommand)].filter(Boolean);
    if (commands.length) return commands.some(command => Number(command.commandId) === LUNCH_COMMAND_ID);
    return (!event.appCommandMetadata?.appCommandType || event.appCommandMetadata.appCommandType === 'SLASH_COMMAND') &&
      Number(event.appCommandMetadata?.appCommandId) === LUNCH_COMMAND_ID;
  }
  return event.type === 'APP_COMMAND' && event.appCommandMetadata?.appCommandType === 'SLASH_COMMAND' &&
    Number(event.appCommandMetadata.appCommandId) === LUNCH_COMMAND_ID;
}

export function makeCard(session, id, senderType = 'HUMAN') {
  const url = id ? `${SITE}/?room=${id}` : SITE;
  const widgets = [];
  if (session) {
    const rows = voteRows(session);
    widgets.push(row('참여', `${session.participants.length} / ${session.headcount}명`));
    widgets.push(row(session.kind === 'calendar' ? '📅 날짜 후보' : '🍜 식당 후보', rows.length ? rows.join('\n') : '아직 투표가 없어요'));
    widgets.push(row('진행 상태', session.kind === 'calendar'
      ? session.final_date ? `확정: ${session.final_date}` : session.participants.length === session.headcount ? '전원 참여 · 날짜 결정 대기' : '날짜 투표 진행 중'
      : session.final_restaurant ? `확정: ${restaurantNames[session.final_restaurant - 1] || '식당'}` : session.participants.length === session.headcount ? '전원 참여 · 식당 결정 대기' : '식당 투표 진행 중'));
    widgets.push({ buttonList: { buttons: [
      button('참여하기', `${url}#joinBox`),
      button(session.kind === 'calendar' ? '날짜 투표' : '식당 투표', `${url}#${session.kind === 'calendar' ? 'calendarSection' : 'voteSection'}`),
      button('전체 결과 보기', `${url}#resultList`)
    ] } });
    widgets.push({ buttonList: { buttons: [
      { text: '결과 새로고침', onClick: { action: { function: 'refreshRoom', parameters: [{ key: 'room', value: id }] } } },
      button('사이트에서 자세히 보기', url)
    ] } });
  } else {
    widgets.push(row('안내', id ? '모임을 찾을 수 없어요. 링크를 확인해 주세요.' : '식당을 고르고 점심 약속을 만들어 보세요.'));
    widgets.push({ buttonList: { buttons: [button('사이트에서 보기', url)] } });
  }
  return {
    actionResponse: { type: senderType === 'HUMAN' ? 'UPDATE_USER_MESSAGE_CARDS' : 'UPDATE_MESSAGE' },
    cardsV2: [{ cardId: 'lunch-room-preview', card: {
      header: { title: escapeHtml(session?.title || (id ? '🍱 점심 약속' : '🍴 오늘 점심 어디 갈까요?')), subtitle: session ? (session.kind === 'calendar' ? '점약 날짜 잡기' : '식당 정하기') : '점심 약속 사이트' },
      sections: [{ widgets }]
    } }]
  };
}

export async function handleChat(request, env, getSession, verify = verifyChatToken) {
  if (request.method !== 'POST') return response({ error: 'Method Not Allowed' }, 405);
  if (!await verify(request)) return response({ error: 'Unauthorized' }, 401);
  if (Number(request.headers.get('content-length') || 0) > 20000) return response({ error: 'Payload Too Large' }, 413);
  let event;
  try {
    const raw = await request.text();
    if (raw.length > 20000) return response({ error: 'Payload Too Large' }, 413);
    event = JSON.parse(raw);
  } catch { return response({ error: 'Invalid JSON' }, 400); }
  const chatEvent = event?.chat;
  const addOnCommand = chatEvent?.appCommandPayload?.appCommandMetadata;
  if (addOnCommand) {
    if (Number(addOnCommand.appCommandId) === LUNCH_COMMAND_ID && addOnCommand.appCommandType === 'SLASH_COMMAND') {
      return response({ hostAppDataAction: { chatDataAction: { createMessageAction: {
        message: makeLunchCommandCard(chatEvent.user)
      } } } });
    }
    return response({});
  }
  if (isLunchCommand(event)) return response(makeLunchCommandCard(event.user));
  let room;
  if (event?.type === 'MESSAGE' && typeof event.message?.matchedUrl?.url === 'string') room = roomFromUrl(event.message.matchedUrl.url);
  else if (event?.type === 'CARD_CLICKED' && event.action?.actionMethodName === 'refreshRoom') {
    const id = event.action.parameters?.find(p => p.key === 'room')?.value;
    room = roomFromUrl(`${SITE}/?room=${id}`);
  } else return response({});
  if (!room) return response({});
  const session = room.id ? await getSession(env.DB, room.id) : null;
  return response(makeCard(session, room.id, event.message?.sender?.type));
}
