import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRealtimeSession } from '../ui/realtime-session.js';
import { createLocalWebRTCProvider } from '../adapters/local-webrtc.js';

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fakeConnection(events, id = 'one') {
  let closed = false, microphone = true, camera = true, screen = false;
  const snapshot = () => ({ status: 'connected', localStream: { id: `local-${id}` }, peers: [{ id, stream: { id: `remote-${id}` }, state: 'connected' }], microphoneEnabled: microphone, cameraEnabled: camera, screenSharing: screen });
  return { snapshot, async close() { closed = true; events.push(`close:${id}`); }, async setMicrophone(value) { microphone = value; events.push(`mic:${value}`); }, async setCamera(value) { camera = value; events.push(`camera:${value}`); }, async shareScreen() { screen = true; events.push('screen:on'); }, async stopScreenShare() { screen = false; events.push('screen:off'); }, get closed() { return closed; } };
}

test('session publishes a stable snapshot and delegates controls to its active connection', async () => {
  const events = []; const connection = fakeConnection(events);
  const provider = { capabilities: { audio: true, scope: 'SAME_BROWSER_DEMO' }, async connect({ onUpdate }) { onUpdate({ status: 'waiting', peers: [] }); return connection; } };
  const session = createRealtimeSession({ provider }); const seen = []; const unsubscribe = session.subscribe(value => seen.push(value.status));
  await session.join({ roomId: 'room', mode: 'video', role: 'participant' });
  assert.equal(session.getSnapshot().status, 'connected');
  assert.equal(Object.isFrozen(session.getSnapshot()), true);
  await session.setMicrophone(false); await session.setCamera(false); await session.shareScreen(); await session.stopScreenShare();
  assert.deepEqual(events.slice(0, 4), ['mic:false', 'camera:false', 'screen:on', 'screen:off']);
  await session.leave(); unsubscribe();
  assert.equal(connection.closed, true); assert.equal(session.getSnapshot().status, 'idle'); assert.ok(seen.includes('joining'));
});

test('late connects and provider events cannot revive a session after leave', async () => {
  const pending = deferred(), events = [], connection = fakeConnection(events, 'late'); let update;
  const provider = { capabilities: {}, connect({ onUpdate }) { update = onUpdate; return pending.promise; } };
  const session = createRealtimeSession({ provider }); const joining = session.join({ roomId: 'room', mode: 'audio', role: 'participant' });
  await new Promise(resolve => setImmediate(resolve));
  await session.leave(); pending.resolve(connection); await joining;
  update({ status: 'connected', peers: [{ id: 'late', state: 'connected' }] });
  assert.equal(connection.closed, true); assert.equal(session.getSnapshot().status, 'idle');
  assert.equal(session.getSnapshot().peers.length, 0);
});

