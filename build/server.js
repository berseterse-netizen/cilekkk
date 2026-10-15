// server/prod.ts
import { createReadStream, existsSync as existsSync3, readFileSync as readFileSync3, statSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

// server/cert.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import selfsigned from "selfsigned";
async function ensureCertificate(directory, publicHost) {
  const dir = path.resolve(directory);
  const certPath = path.join(dir, "cert.pem");
  const keyPath = path.join(dir, "key.pem");
  const hostsPath = path.join(dir, "hosts.txt");
  const names = ["localhost", "127.0.0.1", publicHost].filter((item, index, list) => item && list.indexOf(item) === index);
  const wanted = names.join(",");
  const previous = existsSync(hostsPath) ? readFileSync(hostsPath, "utf8").trim() : "";
  const stale = existsSync(hostsPath) && previous !== wanted;
  if (!existsSync(certPath) || !existsSync(keyPath) || stale) {
    mkdirSync(dir, { recursive: true });
    const pems = await selfsigned.generate([{ name: "commonName", value: publicHost || "cilek" }], {
      keySize: 2048,
      algorithm: "sha256",
      extensions: [
        {
          name: "subjectAltName",
          altNames: names.map((name) => isIP(name) ? { type: 7, ip: name } : { type: 2, value: name })
        }
      ]
    });
    writeFileSync(keyPath, pems.private);
    writeFileSync(certPath, pems.cert);
  }
  writeFileSync(hostsPath, wanted);
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

// server/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";
function loadEnvFile() {
  const file = path2.resolve(process.cwd(), ".env");
  if (!existsSync2(file)) return;
  for (const raw of readFileSync2(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const split = line.indexOf("=");
    if (split <= 0) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (process.env[key] === void 0) process.env[key] = value;
  }
}
loadEnvFile();
function envText(name, fallback) {
  const raw = process.env[name];
  return raw === void 0 || raw.trim() === "" ? fallback : raw.trim();
}
function envInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === void 0 || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    console.error(`${name} ge\xE7ersiz: ${raw}. ${min} ile ${max} aras\u0131nda bir tam say\u0131 olmal\u0131.`);
    process.exit(1);
  }
  return parsed;
}
function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw.trim() === "") return fallback;
  return !["0", "false", "no", "off", "hayir", "hay\u0131r"].includes(raw.trim().toLowerCase());
}
var cloudflareKeyId = envText("CF_TURN_KEY_ID", "");
var cloudflareToken = envText("CF_TURN_API_TOKEN", "");
var cloudflareEnabled = Boolean(cloudflareKeyId && cloudflareToken);
var certFile = envText("CERT_FILE", "");
var keyFile = envText("KEY_FILE", "");
var config = {
  port: envInt("PORT", 38471, 1, 65535),
  /** Sunucunun dinlediği arayüz. Varsayılan tüm arayüzler. */
  host: envText("HOST", "0.0.0.0"),
  /** Kullanıcıların eriştiği genel adres (IP ya da alan adı). Sertifika ve TURN için kullanılır. */
  publicHost: envText("PUBLIC_HOST", "185.254.28.174"),
  tls: {
    /** self: kendinden imzalı, file: CERT_FILE/KEY_FILE, off: düz http (ters vekil arkasında) */
    mode: !envFlag("HTTPS", true) ? "off" : certFile && keyFile ? "file" : "self",
    certFile,
    keyFile
  },
  /** Cloudflare TURN ayarlıysa önce o kullanılır; yerel TURN yalnızca yedek olarak bekler. */
  cloudflare: {
    enabled: cloudflareEnabled,
    keyId: cloudflareKeyId,
    token: cloudflareToken,
    ttl: envInt("CF_TURN_TTL", 86400, 600, 172800)
  },
  turn: {
    enabled: envFlag("TURN", true),
    port: envInt("TURN_PORT", 3478, 1, 65535),
    user: envText("TURN_USER", "cilek"),
    pass: envText("TURN_PASS", "cilek-ses"),
    minPort: envInt("TURN_MIN_PORT", 49160, 1024, 65535),
    maxPort: envInt("TURN_MAX_PORT", 49180, 1024, 65535)
  },
  iceOverride: envText("ICE_SERVERS", "")
};
var publicStun = { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] };
function hostOnly(value) {
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0] ?? value;
}
function iceServers(requestHost, withTurn = config.turn.enabled) {
  const turn = config.turn;
  if (config.iceOverride) {
    try {
      const source = config.iceOverride.startsWith("[") ? config.iceOverride : readFileSync2(config.iceOverride, "utf8");
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      console.error("ICE_SERVERS okunamad\u0131, varsay\u0131lan liste kullan\u0131l\u0131yor.");
    }
  }
  const list = [publicStun];
  if (withTurn) {
    const host = config.publicHost || hostOnly(requestHost ?? "");
    if (host) {
      list.push({
        urls: [`turn:${host}:${turn.port}?transport=udp`, `turn:${host}:${turn.port}?transport=tcp`],
        username: turn.user,
        credential: turn.pass
      });
    }
  }
  return list;
}

