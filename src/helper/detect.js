import os from 'node:os';
import dns from 'node:dns';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const TARGETS = ['example.com', 'www.microsoft.com', 'cloudflare.com'];
const CLIENTS = ['Mullvad', 'Proton VPN', 'IVPN', 'NordVPN', 'Surfshark', 'Windscribe'];
const canonical = name => String(name).replace(/[-_ ]/g, '').toLowerCase();
export function normalizeClients(rows, processes = []) {
  return (Array.isArray(rows) ? rows : rows ? [rows] : []).filter(r =>
    CLIENTS.some(n => canonical(r.DisplayName).includes(canonical(n)))
  ).map(r => ({ name: String(r.DisplayName).slice(0, 120), version: r.DisplayVersion || null,
    running: processes.some(p => String(p).replace(/[-_ ]/g, '').toLowerCase().startsWith(
      canonical(CLIENTS.find(n => canonical(r.DisplayName).includes(canonical(n)))))),
    connection: 'unknown', evidence: 'Windows uninstall registry; process name match (not a VPN connection test)' }));
}
export async function device() {
  const result = { version: 1, detectedAt: new Date().toISOString(), system: { platform: os.platform(), release: os.release(), architecture: os.arch() }, clients: [], clientDetection: 'unsupported', warnings: [] };
  if (process.platform !== 'win32') {
    result.warnings.push('此平台仅支持系统信息；客户端检测待支持。'); return result;
  }
  // Fixed, read-only script. No request values enter a shell or command.
  const script = `$ErrorActionPreference='Stop'; $r=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); $apps=@(Get-ItemProperty $r -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Mullvad|Proton.?VPN|IVPN|NordVPN|Surfshark|Windscribe' } | Select-Object DisplayName,DisplayVersion); $p=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(mullvad|proton.?vpn|ivpn|nordvpn|surfshark|windscribe)' } | Select-Object -ExpandProperty ProcessName); @{apps=$apps;processes=$p} | ConvertTo-Json -Compress -Depth 4`;
  try {
    const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, maxBuffer: 256 * 1024, windowsHide: true });
    const data = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    result.clients = normalizeClients(data.apps, data.processes);
    result.clientDetection = 'completed';
    result.warnings.push('仅检查当前用户及系统卸载登记；便携版、其他用户安装及特殊命名进程可能漏检。进程存在不代表 VPN 已连接。');
  } catch (e) { result.clientDetection = 'error'; result.warnings.push('客户端检测失败：' + (e.code || 'DETECTION_ERROR')); }
  return result;
}
export async function diagnostics(target = TARGETS[0]) {
  if (!TARGETS.includes(target)) throw Object.assign(new Error('目标不在白名单中'), { code: 'INVALID_INPUT' });
  const checkedAt = new Date().toISOString();
  const resolver = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
  const checks = [{ id: 'dns-config', status: 'info', checkedAt, evidence: resolver.getServers(), cause: 'Node 系统解析器使用的服务器；不代表所有网卡或 VPN 的有效 DNS 路径', advice: '必要时与系统网络设置核对；本工具不修改 DNS。' }];
  let addresses;
  try {
    addresses = await resolver.resolve4(target);
    checks.push({ id: 'dns', status: 'pass', checkedAt: new Date().toISOString(), evidence: { target, recordType: 'A', count: addresses.length }, cause: '系统 DNS 服务器返回 IPv4 记录', advice: '此结果不能证明无 DNS 泄漏或 VPN 已连接。' });
  } catch (e) {
    checks.push({ id: 'dns', status: 'fail', checkedAt: new Date().toISOString(), evidence: { target, code: e.code || 'ERROR' }, cause: '可能为 DNS 配置、网络策略或目标解析问题', advice: '核对本地网络与 DNS；单次失败不代表 VPN 服务商故障。' });
  }
  if (addresses?.length) {
    const started = Date.now();
    const outcome = await new Promise(resolve => {
      const socket = net.createConnection({ host: addresses[0], port: 443 });
      const finish = status => { socket.destroy(); resolve(status); };
      socket.setTimeout(3000, () => finish('TIMEOUT'));
      socket.once('connect', () => finish('CONNECTED'));
      socket.once('error', e => finish(e.code || 'ERROR'));
    });
    checks.push({ id: 'tcp', status: outcome === 'CONNECTED' ? 'pass' : 'fail', checkedAt: new Date().toISOString(), evidence: { target, port: 443, outcome, durationMs: Date.now() - started }, cause: '对目标首个 IPv4 地址的 TCP 握手；未发送 HTTP 请求', advice: '不能据此推断 VPN 隧道、TLS、全网连通性或服务商状态。' });
  } else checks.push({ id: 'tcp', status: 'skipped', checkedAt: new Date().toISOString(), evidence: 'DNS 未返回地址', cause: '依赖 DNS 解析', advice: '先排查 DNS，再重试。' });
  return { version: 1, detectedAt: checkedAt, target, checks, device: await device() };
}
