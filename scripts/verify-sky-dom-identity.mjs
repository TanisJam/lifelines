// Offline regression of the actual SVG producers and imperative consumers.
// No installs, HTTP transport, provider data, or canonical-ID substitutions.
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
let esbuild;
try {
  esbuild = require("esbuild");
} catch {
  esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
}
const { chromium } = require("playwright");
const ids = ["regular", "nul\0", "nul\ufffd", "lone\ud800", "lone\ud801", "lone\udfff", "quotes\"'\\[]", "__proto__", "constructor", "雪😀"];
const options = {
  bundle: true, write: false, jsx: "automatic", logLevel: "silent",
  alias: { "@": path.join(root, "src") },
};
// SSR and fixtures stay in a Node bundle, where node:crypto/util resolve natively.
// The browser bundle imports only the real browser modules, not server fixtures.
const serverSource = String.raw`
import React from 'react';
import {renderToString} from 'react-dom/server';
import {SkySvg} from './src/components/sky/sky-svg';
import {elinScene} from './src/lib/sky/fixture-scene';
import {timeline} from './src/lib/sky/dial';
export function fixture(id) {
  const base = elinScene();
  const start = 1500, end = 1510;
  const a = {...base.people[0], id, name:'Subject', born:1490, appearsAt:start, diedAt:undefined};
  const b = {...base.people[1], id:id+'/other', name:'Other', born:1490, appearsAt:1502, diedAt:undefined};
  const peers = ['nul\u0000','nul\ufffd','lone\ud800','lone\ud801','lone\udfff'].filter(peer=>peer!==id).map(peer=>({...b,id:peer}));
  const scene = {...base, span:{start,end}, people:[a,b,...peers], edges:[{a:a.id,b:b.id,kind:'spouse',fromAt:1503}], village:[], bands:[]};
  const entries = [{id, at:1504, year:1504, turn:id.startsWith('lone'), who:[id], text:{title:'Event', prose:'Subject', links:[{start:0,end:7,personId:id}]}, parts:[{text:'Event',rate:0.01},{text:'Subject',rate:0.01}]}];
  const line = timeline(scene,end);
  const props = {scene,timeline:line,label:'Identity',svgRef:null,relation:()=>'',bandLabels:{},entries};
  return {id,scene,entries,line,html:renderToString(React.createElement(SkySvg,props))};
}
`;
const serverBundle = await esbuild.build({
  ...options, platform: "node", format: "esm",
  banner: { js: `import {createRequire} from 'node:module'; const require=createRequire(${JSON.stringify(path.join(root, "package.json"))});` },
  stdin: { contents: serverSource, resolveDir: root, loader: "tsx", sourcefile: "identity-server.tsx" },
});
const { fixture } = await import("data:text/javascript;base64," + Buffer.from(serverBundle.outputFiles[0].text).toString("base64"));
const fixtures = ids.map(fixture);
const browserSource = String.raw`
import React from 'react';
import {createRoot,hydrateRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SkySvg} from './src/components/sky/sky-svg';
import {createSkyEngine} from './src/components/sky/engine/create-sky-engine';
import {createFocus} from './src/components/sky/engine/focus';
import {createReel} from './src/components/sky/engine/draw-reel';
import {createPlayerStore} from './src/lib/sky/player-store';
import {computeLayout,edgeKey} from './src/lib/sky/layout';
import {frameAt} from './src/lib/sky/scene-model';
// Independent oracle, so the regression runs before the production helper exists.
const coordinate = id => 'sky-' + id.split('').map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
window.verifyIdentity = async fixtures => {
  let checks = 0;
  const failures = [], cases = [];
  const ok = (value, message) => { checks++; if (!value) throw Error(message); };
  for (const f of fixtures) for (const mode of ['client','SSR-parsed']) {
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:800px';
    document.body.append(host);
    let root, engine, focus, reel, off;
    const label = mode+' '+JSON.stringify(f.id);
    try {
      const disc = document.createElement('div');
      disc.className = 'sky-disc';
      host.append(disc);
      if (mode === 'client') {
        root = createRoot(disc);
        flushSync(()=>root.render(<SkySvg scene={f.scene} timeline={f.line} entries={f.entries} label="Identity" svgRef={null} relation={()=>''} bandLabels={{}}/>));
      } else {
        disc.innerHTML = f.html;
        root = hydrateRoot(disc,<SkySvg scene={f.scene} timeline={f.line} entries={f.entries} label="Identity" svgRef={null} relation={()=>''} bandLabels={{}}/>);
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      }
      const svg = disc.querySelector('svg');
      // Bind first: RED must expose the original null.querySelector failure,
      // not merely a mismatch against the new coordinate oracle.
      const store = createPlayerStore();
      let frame;
      off = store.onFrame(value=>frame=value);
      engine = createSkyEngine({svg,scene:f.scene,timeline:f.line,store});
      const node = (kind,id) => svg.querySelector('[data-'+kind+'="'+coordinate(id)+'"]');
      for (const p of f.scene.people) {
        ok(node('person',p.id), 'person binding');
        ok(node('trail',p.id), 'trail binding');
      }
      const key = edgeKey(f.scene.edges[0]);
      ok(node('edge',key) && node('head',key), 'edge/head binding');
      const bead = node('bead',f.id);
      ok(bead, 'bead binding');
      ok(new Set([...svg.querySelectorAll('[data-person]')].map(el=>el.dataset.person)).size===f.scene.people.length, 'distinct coordinates');
      const tip = document.createElement('div');
      tip.innerHTML = '<span class="r"></span><b></b><span class="s"></span>';
      disc.append(tip);
      const activated = [];
      focus = createFocus({svg,tip,scene:f.scene,store,describe:p=>({rel:'role',name:p.name,sub:'detail'}),activate:id=>{activated.push(id);return true;}});
      const star = node('person',f.id);
      engine.seek(1504);
      focus.setEntry([f.id]);
      focus.setNamed(new Set([f.id]));
      ok(star.classList.contains('hl') && star.classList.contains('named'), 'exact focus map identity');
      star.focus();
      ok(star.classList.contains('focal') && tip.querySelector('b').textContent==='Subject', 'keyboard focus');
      star.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      for (const key of ['Enter',' ']) star.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
      ok(activated.length===3 && activated.every(id=>id===f.id), 'exact original JS activation IDs');
      star.blur();
      for (const p of f.scene.people) {
        const target = node('person',p.id);
        focus.setNamed(new Set([p.id]));
        ok(target.classList.contains('named'),'co-resident exact named identity');
        target.focus();
        ok(target.classList.contains('focal'),'co-resident exact focus identity');
        target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        target.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        ok(activated.at(-1)===p.id && activated.at(-2)===p.id,'co-resident callback ID unchanged');
        target.blur();
      }
      const ol = document.createElement('ol');
      ol.innerHTML = '<li tabindex="0"><span class="node"></span><div class="body"><span class="t"></span><span class="p"></span></div></li>';
      host.append(ol);
      const rail = document.createElementNS('http://www.w3.org/2000/svg','svg');
      rail.innerHTML = '<linearGradient></linearGradient><path data-rail-arc></path><line data-rail-now></line><g data-rail-leaders></g>';
      host.append(rail);
      const opened = [];
      reel = createReel({area:host,ol,rail,entries:f.entries,store,timeline:f.line,focus,seek:t=>engine.seek(t),openPerson:id=>opened.push(id)});
      engine.seek(1504.5);
      ok(bead.classList.contains('on'), 'reel finds exact bead');
      ol.querySelector('li').dispatchEvent(new MouseEvent('mouseenter'));
      ok(bead.classList.contains('lit'), 'reel lights exact bead');
      const link = ol.querySelector('a[data-person-link]');
      ok(link && link.textContent==='Subject','real reel link text');
      link.click();
      ok(opened.length===1 && opened[0]===f.id,'exact original JS prose link ID');
      const snapshots = new Map();
      for (const t of [1502.1,1503.1,1504,1502.1,1503.1,1504]) {
        engine.seek(t);
        ok(frame.people.some(p=>p.id===f.id),'frame IDs unchanged');
        for (const p of frame.people) ok(p.pos.every(Number.isFinite) && Number.isFinite(p.coreOpacity),'finite frame');
        const pure = JSON.stringify(frameAt(f.scene,computeLayout(f.scene),t));
        ok(JSON.stringify(frame)===pure,'actual engine deterministic pure frame');
        if (snapshots.has(t)) ok(snapshots.get(t)===pure,'replay determinism');
        snapshots.set(t,pure);
      }
      engine.seek(1502.1);
      ok(node('trail',f.scene.people[1].id).getAttribute('d'), 'arrival trail written');
      engine.seek(1503.1);
      ok(node('edge',key).getAttribute('d') && Number(node('head',key).style.opacity)>0,'growing edge/head written');
      // Grow React's nodes first, then rebind the same engine without changing its clock.
      const added = {...f.scene.people[1],id:f.id+'/grown',name:'Grown',appearsAt:1505};
      const grown = {...f.scene,people:[...f.scene.people,added],edges:[...f.scene.edges,{a:f.id,b:added.id,kind:'friend',fromAt:1506}]};
      const newEntry = {...f.entries[0],id:f.id+'/grown-entry',at:1507,turn:!f.entries[0].turn};
      const grownEntries = [...f.entries,newEntry];
      const props = {scene:grown,timeline:f.line,entries:grownEntries,label:'Identity',svgRef:null,relation:()=>'',bandLabels:{}};
      focus.destroy(); focus = null;
      flushSync(()=>root.render(<SkySvg {...props}/>));
      ok(disc.querySelector('svg')===svg,'growth preserves engine-owned SVG root');
      engine.update({scene:grown,timeline:f.line});
      ok(frame.t===1503.1,'update preserves clock');
      engine.seek(1505.1);
      ok(node('person',added.id).getAttribute('transform') && node('trail',added.id).getAttribute('d'),'update binds grown person/trail');
      engine.seek(1506.1);
      const grownKey=edgeKey(grown.edges[1]);
      ok(node('edge',grownKey).getAttribute('d') && Number(node('head',grownKey).style.opacity)>0,'update binds grown edge/head');
      reel.destroy();
      ol.append(ol.firstElementChild.cloneNode(true));
      reel = createReel({area:host,ol,rail,entries:grownEntries,store,timeline:f.line,focus:{setEntry(){},setNamed(){}},seek:t=>engine.seek(t),openPerson:id=>opened.push(id)});
      engine.seek(1507.5);
      const grownBead = node('bead',newEntry.id);
      ok(grownBead.classList.contains('on'),'grown reel finds new bead');
      ol.lastElementChild.dispatchEvent(new MouseEvent('mouseenter'));
      ok(grownBead.classList.contains('lit'),'grown reel lights new bead');
      ol.lastElementChild.querySelector('a[data-person-link]').click();
      ok(opened.at(-1)===f.id,'grown reel preserves exact link ID');
      for (const el of svg.querySelectorAll('*')) for (const attr of el.attributes) ok(!/NaN|Infinity/.test(attr.value),'finite DOM attributes');
      cases.push(label);
    } catch (error) {
      failures.push({case:label,error:error.stack || String(error)});
    } finally {
      reel?.destroy(); focus?.destroy(); engine?.destroy(); off?.();
      if(root) flushSync(()=>root.unmount());
      host.remove();
    }
  }
  return {checks,cases,failures,remainingMounts:document.body.children.length};
};
`;
const browserBundle = await esbuild.build({
  ...options, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  stdin: { contents: browserSource, resolveDir: root, loader: "tsx", sourcefile: "identity-browser.tsx" },
});
const installedChromium = chromium.executablePath();
const priorChromium = "/home/tanisjam/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const executablePath = existsSync(installedChromium) ? installedChromium : priorChromium;
let browser;
const requests = [], errors = [];
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ offline: true, serviceWorkers: "block", reducedMotion: "reduce", viewport: { width: 800, height: 900 } });
  await context.route("**/*", route => route.abort());
  context.on("request", request => requests.push(request.url()));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: browserBundle.outputFiles[0].text });
  const result = await page.evaluate(fixtures => window.verifyIdentity(fixtures), fixtures);
  console.log(JSON.stringify({ node: process.version, chromium: browser.version(), playwright: require("playwright/package.json").version, esbuild: esbuild.version, react: require("react/package.json").version, ...result, requests, errors }, null, 2));
  if (result.failures.length || result.cases.length !== ids.length * 2 || result.remainingMounts || requests.length || errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
}