// server/ice.ts
var cache = null;
var inflight = null;
var lastError = "";
var failedAt = 0;
var RETRY_MS = 6e4;
var ENDPOINT = process.env.CF_TURN_ENDPOINT || "https://rtc.live.cloudflare.com/v1/turn/keys";
function clean(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item;
    const urls = (Array.isArray(raw.urls) ? raw.urls : [raw.urls]).filter((url) => typeof url === "string").filter((url) => !/:53(\?|$)/.test(url));
    if (urls.length === 0) return [];
    return [
      {
        urls,
        ...typeof raw.username === "string" ? { username: raw.username } : {},
        ...typeof raw.credential === "string" ? { credential: raw.credential } : {}
      }
    ];
  });
}
async function fetchCloudflare() {
  const { keyId, token, ttl } = config.cloudflare;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4e3);
  try {
    const response = await fetch(`${ENDPOINT}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl }),
      signal: controller.signal
    });
    if (!response.ok) {
      lastError = `Cloudflare TURN ${response.status}: ${(await response.text()).slice(0, 200)}`;
      return null;
    }
    const body = await response.json();
    const servers = clean(Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers]);
    if (!servers.some((server2) => server2.username && server2.credential)) {
      lastError = "Cloudflare TURN yan\u0131t\u0131nda kimlik bilgisi yok";
      return null;
    }
    const now = Date.now();
    lastError = "";
    return { servers, fetchedAt: now, expiresAt: now + ttl * 1e3 };
  } catch (error) {
    lastError = `Cloudflare TURN'e ula\u015F\u0131lamad\u0131: ${error instanceof Error ? error.message : String(error)}`;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
async function cloudflareServers() {
  const now = Date.now();
  const fresh = cache && now - cache.fetchedAt < config.cloudflare.ttl * 1e3 / 4;
  if (fresh) return cache.servers;
  if (failedAt && now - failedAt < RETRY_MS) return cache && cache.expiresAt - now > 60 * 60 * 1e3 ? cache.servers : null;
  if (!inflight) {
    inflight = fetchCloudflare().finally(() => {
      inflight = null;
    });
  }
  const next = await inflight;
  if (next) {
    cache = next;
    failedAt = 0;
  } else if (!failedAt || now - failedAt >= RETRY_MS) {
    failedAt = Date.now();
    console.error(`Cloudflare TURN kullan\u0131lam\u0131yor, yedek ba\u011Flant\u0131 kullan\u0131l\u0131yor. ${lastError}`);
  }
  if (cache && cache.expiresAt - now > 60 * 60 * 1e3) return cache.servers;
  return null;
}
async function resolveIceServers(requestHost, allowLocalTurn = true) {
  const local = iceServers(requestHost, allowLocalTurn && config.turn.enabled);
  if (config.iceOverride || !config.cloudflare.enabled) return local;
  const cloudflare = await cloudflareServers();
  if (!cloudflare) return local;
  const hasStun = cloudflare.some((server2) => [server2.urls].flat().some((url) => url.startsWith("stun:")));
  return hasStun ? cloudflare : [...cloudflare, publicStun];
}
function iceStatus() {
  return {
    turn: config.cloudflare.enabled ? "cloudflare" : config.turn.enabled ? "local" : "none",
    localFallback: config.turn.enabled,
    cloudflareReady: Boolean(cache && cache.expiresAt > Date.now()),
    ...lastError ? { error: lastError } : {}
  };
}
async function checkCloudflare() {
  if (!config.cloudflare.enabled) return;
  if (await cloudflareServers()) console.log("Cloudflare TURN haz\u0131r.");
}

// server/hub.ts
import { randomBytes, randomUUID } from "node:crypto";

// src/lib/room.ts
var ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var ROOM_CODE_LENGTH = 6;
function makeRoomCode() {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}
function normalizeRoomCode(raw) {
  const fromLink = raw.match(/[?&]room=([a-z0-9]+)/i)?.[1] ?? raw;
  return fromLink.toUpperCase().split("").filter((char) => ROOM_ALPHABET.includes(char)).join("").slice(0, ROOM_CODE_LENGTH);
}

// server/hub.ts
var NAMES = ["\xE7ilek", "yaprak", "\xE7ekirdek", "krem", "bal", "nane", "tar\xE7\u0131n", "vanilya"];
var CLIENT_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var CHAT_LIMIT = 8;
var CHAT_WINDOW_MS = 5e3;
var REACT_LIMIT = 6;
var REACT_WINDOW_MS = 3e3;
var MAX_UNUSED_INVITES = 10;
var HISTORY_LIMIT = 80;
var ROOM_IDLE_MS = 6 * 60 * 60 * 1e3;
var INVITE_TTL_MS = 24 * 60 * 60 * 1e3;
var SWEEP_MS = 5 * 60 * 1e3;
var REACTIONS = /* @__PURE__ */ new Set(["\u{1F44D}", "\u2764\uFE0F", "\u{1F602}", "\u{1F62E}", "\u{1F44F}", "\u{1F353}", "\u{1F389}", "\u{1F622}"]);
function occupied(room) {
  return room.members.filter((member) => !member.left).length;
}
function send(socket, message) {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
  }
}
function syncLock(room) {
  room.locked = occupied(room) >= 2;
}
function allow(times, limit, windowMs) {
  const now = Date.now();
  while (times.length && now - times[0] >= windowMs) times.shift();
  if (times.length >= limit) return false;
  times.push(now);
  return true;
}
function textOf(raw) {
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw) && raw.every((part) => Buffer.isBuffer(part))) {
    return Buffer.concat(raw).toString("utf8");
  }
  return "";
}
function cleanName(raw) {
  if (typeof raw !== "string") return "";
  return Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim()).slice(0, 24).join("");
}
function cleanState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw;
  return { mic: value.mic === true, cam: value.cam === true, screen: value.screen === true, deaf: value.deaf === true, echo: value.echo === true };
}
function createHub() {
  const rooms = /* @__PURE__ */ new Map();
  const invites = /* @__PURE__ */ new Map();
  function liveMembers(room) {
    return room.members.filter((member) => !member.left && member.socket?.readyState === 1);
  }
  function roster(room, viewer) {
    return liveMembers(room).filter((person) => person !== viewer).map((person) => ({ session: person.session, name: person.name, epoch: person.epoch, state: person.state }));
  }
  function broadcastPeers(room) {
    const online = liveMembers(room);
    if (online.length === 0) room.emptySince = Date.now();
    for (const member of online) {
      if (!member.socket) continue;
      const members = roster(room, member);
      send(member.socket, {
        type: "peers",
        peers: members.length,
        sessions: members.map((person) => person.session),
        members
      });
    }
  }
  function historyFor(room, member) {
    return room.history.slice(-50).map((item) => ({
      id: item.id,
      text: item.text,
      name: item.name,
      self: item.session === member.session,
      at: item.at
    }));
  }
  function welcome(room, member, socket) {
    if (member.socket && member.socket !== socket && member.socket.readyState === 1) {
      member.socket.close(4e3, "replaced");
    }
    member.socket = socket;
    member.epoch += 1;
    const members = roster(room, member);
    send(socket, {
      type: "joined",
      session: member.session,
      code: room.code,
      name: member.name,
      peers: members.length,
      members,
      history: historyFor(room, member)
    });
    broadcastPeers(room);
  }
  function addMember(room, requested, name) {
    const claimed = requested.toLowerCase();
    const fresh = CLIENT_SESSION.test(claimed) && !room.members.some((member2) => member2.session === claimed);
    const member = {
      session: fresh ? claimed : randomUUID(),
      name: name || NAMES[room.members.length % NAMES.length] || "\xE7ilek",
      socket: null,
      epoch: 0,
      left: false,
      state: { mic: false, cam: false, screen: false, deaf: false, echo: false },
      chatTimes: [],
      reactTimes: []
    };
    room.members.push(member);
    syncLock(room);
    return member;
  }
  function findSession(room, session) {
    if (!session) return void 0;
    return room.members.find((member) => member.session === session && !member.left);
  }
  function admit(input) {
    const inviteToken = (input.invite ?? "").trim().slice(0, 128);
    const session = (input.session ?? "").trim().slice(0, 80).toLowerCase();
    if (inviteToken) {
      const invite = invites.get(inviteToken);
      if (!invite) return { type: "bad-invite" };
      const room2 = rooms.get(invite.roomCode);
      if (!room2) return { type: "bad-invite" };
      if (invite.used) {
        const existing3 = session && invite.session === session ? findSession(room2, session) : void 0;
        if (existing3) return { type: "ok", room: room2, member: existing3 };
        return { type: "bad-invite" };
      }
      const existing2 = findSession(room2, session);
      if (existing2) return { type: "ok", room: room2, member: existing2 };
      const member = addMember(room2, session, input.name);
      invite.used = true;
      invite.session = member.session;
      return { type: "ok", room: room2, member };
    }
    const code = normalizeRoomCode((input.code ?? "").slice(0, 200));
    if (code.length !== ROOM_CODE_LENGTH) return { type: "bad-code" };
    const room = rooms.get(code);
    if (!room) return { type: "missing" };
    const existing = findSession(room, session);
    if (existing) return { type: "ok", room, member: existing };
    if (occupied(room) >= 2) {
      room.locked = true;
      return { type: "locked" };
    }
    return { type: "ok", room, member: addMember(room, session, input.name) };
  }
  function openRoom(session, name) {
    let code = makeRoomCode();
    for (let attempt = 0; attempt < 8 && rooms.has(code); attempt += 1) code = makeRoomCode();
    const room = { code, locked: false, members: [], history: [], emptySince: Date.now() };
    rooms.set(code, room);
    return { type: "ok", room, member: addMember(room, session, name) };
  }
  function relayChat(room, member, text) {
    if (!allow(member.chatTimes, CHAT_LIMIT, CHAT_WINDOW_MS)) return;
    const item = {
      id: randomUUID(),
      text,
      session: member.session,
      name: member.name,
      at: Date.now()
    };
    room.history.push(item);
    if (room.history.length > HISTORY_LIMIT) room.history.shift();
    for (const person of liveMembers(room)) {
      if (!person.socket) continue;
      send(person.socket, {
        type: "chat",
        id: item.id,
        text: item.text,
        name: item.name,
        self: person.session === member.session,
        at: item.at
      });
    }
  }
  function sweep() {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (liveMembers(room).length > 0) continue;
      if (now - room.emptySince < ROOM_IDLE_MS) continue;
      rooms.delete(code);
    }
    for (const [token, invite] of invites) {
      if (!rooms.has(invite.roomCode) || !invite.used && now - invite.createdAt > INVITE_TTL_MS) invites.delete(token);
    }
  }
  setInterval(sweep, SWEEP_MS).unref();
  return {
    stats() {
      return { rooms: rooms.size, invites: invites.size };
    },
    connect(socket) {
      let room = null;
      let member = null;
      let joined = false;
      socket.on("error", () => {
      });
      socket.on("message", (raw) => {
        let data;
        try {
          const text = textOf(raw);
          if (!text || text.length > 1e5) return;
          data = JSON.parse(text);
        } catch {
          return;
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) return;
        const message = data;
        if (!joined) {
          if (message.type !== "join" && message.type !== "create") return;
          const session = typeof message.session === "string" ? message.session : "";
          const name = cleanName(message.name);
          const result = message.type === "create" ? openRoom(session, name) : admit({
            code: typeof message.code === "string" ? message.code : "",
            invite: typeof message.invite === "string" ? message.invite : "",
            session,
            name
          });
          if (result.type === "locked") {
            send(socket, { type: "locked" });
            socket.close(4001, "locked");
            return;
          }
          if (result.type === "missing") {
            send(socket, { type: "missing" });
            socket.close(4004, "missing");
            return;
          }
          if (result.type === "bad-invite") {
            send(socket, { type: "invite-invalid" });
            socket.close(4002, "invite");
            return;
          }
          if (result.type === "bad-code") {
            send(socket, { type: "error", message: "Kod 6 karakter olmal\u0131." });
            socket.close(4003, "code");
            return;
          }
          room = result.room;
          member = result.member;
          if (name && name !== member.name) member.name = name;
          const state = cleanState(message.state);
          if (state) member.state = state;
          joined = true;
          welcome(room, member, socket);
          return;
        }
        if (!room || !member || member.left || member.socket !== socket) return;
        try {
          if (message.type === "chat" && typeof message.text === "string") {
            const text = message.text.trim().slice(0, 600);
            if (!text) return;
            relayChat(room, member, text);
            return;
          }
          if (message.type === "state") {
            const state = cleanState(message.state);
            if (!state) return;
            member.state = state;
            broadcastPeers(room);
            return;
          }
          if (message.type === "rename") {
            const name = cleanName(message.name);
            if (!name || name === member.name) return;
            member.name = name;
            broadcastPeers(room);
            return;
          }
          if (message.type === "react" && typeof message.emoji === "string") {
            if (!REACTIONS.has(message.emoji) || !allow(member.reactTimes, REACT_LIMIT, REACT_WINDOW_MS)) return;
            for (const person of liveMembers(room)) {
              if (person === member || !person.socket) continue;
              send(person.socket, { type: "react", from: member.session, name: member.name, emoji: message.emoji });
            }
            return;
          }
          if (message.type === "invite") {
            let unused = 0;
            for (const invite of invites.values()) {
              if (invite.roomCode === room.code && !invite.used) unused += 1;
            }
            if (unused >= MAX_UNUSED_INVITES) {
              send(socket, { type: "invite-error", message: "\xC7ok fazla a\xE7\u0131k davet var." });
              return;
            }
            const token = randomBytes(16).toString("base64url");
            invites.set(token, { roomCode: room.code, used: false, session: "", createdAt: Date.now() });
            send(socket, { type: "invite", urlPath: `/?invite=${encodeURIComponent(token)}` });
            return;
          }
          if (message.type === "signal" && typeof message.to === "string") {
            const data2 = message.data;
            if (!data2 || typeof data2 !== "object" || Array.isArray(data2)) return;
            const record = data2;
            const description = record.description;
            const candidate = record.candidate;
            if (!description && !candidate) return;
            const target = room.members.find(
              (person) => person.session === message.to && !person.left && person.socket?.readyState === 1
            );
            if (!target?.socket) return;
            send(target.socket, {
              type: "signal",
              from: member.session,
              epoch: member.epoch,
              data: {
                ...description && typeof description === "object" ? { description } : {},
                ...candidate && typeof candidate === "object" ? { candidate } : {}
              }
            });
            return;
          }
          if (message.type === "leave") {
            member.left = true;
            if (member.socket === socket) member.socket = null;
            syncLock(room);
            broadcastPeers(room);
            socket.close(1e3, "leave");
          }
        } catch {
        }
      });
      socket.on("close", () => {
        if (!room || !member) return;
        if (member.socket !== socket) return;
        member.socket = null;
        broadcastPeers(room);
      });
    }
  };
}
function heartbeat(server2, everyMs = 25e3) {
  const alive = /* @__PURE__ */ new WeakMap();
  server2.on("connection", (socket) => {
    alive.set(socket, true);
    socket.on("pong", () => alive.set(socket, true));
  });
  const timer = setInterval(() => {
    for (const socket of server2.clients) {
      if (alive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }, everyMs);
  timer.unref();
  server2.on("close", () => clearInterval(timer));
}

// server/turn.ts
import { createRequire } from "node:module";
import os from "node:os";
import { isIP as isIP2 } from "node:net";
var require2 = createRequire(import.meta.url);
function relayAddresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      const version = item.family;
      const ipv4 = version === "IPv4" || version === 4;
      if (!item.internal && ipv4) addresses.push(item.address);
    }
  }
  return addresses.length > 0 ? addresses : ["0.0.0.0"];
}
function startTurn() {
  const turnConfig = config.turn;
  if (!turnConfig.enabled) return;
  try {
    const Turn = require2("node-turn");
    const turn = new Turn({
      listeningPort: turnConfig.port,
      listeningIps: ["0.0.0.0"],
      relayIps: relayAddresses(),
      ...isIP2(config.publicHost) ? { externalIps: config.publicHost } : {},
      minPort: turnConfig.minPort,
      maxPort: Math.max(turnConfig.minPort, turnConfig.maxPort),
      authMech: "long-term",
      credentials: { [turnConfig.user]: turnConfig.pass },
      realm: "cilek",
      debugLevel: "ERROR"
    });
    turn.start();
    console.log(`ses ve g\xF6r\xFCnt\xFC aktar\u0131m\u0131 (TURN) haz\u0131r: ${turnConfig.port}`);
  } catch (error) {
    console.error("ses aktar\u0131m\u0131 (TURN) a\xE7\u0131lmad\u0131", error);
  }
}

