// Focused rollout check: one civilian family through the real p5/GL painters.
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
   const fresh=(style=0,hair=0,angle=-.8)=>{
    const c=new Character(0,0,false,'CITY_CITIZEN_M');cityAppearance(c,123);
    c.clothingStyle=style;c.hairStyle=hair;c.aimAngle=angle;c.moveAngle=angle+.3;
    c.isMoving=true;c.gait=.65;c.walkCycle=.9;c.hitFlash=c.stunTimer=c.skeletonTimer=c.meleeTimer=c.reloadTimer=0;
    resetActorStance(c,'STAND');return c;
   };
   const paint=(c,x,y,native=false)=>{
    const enabled=Player3D.enabled,before=Player3D.stats.draws||0;
    Player3D.enabled=!native;push();translate(x,y);scale(2.2);c.show();pop();Player3D.enabled=enabled;
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
    ['other civilian',c=>c.eType='CITY_CITIZEN_F'],['armed',c=>c.isArmed=true],
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
   return {rows,fallback,disabled,profiles,outfitPixels,casts:Player3D.stats.castDraws||0,gpuError:Player3D.gl.getError()};
  });
  await page.screenshot({path:path.join(out,'city-citizen-m.png')});
  for(const row of report.rows){assert.equal(row.native,0);assert.equal(row.draws,1);assert.ok(row.unchanged&&row.aligned&&row.modelShadow);assert.equal(row.weapon,false);}
  for(const row of report.fallback)assert.ok(!row.eligible&&!row.shadow,row.name+' keeps native body and shadow');
  assert.equal(report.disabled,false);assert.ok(report.profiles.every(Boolean));assert.ok(report.casts>0,'Claude model shadows are used');
  assert.ok(report.outfitPixels.every(n=>n>10),'outfits are visibly distinct: '+report.outfitPixels);
  assert.equal(report.gpuError,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: civilian outfits/hair, dispatch, pose purity, shadows, GPU and native fallbacks. Preview: '+out+'/city-citizen-m.png');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
