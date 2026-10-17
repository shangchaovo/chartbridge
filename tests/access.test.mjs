import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIPv4 } from '../server/access.mjs';

test('LAN and Tailscale IPv4 ranges use exact boundaries and reject public or malformed addresses', () => {
  for (const address of ['10.0.0.1','192.168.9.102','172.16.0.1','172.31.255.255','100.64.0.0','100.117.248.70','100.127.255.255']) assert.equal(isPrivateIPv4(address),true,address);
  for (const address of ['8.8.8.8','172.15.255.255','172.32.0.0','100.63.255.255','100.128.0.0','100.64.999.1','100.117.248.70.evil','127.0.0.1','::1',undefined]) assert.equal(isPrivateIPv4(address),false,String(address));
});
