import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2), options = new Map();
if (args.length % 2) throw new Error('Pass paired options: --playwright-module PATH --browser-executable PATH --url URL [--output PATH]');
for (let i = 0; i < args.length; i += 2) {
  if (!['--playwright-module', '--browser-executable', '--url', '--output'].includes(args[i])) throw new Error('Unknown option');
  options.set(args[i], args[i + 1]);
}
const target = new URL(options.get('--url') || 'http://127.0.0.1:8021/realtime/');
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/realtime/' || target.username || target.password) throw new Error('Use a loopback /realtime/ example');
if (!options.get('--playwright-module') || !options.get('--browser-executable')) throw new Error('Explicit Playwright and browser paths required');
const { chromium } = createRequire(import.meta.url)(resolve(options.get('--playwright-module')));
const output = options.get('--output') ? resolve(options.get('--output')) : null;
if (output) await mkdir(output, { recursive: true });
const result = { status: 'RUNNING', media: 'CHROMIUM_SYNTHETIC_DEVICES_REAL_WEBRTC', signaling: 'SAME_BROWSER_BROADCAST_CHANNEL', checks: [] };
const check = (condition, name) => { assert.ok(condition, name); result.checks.push(name); };
const browser = await chromium.launch({ executablePath: options.get('--browser-executable'), headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__mediaTest = { captures: 0, streams: [], peers: [], displayCaptures: 0 };
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { window.__mediaTest.captures++; const stream = await originalCapture(constraints); window.__mediaTest.streams.push(stream); return stream; };
    // Exercises track replacement and ended cleanup, not an OS screen picker.
    navigator.mediaDevices.getDisplayMedia = async () => { window.__mediaTest.displayCaptures++; const stream = await originalCapture({ video: true, audio: false }); window.__mediaTest.display = stream; window.__mediaTest.streams.push(stream); return stream; };
    const OriginalPeer = RTCPeerConnection;
    window.RTCPeerConnection = class extends OriginalPeer { constructor(...args) { super(...args); window.__mediaTest.peers.push(this); } };
  });
  const room = `test-${Date.now()}`;
  const pageUrl = id => { const url = new URL(target); url.searchParams.set('content', id); url.searchParams.set('room', room); return url.href; };
  const a = await context.newPage(), b = await context.newPage(), c = await context.newPage();
  const ready = page => page.locator('[data-rtc-action="join"]').waitFor();
  const join = page => page.locator('[data-rtc-action="join"]').click();
  const state = (page, expected) => page.waitForFunction(expected => window.hohExample?.realtime?.getSnapshot().status === expected, expected, { timeout: 20000 });
  const leave = async page => { if (await page.evaluate(() => window.hohExample?.realtime?.isActive())) await page.locator('[data-rtc-action="leave"]').click(); };
  const videoReceived = page => page.waitForFunction(() => [...document.querySelectorAll('.realtime-tile video')].some(v => !v.muted && v.getVideoPlaybackQuality().totalVideoFrames > 2), null, { timeout: 20000 });
  await a.goto(pageUrl('video')); await b.goto(pageUrl('video')); await Promise.all([ready(a), ready(b)]);
  check(await a.evaluate(() => window.__mediaTest.captures === 0), 'opening a live content requests no microphone or camera');
  await join(a); await state(a, 'waiting'); await join(b); await Promise.all([state(a, 'connected'), state(b, 'connected')]);
  await Promise.all([videoReceived(a), videoReceived(b)]);
  check(true, 'two tabs exchange and decode real WebRTC video from synthetic capture devices');
  check(await a.evaluate(async () => { const reports = await Promise.all(window.__mediaTest.peers.map(p => p.getStats())); return reports.some(report => [...report.values()].some(r => r.type === 'inbound-rtp' && r.kind === 'audio' && r.bytesReceived > 0)); }), 'audio RTP bytes arrive over the peer connection');
  await a.locator('[data-reaction="like"]').click();
  await a.waitForFunction(() => document.querySelector('[data-reaction="like"]').getAttribute('aria-pressed') === 'true');
  check(await a.evaluate(() => window.hohExample.realtime.getSnapshot().status === 'connected' && window.__mediaTest.captures === 1), 'reacting and rerendering retain the same active media capture');
  await a.locator('[data-rtc-action="microphone"]').click();
  await a.waitForFunction(() => !window.hohExample.realtime.getSnapshot().microphoneEnabled);
  check(await a.evaluate(() => window.__mediaTest.streams[0].getAudioTracks().every(t => !t.enabled)), 'microphone control disables actual audio tracks');
  await a.locator('[data-rtc-action="screen"]').click();
  await a.waitForFunction(() => window.hohExample.realtime.getSnapshot().screenSharing);
  await a.locator('[data-rtc-action="screen"]').click();
  await a.waitForFunction(() => !window.hohExample.realtime.getSnapshot().screenSharing);
  check(await a.evaluate(() => window.__mediaTest.display.getTracks().every(t => t.readyState === 'ended')), 'screen replacement path releases synthetic display tracks on stop');
  a.once('dialog', dialog => dialog.dismiss()); await a.locator('[data-next]').click();
  check(await a.locator('#viewerTitle').textContent() === '영상 통화' && await a.evaluate(() => window.hohExample.realtime.isActive()), 'cancelling navigation keeps the current call');
  a.once('dialog', dialog => dialog.accept()); await a.locator('[data-next]').click();
  await a.waitForFunction(() => document.querySelector('#viewerTitle').textContent !== '영상 통화');
  check(await a.evaluate(() => !window.hohExample.realtime.isActive() && window.__mediaTest.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), 'confirming navigation ends capture before the next content');
  await b.waitForFunction(() => window.hohExample.realtime.getSnapshot().peers.length === 0);
  check(true, 'remote participant departure removes the peer without waiting for ICE timeout');
  await leave(b);
  await a.goto(pageUrl('broadcast-host')); await b.goto(pageUrl('broadcast-watch')); await c.goto(pageUrl('broadcast-watch'));
  await Promise.all([ready(a), ready(b), ready(c)]);
  // Join a receiver first to cover both discovery orders.
  await join(b); await join(a); await state(a, 'connected');
  await a.locator('[data-rtc-action="screen"]').click();
  await a.waitForFunction(() => window.hohExample.realtime.getSnapshot().screenSharing);
  await join(c);
  await Promise.all([state(a, 'connected'), state(b, 'connected'), state(c, 'connected'), videoReceived(b), videoReceived(c)]);
  check(await b.evaluate(() => window.__mediaTest.captures === 0) && await c.evaluate(() => window.__mediaTest.captures === 0), 'broadcast viewers receive video without requesting capture devices');
  check(await a.evaluate(() => window.hohExample.realtime.getSnapshot().peers.length === 2), 'one publisher serves two actual local WebRTC viewers');
  check(await c.evaluate(() => window.hohExample.realtime.getSnapshot().peers.some(p => p.stream?.getAudioTracks().length && p.stream?.getVideoTracks().length)), 'joining during screen sharing retains both remote audio and video tracks');
  await a.locator('[data-rtc-action="screen"]').click();
  await a.waitForFunction(() => !window.hohExample.realtime.getSnapshot().screenSharing);
  if (output) await a.screenshot({ path: resolve(output, 'realtime-desktop.png') });
  await a.setViewportSize({ width: 390, height: 844 });
  check(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px real-time content has no document horizontal overflow');
  check(await a.evaluate(() => [...document.querySelectorAll('.action-rail button')].every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)), 'mobile reaction targets are at least 44px');
  await a.emulateMedia({ reducedMotion: 'reduce' });
  check(await a.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.chat')).transitionDuration) < 0.001), 'reduced motion removes the visible chat height transition');
  await a.locator('#sheetHandle').click();
  await a.waitForFunction(() => document.querySelector('.app-shell').dataset.sheet === 'split');
  check(await a.evaluate(() => document.querySelector('.viewer').getBoundingClientRect().bottom <= document.querySelector('.chat').getBoundingClientRect().top + 1), 'half chat leaves the content viewer above the chat sheet');
  await a.locator('[data-sheet-close]').click();
  await a.waitForFunction(() => document.querySelector('.chat').getBoundingClientRect().height <= 45);
  if (output) await a.screenshot({ path: resolve(output, 'realtime-mobile.png') });
  await Promise.all([leave(a), leave(b), leave(c)]);
  await a.goto(pageUrl('voice')); await b.goto(pageUrl('voice')); await Promise.all([ready(a), ready(b)]);
  await join(a); await join(b); await Promise.all([state(a, 'connected'), state(b, 'connected')]);
  check(await a.evaluate(() => window.__mediaTest.streams.every(s => s.getVideoTracks().length === 0)), 'audio calls capture no camera track');
  await a.evaluate(() => window.hohExample.destroy());
  check(await a.evaluate(() => window.__mediaTest.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), 'destroy ends all captured media tracks');
  await leave(b);
  const denied = await context.newPage();
  await denied.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('마이크·카메라 권한이 거부되었습니다.', 'NotAllowedError'); }; });
  await denied.goto(pageUrl('video')); await ready(denied); await join(denied); await state(denied, 'error');
  check(await denied.locator('.realtime-error').isVisible() && await denied.locator('[data-rtc-action="join"]').isVisible(), 'capture permission denial shows an error and an explicit retry action');
  await context.close();
  result.status = 'PASS'; console.log(JSON.stringify(result));
} catch (error) {
  result.status = 'FAIL'; result.error = error.stack;
  result.diagnostics = await Promise.all(browser.contexts().flatMap(c => c.pages()).map(page => page.evaluate(() => {
    const s = window.hohExample?.realtime?.getSnapshot();
    return { status: s?.status, error: s?.error, peers: s?.peers.map(p => ({ state: p.state, hasStream: Boolean(p.stream) })), captures: window.__mediaTest?.captures,
      transports: window.__mediaTest?.peers.map(p => ({ connection: p.connectionState, ice: p.iceConnectionState, signaling: p.signalingState })) };
  }).catch(() => null)));
  console.error(JSON.stringify(result)); process.exitCode = 1;
}
finally { await browser.close(); if (output) await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n'); }
