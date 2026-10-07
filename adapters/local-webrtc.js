/**
 * Same-origin, same-browser WebRTC reference provider.
 * BroadcastChannel is signalling only: it neither provides NAT traversal nor
 * scales beyond small local meshes. A production service needs authenticated
 * signalling plus TURN and an SFU for broadcasts.
 */
const MODES = new Set(['audio', 'video', 'broadcast']);
const rolesFor = (mode, role) => mode === 'broadcast' ? ['publisher', 'viewer'].includes(role) : role === 'participant';
const streamTracks = stream => stream?.getTracks?.() || [];
const stop = stream => streamTracks(stream).forEach(track => { try { track.stop(); } catch {} });
const err = (code, message) => Object.assign(new Error(message), { code });

export function createLocalWebRTCProvider(options = {}) {
  const env = {
    RTCPeerConnection: options.RTCPeerConnection || globalThis.RTCPeerConnection,
    BroadcastChannel: options.BroadcastChannel || globalThis.BroadcastChannel,
    mediaDevices: options.mediaDevices || globalThis.navigator?.mediaDevices,
    randomUUID: options.randomUUID || globalThis.crypto?.randomUUID?.bind(globalThis.crypto) || (() => Math.random().toString(36).slice(2)),
  };
  const maxPeers = Math.max(1, Math.min(8, Number(options.maxPeers) || 4));
  if (!env.RTCPeerConnection || !env.BroadcastChannel || !env.mediaDevices) throw err('unsupported', 'This browser does not provide the local WebRTC APIs');
  return Object.freeze({
    capabilities: Object.freeze({ audio: true, video: true, broadcast: true, screenShare: Boolean(env.mediaDevices.getDisplayMedia), scope: 'SAME_BROWSER_DEMO', maxPeers }),
    async connect({ roomId, mode = 'audio', role = 'participant', signal, onUpdate } = {}) {
      if (typeof roomId !== 'string' || !roomId.trim() || !MODES.has(mode) || !rolesFor(mode, role)) throw err('invalid_request', 'Invalid local real-time room request');
      if (signal?.aborted) throw err('aborted', 'Connection was cancelled');
      const senderId = env.randomUUID();
      const channel = new env.BroadcastChannel(`hoh-local-webrtc:${roomId.trim()}`);
      const peers = new Map(); let localStream = null, screenStream = null, closed = false, ready = false;
      const inbox = [];
      let microphoneEnabled = false, cameraEnabled = false;
      const emit = event => { if (!closed) { try { onUpdate?.(event); } catch {} } };
      let screenEndedTrack = null, screenEndedListener = null;
      const peerList = () => [...peers].map(([id, peer]) => ({ id, stream: peer.stream || null, state: peer.state || peer.pc.connectionState || 'connecting' }));
      const snapshot = () => ({ status: peers.size ? (peerList().some(p => p.state === 'connected') ? 'connected' : 'waiting') : 'waiting', localStream: screenStream || localStream, peers: peerList(), microphoneEnabled, cameraEnabled, screenSharing: Boolean(screenStream) });
      const publish = () => emit(snapshot());
      const send = message => { if (!closed) channel.postMessage({ ...message, from: senderId }); };
      const compatible = meta => meta && meta.roomId === roomId.trim() && meta.mode === mode && meta.from !== senderId && (mode !== 'broadcast' || meta.role !== role);
      const outboundTracks = () => [
        ...(localStream?.getAudioTracks?.() || []),
        ...((screenStream || localStream)?.getVideoTracks?.() || []),
      ];
      const drainCandidates = async peer => {
        const queued = peer.candidates.splice(0);
        for (const candidate of queued) await peer.pc.addIceCandidate(candidate);
      };
      const disposePeer = peer => { peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null; try { peer.pc.close(); } catch {} peer.stream?.getTracks?.().forEach(track => { /* remote tracks are owned by their sender */ }); };
      const createPeer = (id) => {
        if (closed || peers.has(id)) return peers.get(id);
        if (peers.size >= maxPeers) { emit({ status: 'reconnecting', fatal: false, error: { code: 'peer_limit', message: 'Local room peer limit reached; existing peers stay connected' } }); return null; }
        const pc = new env.RTCPeerConnection(); const peer = { pc, stream: null, state: 'connecting', candidates: [] }; peers.set(id, peer);
        for (const track of outboundTracks()) pc.addTrack(track, track.kind === 'video' && screenStream ? screenStream : localStream);
        if (role === 'viewer') {
          pc.addTransceiver?.('audio', { direction: 'recvonly' });
          if (mode === 'video' || mode === 'broadcast') pc.addTransceiver?.('video', { direction: 'recvonly' });
        }
        pc.onicecandidate = event => { if (event.candidate) send({ type: 'candidate', to: id, candidate: event.candidate.toJSON?.() || event.candidate, roomId: roomId.trim(), mode, role }); };
        pc.ontrack = event => {
          const incoming = event.streams[0] || new MediaStream([event.track]);
          if (!peer.stream) peer.stream = incoming;
          else if (peer.stream !== incoming && !peer.stream.getTracks().some(track => track.id === event.track.id)) peer.stream.addTrack(event.track);
          publish();
        };
        pc.onconnectionstatechange = () => { peer.state = pc.connectionState || 'connecting'; if (['failed', 'closed'].includes(peer.state)) { disposePeer(peer); peers.delete(id); if (peer.state === 'failed') emit({ status: 'reconnecting', error: { code: 'peer_failed', message: 'A peer connection failed' } }); } publish(); };
        return peer;
      };
      const offer = async id => { const peer = createPeer(id); if (!peer || closed || peer.offerStarted) return; peer.offerStarted = true; const description = await peer.pc.createOffer(); await peer.pc.setLocalDescription(description); send({ type: 'offer', to: id, description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp }, roomId: roomId.trim(), mode, role }); };
      const handleMessage = async ({ data }) => {
        try {
          if (closed || !compatible(data) || (data.to && data.to !== senderId)) return;
          // A welcome makes discovery work regardless of which tab opened first.
          // Calls use a stable ID tie-break; a broadcast publisher always offers
          // so a viewer never creates an offer with no media sections.
          if (data.type === 'hello') { send({ type: 'welcome', to: data.from, roomId: roomId.trim(), mode, role }); if ((mode === 'broadcast' && role === 'publisher') || (mode !== 'broadcast' && senderId < data.from)) await offer(data.from); return; }
          if (data.type === 'welcome') { if ((mode === 'broadcast' && role === 'publisher') || (mode !== 'broadcast' && senderId < data.from)) await offer(data.from); return; }
          if (data.type === 'bye') { const departing = peers.get(data.from); if (departing) { disposePeer(departing); peers.delete(data.from); publish(); } return; }
          const peer = createPeer(data.from); if (!peer) return;
          if (data.type === 'offer') { await peer.pc.setRemoteDescription(data.description); await drainCandidates(peer); const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer); send({ type: 'answer', to: data.from, description: { type: peer.pc.localDescription.type, sdp: peer.pc.localDescription.sdp }, roomId: roomId.trim(), mode, role }); }
          else if (data.type === 'answer') { await peer.pc.setRemoteDescription(data.description); await drainCandidates(peer); }
          else if (data.type === 'candidate' && data.candidate) { if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate); else peer.candidates.push(data.candidate); }
        } catch (error) { emit({ status: 'reconnecting', error: { code: 'signalling_error', message: error.message || 'Local signalling failed' } }); }
      };
      channel.onmessage = event => { if (closed) return; if (!ready) { inbox.push(event); return; } void handleMessage(event); };
      const close = async () => { if (closed) return; send({ type: 'bye', roomId: roomId.trim(), mode, role }); closed = true; inbox.length = 0; channel.onmessage = null; signal?.removeEventListener?.('abort', abort); if (screenEndedTrack && screenEndedListener) screenEndedTrack.removeEventListener?.('ended', screenEndedListener); screenEndedTrack = null; screenEndedListener = null; try { channel.close(); } catch {} for (const peer of peers.values()) disposePeer(peer); peers.clear(); stop(screenStream); stop(localStream); screenStream = null; localStream = null; microphoneEnabled = false; cameraEnabled = false; };
      const abort = () => { void close(); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (role !== 'viewer') {
          const constraints = { audio: true, video: mode !== 'audio' };
          localStream = await env.mediaDevices.getUserMedia(constraints);
          // Abort can occur while the browser permission prompt is open. The
          // late stream was not present when close() first ran, so dispose it
          // directly instead of allowing a closed connection to retain it.
          if (signal?.aborted) { stop(localStream); localStream = null; throw err('aborted', 'Connection was cancelled'); }
          microphoneEnabled = localStream.getAudioTracks().some(track => track.enabled);
          cameraEnabled = localStream.getVideoTracks().some(track => track.enabled);
          for (const track of streamTracks(localStream)) track.addEventListener?.('ended', () => {
            if (closed) return;
            if (track.kind === 'audio') microphoneEnabled = false;
            if (track.kind === 'video') cameraEnabled = false;
            emit({ status: 'reconnecting', microphoneEnabled, cameraEnabled, error: { code: 'device_ended', message: `${track.kind} capture ended` } });
          }, { once: true });
        }
        if (signal?.aborted || closed) throw err('aborted', 'Connection was cancelled');
        ready = true;
        for (const event of inbox.splice(0)) await handleMessage(event);
        send({ type: 'hello', roomId: roomId.trim(), mode, role }); publish();
      } catch (error) { await close(); throw error; }
      const replaceVideo = async track => {
        for (const { pc } of peers.values()) {
          const sender = pc.getSenders().find(candidate => candidate.track?.kind === 'video');
          if (sender) await sender.replaceTrack(track); else if (track) pc.addTrack(track, screenStream || localStream);
        }
      };
      return Object.freeze({
        snapshot,
        async setMicrophone(enabled) { for (const track of localStream?.getAudioTracks?.() || []) track.enabled = Boolean(enabled); microphoneEnabled = Boolean(enabled) && Boolean(localStream?.getAudioTracks?.().some(t => t.readyState !== 'ended')); publish(); },
        async setCamera(enabled) { for (const track of localStream?.getVideoTracks?.() || []) track.enabled = Boolean(enabled); cameraEnabled = Boolean(enabled) && Boolean(localStream?.getVideoTracks?.().some(t => t.readyState !== 'ended')); publish(); },
        async shareScreen() {
          if (closed) throw err('closed', 'Session is closed');
          if (role === 'viewer' || mode === 'audio') throw err('unsupported', 'This role or mode cannot share a screen');
          if (!env.mediaDevices.getDisplayMedia) throw err('unsupported', 'Screen sharing is not available');
          if (screenStream) return;
          const selected = await env.mediaDevices.getDisplayMedia({ video: true, audio: false });
          if (closed) { stop(selected); return; }
          screenStream = selected;
          const track = selected.getVideoTracks()[0];
          if (!track) { stop(selected); screenStream = null; throw err('no_screen_track', 'No screen video track was selected'); }
          screenEndedTrack = track; screenEndedListener = () => { void this.stopScreenShare().catch(error => emit({ error: { code: 'screen_restore_failed', message: error.message } })); };
          track.addEventListener?.('ended', screenEndedListener, { once: true });
          try { await replaceVideo(track); publish(); }
          catch (error) { await this.stopScreenShare().catch(() => {}); throw error; }
        },
        async stopScreenShare() {
          if (!screenStream) return;
          const previous = screenStream; screenStream = null;
          if (screenEndedTrack && screenEndedListener) screenEndedTrack.removeEventListener?.('ended', screenEndedListener);
          screenEndedTrack = null; screenEndedListener = null;
          try { await replaceVideo(localStream?.getVideoTracks?.()[0] || null); }
          finally { stop(previous); publish(); }
        },
        close,
      });
    },
  });
}
