// 打印本机局域网 IPv4 地址（供 预览.bat 显示手机访问地址用）
// 输出只含 ASCII，避免 cmd 控制台中文乱码；过滤虚拟网卡与回环地址
const os = require("os");

const VIRTUAL_HINTS = [
  "vmware", "virtualbox", "hyper-v", "vethernet", "loopback", "tailscale",
  "openvpn", "wintun", "tap", "tun", "docker", "wsl", "npcap", "zerotier",
];

function isPrivate(ip) {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

function candidates() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const lower = name.toLowerCase();
    if (VIRTUAL_HINTS.some((v) => lower.includes(v))) continue;
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      out.push({ name, ip: a.address });
    }
  }
  return out;
}

const list = candidates();
const picked = list.find((x) => isPrivate(x.ip)) || list[0];
console.log(picked ? picked.ip : "");
