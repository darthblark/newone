// Death falls: the Blender-timed collapse and the model's fall onto the corpse.
//
//   node tools/check-death-fall.js
//
// The fall starts in the living figure's last drawn pose, follows the timing
// exported from the actions in assets/player/player.blend, and ENDS on the
// corpse rig this game has always drawn -- player3DCorpseSkeleton(c) at
// progress 1, the corpse's own archetype, springs and wounds. An enemy then
// hands over to its native painter; the player keeps its 3D corpse.
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
    e.fallHit={frame:frameCount,kind:'BODY',weapon:WEAPONS.PISTOL,angle:${hit},force:3,mx:0,my:0,x:e.x,y:e.y,fatal:true};
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
    // Hand-over: the native painter takes the body before it can be stamped.
    ok(`${tag}: an enemy hands over rather than retiring as a model`, P('player3DFallHandoff(c)') > .9 && !P('corpseSettled(c)'));
    let fade = 0; while (P('player3DFallActive(c)') && fade < 40) { probe('frameCount++;c.update();'); fade++; }
    ok(`${tag}: the hand-over lasts its fade`, fade === P('PLAYER3D_FALL_FADE') - 1, `${fade} more frames`);
    ok(`${tag}: then the native painter owns it and it can retire`, !P('player3DFallActive(c)') && !P('c.id.isPlayer') && P('corpseSettled(c)'));
  }

// ---- the player keeps its model --------------------------------------------
shoot('NORMAL', 0, Math.PI, { player: true });
ok('player: the model takes the fall', P('!!c.fall3D&&c.fall3D.isPlayer'));
probe('for(let i=0;i<120&&!c.fall.done;i++){frameCount++;c.update();}');
const playerFall = P('player3DFallSkeleton(c).pose');
probe('frameCount++;c.update();');
// (Headless there is no WebGL, so the renderer's own readiness is not asked.)
ok('player: no hand-over; the 3D corpse continues', !P('player3DFallActive(c)') && P('c.fall3D.finished') && P('c.id.isPlayer') && P('player3DFallHandoff(c)') === null);
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

// ---- wounds ride the falling body -----------------------------------------
shoot('NORMAL', 0, Math.PI);
probe('for(let i=0;i<18;i++){frameCount++;c.update();}');
const wound = P('fatalWoundPoint(c,{x:0,y:0})'), chest = P('player3DFallSkeleton(c).pose.chest');
ok('a chest wound sits on the falling chest', Math.hypot(wound.x - P('c.x') - chest.x, wound.y - P('c.y') - chest.y) < 1e-6);
probe('finishFigureFall(c);');
ok('finishing a fall (off screen, level change) finishes the model too', !P('player3DFallActive(c)'));

console.log(`${checks} death fall timing, start/end continuity, floor, hand-over and retirement checks passed`);