test('fatal provider errors close media and surface an observable error state', async () => {
  const events = []; const connection = fakeConnection(events); let update;
  const provider = { capabilities: {}, async connect(input) { update = input.onUpdate; return connection; } };
  const session = createRealtimeSession({ provider }); await session.join({ roomId: 'room', mode: 'broadcast', role: 'viewer' });
  update({ status: 'error', fatal: true, error: { code: 'media_lost', message: 'Media device lost' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connection.closed, true); assert.equal(session.getSnapshot().status, 'error'); assert.equal(session.getSnapshot().error.code, 'media_lost');
  assert.equal(session.isActive(), false);
});

test('invalid roles are rejected before provider access', async () => {
  let called = false; const session = createRealtimeSession({ provider: { capabilities: {}, async connect() { called = true; } } });
  await assert.rejects(() => session.join({ roomId: 'room', mode: 'broadcast', role: 'participant' }), /Broadcast roles/);
  assert.equal(called, false);
});

test('local WebRTC provider disposes a late granted device stream after cancellation', async () => {
  const pending = deferred(); const track = { kind: 'audio', enabled: true, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [] };
  class FakeChannel { constructor() {} postMessage() {} close() {} }
  class FakePeer { constructor() { this.connectionState = 'new'; } addTrack() {} close() {} getSenders() { return []; } }
  const provider = createLocalWebRTCProvider({ RTCPeerConnection: FakePeer, BroadcastChannel: FakeChannel, randomUUID: () => 'sender', mediaDevices: { getUserMedia: () => pending.promise, getDisplayMedia: async () => stream } });
  const controller = new AbortController(); const connecting = provider.connect({ roomId: 'room', mode: 'audio', role: 'participant', signal: controller.signal });
  controller.abort(); pending.resolve(stream);
  await assert.rejects(connecting, error => error.code === 'aborted');
  assert.equal(track.stopped, true);
});

test('local WebRTC viewer requests no capture device and closes cleanly', async () => {
  let captureCalls = 0;
  class FakeChannel { constructor() {} postMessage() {} close() {} }
  class FakePeer { constructor() { this.connectionState = 'new'; } addTrack() {} close() {} getSenders() { return []; } }
  const provider = createLocalWebRTCProvider({ RTCPeerConnection: FakePeer, BroadcastChannel: FakeChannel, randomUUID: () => 'viewer', mediaDevices: { getUserMedia: async () => { captureCalls += 1; }, getDisplayMedia: async () => null } });
  const connection = await provider.connect({ roomId: 'room', mode: 'broadcast', role: 'viewer' });
  assert.equal(captureCalls, 0); assert.equal(connection.snapshot().localStream, null);
  await connection.close();
});

test('join becomes active synchronously and an immediate leave wins over pending cleanup', async () => {
  const closeGate = deferred(); const first = fakeConnection([]); first.close = async () => closeGate.promise;
  const second = fakeConnection([]); let calls = 0;
  const session = createRealtimeSession({ provider: { capabilities: {}, async connect() { return ++calls === 1 ? first : second; } } });
  await session.join({ roomId: 'first', mode: 'audio', role: 'participant' });
  const replacing = session.join({ roomId: 'second', mode: 'audio', role: 'participant' });
  assert.equal(session.getSnapshot().status, 'joining'); assert.equal(session.isActive(), true);
  const leaving = session.leave();
  assert.equal(session.getSnapshot().status, 'idle'); assert.equal(session.isActive(), false);
  closeGate.resolve(); await Promise.all([replacing, leaving]);
  assert.equal(calls, 1); assert.equal(session.getSnapshot().status, 'idle');
});

test('a cancelled screen picker preserves the active call, and close is terminal', async () => {
  const connection = fakeConnection([]); connection.shareScreen = async () => { throw Object.assign(new Error('Picker cancelled'), { code: 'AbortError' }); };
  let connects = 0; const session = createRealtimeSession({ provider: { capabilities: {}, async connect() { connects += 1; return connection; } } });
  await session.join({ roomId: 'room', mode: 'video', role: 'participant' });
  const result = await session.shareScreen();
  assert.equal(result.applies, false); assert.equal(result.reason, 'operation_failed'); assert.equal(session.getSnapshot().status, 'connected');
  await session.close(); assert.equal(session.getSnapshot().status, 'closed');
  await session.join({ roomId: 'later', mode: 'video', role: 'participant' });
  assert.equal(connects, 1); assert.equal(session.getSnapshot().status, 'closed');
});

function meshFakes() {
  const channels = new Set(), offers = [], transceivers = [];
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) { for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.({ data }); }
    close() { channels.delete(this); }
  }
  class Peer {
    constructor() { this.connectionState = 'new'; this.localDescription = null; this.remoteDescription = null; }
    addTrack() {} addTransceiver(kind, options) { transceivers.push({ kind, options }); }
    async createOffer() { offers.push('offer'); return { type: 'offer', sdp: 'fake' }; }
    async createAnswer() { return { type: 'answer', sdp: 'fake' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription(description) { this.remoteDescription = description; }
    async addIceCandidate() {} getSenders() { return []; } close() { this.connectionState = 'closed'; }
  }
  const media = () => { const audio = { kind: 'audio', enabled: true, stop() {} }, video = { kind: 'video', enabled: true, stop() {} }; return { getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] }; };
  return { Channel, Peer, offers, transceivers, media };
}

test('welcome handshake elects the new lower-ID call tab to offer when it joins second', async () => {
  const f = meshFakes(); const providerA = createLocalWebRTCProvider({ RTCPeerConnection: f.Peer, BroadcastChannel: f.Channel, randomUUID: () => 'z', mediaDevices: { getUserMedia: async () => f.media(), getDisplayMedia: async () => f.media() } });
  const providerB = createLocalWebRTCProvider({ RTCPeerConnection: f.Peer, BroadcastChannel: f.Channel, randomUUID: () => 'a', mediaDevices: { getUserMedia: async () => f.media(), getDisplayMedia: async () => f.media() } });
  const a = await providerA.connect({ roomId: 'room', mode: 'video', role: 'participant' }); const b = await providerB.connect({ roomId: 'room', mode: 'video', role: 'participant' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.offers.length, 1); await Promise.all([a.close(), b.close()]);
});

test('broadcast publisher always offers and a viewer receives without media capture', async () => {
  const f = meshFakes(); let viewerCapture = 0;
  const publisher = createLocalWebRTCProvider({ RTCPeerConnection: f.Peer, BroadcastChannel: f.Channel, randomUUID: () => 'publisher', mediaDevices: { getUserMedia: async () => f.media(), getDisplayMedia: async () => f.media() } });
  const viewer = createLocalWebRTCProvider({ RTCPeerConnection: f.Peer, BroadcastChannel: f.Channel, randomUUID: () => 'viewer', mediaDevices: { getUserMedia: async () => { viewerCapture += 1; return f.media(); }, getDisplayMedia: async () => f.media() } });
  const pub = await publisher.connect({ roomId: 'room', mode: 'broadcast', role: 'publisher' }); const view = await viewer.connect({ roomId: 'room', mode: 'broadcast', role: 'viewer' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(viewerCapture, 0); assert.equal(f.offers.length, 1); assert.ok(f.transceivers.some(item => item.kind === 'video' && item.options.direction === 'recvonly'));
  await view.close(); await new Promise(resolve => setImmediate(resolve)); assert.equal(pub.snapshot().peers.length, 0); await pub.close();
});
