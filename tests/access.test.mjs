import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPrivateIPv4, isTailnetIPv4, isTrustedBindAddress, createAccess } from '../server/access.mjs';

test('LAN and Tailscale IPv4 ranges use exact boundaries and reject public or malformed addresses', () => {
  for (const address of ['10.0.0.1','192.168.1.20','172.16.0.1','172.31.255.255','100.64.0.0','100.100.1.1','100.127.255.255']) assert.equal(isPrivateIPv4(address),true,address);
  for (const address of ['8.8.8.8','172.15.255.255','172.32.0.0','100.63.255.255','100.128.0.0','100.64.999.1','100.100.1.1.evil','127.0.0.1','::1',undefined]) assert.equal(isPrivateIPv4(address),false,String(address));
});

test('accepted connections must land on loopback or a private interface', () => {
  for (const address of ['127.0.0.1','::1','::ffff:127.0.0.1','::ffff:10.1.2.3','192.168.1.20','100.100.1.1']) assert.equal(isTrustedBindAddress(address), true, address);
  for (const address of ['8.8.8.8','::ffff:1.2.3.4','169.254.169.254','',undefined]) assert.equal(isTrustedBindAddress(address), false, String(address));
});

test('loopback requests with the local host are allowed and a public interface is not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shanhai-access-'));
  try {
    const access = await createAccess(dir, 18799, '127.0.0.1');
    const localReq = { socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:18799' } };
    assert.equal(access.allowed(localReq), true);
    assert.equal(access.principal(localReq).local, true);
    assert.equal(access.allowed({ socket: { localAddress: '8.8.8.8', remoteAddress: '1.2.3.4' }, headers: { host: '127.0.0.1:18799' } }), false);
    assert.equal(access.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: 'evil.example:18799' } }), false);
    assert.equal(access.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:18799', origin: 'https://127.0.0.1:18799' } }), true);
    assert.equal(access.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:18799', origin: 'https://evil.example:18799' } }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Tailscale 100.64/10 段按精确边界识别，其余地址不算 tailnet 对端', () => {
  for (const address of ['100.64.0.1','100.100.1.1','100.127.255.255']) assert.equal(isTailnetIPv4(address), true, address);
  for (const address of ['100.63.255.255','100.128.0.0','100.64.999.1','127.0.0.1','192.168.1.1','8.8.8.8',undefined]) assert.equal(isTailnetIPv4(address), false, String(address));
});

test('Tailscale 对端与 serve 反代连接是免凭据的非本机 owner，局域网来源仍需凭据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shanhai-access-'));
  try {
    const access = await createAccess(dir, 18799, '0.0.0.0', ['shang.tailc2493b.ts.net:18443','shang.tailc2493b.ts.net']);
    const macReq = { socket: { localAddress: '100.117.248.70', remoteAddress: '100.104.75.117' }, headers: { host: 'localhost:18799' } };
    assert.equal(access.allowed(macReq), true);
    assert.deepEqual([access.principal(macReq).role, access.principal(macReq).local], ['owner', false]);
    const serveReq = { socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: 'shang.tailc2493b.ts.net:18443', origin: 'https://shang.tailc2493b.ts.net:18443' } };
    assert.equal(access.allowed(serveReq), true);
    assert.deepEqual([access.principal(serveReq).role, access.principal(serveReq).local], ['owner', false]);
    const lanReq = { socket: { localAddress: '192.168.1.10', remoteAddress: '192.168.1.30' }, headers: { host: 'localhost:18799' } };
    assert.equal(access.allowed(lanReq), true);
    assert.equal(access.principal(lanReq), null);
    assert.equal(access.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: 'shang.tailc2493b.ts.net:18443', origin: 'https://evil.example' } }), false);
    assert.equal(access.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, headers: { host: 'shang.tailc2493b.ts.net:18443', 'sec-fetch-site': 'cross-site' } }), false);
    const localOnly = await createAccess(dir, 18799, '127.0.0.1');
    assert.equal(localOnly.allowed({ socket: { localAddress: '127.0.0.1', remoteAddress: '100.104.75.117' }, headers: { host: '100.117.248.70:18799' } }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
