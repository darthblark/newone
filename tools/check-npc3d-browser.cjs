// Exercise city residents through the real p5/GL painters.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=process.env.NPC3D_OUT||'/tmp/npc3d-qa';
fs.mkdirSync(out,{recursive:true});
const game=fs.readFileSync(path.join(root,'game.js'),'utf8');
const p5=fs.readFileSync(process.env.PLAYER3D_P5||'/workspace/.environment/newone/node_modules/p5/lib/p5.min.js','utf8');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.VIS_CHROME||'/usr/bin/chromium',headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-angle=swiftshader']});
 try {
  const page=await browser.newPage({viewport:{width:1000,height:720},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('http://npc3d.local/**',r=>{
   if(r.request().url().endsWith('/p5.js'))return r.fulfill({contentType:'application/javascript',body:p5});
   if(r.request().url().endsWith('/game.js'))return r.fulfill({contentType:'application/javascript',body:game});
   return r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{display:block}</style><script src="/p5.js"></script><script src="/game.js"></script><script>preload=function(){};draw=function(){};windowResized=function(){};setup=function(){createCanvas(1000,720);pixelDensity(1);noLoop();window.__ready=true;};</script>'});
  });
  await page.goto('http://npc3d.local/');await page.waitForFunction(()=>window.__ready);
  const report=await page.evaluate(()=>{
   started=doTick=true;isStoryMode=isPaused=isDead=isWin=killcamMode=false;
   inStoryIntro=inStoryRoom=inTownCutscene=inFortCutscene=inPostAmbushCutscene=false;
   inFarmCutscene=inFarmPostCutscene=inLvl4Cutscene=inDarchonCall=inWorldBuildingMenu=inTravelMenu=inUpgradeMenu=inCutscene=inOverworldView=false;
   currentLevel=currentBiome=1;BIOME_ACTIVE=true;window.inNM0SecretOverlay=false;buildGhost=null;
   resetUndergroundRoute();setMeleeTool('NONE');buildings=activeBuildings=[];barrels=[];activeParkingCars=[];enemiesList=[];invalidateColIndex();
   chemistSuitUnlocked=ninjaSuitUnlocked=explosiveArmorUnlocked=cowboySuitEquipped=jetpackUnlocked=false;
   leftStick={active:false,dx:0,dy:0,dist:0};rightStick={active:false,dx:0,dy:0,dist:0};
   camX=camY=0;zoom=1;viewLeft=viewTop=-1e6;viewRight=viewBottom=1e6;LIGHT_DX=.7;LIGHT_DY=.7;
   player=new Character(1000,1000,true);
   const fresh=(style=0,hair=0,angle=-.8,type='CITY_CITIZEN_M',seed=123)=>{
    const c=new Character(0,0,false,type);cityAppearance(c,seed);
    c.clothingStyle=style;c.hairStyle=hair;c.aimAngle=angle;c.moveAngle=angle+.3;
    c.isMoving=true;c.gait=.65;c.walkCycle=.9;c.hitFlash=c.stunTimer=c.skeletonTimer=c.meleeTimer=c.reloadTimer=0;
    resetActorStance(c,'STAND');return c;
   };
   const paint=(c,x,y,native=false,magnification=2.2)=>{
    const enabled=Player3D.enabled,before=Player3D.stats.draws||0;
    Player3D.enabled=!native;push();translate(x,y);scale(magnification);c.show();pop();Player3D.enabled=enabled;
    return (Player3D.stats.draws||0)-before;
   };
   paint(fresh(),500,250); // initialize GL before comparing equivalent frames
   const outfitPixels=[];let plain;
   for(let style=0;style<4;style++){
    const c=fresh(style,0,0);c.isMoving=false;c.gait=0;
    clear();paint(c,500,250);
    const pixels=drawingContext.getImageData(400,150,200,200).data;
    if(!plain)plain=pixels;
    else {let changed=0;for(let k=0;k<pixels.length;k+=4)if(Math.abs(pixels[k]-plain[k])+Math.abs(pixels[k+1]-plain[k+1])+Math.abs(pixels[k+2]-plain[k+2])>25)changed++;outfitPixels.push(changed);}
   }
   const thug=fresh(0,1,.6,'CITY_THUG_M');
   thug.cityActivity={kind:'SMOKE',phase:'USE',timeMs:200,durationMs:1000};
   const switches=[];
   for(const state of ['smoke','fire','reload','holster']){
    thug.cityThugGunDrawn=thug.cityThugHostile=state==='fire'||state==='reload';
    streetThugSetDisposition(thug);
    thug.muzzleFlash=state==='fire'?3:0;thug.reloadTimer=state==='reload'?45:0;
    if(state==='holster')thug.cityActivity.phase='WAIT';
    push();translate(250,250);thug.show();pop();
    const p=player3DLiveSnapshot(thug);
    switches.push({pistol:p.parts.some(part=>part.part==='weapon_primary'),smoke:!!p.sockets.ember,
      aligned:!thug.cityThugGunDrawn||(()=>{const m=aimLaserMuzzle(thug,0);return Math.hypot(m.x-thug.x-p.sockets.muzzle.x,m.y-thug.y-p.sockets.muzzle.y)<.001;})()});
   }
   background(173,184,182);textFont('sans-serif');textAlign(CENTER);noStroke();fill(25,38,44);textSize(22);
   text('City civilian · native / Blender rig',500,34);
   const rows=[];
   for(let i=0;i<8;i++){
    const c=fresh(i%4,i%7,i<4?-.8:2.3),x=(i%4)*250,y=Math.floor(i/4)*320+65;
    const before=JSON.stringify([c.isFriendly,c.isNeutral,c.isUnarmed,c.isArmed,c.aimAngle,c.moveAngle,c.ammo,c.fireTimer,c.state]);
    const native=paint(c,x+54,y+140,true),draws=paint(c,x+182,y+140);
    const snapshot=player3DLiveSnapshot(c),torso=snapshot.parts.find(p=>p.part==='torso'),detail=snapshot.parts.find(p=>p.part==='civilian_clothing');
    const after=JSON.stringify([c.isFriendly,c.isNeutral,c.isUnarmed,c.isArmed,c.aimAngle,c.moveAngle,c.ammo,c.fireTimer,c.state]);
    rows.push({native,draws,unchanged:before===after,weapon:snapshot.parts.some(p=>p.part==='weapon_primary'),
      clothing:detail.mesh,hair:snapshot.parts.find(p=>p.part==='civilian_hair').mesh,
      aligned:Array.from(torso.matrix).every((v,k)=>v===detail.matrix[k]),modelShadow:celFigureModelCasts(c)});
    noStroke();fill(25,38,44);textSize(14);text(['Shirt','Vest','Tie','Stripes'][i%4],x+125,y+12);
    textSize(11);text('native',x+55,y+266);text('Blender',x+182,y+266);
   }
   const fallback=[];
   for(const [name,mutate] of [
    ['farmer',c=>c.eType='FARMER_MALE'],['armed bystander',c=>c.isArmed=true],
    ['thug boxing',c=>{c.eType='CITY_THUG_M';c.cityStreetFight=true;}],
    ['stun',c=>c.stunTimer=20],['injury',c=>c.legInjury={}],['dead',c=>c.dead=true],
    ['prone',c=>resetActorStance(c,'PRONE')],['crouch',c=>resetActorStance(c,'CROUCH')]]){
    const c=fresh();mutate(c);fallback.push({name,eligible:npc3DLivingEligible(c),shadow:celFigureModelCasts(c)});
   }
   const c=fresh(),enabled=Player3D.enabled;Player3D.enabled=false;
   const disabled=drawNPC3DLiving(c);Player3D.enabled=enabled;
   // All seven hair profiles remain spherical-head attachments at every angle.
   const profiles=[];
   for(let h=0;h<7;h++)for(const a of [0,Math.PI*.5,Math.PI,Math.PI*1.5]){
    const p=player3DPose(fresh(0,h,a),{npc:true,weapon:false});
    profiles.push(p.parts.every(part=>Array.from(part.matrix).every(Number.isFinite)));
   }
   // Hold the lower body still to measure the independent wrist animation.
   const actions=[];
   for(const kind of ['PHONE','SMOKE','BOTTLE']) {
    const c=fresh(0,1,.68,'CITY_NEUTRAL_M');c.isMoving=false;c.gait=0;
    for(const [phase,fraction] of [['REACH',0],['REACH',.5],['USE',.25],['LOWER',.5],['LOWER',1]]) {
     c.cityActivity={kind,phase,timeMs:fraction*1000,durationMs:1000};
     const previous=c._cityActivityPose={sentinel:true};
     const state=JSON.stringify(c.cityActivity);
     const p=player3DPose(c,{npc:true,weapon:false}),hand=p.sockets.rightHand;
     const props=p.parts.filter(part=>part.part.startsWith('held_'));
     actions.push({kind,phase,fraction,height:hand.z,count:props.length,
       grip:props.every(part=>Math.hypot(hand.x-part.matrix[12],hand.y-part.matrix[13],hand.z+2.1-part.matrix[14])<.001),
       stable:c._cityActivityPose===previous&&Object.keys(previous).length===1&&JSON.stringify(c.cityActivity)===state});
    }
   }
   window.drawStreetLineup=(phase=0)=>{
    background(77,84,90);textFont('sans-serif');textAlign(CENTER,CENTER);noStroke();
    fill(235,239,235);textSize(24);text('Level 1  /  City residents',500,40);
    const samples=[
     ['City resident','CITY_CITIZEN_F',12],['Work vest','CITY_NEUTRAL_M',29],['Tracksuit','CITY_THUG_M',37],
     ['Phone','CITY_NEUTRAL_M',83,'PHONE'],['Bottle','CITY_NEUTRAL_M',12,'BOTTLE'],['Cigarette','CITY_THUG_M',52,'SMOKE'],
     ['Turning','CITY_CITIZEN_F',83],['Running','CITY_NEUTRAL_M',29],['Pistol drawn','CITY_THUG_M',37,'PISTOL']];
    const shown=[];
    samples.forEach(([label,type,seed,activity],i)=>{
     const x=i%3*330+170,y=Math.floor(i/3)*205+105;
     const angle=[.5,1.9,-1.2,.35,-.8,.8,2.4,-1.8,-.65][i]+Math.sin(phase)*(i===6?1.2:.33);
     const c=fresh(i%2,i%7,angle,type,seed);
     c.walkCycle=phase*2+i*.6;c.gait=i===7?1:.55;
     c.moveAngle=i===6?.4:angle+.25;
     if(activity==='PISTOL'){c.cityThugGunDrawn=true;c.cityThugHostile=true;streetThugSetDisposition(c);}
     else if(activity){
      c.isMoving=false;c.gait=0;
      const cycle=(phase/(2*Math.PI)+.4)%1;
      const state=cycle<.25?'REACH':cycle<.65?'USE':cycle<.9?'LOWER':'WAIT';
      const progress=cycle<.25?cycle/.25:cycle<.65?(cycle-.25)/.4:cycle<.9?(cycle-.65)/.25:0;
      c.cityActivity={kind:activity,phase:state,timeMs:progress*1000,durationMs:1000};
     }
     const draws=paint(c,x,y+8,false,2.5),p=player3DLiveSnapshot(c);
     shown.push({type,draws,garment:p?.parts.find(part=>part.part==='civilian_clothing')?.mesh,
      held:p?.parts.filter(part=>part.part.startsWith('held_')).map(part=>part.mesh),
      pistol:p?.parts.some(part=>part.part==='weapon_primary'),projectile:player3DProjectileShooterEligible(c),
      casts:celFigureModelCasts(c),finite:p?.parts.every(part=>Array.from(part.matrix).every(Number.isFinite))});
     noStroke();fill(235,239,235);textSize(17);text(label,x,y+93);
    });
    return shown;
   };
   return {rows,fallback,disabled,profiles,outfitPixels,actions,switches,casts:Player3D.stats.castDraws||0,gpuError:Player3D.gl.getError()};
  });
  await page.screenshot({path:path.join(out,'city-citizen-m.png')});
  report.street=await page.evaluate(()=>drawStreetLineup());
  await page.screenshot({path:path.join(out,'city-residents.png')});
  assert.deepEqual(report.street.map(s=>s.garment),['city_blouse','city_work_vest','city_tracksuit','city_work_vest','city_work_vest','city_tracksuit','city_blouse','city_work_vest','city_tracksuit']);
  assert.deepEqual(report.street.slice(3,6).map(s=>s.held),[['city_phone'],['flask'],['city_cigarette']]);
  assert.ok(report.street.every((s,i)=>s.draws===1&&s.finite&&s.casts&&s.pistol===(i===8)&&!!s.projectile===(i===8)));
  assert.equal(await page.evaluate(()=>Player3D.gl.getError()),0);
  assert.deepEqual(report.switches.map(s=>s.pistol),[false,true,true,false]);
  assert.deepEqual(report.switches.map(s=>s.smoke),[true,false,false,false]);
  assert.ok(report.switches.every(s=>s.aligned),'drawn pistol follows native projectile origin');
  for(const kind of ['PHONE','SMOKE','BOTTLE']){
   const sequence=report.actions.filter(a=>a.kind===kind);
   assert.deepEqual(sequence.map(a=>a.count),[0,1,1,1,0]);
   assert.ok(sequence.every(a=>a.grip&&a.stable));
   const heights=sequence.map(a=>a.height);
   assert.ok(heights[2]>heights[1]&&heights[1]>heights[0]+3&&heights[1]===heights[3]&&heights[0]===heights[4]);
  }
  if(process.env.NPC3D_FRAMES){
   const frames=process.env.NPC3D_FRAMES;fs.mkdirSync(frames,{recursive:true});
   for(let i=0;i<32;i++){
    const png=await page.evaluate(i=>{drawStreetLineup(i*2*Math.PI/32);return document.querySelector('canvas').toDataURL();},i);
    fs.writeFileSync(path.join(frames,String(i).padStart(3,'0')+'.png'),Buffer.from(png.split(',')[1],'base64'));
   }
  }
  for(const row of report.rows){assert.equal(row.native,0);assert.equal(row.draws,1);assert.ok(row.unchanged&&row.aligned&&row.modelShadow);assert.equal(row.weapon,false);}
  for(const row of report.fallback)assert.ok(!row.eligible&&!row.shadow,row.name+' keeps native body and shadow');
  assert.equal(report.disabled,false);assert.ok(report.profiles.every(Boolean));assert.ok(report.casts>0,'Claude model shadows are used');
  assert.ok(report.outfitPixels.every(n=>n>10),'outfits are visibly distinct: '+report.outfitPixels);
  assert.equal(report.gpuError,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('City residents passed outfit, gesture, pistol, shadow, GPU and fallback checks.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
