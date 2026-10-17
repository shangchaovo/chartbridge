import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { isIP } from 'node:net';
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
export const isPrivateIPv4=address=>typeof address==='string'&&isIP(address)===4&&(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address));
export function normalizeBindAddress(address){return typeof address==='string'&&address.startsWith('::ffff:')?address.slice(7):address||'';}
export function isTrustedBindAddress(address){const normalized=normalizeBindAddress(address);return loopback(address)||loopback(normalized)||isPrivateIPv4(normalized);}
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function createAccess(dataDir,port,host){
  const path=join(dataDir,'access.json');let credentials;
  try{credentials=JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!credentials){credentials={reader:randomBytes(32).toString('base64url'),editor:randomBytes(32).toString('base64url')};await writeFile(path,JSON.stringify(credentials),{mode:0o600,flag:'wx'});}
  for(const role of ['reader','editor'])if(!/^[A-Za-z0-9_-]{40,100}$/.test(credentials[role]||''))throw new Error('本机访问凭据文件格式无效。');
  const ips=[...new Set(Object.values(networkInterfaces()).flat().filter(n=>n&&!n.internal&&n.family==='IPv4'&&isPrivateIPv4(n.address)).map(n=>n.address))];
  const lan=host==='0.0.0.0',hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`,...(lan?ips.map(ip=>`${ip}:${port}`):[])]);
  const sessions=new Map();
  function local(req){return loopback(req.socket.remoteAddress)&&new Set([`127.0.0.1:${port}`,`localhost:${port}`,`[::1]:${port}`]).has(req.headers.host);}
  function originAllowed(origin){if(!origin)return true;if(!origin.startsWith('http://'))return false;return hosts.has(origin.slice('http://'.length));}
  function allowed(req){return isTrustedBindAddress(req.socket?.localAddress)&&hosts.has(req.headers.host)&&originAllowed(req.headers.origin)&&req.headers['sec-fetch-site']!=='cross-site';}
  function tokenRole(token){for(const role of ['reader','editor'])if(same(token,credentials[role]))return role;return null;}
  function principal(req){
    const auth=req.headers.authorization;
    if(auth){const role=tokenRole(auth.replace(/^Bearer\s+/i,''));return role?{role,local:false,kind:'human'}:null;}
    const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('shanhai_session='))?.slice('shanhai_session='.length);
    if(cookie){const session=sessions.get(cookie);if(session?.expires>Date.now())return {role:session.role,local:false,kind:'human'};sessions.delete(cookie);}
    return local(req)?{role:'owner',local:true,kind:'human'}:null;
  }
  return {local,allowed,principal,credentials,
    connection(principal){return {mode:lan?'lan':'local',role:principal.role,local:principal.local,urls:lan?ips.map(ip=>`http://${ip}:${port}`):[],mcpPath:'/mcp',roomId:'main'};},
    login(token,res){const role=tokenRole(token);if(!role)return false;
      for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);
      if(sessions.size>500)return false;const session=randomBytes(32).toString('base64url');sessions.set(session,{role,expires:Date.now()+12*3600000});
      res.setHeader('Set-Cookie',`shanhai_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);return true;
    },
    logout(req,res){const cookie=req.headers.cookie?.match(/(?:^|;\s*)shanhai_session=([^;]+)/)?.[1];sessions.delete(cookie);res.setHeader('Set-Cookie','shanhai_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');}
  };
}
