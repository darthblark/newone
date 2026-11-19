// Death falls: the Blender-timed collapse and the model's fall onto the corpse.
//
//   node tools/check-death-fall.js
//
// The fall starts in the living figure's last drawn pose, follows the timing
// exported from the actions in assets/player/player.blend, and ENDS on the
// corpse rig this game has always drawn -- player3DCorpseSkeleton(c) at
// progress 1, the corpse's own archetype, springs and wounds. The body stays
// the model from there until it is stamped, enemy and player alike.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { ctx, probe } = require('./harness');
const P = s => probe('(' + s + ')');
let checks = 0;
const ok = (label, value, detail = '') => { assert.ok(value, label + (detail ? ' -- ' + detail : '')); checks++; };

ctx.setTimeout = () => 0;
let seed = 4242;
ctx.random = (a, b) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const u = seed / 4294967296;
  return a === undefined ? u : Array.isArray(a) ? a[Math.floor(u * a.length)] : b === undefined ? u * a : a + (b - a) * u; };
probe(`currentLevel=currentBiome=1;BIOME_ACTIVE=false;isStoryMode=false;started=doTick=true;
  isPaused=isDead=isWin=killcamMode=false;buildings=activeBuildings=[];parkingCars=activeParkingCars=[];barrels=[];
  invalidateColIndex();enemiesList=[];corpses=[];leftStick={active:false,dx:0,dy:0};rightStick={active:false,dx:0,dy:0,dist:0};
  player=new Character(5000,5000,true);viewLeft=viewTop=-1e6;viewRight=viewBottom=1e6;`);

// ---- the asset ------------------------------------------------------------
const asset = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/player/player-falls.json'), 'utf8'));
ok('the embedded fall timing is the exported asset', P('JSON.stringify(PLAYER3D_FALLS)') === JSON.stringify(asset));
for (const key of ['BACKWARD', 'FORWARD']) {
  const f = asset.falls[key], ch = f.channels;
  ok(`${key}: a Blender action on the player rig`, /^Death_Fall_/.test(f.action) && f.frames === f.settle + 1);
  ok(`${key}: reaches the floor several times later than the old 7-frame collapse`, f.contact >= 30 && f.contact < f.settle, `contact ${f.contact}`);
  ok(`${key}: overhead extent never shrinks, 0 to 1`, ch.projected[0] === 0 && ch.projected.every((v, i) => i === 0 || v >= ch.projected[i - 1]) &&
    ch.projected[f.contact] === 1 && ch.projected[f.frames - 1] === 1);
  for (const name of ['pelvisDrop', 'pelvisTravel', 'torso', 'head', 'thighL', 'thighR', 'shinL', 'shinR'])
    ok(`${key}: ${name} runs from standing (0) to lying (1)`, Math.abs(ch[name][0]) < 1e-3 && Math.abs(ch[name][f.frames - 1] - 1) < 1e-3);
  for (const name of Object.keys(ch).filter(n => /Sweep|Raise/.test(n)))
    ok(`${key}: ${name} departs and comes back`, Math.abs(ch[name][0]) < 1e-3 && Math.abs(ch[name][f.frames - 1]) < 1e-3);
  // Arm angles change fastest where they matter least (near the chest's
  // normal), so their smoothness is measured below, as joint travel.
  ok(`${key}: no progress channel steps`, Object.keys(ch).filter(n => !/Sweep|Raise/.test(n)).every(n => ch[n].every((v, i) => i === 0 || Math.abs(v - ch[n][i - 1]) < .25)));
}