// server/prod.ts
var types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json"
};
var here = path3.dirname(fileURLToPath(import.meta.url));
var publicDir = path3.resolve(here, "../dist");
var root = path3.resolve(publicDir);
if (!existsSync3(path3.join(publicDir, "index.html"))) {
  console.error("dist/index.html yok. \xD6nce npm run build \xE7al\u0131\u015Ft\u0131r.");
  process.exit(1);
}
var securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), picture-in-picture=(self)",
  "cross-origin-opener-policy": "same-origin"
};
function fileFromPath(pathname) {
  const full = path3.resolve(publicDir, pathname.replace(/^[/\\]+/, ""));
  if (full !== root && !full.startsWith(root + path3.sep)) return null;
  return full;
}
function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
function cacheControl(pathname) {
  if (pathname.startsWith("/assets/") || pathname.startsWith("/mediapipe/")) return "public, max-age=31536000, immutable";
  if (pathname === "/sw.js" || pathname.endsWith(".html") || pathname === "/" || pathname.endsWith(".webmanifest")) return "no-cache";
  return "public, max-age=86400";
}
function pickEncoding(request, file) {
  const accepted = String(request.headers["accept-encoding"] ?? "");
  if (/\bbr\b/.test(accepted) && isFile(`${file}.br`)) return { file: `${file}.br`, encoding: "br" };
  if (/\bgzip\b/.test(accepted) && isFile(`${file}.gz`)) return { file: `${file}.gz`, encoding: "gzip" };
  return { file, encoding: "" };
}
function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...securityHeaders });
  response.end(JSON.stringify(body));
}
function sendText(response, status, text) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...securityHeaders });
  response.end(text);
}
function sendFile(request, response, file, pathname) {
  const original = statSync(file);
  const etag = `W/"${original.size.toString(16)}-${Math.floor(original.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": types[path3.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": cacheControl(pathname),
    etag,
    vary: "accept-encoding",
    ...securityHeaders
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  const chosen = pickEncoding(request, file);
  if (chosen.encoding) headers["content-encoding"] = chosen.encoding;
  headers["content-length"] = String(statSync(chosen.file).size);
  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(chosen.file).on("error", () => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }).pipe(response);
}
var hub = createHub();
var sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
heartbeat(sockets);
function handle(request, response) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://cilek.local").pathname);
  } catch {
    sendText(response, 400, "yok");
    return;
  }
  if (pathname === "/api/ice") {
    void resolveIceServers(request.headers.host).then(
      (servers) => sendJson(response, 200, { iceServers: servers }),
      () => sendJson(response, 200, { iceServers: [] })
    );
    return;
  }
  if (pathname === "/healthz") {
    sendJson(response, 200, { ok: true, ...hub.stats(), ...iceStatus() });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "yok");
    return;
  }
  const full = fileFromPath(pathname);
  if (!full) {
    sendText(response, 400, "yok");
    return;
  }
  let file = full;
  try {
    if (statSync(full).isDirectory()) file = path3.join(full, "index.html");
  } catch {
  }
  if (!isFile(file)) {
    const extension = path3.extname(pathname);
    if (extension && extension !== ".html") {
      sendText(response, 404, "yok");
      return;
    }
    file = path3.join(publicDir, "index.html");
    pathname = "/index.html";
  }
  sendFile(request, response, file, pathname);
}
async function createWebServer() {
  if (config.tls.mode === "off") return createHttp(handle);
  const credentials = config.tls.mode === "file" ? { cert: readFileSync3(config.tls.certFile), key: readFileSync3(config.tls.keyFile) } : await ensureCertificate(path3.resolve(here, "../certs"), config.publicHost);
  return createHttps(credentials, handle);
}
var server = await createWebServer();
server.on("upgrade", (request, socket, head) => {
  const pathname = (request.url ?? "").split("?")[0];
  if (pathname !== "/cilek") {
    socket.destroy();
    return;
  }
  try {
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit("connection", ws, request);
      hub.connect(ws);
    });
  } catch {
    socket.destroy();
  }
});
server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
startTurn();
void checkCloudflare();
server.listen(config.port, config.host, () => {
  const scheme = config.tls.mode === "off" ? "http" : "https";
  console.log(`\xE7ilek haz\u0131r: ${scheme}://${config.publicHost || "localhost"}:${config.port}`);
  if (config.tls.mode === "self") {
    console.log("Kendinden imzal\u0131 sertifika kullan\u0131l\u0131yor. Taray\u0131c\u0131 uyar\u0131s\u0131nda Geli\u015Fmi\u015F deyip devam et.");
    console.log("Uygulama olarak y\xFCklemek i\xE7in ger\xE7ek bir sertifika gerekir (CERT_FILE ve KEY_FILE).");
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    sockets.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
