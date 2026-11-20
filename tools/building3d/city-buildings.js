// Blender roof solids share one footprint-anchored projection with their walls,
// lighting proxies and actor occlusion. No additional WebGL context is needed.
const CityBuildings3D = (() => {
  'use strict';
  const cache=new WeakMap(),lean=[0,0];
  const stats={plans:0,cacheHits:0,projections:0,projectionHits:0,pathBuilds:0,
    draws:0,faces:0,heightDraws:0,heightFaces:0,outlines:0,inkFaces:0,shadowBuilds:0,shadowDraws:0};
  const asset=()=>typeof CITY3D_ASSET!=='undefined'?CITY3D_ASSET:null;
  function profile(b) {
    if(typeof currentLevel==='undefined'||currentLevel!==1||currentBiome!==1||!b||!b.isBlockBuilding||
        b.isGovFortress||b.isGiantBarrier||b.isHouse||b.isLandmark||b.isBuiltStructure||
        b.isTower||b.isBiomeProp||b.forestHuntingLodge||b.undergroundWall||b.hqWall)return null;
    const a=b.cityArchitecture;
    if(a===0||a===3)return 'quay_house';
    if(a===1)return 'quay_office';
    if(a===4)return 'quay_warehouse';
    if(a!==undefined)return null;
    return b.style===1||b.style===2?'quay_house':b.style===3?'quay_warehouse':'quay_office';
  }
  function normalOf(points) {
    const a=points[0];
    for(let i=1;i<points.length-1;i++) {
      const b=points[i],c=points[i+1],ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],
        vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,n=Math.hypot(x,y,z);
      if(n>1e-9)return [x/n,y/n,z/n];
    }
    return null;
  }
  function face(points,material,kind,order=0) {
    const normal=normalOf(points);if(!normal)return null;
    const meanZ=points.reduce((z,p)=>z+p[2],0)/points.length;
    return {points,normal,material,kind,meanZ,order,projected:new Float64Array(points.length*2),
      visible:false,path:null,heightStyle:null};
  }
  function addFacadeFaces(plan,b) {
    const x0=b.x-b.w/2,x1=b.x+b.w/2,y0=b.y-b.h/2,y1=b.y+b.h/2,r=plan.rise;
    // A taller wall carries another row of windows rather than taller ones:
    // the rows are what say how many floors a building has.
    const storeys=plan.profile==='quay_warehouse'?1:
      Math.min(4,Math.max(2,b.cityStoreys||2,r>=37.5?4:r>=31.5?3:2));
    const canal=typeof cityHasCanal==='function'&&cityHasCanal(1,Math.floor(b.y/CHUNK_W));
    const front=canal?(b.y<cityCanalY(1,Math.floor(b.y/CHUNK_W),b.x)?1:-1):
      ((Math.abs(Math.floor(b.x/120)+Math.floor(b.y/120))%2)?1:-1);
    // Counter-clockwise in world XY/Z, with outward wall normals.
    for(const wall of [
      [x0,y0,x1,y0,b.w,0,-1],[x1,y1,x0,y1,b.w,0,1],
      [x0,y1,x0,y0,b.h,-1,0],[x1,y0,x1,y1,b.h,1,0]
    ]) {
      const [ax,ay,bx,by,len,nx,ny]=wall,bays=Math.max(2,Math.min(6,Math.floor(len/48)));
      const panel=(u,v,lo,hi,material)=>{
        const point=(t,z)=>[ax+(bx-ax)*t+nx*.035,ay+(by-ay)*t+ny*.035,z*r];
        const f=face([point(u,lo),point(v,lo),point(v,hi),point(u,hi)],material,'facade');
        if(f)plan.facadeFaces.push(f);
      };
      for(let floor=0;floor<storeys;floor++)for(let i=0;i<bays;i++) {
        const u=(i+.20)/bays,v=(i+.80)/bays,lo=(floor+.19)/storeys,hi=(floor+.75)/storeys;
        panel(u-.035/bays,v+.035/bays,lo-.045,hi+.035,'frame');
        panel(u,v,lo,hi,'window');
        panel(u+.025/bays,u+.11/bays,lo+.025,hi-.025,'window_highlight');
      }
      if(ny===front) {
        const half=plan.profile==='quay_warehouse'?.18:.065;
        panel(.5-half-.02,.5+half+.02,0,.59,'frame');
        panel(.5-half,.5+half,.025,.55,plan.profile==='quay_warehouse'?'shutter':'door');
        if(plan.profile==='quay_warehouse')for(const z of [.14,.25,.36,.47])
          panel(.5-half,.5+half,z,z+.018,'metal_dark');
        else panel(.5-half*.72,.5+half*.72,.25,.48,'window');
      }
    }
  }
  function plan(b) {
    const name=profile(b),data=asset(),model=data&&data.models&&data.models[name];
    if(!model||!(b.w>0)||!(b.h>0))return null;
    const rise=buildingRise(b),old=cache.get(b);
    if(old&&old.asset===data&&old.profile===name&&old.x===b.x&&old.y===b.y&&old.w===b.w&&
        old.h===b.h&&old.rise===rise&&old.style===b.style&&old.burnt===!!b.burnt){stats.cacheHits++;return old;}
    const current={asset:data,profile:name,x:b.x,y:b.y,w:b.w,h:b.h,rise,maxZ:rise+model.bounds[1][2],style:b.style,burnt:!!b.burnt,
      faces:[],roofFaces:[],bodyFaces:[],facadeFaces:[],bounds:[0,0,0,0],roofBounds:[0,0,0,0]};
    // A long house has its ridge along its long axis, rather than stretching a
    // short ridge across a whole tenement wing. Ground bounds remain identical.
    const turn=name==='quay_house'&&b.h>b.w*1.15;
    for(const part of model.parts)for(const source of part.faces) {
      const points=source.points.map(p=>[b.x+(turn?-p[1]:p[0])*b.w,b.y+(turn?p[0]:p[1])*b.h,rise+p[2]]);
      const f=face(points,source.material,'roof',part.order||0);if(f)current.roofFaces.push(f);
    }
    const x0=b.x-b.w/2,x1=b.x+b.w/2,y0=b.y-b.h/2,y1=b.y+b.h/2;
    for(const q of [
      [[x0,y0,0],[x1,y0,0],[x1,y0,rise],[x0,y0,rise]],
      [[x1,y1,0],[x0,y1,0],[x0,y1,rise],[x1,y1,rise]],
      [[x0,y1,0],[x0,y0,0],[x0,y0,rise],[x0,y1,rise]],
      [[x1,y0,0],[x1,y1,0],[x1,y1,rise],[x1,y0,rise]]
    ]){const f=face(q,'wall','wall');if(f)current.bodyFaces.push(f);}
    addFacadeFaces(current,b);
    // Painter order within a component is low-to-high; Blender's semantic part
    // order puts roof slopes before the dormers/equipment they support.
    current.roofFaces.sort((a,c)=>a.order-c.order||a.meanZ-c.meanZ);
    current.faces=current.bodyFaces.concat(current.facadeFaces,current.roofFaces);
    for(const f of current.faces){
      f.color=vivid(materialColor(current,f),f.kind==='wall'?1.5:1.42);
      // Interior ink goes on the faces big enough to carry a line: the walls and
      // the main roof planes. Stroking every vent and glazing bar turns the roof
      // to hatching and doubles the fill cost of the building.
      let area=0;const q=f.points;
      for(let i=1;i<q.length-1;i++){
        const ux=q[i][0]-q[0][0],uy=q[i][1]-q[0][1],uz=q[i][2]-q[0][2],
          vx=q[i+1][0]-q[0][0],vy=q[i+1][1]-q[0][1],vz=q[i+1][2]-q[0][2];
        area+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)*.5;
      }
      f.ink=f.kind==='roof'&&area>=90&&f.material!=='glass'&&f.material!=='glass_highlight';
      // Only a face of some size can be the solid's outline. Vents, glazing
      // bars and chimney caps sit inside the roof they stand on, and leaving
      // them out of the hull stroke is most of what that stroke costs.
      f.hull=f.kind==='wall'||(f.kind==='roof'&&area>=70);
      CityProjectedFaces.prepare(f,stats);
    }
    cache.set(b,current);stats.plans++;return current;
  }
  function project(b) {
    const p=plan(b);if(!p)return null;
    massLean(b.x,b.y,1,lean);const ux=lean[0],uy=lean[1];
    if(p.ux===ux&&p.uy===uy){stats.projectionHits++;return p;}
    p.ux=ux;p.uy=uy;p.bounds[0]=p.bounds[1]=p.roofBounds[0]=p.roofBounds[1]=Infinity;
    p.bounds[2]=p.bounds[3]=p.roofBounds[2]=p.roofBounds[3]=-Infinity;
    for(const f of p.faces) {
      const q=f.projected;
      for(let i=0;i<f.points.length;i++) {
        const v=f.points[i],x=v[0]+ux*v[2],y=v[1]+uy*v[2];q[i*2]=x;q[i*2+1]=y;
        p.bounds[0]=Math.min(p.bounds[0],x);p.bounds[1]=Math.min(p.bounds[1],y);
        p.bounds[2]=Math.max(p.bounds[2],x);p.bounds[3]=Math.max(p.bounds[3],y);
        if(f.kind==='roof'){
          p.roofBounds[0]=Math.min(p.roofBounds[0],x);p.roofBounds[1]=Math.min(p.roofBounds[1],y);
          p.roofBounds[2]=Math.max(p.roofBounds[2],x);p.roofBounds[3]=Math.max(p.roofBounds[3],y);
        }
      }
      let area=0;for(let i=2;i<q.length-2;i+=2)
        area+=(q[i]-q[0])*(q[i+3]-q[1])-(q[i+1]-q[1])*(q[i+2]-q[0]);
      f.visible=area>1e-7;
      CityProjectedFaces.project(f,ux,uy);
    }
    stats.projections++;return p;
  }
  function materialColor(p,f) {
    const palette=p.asset.palette;
    if(f.material==='wall')return p.style===1?[151,92,70]:p.style===2?[190,180,155]:p.style===3?[96,118,127]:[164,174,171];
    if(f.material==='frame')return [57,66,65];
    if(f.material==='window')return [48,99,112];
    if(f.material==='window_highlight')return [146,192,190];
    if(f.material==='door')return [91,76,56];
    if(f.material==='shutter')return [120,141,144];
    if(p.profile==='quay_house'&&p.style===2&&f.material==='roof_tile')return [83,126,121];
    if(p.profile==='quay_house'&&p.style===2&&f.material==='roof_tile_dark')return [54,85,86];
    return palette[f.material]||[142,153,148];
  }
  // COMIC INK AND CEL TONES.
  //
  // The roof kit was lit with one continuous Lambert term, which at this size
  // is a smooth grey ramp: every face of a building lands within a few levels
  // of its neighbour and the solid reads as a tinted decal. A comic panel says
  // "this is a box" with three flat tones and a line round it, and that is what
  // these do. Nothing here touches geometry, projection, caches or the height
  // field: it is the fill style of faces that were already being filled, one
  // batched silhouette stroke per building and one cached ground path.
  //
  //   * vivid(): material colours pushed away from their own grey. Applied once
  //     per plan, so it costs nothing per frame.
  //   * celTone(): the diffuse term snapped to shade / mid / lit. The shade band
  //     leans cool and the lit band warm, which is what separates a wall in
  //     shadow from a wall that is merely painted a darker colour.
  //   * the silhouette is the "inverted hull": every visible face is stroked in
  //     ink FIRST, in one path, and the fills then cover the inner half of each
  //     line. What survives is the outline of the whole solid.
  const CEL_INK='rgb(26,22,38)';
  function vivid(c,amount) {
    const l=c[0]*.30+c[1]*.59+c[2]*.11,k=amount===undefined?1.42:amount;
    const q=v=>Math.max(0,Math.min(255,Math.round(l+(v-l)*k)));
    return [q(c[0]),q(c[1]),q(c[2])];
  }
  // [value, r, g, b] multipliers for the three bands of each kind of face.
  const CEL_WALL=[[.50,.86,.90,1.16],[.74,.97,.98,1.05],[.98,1.05,1.01,.93]];
  const CEL_ROOF=[[.64,.88,.92,1.14],[.86,.98,.99,1.03],[1.05,1.05,1.02,.94]];
  const CEL_TRIM=[[.72,.92,.95,1.10],[.90,1,1,1],[1.04,1.03,1.01,.96]];
  function celBand(f,diffuse) {
    // Thresholds differ by kind: a wall is vertical, so its diffuse never gets
    // near 1 and one threshold set would leave every wall in the middle band.
    if(f.kind==='wall')return diffuse<.10?0:diffuse<.36?1:2;
    if(f.kind==='facade')return diffuse<.10?0:diffuse<.36?1:2;
    return diffuse<.56?0:diffuse<.74?1:2;
  }
  // part 0 is the whole building. 1 is the walls and their facade, 2 the roof
  // alone: the sorted pass puts the people of the street between the two.
  // `edge` asks part 2 for the roof's outline as well; see drawDepthSorted().
  function draw(b,g=window,part=0,edge=false) {
    const p=project(b),ctx=g&&(g.drawingContext||g);
    if(!p||!ctx||typeof ctx.fill!=='function')return false;
    const dx=typeof LIGHT_DX==='number'?LIGHT_DX:.6,dy=typeof LIGHT_DY==='number'?LIGHT_DY:.8;
    const daylight=typeof sceneLightDaylight==='function'?sceneLightDaylight():1;
    const ambient=.76+Math.max(0,Math.min(1,daylight))*.06;
    const target=typeof ctx.getTransform==='function'?ctx.getTransform():null;
    ctx.save();
    try{
      // The cel bands sit on top of the old daylight term, so dusk still dims
      // the whole solid and the night wash has the same level to subtract from.
      const dayK=(ambient-.76)/.06*.10+.90,burnt=p.burnt?.38:1;
      const paint=f=>{
        if(!f.visible)return;
        const n=f.normal,c=f.color,diffuse=Math.max(0,(-n[0]*dx-n[1]*dy+n[2]*.9)/1.34536);
        const band=celBand(f,diffuse);
        const lit=f.kind==='facade'&&f.material==='window'&&daylight<.48&&Math.floor(f.meanZ+b.x+b.y)%4===0;
        const key=band+'|'+Math.round(dayK*64)+'|'+lit+'|'+p.burnt;
        if(f.colorKey!==key){f.colorKey=key;
          const t=(f.kind==='wall'?CEL_WALL:f.kind==='facade'||f.material==='trim'||f.material==='stone'?CEL_TRIM:CEL_ROOF)[band];
          const k=t[0]*dayK*burnt,q=(v,m)=>Math.max(0,Math.min(255,Math.round(v*k*m)));
          f.colorStyle=lit?'rgb(255,196,92)':'rgb('+q(c[0],t[1])+','+q(c[1],t[2])+','+q(c[2],t[3])+')';}
        ctx.fillStyle=f.colorStyle;
        CityProjectedFaces.fill(ctx,f,target);stats.faces++;
        if(f.ink&&f.path&&target){ctx.stroke(f.path);stats.inkFaces++;}
      };
      // Silhouette first: one path, one stroke, covered on its inner half by
      // everything painted after it.
      if(target)ctx.setTransform(target);
      if(part!==2){
        // The whole silhouette goes down with the walls even when the roof is
        // to follow, so the building's outline is the same line either way.
        ctx.strokeStyle=CEL_INK;ctx.lineJoin='bevel';ctx.lineWidth=3.4;
        ctx.beginPath();
        for(const f of p.faces){
          if(!f.visible||!f.hull)continue;
          const q=f.projected;ctx.moveTo(q[0],q[1]);
          for(let i=2;i<q.length;i+=2)ctx.lineTo(q[i],q[i+1]);ctx.closePath();
        }
        ctx.stroke();stats.outlines++;
        ctx.lineWidth=.9;ctx.strokeStyle='rgba(26,22,38,.5)';
        for(const f of p.bodyFaces)paint(f);
        // The corners between two showing walls, and the eave over them.
        if(target)ctx.setTransform(target);
        ctx.lineWidth=1.3;ctx.strokeStyle='rgba(26,22,38,.78)';ctx.beginPath();
        for(const f of p.bodyFaces){
          if(!f.visible)continue;const q=f.projected;
          ctx.moveTo(q[0],q[1]);ctx.lineTo(q[6],q[7]);ctx.lineTo(q[4],q[5]);ctx.lineTo(q[2],q[3]);
        }
        ctx.stroke();
        for(const f of p.facadeFaces)paint(f);
      }
      if(part!==1){
        if(part===2&&edge){
          // The roof's own edge, laid again over whoever is standing under it:
          // without it a figure tucked under an eave meets the roof with no
          // line between them. Thin, so the eave over a wall keeps its weight.
          if(target)ctx.setTransform(target);
          ctx.lineJoin='bevel';ctx.lineWidth=1.3;ctx.strokeStyle='rgba(26,22,38,.78)';ctx.beginPath();
          for(const f of p.roofFaces){
            if(!f.visible||!f.hull)continue;
            const q=f.projected;ctx.moveTo(q[0],q[1]);
            for(let i=2;i<q.length;i+=2)ctx.lineTo(q[i],q[i+1]);ctx.closePath();
          }
          ctx.stroke();
        }
        ctx.lineWidth=.9;ctx.strokeStyle='rgba(26,22,38,.5)';
        for(const f of p.roofFaces)paint(f);
      }
    }finally{ctx.restore();}
    if(part!==2)stats.draws++;
    return true;
  }
  // THE SHADOW IS THE SHAPE OF THE BUILDING, NOT OF ITS BOX.
  //
  // The shared pass hulls a footprint with its offset copy, which is right for
  // a box and says nothing about what is on top of it. Every vertex here
  // already carries a real height, so each one is dropped to the ground along
  // the sun at its own height: a ridge throws a gable, a chimney throws a
  // notch, a plant room steps the edge of a flat roof. That outline is the
  // strongest statement of the roof's form this camera can make, because it
  // is the only place the profile is seen from the side.
  //
  // A shadow lies on the ground, so its path is in WORLD space and does not
  // depend on the camera at all. It is rebuilt only when the sun has moved a
  // thirty-second of a unit per unit of height -- every few seconds of play --
  // and is otherwise one cached fill per building. Each polygon is wound the
  // same way before it joins the path, so the nonzero rule unions them and no
  // overlap is ever filled twice.
  function drawShadow(b,g,ox,oy,style) {
    const p=plan(b),ctx=g&&(g.drawingContext||g);
    if(!p||!ctx||typeof ctx.fill!=='function'||typeof Path2D!=='function')return false;
    const qx=Math.round(ox*32)/32,qy=Math.round(oy*32)/32;
    if(!p.shadowPath||p.shadowOx!==qx||p.shadowOy!==qy){
      const path=new Path2D(),pts=[];
      const add=n=>{
        let area=0;
        for(let i=0;i<n;i++){const j=(i+1)%n;area+=pts[i*2]*pts[j*2+1]-pts[j*2]*pts[i*2+1];}
        if(Math.abs(area)<.5)return;
        if(area>0){path.moveTo(pts[0],pts[1]);for(let i=1;i<n;i++)path.lineTo(pts[i*2],pts[i*2+1]);}
        else{path.moveTo(pts[(n-1)*2],pts[(n-1)*2+1]);for(let i=n-2;i>=0;i--)path.lineTo(pts[i*2],pts[i*2+1]);}
        path.closePath();
      };
      for(const f of p.faces){
        if(f.kind==='facade')continue;
        const n=f.points.length;
        for(let i=0;i<n;i++){const v=f.points[i];pts[i*2]=v[0]+qx*v[2];pts[i*2+1]=v[1]+qy*v[2];}
        add(n);
      }
      p.shadowPath=path;p.shadowOx=qx;p.shadowOy=qy;stats.shadowBuilds++;
    }
    ctx.fillStyle=style;ctx.fill(p.shadowPath);stats.shadowDraws++;return true;
  }
  function paintHeight(g,b,wet=0) {
    const p=project(b),ctx=g&&(g.drawingContext||g);if(!p||!ctx||typeof ctx.fill!=='function')return false;
    const ground=typeof groundElev==='function'?groundElev(b.x,b.y):0;
    const origin=typeof glRigHeightOrigin==='function'?glRigHeightOrigin():0;
    const range=typeof glRigHeightRange==='function'?glRigHeightRange():200;
    const target=typeof ctx.getTransform==='function'?ctx.getTransform():null;
    ctx.save();
    try{
      for(const f of p.faces){
        if(!f.visible||f.kind==='facade')continue;
        if(f.heightGround!==ground||f.heightWet!==wet||f.heightOrigin!==origin||f.heightRange!==range){
          const h=Math.max(0,Math.min(255,(ground+f.meanZ-origin)*255/range));
          const gloss=(f.material==='glass'?.30:.12)+.26*wet;
          f.heightStyle='rgb('+h+','+Math.min(255,gloss*255)+',0)';
          f.heightGround=ground;f.heightWet=wet;f.heightOrigin=origin;f.heightRange=range;
        }
        ctx.fillStyle=f.heightStyle;CityProjectedFaces.fill(ctx,f,target);stats.heightFaces++;
      }
    }finally{ctx.restore();}
    stats.heightDraws++;return true;
  }
  function depth(b) {
    const p=project(b);return p?Math.max(b.y+b.h/2,p.roofBounds[3]):b.y+(b.h||0)/2;
  }
  return {profile,plan,project,draw,drawShadow,paintHeight,depth,stats,getDiagnostics(){return {...stats};}};
})();