// ---- a model-drawn enemy, shot ---------------------------------------------
// The renderer records each figure it draws; headless, that record is made
// here from the same pose the live draw would use.
function shoot(type, facing, hit, opts = {}) {
  probe(`frameCount++;corpses=[];window.e=new Character(${opts.x || 100},${opts.y || 100},${opts.player ? 'true' : 'false'},'${type}');
    e.aimAngle=${facing};e.moveAngle=${facing};e.isArmed=true;rememberFigureMotion(e,0,0);
    ${opts.noModel ? '' : `_player3DLiveSnapshots.set(e,Object.assign(player3DPose(e),{renderActorState:{frame:frameCount-1,x:e.x,y:e.y}}));`}
    e.fallHit={frame:frameCount,kind:'${opts.kind || 'BODY'}',weapon:WEAPONS.${opts.weapon || 'PISTOL'},angle:${hit},force:3,mx:0,my:0,x:e.x,y:e.y,fatal:true};
    window.livePose=_player3DLiveSnapshots.get(e);
    window.c=new Corpse(e.x,e.y,e.moveAngle,e.aimAngle,e.shirtCol,e.pantsCol,${opts.dT || 0},0,[],e.currentWeapon,${hit},e.eType,e.bodyW,e.bodyH,e);
    corpses.push(c);`);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const joints = p => [p.head, p.chest, p.pelvis, ...p.arms.flatMap(a => [a.shoulder, a.elbow, a.fist]), ...p.legs.flatMap(l => [l.hip, l.knee, l.ankle])];

for (const type of ['NM0_GREY_FATIGUE', 'NORMAL', 'FEMALE_PISTOL', 'BANDIT'])
  for (const [facing, hit] of [[0, Math.PI], [0, 0], [1.2, -0.4], [-2, 2.6]]) {
    shoot(type, facing, hit);
    const tag = `${type} facing ${facing} hit ${hit}`;
    ok(`${tag}: the model takes the fall`, P('!!c.fall3D&&player3DFallActive(c)'));
    ok(`${tag}: forward or backward by the fall's own direction`, P(`c.fall.curve===(c.backFacing?'FORWARD':'BACKWARD')`));
    // Start: the living figure's last drawn pose, joint for joint.
    const live = P('livePose.pose'), start = P('player3DFallSkeleton(c).pose');
    const liveTorso = P(`livePose.parts.find(p=>p.part==='torso').matrix`);
    const startJoints = joints(start), liveJoints = joints({ ...live, chest: { x: liveTorso[12], y: liveTorso[13], z: liveTorso[14] }, arms: live.arms.map(a => ({ shoulder: a.shoulder, elbow: a.elbow, fist: a.fist || a.hand })) });
    // Limbs are listed in the corpse's order (paired by side), so each living
    // joint is matched to the nearest joint of the falling body.
    const gap = Math.max(...liveJoints.map(q => Math.min(...startJoints.map(r => dist(q, r)))));
    ok(`${tag}: frame 0 is the living pose`, gap < 1e-6, gap.toFixed(6));
    // Through the fall: no joint jumps, nothing through the floor.
    let worst = 0, under = 0, prev = start, frames = 0;
    while (!P('c.fall.done') && frames < 200) {
      probe('frameCount++;c.update();'); frames++;
      const now = P('player3DFallSkeleton(c).pose'), end = P('player3DFallSkeleton(c).end');
      joints(now).forEach((q, i) => { worst = Math.max(worst, dist(q, joints(prev)[i])); if (q.z < Math.min(joints(end)[i].z * .9, startJoints[i].z) - 1e-9) under++; });
      prev = now;
    }
    ok(`${tag}: it takes the action's length, not 7 frames`, frames >= 40 && frames <= 60, `${frames} frames`);
    ok(`${tag}: no joint moves more than a third of a body width in a frame`, worst < 7, `largest step ${worst.toFixed(2)}`);
    ok(`${tag}: no joint goes below where it rests on the floor`, under === 0);
    // End: exactly the corpse rig, nothing re-modelled.
    const fin = P('player3DFallSkeleton(c).pose'), rest = P('player3DCorpseSkeleton(c,{progress:1,rig:projectFallRig(c.bW,c.bH,1),angle:figureFallYaw(c.fall,c.rag,1)})');
    ok(`${tag}: comes to rest exactly on the corpse rig`, joints(fin).every((q, i) => dist(q, joints(rest)[i]) < 1e-6),
      Math.max(...joints(fin).map((q, i) => dist(q, joints(rest)[i]))).toExponential(2));
    ok(`${tag}: at rest the 2D painters are at progress 1`, P('c.fP') === 1 && P('c.rag.done'));
    // One system: the model is the corpse from here to the stamp. There is
    // no hand-over to the native painter on the floor.
    ok(`${tag}: the fall is over and the body is still the model`, !P('player3DFallActive(c)') && !!P('c.model3D') && P('c.fall3D.finished'));
    ok(`${tag}: and it can retire into the ground straight away`, P('corpseSettled(c)'));
    // The corpse's sleeves, forearms and palms are the 2D rig's, not the
    // living mesh's heavier ones.
    const arms = P(`player3DCorpseSkeleton(c).arms.map(a=>[a.widths[0],a.foreWidth,a.handDiameter])`);
    const want = P(`(()=>{const r=projectFallRig(c.bW,c.bH,1),k=RAG_SCALE,d=c.backFacing||c.fall.faceDown?.92:1,h=c.backFacing||c.fall.faceDown?.94:1;return [r.upperW*d*k,r.foreW*d*k,r.hand*h*k];})()`);
    ok(`${tag}: the corpse's arms are the 2D corpse's widths`, arms.every(a => a.every((v, i) => Math.abs(v - want[i]) < 1e-6)), JSON.stringify(arms) + ' vs ' + JSON.stringify(want));
    const blend = P(`player3DFallSkeleton(c).pose.arms.map(a=>[a.widths[0],a.foreWidth,a.handDiameter])`);
    ok(`${tag}: and the fall ends on them`, blend.every((a, j) => a.every((v, i) => Math.abs(v - arms[j][i]) < 1e-6)));
  }

// ---- the player keeps its model --------------------------------------------
shoot('NORMAL', 0, Math.PI, { player: true });
ok('player: the model takes the fall', P('!!c.fall3D&&c.fall3D.isPlayer'));
probe('for(let i=0;i<120&&!c.fall.done;i++){frameCount++;c.update();}');
const playerFall = P('player3DFallSkeleton(c).pose');
probe('frameCount++;c.update();');
// (Headless there is no WebGL, so the renderer's own readiness is not asked.)
ok('player: the 3D corpse continues', !P('player3DFallActive(c)') && P('c.fall3D.finished') && P('c.id.isPlayer'));
const playerRest = P('player3DCorpseSkeleton(c)');
ok('player: the corpse pose it continues in is where the fall ended',
  joints(playerFall).every((q, i) => dist(q, joints(playerRest)[i]) < 1e-6));
ok('player: a body on its back faces the sky', P(`player3DCorpsePose(c).parts.find(p=>p.part==='head').matrix[2]`) > 0);

// ---- who does not ----------------------------------------------------------
shoot('NORMAL', 0, Math.PI, { noModel: true });
ok('a figure the native painter drew keeps the native fall', P('c.fall3D') === null && P('!!c.fall'));
ok('and still falls on the Blender clock', P('c.fall.curve') === 'BACKWARD' && P('c.fall.duration') === asset.falls.BACKWARD.contact);
probe('frameCount++;e=new Character(100,100,false,"NORMAL");e.aimAngle=0;_player3DLiveSnapshots.set(e,Object.assign(player3DPose(e),{renderActorState:{frame:frameCount-5,x:e.x,y:e.y}}));');
probe('e.fallHit={frame:frameCount,kind:"BODY",angle:Math.PI,force:3,mx:0,my:0};window.c=new Corpse(e.x,e.y,0,0,e.shirtCol,e.pantsCol,0,0,[],e.currentWeapon,Math.PI,e.eType,e.bodyW,e.bodyH,e);');
ok('a stale model record is not a living pose', P('c.fall3D') === null);
shoot('NORMAL', 0, Math.PI, { dT: 13 });
ok('a death that comes apart keeps its own painter', P('c.fall3D') === null);

// ---- every death a model-drawn body can die stays on the model -------------
// A shotgun slice and breakup: each thrown piece starts as the living pose,
// carried in its own drawing frame, and lies down while it flies.
for (const dT of [2, 10]) {
  shoot('NORMAL', 0, Math.PI, { dT, weapon: 'SHOTGUN' });
  ok(`shotgun ${dT}: blown apart on the model`, !!P('c.model3D') && !!P('c.blast&&c.blast.mode') && P('c.blast.parts.every(q=>!!q.born)'));
  const gap = P(`(()=>{let worst=0;const k=RAG_SCALE,lp=livePose.pose,t=livePose.parts.find(q=>q.part==='torso').matrix;
    for(const q of c.blast.parts){const f=player3DPieceFall(c,q),b=q.born,co=Math.cos(b.rot),si=Math.sin(b.rot);
      const back=v=>{const x=(v.x-q.pivot.x)*k,y=(v.y-q.pivot.y)*k;return {x:b.x+co*x-si*y,y:b.y+si*x+co*y,z:v.z*k};};
      for(const [m,l] of [[f.pose.head,lp.head],[f.pose.pelvis,lp.pelvis],[f.pose.chest,{x:t[12],y:t[13],z:t[14]}]]){
        const w=back(m);worst=Math.max(worst,Math.hypot(w.x-l.x,w.y-l.y,w.z-l.z));}}
    return worst;})()`);
  ok(`shotgun ${dT}: every piece leaves from the living pose`, gap < 1e-6, gap.toExponential(2));
  probe('for(let i=0;i<70;i++){frameCount++;c.update();}');
  ok(`shotgun ${dT}: and lies as the 2D pieces do once down`, P('c.blast.parts.every(q=>player3DPieceFall(c,q)===null)'));
}
// The shotgun's separation headshot, a 4, had no fall of its own; on the
// model it gets one rather than appearing on the floor.
shoot('NORMAL', 0, Math.PI, { dT: 4, weapon: 'SHOTGUN', kind: 'HEAD' });
ok('shotgun headshot 4: falls on the Blender clock on the model', !!P('c.fall3D') && P('c.fall.curve') === 'BACKWARD');
shoot('NORMAL', 0, Math.PI, { dT: 4, weapon: 'SHOTGUN', kind: 'HEAD', noModel: true });
ok('shotgun headshot 4: a native body keeps its legacy frames', P('c.fall') === null);
// A sword kill swaps src for a copy; the capture still finds the actor.
shoot('NORMAL', 0, Math.PI, { dT: 16 });
ok('sword kill: the halves fall on the model', !!P('c.sword') && !!P('c.fall3D'));
// A wall slump starts where the figure stood and is the slump's own after.
shoot('NORMAL', 0, Math.PI);
probe(`window.seat={head:{x:5,y:1,z:20},chest:{x:4,y:0,z:14},pelvis:{x:3,y:0,z:6},forward:{x:1,y:0,z:0},
  arms:[0,1].map(i=>({shoulder:{x:3,y:i?6:-6,z:16},elbow:{x:6,y:i?9:-9,z:10},fist:{x:9,y:i?9:-9,z:6}})),
  legs:[0,1].map(i=>({hip:{x:3,y:i?4:-4,z:6},knee:{x:9,y:i?5:-5,z:4},ankle:{x:16,y:i?5:-5,z:1}})),torsoWidth:9,torsoDepth:3,headRadius:4.4};
  c.wallSit={age:0};`);
ok('wall slump: frame 0 is the living pose', dist(P('player3DSeatBlend(c,seat).head'), P('c.model3D.head')) < 1e-9);
probe('c.wallSit.age=PLAYER3D_SLUMP_BLEND;');
ok('wall slump: after the blend it is the slump', P('player3DSeatBlend(c,seat)===seat'));
probe('c.wallSit=null;');

// ---- the NM-0 regular's insignia -------------------------------------------
const marks = P(`['NORMAL','NM0_ROOKIE','FEMALE_PISTOL','NM0_GREY_FATIGUE'].map(t=>{const e=new Character(0,0,false,t);e.aimAngle=.4;
  const s=player3DPose(e),m=s.parts.find(q=>q.part==='nm0_insignia'),t2=s.parts.find(q=>q.part==='torso');
  return [t,!!m,!!m&&m.noInk&&Array.from(m.matrix).every((v,i)=>v===t2.matrix[i])];})`);
ok('the yellow and blue regulars wear the NMO patch and crest on the torso', marks.filter(m => m[0] === 'NORMAL' || m[0] === 'NM0_ROOKIE').every(m => m[1] && m[2]));
ok('nobody else does', marks.filter(m => m[0] !== 'NORMAL' && m[0] !== 'NM0_ROOKIE').every(m => !m[1]));
ok('the player does not', !P(`player3DPose(player).parts.some(q=>q.part==='nm0_insignia')`));
shoot('NORMAL', 0, 0);
probe('finishFigureFall(c);');
ok('a fallen regular keeps them', P(`player3DCorpsePose(c).parts.some(q=>q.part==='nm0_insignia')`));

// ---- a volley's bodies are stamped a couple at a time -----------------------
probe(`corpses=[];for(let i=0;i<6;i++){frameCount++;window.e=new Character(100+i*40,100,false,'NORMAL');e.aimAngle=0;rememberFigureMotion(e,0,0);
  _player3DLiveSnapshots.set(e,Object.assign(player3DPose(e),{renderActorState:{frame:frameCount-1,x:e.x,y:e.y}}));
  e.fallHit={frame:frameCount,kind:'BODY',weapon:WEAPONS.PISTOL,angle:Math.PI,force:3,mx:0,my:0};
  const k=new Corpse(e.x,e.y,0,0,e.shirtCol,e.pantsCol,0,0,[],e.currentWeapon,Math.PI,e.eType,e.bodyW,e.bodyH,e);finishFigureFall(k);
  k.bloodTimer=k.smokeTimer=0;k.bT=0;if(k.fatalSpray)k.fatalSpray.left=0;if(k.rag)while(!k.rag.done)ragStep(k.rag);corpses.push(k);}
  window.__stamped=0;window.__stamp=stampCorpse;stampCorpse=k=>{__stamped++;};`);
const before = P('corpses.length');
probe('frameCount++;updateCorpses();');
ok('a volley stamps at most MODEL_STAMPS_PER_FRAME bodies a frame', P('__stamped') === P('MODEL_STAMPS_PER_FRAME') && P('corpses.length') === before - P('MODEL_STAMPS_PER_FRAME'));
probe('for(let i=0;i<4;i++){frameCount++;updateCorpses();}stampCorpse=__stamp;');
ok('and the rest follow on the next frames', P('corpses.length') === 0 && P('__stamped') === before);

// ---- wounds ride the falling body -----------------------------------------
shoot('NORMAL', 0, Math.PI);
probe('for(let i=0;i<18;i++){frameCount++;c.update();}');
const wound = P('fatalWoundPoint(c,{x:0,y:0})'), chest = P('player3DFallSkeleton(c).pose.chest');
ok('a chest wound sits on the falling chest', Math.hypot(wound.x - P('c.x') - chest.x, wound.y - P('c.y') - chest.y) < 1e-6);
probe('finishFigureFall(c);');
ok('finishing a fall (off screen, level change) finishes the model too', !P('player3DFallActive(c)'));

console.log(`${checks} death fall timing, start/end continuity, floor, corpse widths and retirement checks passed`);
