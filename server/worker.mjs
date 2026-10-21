const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function validate(b){
 const studentId=String(b.studentId||'').trim(),name=String(b.name||'').trim(),phone=String(b.phone||'').replace(/[ -]/g,''),people=Number(b.people);
 if(!/^\d{4,8}$/.test(studentId))throw Error('학번은 숫자 4~8자리로 입력해 주세요.');
 if(name.length<1||name.length>30||/[<>\x00-\x1f]/.test(name))throw Error('이름을 1~30자로 입력해 주세요.');
 if(!/^010\d{8}$/.test(phone))throw Error('전화번호는 010으로 시작하는 11자리로 입력해 주세요.');
 if(!Number.isInteger(people)||people<1||people>10)throw Error('인원은 1~10명으로 선택해 주세요.');
 if(b.consent!==true)throw Error('개인정보 수집·이용 안내를 확인해 주세요.');
 if(!/^[a-f0-9-]{36}$/.test(b.requestId||''))throw Error('접수 식별자가 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.');
 return {studentId,name,phone,people};
}
async function same(a,b){if(!a||!b)return false;const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));const [x,y]=await Promise.all([hash(a),hash(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;}
async function route(req,env){
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(!env.DB||!env.ADMIN_KEY||!env.KIOSK_KEY)return json({error:'서버의 DB·관리자 키·접수 키를 설정해 주세요.'},503);
 const bearer=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 const admin=await same(bearer,env.ADMIN_KEY),kiosk=admin||await same(bearer,env.KIOSK_KEY);
 if(path==='/api/kiosk'&&method==='GET')return kiosk?json({ok:true}):json({error:'접수용 비밀번호를 확인해 주세요.'},401);
 if(path==='/api/health'&&method==='GET')return json({ok:true,messaging:false,retention:env.RETENTION_NOTICE||'행사 종료 후 24시간 이내 삭제'});
 if(path==='/api/status'&&method==='GET'){
 const setting=await env.DB.prepare('SELECT accepting FROM settings WHERE id=1').first();
 const counts=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM tickets GROUP BY status").all();
 const called=await env.DB.prepare("SELECT id FROM tickets WHERE status='called' ORDER BY id").all();
 return json({accepting:!!setting.accepting,counts:counts.results,called:called.results.map(r=>r.id)});
 }
 if(path==='/api/ticket'&&method==='GET'){
 const token=url.searchParams.get('token');if(!token||token.length>100)return json({error:'번호표를 찾을 수 없습니다.'},404);
 const t=await env.DB.prepare('SELECT id,people,status FROM tickets WHERE token=?').bind(token).first();
 if(!t)return json({error:'번호표가 없거나 삭제되었습니다.'},404);
 const ahead=await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE id<? AND status IN ('waiting','called')").bind(t.id).first();
 return json({...t,ahead:['waiting','called'].includes(t.status)?ahead.n:0});
 }
 if(path==='/api/register'&&method==='POST'){
 if(!kiosk)return json({error:'접수 기기 잠금을 먼저 해제해 주세요.'},401);
 let b;try{b=await req.json();}catch{return json({error:'입력 형식이 올바르지 않습니다.'},400);}
 let v;try{v=validate(b);}catch(e){return json({error:e.message},400);}
 // 요청 UUID 재사용은 통신 실패 후 재시도 시 중복 발급을 방지합니다.
 const previous=await env.DB.prepare('SELECT id,token FROM tickets WHERE request_id=?').bind(b.requestId).first();if(previous)return json(previous);
 const token=crypto.randomUUID()+crypto.randomUUID();
 try{
 const out=await env.DB.prepare("INSERT INTO tickets(request_id,token,student_id,name,phone,people) SELECT ?,?,?,?,?,? WHERE (SELECT accepting FROM settings WHERE id=1)=1 RETURNING id,token").bind(b.requestId,token,v.studentId,v.name,v.phone,v.people).first();
 if(!out)return json({error:'현재 접수가 마감되었습니다.'},409);
 return json(out,201);
 }catch(e){
 const retry=await env.DB.prepare('SELECT id,token FROM tickets WHERE request_id=?').bind(b.requestId).first();if(retry)return json(retry);
 const duplicate=await env.DB.prepare("SELECT id FROM tickets WHERE phone=? AND status IN ('waiting','called','absent')").bind(v.phone).first();
 if(duplicate)return json({error:`이미 접수된 번호입니다. 운영진에게 ${duplicate.id}번 번호표를 확인해 주세요.`},409);
 throw e;
 }
 }
 if(path.startsWith('/api/admin/')){
 if(!admin)return json({error:'관리자 비밀번호를 확인해 주세요.'},401);
 if(path==='/api/admin/tickets'&&method==='GET'){
 const rows=await env.DB.prepare('SELECT id,student_id,name,phone,people,status,created_at FROM tickets ORDER BY id DESC LIMIT 3000').all();return json({tickets:rows.results});
 }
 if(method==='POST'){
 let b;try{b=await req.json();}catch{return json({error:'요청 형식이 올바르지 않습니다.'},400);}
 if(path==='/api/admin/state'){
 const allowed={waiting:['called','cancelled'],called:['entered','absent','cancelled'],absent:['called','cancelled'],entered:[],cancelled:[]};
 if(!allowed[b.from]?.includes(b.to)||!Number.isInteger(b.id))return json({error:'허용되지 않은 상태 변경입니다.'},400);
 const r=await env.DB.prepare("UPDATE tickets SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status=?").bind(b.to,b.id,b.from).run();
 return r.meta.changes?json({ok:true}):json({error:'다른 운영진이 먼저 변경했습니다. 목록을 갱신해 주세요.'},409);
 }
 if(path==='/api/admin/accepting'&&typeof b.accepting==='boolean'){
 await env.DB.prepare('UPDATE settings SET accepting=? WHERE id=1').bind(b.accepting?1:0).run();return json({ok:true});
 }
 if(path==='/api/admin/purge'&&b.confirm==='전체 명단 삭제'){
 const r=await env.DB.batch([env.DB.prepare('UPDATE settings SET accepting=0 WHERE id=1'),env.DB.prepare('DELETE FROM tickets')]);return json({ok:true,deleted:r[1].meta.changes});
 }
 }
 }
 return json({error:'요청을 찾을 수 없습니다.'},404);
}
export default {async fetch(req,env){
 const origin=req.headers.get('Origin');
 if(origin&&origin!==env.ALLOWED_ORIGIN)return json({error:'허용되지 않은 사이트입니다.'},403);
 const cors={'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN||'https://invalid.example','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Vary':'Origin'};
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(Number(req.headers.get('Content-Length')||0)>4096)return json({error:'요청이 너무 큽니다.'},413);
 let res;try{res=await route(req,env);}catch{return new Response(JSON.stringify({error:'서버 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'}),{status:500,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});}
 const headers=new Headers(res.headers);Object.entries(cors).forEach(([k,v])=>headers.set(k,v));return new Response(res.body,{status:res.status,headers});
}};
