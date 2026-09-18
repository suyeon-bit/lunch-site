import { handleChat } from './chat.js';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const error = (message, status = 400) => json({ error: message }, status);
const places = ['신관 15층 엘베 앞', '본관 15층 엘베 앞', '신관 1층 로비', '본관 1층 로비'];
const clean = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const dateOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const timeOk = v => /^(11|12):[0-5]\d$/.test(v);
const list = (v, test, max = 100) => [...new Set(Array.isArray(v) ? v : [])].filter(test).slice(0, max);
async function payload(request) {
  if (Number(request.headers.get('content-length') || 0) > 20000) throw new Error('입력 내용이 너무 깁니다.');
  return request.json();
}
async function getSession(db, id) {
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  if (!session) return null;
  const participants = (await db.prepare('SELECT id,name,likes,dislikes,dates,place,available_time,on_duty,updated_at FROM participants WHERE session_id = ? ORDER BY updated_at').bind(id).all()).results;
  return { ...session, participants: participants.map(p => ({ ...p, likes: JSON.parse(p.likes), dislikes: JSON.parse(p.dislikes), dates: JSON.parse(p.dates), on_duty: !!p.on_duty })) };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/chat') return handleChat(request, env, getSession);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/sessions' && request.method === 'POST') {
        const b = await payload(request);
        const kind = b.kind === 'calendar' ? 'calendar' : b.kind === 'restaurant' ? 'restaurant' : null;
        const headcount = Number(b.headcount);
        if (!kind || !Number.isInteger(headcount) || headcount < 2 || headcount > 30) return error('모임 종류와 2~30명 인원을 확인해 주세요.');
        const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
        const title = clean(b.title, 60) || (kind === 'restaurant' ? '오늘 점심' : '점약 잡기');
        await env.DB.prepare('INSERT INTO sessions (id,kind,title,headcount,created_at) VALUES (?,?,?,?,?)').bind(id, kind, title, headcount, new Date().toISOString()).run();
        return json({ id, url: `${url.origin}/?room=${id}` }, 201);
      }
      const m = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{12})(?:\/(participants|final))?$/);
      if (!m) return error('주소를 찾을 수 없습니다.', 404);
      const [, id, sub] = m;
      const session = await getSession(env.DB, id);
      if (!session) return error('모임을 찾을 수 없습니다.', 404);
      if (!sub && request.method === 'GET') return json(session);
      if (sub === 'participants' && request.method === 'POST') {
        if (session.participants.length >= session.headcount) return error('설정한 인원이 모두 참여했습니다.', 409);
        const b = await payload(request), name = clean(b.name, 30);
        if (!name) return error('이름을 입력해 주세요.');
        if (session.participants.some(p => p.name === name)) return error('이미 참여한 이름입니다.', 409);
        const participantId = crypto.randomUUID(), token = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO participants (id,session_id,name,edit_token,updated_at) VALUES (?,?,?,?,?)').bind(participantId, id, name, token, new Date().toISOString()).run();
        return json({ participantId, token }, 201);
      }
      if (sub === 'participants' && request.method === 'PUT') {
        const b = await payload(request);
        const p = await env.DB.prepare('SELECT * FROM participants WHERE id = ? AND session_id = ? AND edit_token = ?').bind(clean(b.participantId, 50), id, clean(b.token, 50)).first();
        if (!p) return error('이 브라우저에서 수정할 수 없는 참여자입니다.', 403);
        const likes = list(b.likes, n => Number.isInteger(n) && n >= 1 && n <= 36, 36);
        const dislikes = list(b.dislikes, n => Number.isInteger(n) && n >= 1 && n <= 36 && !likes.includes(n), 36);
        const dates = list(b.dates, dateOk, 100);
        const place = places.includes(b.place) ? b.place : null;
        const onDuty = !!b.onDuty;
        const availableTime = onDuty ? '12:00' : timeOk(b.availableTime) ? b.availableTime : null;
        await env.DB.prepare('UPDATE participants SET likes=?,dislikes=?,dates=?,place=?,available_time=?,on_duty=?,updated_at=? WHERE id=?').bind(JSON.stringify(likes), JSON.stringify(dislikes), JSON.stringify(dates), place, availableTime, Number(onDuty), new Date().toISOString(), p.id).run();
        return json(await getSession(env.DB, id));
      }
      if (sub === 'final' && request.method === 'PUT') {
        const b = await payload(request);
        const p = await env.DB.prepare('SELECT id FROM participants WHERE session_id=? AND id=? AND edit_token=?').bind(id, clean(b.participantId, 50), clean(b.token, 50)).first();
        if (!p) return error('참여자만 최종 결정을 저장할 수 있습니다.', 403);
        const restaurant = Number(b.restaurant);
        const finalRestaurant = session.kind === 'restaurant' && Number.isInteger(restaurant) && restaurant >= 1 && restaurant <= 36 ? restaurant : null;
        const finalDate = session.kind === 'calendar' && dateOk(b.date) ? b.date : null;
        const finalPlace = places.includes(b.place) ? b.place : null;
        const finalTime = timeOk(b.time) ? b.time : null;
        if (session.kind === 'restaurant' && !finalRestaurant || session.kind === 'calendar' && !finalDate) return error('최종 식당 또는 날짜를 선택해 주세요.');
        await env.DB.prepare('UPDATE sessions SET final_restaurant=?,final_date=?,final_place=?,final_time=? WHERE id=?').bind(finalRestaurant, finalDate, finalPlace, finalTime, id).run();
        return json(await getSession(env.DB, id));
      }
      return error('지원하지 않는 요청입니다.', 405);
    } catch (e) { return error(e instanceof SyntaxError ? '입력 형식이 올바르지 않습니다.' : e.message || '잠시 후 다시 시도해 주세요.', 500); }
  }
};
