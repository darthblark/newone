// A death fall on the model, between the living figure's last drawn pose and
// the corpse's own resting pose. The timing is Blender's: the two actions on
// PlayerRig in assets/player/player.blend, sampled every 60 Hz frame into
// PLAYER3D_FALLS by tools/blender-falls.py. Where the body ENDS is not: the
// end of the blend is exactly player3DCorpseSkeleton(c) at progress 1, the
// corpse rig the native painter and the stamp have always drawn, with its own
// archetype, limb springs and wounds. Once the fall settles the body is that
// 3D corpse, player or enemy alike, until it is stamped into the ground.
// No clocks, random numbers or game state are advanced here: Corpse.update()
// owns the fall's age.
const PLAYER3D_FALL_WEAPON_DROP = 24;

const Player3DQuat = (() => {
  // Columns x, y, z are orthonormal axes. Quaternions are [w, x, y, z].
  const fromAxes=(x,y,z)=>{
    const m00=x.x,m10=x.y,m20=x.z,m01=y.x,m11=y.y,m21=y.z,m02=z.x,m12=z.y,m22=z.z,tr=m00+m11+m22;
    let q;
    if(tr>0){const s=Math.sqrt(tr+1)*2;q=[.25*s,(m21-m12)/s,(m02-m20)/s,(m10-m01)/s];}
    else if(m00>m11&&m00>m22){const s=Math.sqrt(1+m00-m11-m22)*2;q=[(m21-m12)/s,.25*s,(m01+m10)/s,(m02+m20)/s];}
    else if(m11>m22){const s=Math.sqrt(1+m11-m00-m22)*2;q=[(m02-m20)/s,(m01+m10)/s,.25*s,(m12+m21)/s];}
    else{const s=Math.sqrt(1+m22-m00-m11)*2;q=[(m10-m01)/s,(m02+m20)/s,(m12+m21)/s,.25*s];}
    const n=Math.hypot(q[0],q[1],q[2],q[3])||1;return [q[0]/n,q[1]/n,q[2]/n,q[3]/n];
  };
  // The great-circle arc from a to b, also past either end: Blender's curves
  // overshoot their rest pose and come back, and so must the rotation.
  const slerp=(a,b,t)=>{
    let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],s=1;
    if(d<0){d=-d;s=-1;}
    let k0,k1;
    if(d>.9995){k0=1-t;k1=s*t;}
    else{const th=Math.acos(Math.min(1,d)),sn=Math.sin(th);k0=Math.sin((1-t)*th)/sn;k1=s*Math.sin(t*th)/sn;}
    const q=[k0*a[0]+k1*b[0],k0*a[1]+k1*b[1],k0*a[2]+k1*b[2],k0*a[3]+k1*b[3]];
    const n=Math.hypot(q[0],q[1],q[2],q[3])||1;return [q[0]/n,q[1]/n,q[2]/n,q[3]/n];
  };
  const rotate=(q,vx,vy,vz)=>{
    const w=q[0],x=q[1],y=q[2],z=q[3];
    const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
    return {x:vx+w*tx+y*tz-z*ty,y:vy+w*ty+z*tx-x*tz,z:vz+w*tz+x*ty-y*tx};
  };
  const axes=q=>({x:rotate(q,1,0,0),y:rotate(q,0,1,0),z:rotate(q,0,0,1)});
  // A part matrix's rotation, scale and position, for rigid props.
  const fromMatrix=m=>{
    const M=Player3DMath,sx=Math.hypot(m[0],m[1],m[2])||1,sy=Math.hypot(m[4],m[5],m[6])||1,sz=Math.hypot(m[8],m[9],m[10])||1;
    const x=M.norm(M.point(m[0],m[1],m[2])),yr=M.point(m[4],m[5],m[6]);
    const y=M.norm(M.sub(yr,M.mul(x,M.dot(yr,x)))),z=M.cross(x,y);
    return {q:fromAxes(x,y,z),s:[sx,sy,sz],p:M.point(m[12],m[13],m[14])};
  };
  return {fromAxes,slerp,rotate,axes,fromMatrix};
})();

function player3DFallCurve(key) {
  const falls=typeof PLAYER3D_FALLS!=='undefined'&&PLAYER3D_FALLS&&PLAYER3D_FALLS.falls;
  return falls?falls[key]||falls.BACKWARD:null;
}

// A channel at a fractional Blender frame, held at its ends.
function player3DFallSample(curve, name, frame) {
  const a=curve&&curve.channels&&curve.channels[name];
  if(!a||!a.length)return 0;
  const n=a.length-1;
  if(!(frame>0))return a[0];
  if(frame>=n)return a[n];
  const i=Math.floor(frame),u=frame-i;
  return a[i]+(a[i+1]-a[i])*u;
}

function player3DFallActive(c) {
  return !!(c&&c.fall3D&&!c.fall3D.finished&&c.fall);
}

function player3DFallTick(c) {
  const s=c&&c.fall3D;
  if(s&&!s.finished&&(!c.fall||c.fall.done))s.finished=true;
}

function player3DFallFinish(c) {
  if(c&&c.fall3D)c.fall3D.finished=true;
}

// The living figure's last drawn pose, copied into plain numbers. Only a
// figure the model drew on the previous frame qualifies: one the native
// painter drew (stunned, injured, mounted, boxing...) keeps the native fall.
function player3DFallCapture(src, c) {
  if(!src||typeof _player3DLiveSnapshots==='undefined'||typeof Player3D==='undefined'||!Player3D||Player3D.enabled===false)return null;
  const snap=_player3DLiveSnapshots.get(src),state=snap&&snap.renderActorState,p=snap&&snap.pose;
  if(!p||!state||!(state.frame>=frameCount-1)||!p.head||!p.chest||!p.pelvis||!p.arms||p.arms.length<2||!p.legs||p.legs.length<2)return null;
  const M=Player3DMath,dx=(Number(state.x)||c.x)-c.x,dy=(Number(state.y)||c.y)-c.y;
  const at=q=>M.point(Number(q.x)+dx,Number(q.y)+dy,Number(q.z)||0);
  if(p.arms.some(a=>!a.shoulder||!a.elbow||!(a.fist||a.hand))||p.legs.some(l=>!l.hip||!l.knee||!l.ankle))return null;
  const torso=snap.parts.find(q=>q.part==='torso'),head=snap.parts.find(q=>q.part==='head');
  const len=(m,i)=>Math.hypot(m[i],m[i+1],m[i+2]);
  const basis=Number.isFinite(p.chestHeading)?M.postureFrame(p.chestHeading,Number(p.bodyPitch)||0):
    M.frame(p.up||M.norm(M.sub(p.head,p.pelvis)),p.forward||M.point(1,0,0));
  const facing=Math.atan2(basis.x.y,basis.x.x);
  const props=[],worn=snap.parts.find(q=>q.part==='headwear'||q.part==='helmet');
  for(const q of snap.parts)if(/^weapon_|^held_/.test(q.part||'')){
    const m=new Float32Array(q.matrix);m[12]+=dx;m[13]+=dy;
    props.push({mesh:q.mesh,color:q.color.slice(),part:q.part,materials:q.materials,matrix:m});
  }
  return {isPlayer:!!src.isPlayer,finished:false,facing,hatColor:worn?worn.color.slice():null,
    helmet:snap.parts.some(q=>q.part==='helmet'),
    head:at(p.head),chest:torso?M.point(torso.matrix[12]+dx,torso.matrix[13]+dy,torso.matrix[14]):at(p.chest),pelvis:at(p.pelvis),
    arms:p.arms.slice(0,2).map(a=>{
      // The widths the living model drew this arm at (pose.js's own rules).
      const R=figureRig(Number(c.bW)||21,Number(c.bH)||27),upper=a.widths?a.widths[0]:R.upperW;
      return {shoulder:at(a.shoulder),elbow:at(a.elbow),fist:at(a.fist||a.hand),
        widths:[upper,a.widths?a.widths[1]:(R.upperW+R.foreW)*.5,0],foreWidth:R.foreW*(upper/R.upperW),handDiameter:a.handDiameter||R.hand};
    }),
    legs:p.legs.slice(0,2).map(l=>({hip:at(l.hip),knee:at(l.knee),ankle:at(l.ankle),
      heading:Number.isFinite(l.heading)?l.heading:facing})),
    q:Player3DQuat.fromAxes(basis.x,basis.y,basis.z),
    torsoDepth:torso?len(torso.matrix,0):8.8,torsoWidth:torso?len(torso.matrix,4):13.5,torsoLength:torso?len(torso.matrix,8):9.6,
    headRadius:(head?len(head.matrix,0):5.5)/(typeof PLAYER3D_HEAD_SCALE==='number'?PLAYER3D_HEAD_SCALE:1),
    props,cache:null,cacheKey:''};
}

function player3DFallFrame(c) {
  const p=c.fall;return Math.max(0,(Number(p&&p.age)||0)*(Number(p&&p.tempo)||1));
}

// The blended skeleton, in the corpse's own frame, cached per fall age.
function player3DFallSkeleton(c) {
  // Corpse-local, so a body sliding along the floor (or a sword half drawn at
  // its own origin) shares one blend per frame.
  const s=c.fall3D,p=c.fall,key=p.age+'|'+(c.rag?c.rag.t:0);
  if(s.cache&&s.cacheKey===key)return s.cache;
  const end=player3DCorpseSkeleton(c,{progress:1,rig:projectFallRig(c.bW||21,c.bH||27,1),angle:figureFallYaw(p,c.rag,1)});
  s.cache=player3DFallBlend(s,end,p.curve||(p.faceDown?'FORWARD':'BACKWARD'),player3DFallFrame(c),figureFallYaw(p,c.rag,1));
  s.cacheKey=key;
  return s.cache;
}

// The blend itself, from a start pose (a living capture, perhaps localised
// into a flying piece's frame) to an end skeleton in the same frame, at
// Blender frame t. yaw is the end's heading, for the overlays that turn.
function player3DFallBlend(s, end, curveKey, t, yaw) {
  const M=Player3DMath,Q=Player3DQuat,curve=player3DFallCurve(curveKey);
  const ch=name=>player3DFallSample(curve,name,t),c01=v=>Math.max(0,Math.min(1,v));
  const F0=Q.axes(s.q),F1=M.frame(M.norm(M.sub(end.head,end.pelvis)),end.forward),q1=Q.fromAxes(F1.x,F1.y,F1.z);
  const sT=ch('torso'),sH=ch('head'),k=c01(sT),kh=c01(sH),e=c01(ch('projected'));
  const F=Q.axes(Q.slerp(s.q,q1,sT)),FH=Q.axes(Q.slerp(s.q,q1,sH));
  const local=(A,v)=>M.point(M.dot(v,A.x),M.dot(v,A.y),M.dot(v,A.z));
  const world=(A,l)=>M.add(M.add(M.mul(A.x,l.x),M.mul(A.y,l.y)),M.mul(A.z,l.z));
  const offset=(a0,o0,a1,o1,u)=>M.mix(local(F0,M.sub(a0,o0)),local(F1,M.sub(a1,o1)),u);
  const travel=ch('pelvisTravel'),drop=ch('pelvisDrop');
  const pelvis=M.point(s.pelvis.x+(end.pelvis.x-s.pelvis.x)*travel,s.pelvis.y+(end.pelvis.y-s.pelvis.y)*travel,
    s.pelvis.z+(end.pelvis.z-s.pelvis.z)*drop);
  const chest=M.add(pelvis,world(F,offset(s.chest,s.pelvis,end.chest,end.pelvis,k)));
  const head=M.add(chest,world(FH,offset(s.head,s.chest,end.head,end.chest,kh)));
  // A leg bone turns in the plane between where it was and where it rests,
  // by Blender's fraction of that turn (a buckle runs it backward first).
  const turn=(v0,v1,u,axis)=>{
    const l0=Math.hypot(v0.x,v0.y,v0.z)||1,l1=Math.hypot(v1.x,v1.y,v1.z)||1,d0=M.mul(v0,1/l0),d1=M.mul(v1,1/l1);
    let n=M.cross(d0,d1);const sn=Math.hypot(n.x,n.y,n.z),total=Math.atan2(sn,M.dot(d0,d1));
    n=sn>1e-4?M.mul(n,1/sn):M.norm(M.sub(axis,M.mul(d0,M.dot(axis,d0))));
    const a=total*u,d=M.add(M.mul(d0,Math.cos(a)),M.mul(M.cross(n,d0),Math.sin(a)));
    return M.mul(d,l0+(l1-l0)*c01(u));
  };
  // An arm is a sweep out from hanging and a raise toward the chest's front,
  // in the chest's own frame: interpolated from the living arm to the
  // corpse's, plus Blender's departure from that line -- the reach and the
  // flail. Game arm 0 is the figure's left, at -y; Blender's left is +Y.
  const angles=(A,u,out)=>{
    const l=local(A,u);let sweep=Math.atan2(out*l.y,-l.z);if(sweep<-Math.PI/2)sweep+=Math.PI*2;
    return [sweep,Math.asin(Math.max(-1,Math.min(1,l.x)))];
  };
  const limb=(from0,to0,from1,to1,base,name,side,out)=>{
    const v0=M.sub(to0,from0),v1=M.sub(to1,from1),l0=Math.hypot(v0.x,v0.y,v0.z)||1,l1=Math.hypot(v1.x,v1.y,v1.z)||1;
    const [w0,r0]=angles(F0,M.mul(v0,1/l0),out),[w1,r1]=angles(F1,M.mul(v1,1/l1),out);
    const w=w0+(w1-w0)*e+ch(name+'Sweep'+side);
    const r=Math.max(-Math.PI/2,Math.min(Math.PI/2,r0+(r1-r0)*e+ch(name+'Raise'+side)));
    const cr=Math.cos(r);
    return M.add(base,M.mul(world(F,M.point(Math.sin(r),out*cr*Math.sin(w),-cr*Math.cos(w))),l0+(l1-l0)*e));
  };
  // Nothing sinks through the floor: no joint goes below its height lying
  // at rest, or below where it started (a standing ankle is the lower).
  const floor=(q,z1,z0)=>{const z=Math.min(z1*.9,z0);if(q.z<z)q.z=z;return q;};
  // Limbs pair by side, not by index: the corpse rig numbers its limbs in
  // its own lying frame, so on its back its arm 0 is the living figure's
  // right arm. Paired by index, every limb swept across the body to the
  // other side. The output keeps the corpse's order, so it ends on it exactly.
  const sideOf=(A,q,o)=>local(A,M.sub(q,o)).y<0;
  const armFrom=j=>sideOf(F1,end.arms[j].shoulder,end.chest)===sideOf(F0,s.arms[0].shoulder,s.chest)?0:1;
  const legFrom=j=>sideOf(F1,end.legs[j].hip,end.pelvis)===sideOf(F0,s.legs[0].hip,s.pelvis)?0:1;
  const arms=[0,1].map(j=>{
    const i=armFrom(j),a0=s.arms[i],a1=end.arms[j],side=i?'R':'L';
    const shoulder=floor(M.add(chest,world(F,offset(a0.shoulder,s.chest,a1.shoulder,end.chest,k))),a1.shoulder.z,a0.shoulder.z);
    const out=local(F,M.sub(shoulder,chest)).y<0?-1:1;
    const elbow=floor(limb(a0.shoulder,a0.elbow,a1.shoulder,a1.elbow,shoulder,'arm',side,out),a1.elbow.z,a0.elbow.z);
    const fist=floor(limb(a0.elbow,a0.fist,a1.elbow,a1.fist,elbow,'fore',side,out),a1.fist.z,a0.fist.z);
    // Thinning from the living sleeve to the corpse's, as the 2D rig does.
    const w=(x0,x1)=>x0+(x1-x0)*e;
    return {shoulder,elbow,fist,widths:[w(a0.widths[0],a1.widths[0]),w(a0.widths[1],a1.widths[1]),w(a0.foreWidth,a1.foreWidth)],
      foreWidth:w(a0.foreWidth,a1.foreWidth),handDiameter:w(a0.handDiameter,a1.handDiameter)};
  });
  const legs=[0,1].map(j=>{
    const i=legFrom(j),l0=s.legs[i],l1=end.legs[j],side=i?'R':'L';
    const hip=floor(M.add(pelvis,world(F,offset(l0.hip,s.pelvis,l1.hip,end.pelvis,k))),l1.hip.z,l0.hip.z);
    const knee=floor(M.add(hip,turn(M.sub(l0.knee,l0.hip),M.sub(l1.knee,l1.hip),ch('thigh'+side),F.y)),l1.knee.z,l0.knee.z);
    const ankle=floor(M.add(knee,turn(M.sub(l0.ankle,l0.knee),M.sub(l1.ankle,l1.knee),ch('shin'+side),F.y)),l1.ankle.z,l0.ankle.z);
    const h1=Number.isFinite(l1.heading)?l1.heading:0,dh=Math.atan2(Math.sin(h1-l0.heading),Math.cos(h1-l0.heading));
    return {hip,knee,ankle,heading:l0.heading+dh*k};
  });
  floor(head,end.head.z,s.head.z);floor(chest,end.chest.z,s.chest.z);floor(pelvis,end.pelvis.z,s.pelvis.z);
  const lerp1=(a,b,u)=>a+(b-a)*u;
  const pose={head,chest,pelvis,arms,legs,forward:F.x,up:F.z,
    torsoWidth:lerp1(s.torsoWidth,end.torsoWidth,k),torsoLength:lerp1(s.torsoLength,end.torsoLength,k),
    torsoDepth:lerp1(s.torsoDepth,end.torsoDepth,k),headRadius:lerp1(s.headRadius,end.headRadius,kh)};
  // The heading a 2D decal, the hair and a prop read: the living facing
  // turning to the corpse's yaw at the torso's pace.
  const dy=Math.atan2(Math.sin(yaw-s.facing),Math.cos(yaw-s.facing));
  return {pose,end,t,e,heading:s.facing+dy*k,headHeading:s.facing+dy*kh};
}

// A start pose carried into another frame: a flying piece's, translated to
// (ox, oy), turned by rot and scaled by k, with its pivot at the origin of
// its own drawing. Widths stay in screen units; pose.js scales those itself.
function player3DFallLocalize(s, ox, oy, rot, k, pivot) {
  const co=Math.cos(rot),si=Math.sin(rot),px=pivot?pivot.x:0,py=pivot?pivot.y:0;
  const L=q=>{const x=q.x-ox,y=q.y-oy;return {x:(co*x+si*y)/k+px,y:(-si*x+co*y)/k+py,z:q.z/k};};
  const h=-rot*.5,a=[Math.cos(h),0,0,Math.sin(h)],b=s.q;
  const q=[a[0]*b[0]-a[3]*b[3],a[0]*b[1]-a[3]*b[2],a[0]*b[2]+a[3]*b[1],a[0]*b[3]+a[3]*b[0]];
  return {...s,head:L(s.head),chest:L(s.chest),pelvis:L(s.pelvis),
    arms:s.arms.map(arm=>({...arm,shoulder:L(arm.shoulder),elbow:L(arm.elbow),fist:L(arm.fist)})),
    legs:s.legs.map(leg=>({...leg,hip:L(leg.hip),knee:L(leg.knee),ankle:L(leg.ankle),heading:leg.heading-rot})),
    q,torsoDepth:s.torsoDepth/k,torsoWidth:s.torsoWidth/k,torsoLength:s.torsoLength/k,headRadius:s.headRadius/k,
    facing:s.facing-rot,cache:null};
}

// A blown-apart body's pieces go down the way a whole one does: each carries
// the living pose in its own drawing frame from the moment it is thrown, and
// lies down on the Blender clock while it flies. Null once it has.
function player3DPieceFall(c, p) {
  const b=c.blast,s0=c.model3D;if(!b||!s0||!p.born)return null;
  const key=c.backFacing?'FORWARD':'BACKWARD',curve=player3DFallCurve(key);
  if(!curve||!(b.age<curve.settle))return null;
  const k=typeof RAG_SCALE==='number'?RAG_SCALE:.8;
  const s=p.local3D||(p.local3D=player3DFallLocalize(s0,p.born.x,p.born.y,p.born.rot,k,p.pivot));
  const end=player3DCorpseSkeleton(c,{progress:1,rig:b.rig,scale:1,angle:0});
  return player3DFallBlend(s,end,key,b.age,0);
}

// While a sliced body is still standing a flat cut cannot divide it, so each
// half keeps its own run of the torso, split along the spine at the cut.
function player3DPieceShorten(snapshot, c, p) {
  const b=c.blast,r=b.rig,u=Math.max(-.95,Math.min(.95,(b.cut.x-(r.chestX||0))/((r.TL||24)*.5))),up=p.side>0;
  const shift=up?(u+1)*.5:(u-1)*.5,keep=up?(1-u)*.5:(1+u)*.5;
  const parts=snapshot.parts.map(q=>{
    if(!['torso','armor','vest','coat'].includes(q.part))return q;
    const m=new Float32Array(q.matrix);
    m[12]+=m[8]*shift;m[13]+=m[9]*shift;m[14]+=m[10]*shift;m[8]*=keep;m[9]*=keep;m[10]*=keep;
    return {...q,matrix:m};
  });
  return {...snapshot,parts};
}

// A held prop goes down with the hand that let go of it and lands where the
// corpse's dropped weapon lies; a hat that falls off rolls off the head.
function player3DFallProp(part, target, u) {
  const Q=Player3DQuat,a=Q.fromMatrix(part.matrix),b=Q.fromMatrix(target.matrix);
  const q=Q.slerp(a.q,b.q,u),A=Q.axes(q),sc=[0,1,2].map(i=>a.s[i]+(b.s[i]-a.s[i])*u);
  const x=a.p.x+(b.p.x-a.p.x)*u,y=a.p.y+(b.p.y-a.p.y)*u,z=a.p.z+(b.p.z-a.p.z)*u*u;
  // It is the same object all the way down: its own mesh and colour until
  // it is nearly there, then the resting prop's.
  const late=u>=.5,col=part.color.map((v,i)=>v+((target.color[i]===undefined?v:target.color[i])-v)*u);
  return {...(late?target:part),color:col,matrix:new Float32Array([A.x.x*sc[0],A.x.y*sc[0],A.x.z*sc[0],0,A.y.x*sc[1],A.y.y*sc[1],A.y.z*sc[1],0,
    A.z.x*sc[2],A.z.y*sc[2],A.z.z*sc[2],0,x,y,z,1])};
}

function player3DFallSnapshot(c) {
  const s=c.fall3D,frame=player3DFallSkeleton(c),proxy=player3DCorpseProxy(c);
  if(!s.isPlayer)proxy.hp=s.helmet?100:0;
  const snapshot=player3DPose(proxy,{identity:player3DCorpseIdentity(c),pose:frame.pose,weapon:false,angle:frame.heading});
  snapshot.worldOrigin=player3DCorpseWorldOrigin(c);
  // Weapons: the dropped weapon's resting place, reached from the hand.
  const u=Math.max(0,Math.min(1,frame.t/PLAYER3D_FALL_WEAPON_DROP)),ease=u*u*(3-2*u);
  const rest=player3DCorpseDroppedWeapons(c,{parts:[],bounds:[0,0,0,0]},1,frame.end.yaw).parts;
  const held=s.props.filter(q=>/^weapon_/.test(q.part));
  for(let i=0;i<rest.length;i++)snapshot.parts.push(held[i]?player3DFallProp(held[i],rest[i],ease):rest[i]);
  if(u<1)for(const q of s.props)if(!/^weapon_/.test(q.part)||!rest[held.indexOf(q)]){
    const m=new Float32Array(q.matrix);m[14]*=1-ease;snapshot.parts.push({...q,matrix:m});
  }
  // A hat that comes off leaves the head as it goes back, and lies where the
  // corpse's own fallen hat lies.
  const hat=typeof player3DCorpseHatPart==='function'&&player3DCorpseHatPart(c,frame.end.head,frame.end.yaw);
  if(hat){
    const on=snapshot.parts.findIndex(q=>q.part==='headwear'||q.part==='helmet');
    const v=Math.max(0,Math.min(1,(player3DFallSample(player3DFallCurve(c.fall.curve),'head',frame.t)-.35)/.65));
    // Until it is clear of the head it is still headwear (and still hides hair).
    if(on>=0)snapshot.parts[on]=player3DFallProp(snapshot.parts[on],hat,v*v*(3-2*v));
    else snapshot.parts.push(hat);
  }
  return snapshot;
}

// A falling body is still standing up, so it keeps the living figure's
// pinhole camera and, in a cel level, casts its own shadow, which shortens
// to nothing as it reaches the floor. Lying down, both differ from the
// corpse's orthographic draw by a fraction of a pixel.
function player3DFallRenderOptions(r, c, snapshot) {
  const ctx=r.drawingContext;
  if(typeof drawingContext==='undefined'||ctx!==drawingContext)return {};
  let shade=null;
  // Once it has come to rest it is a body on the floor and casts nothing
  // worth a second model draw while it hands over.
  if(typeof celFigureCast3D==='function'&&!(c.fall&&c.fall.done)&&!c.isSwordHalf) {
    const s=c.fall3D,actor=s.castActor||(s.castActor={x:0,y:0});
    actor.x=c.x;actor.y=c.y;
    try{shade=celFigureCast3D(actor,snapshot,ctx,{});}catch(_){shade=null;}
  }
  return shade?{view:true,shade}:{view:true};
}

// A body's head keeps what the native fallen head draws on it: the hair of a
// bare-headed figure (the same painter the living overlay uses), and once a
// body on its back is most of the way down, closed eyes and a nose in place
// of the model's open ones. It rides the head's projected centre and turns
// with it: the fall's own heading while it falls, the corpse frame's after.
function player3DCorpseHead(r, c, snapshot, falling) {
  const head=snapshot.parts.find(q=>q.part==='head');if(!head||c.swordHeadless||c.dT===4||c.dT===9)return;
  const id=c.id||{},p=c.fall||{faceDown:!!c.backFacing},f=Math.max(0,Math.min(1,c.fP||0));
  const hair=(id.hairStyle!==undefined||id.eType==='FEMALE_PISTOL'||id.eType==='NM0_ROOKIE_F')&&typeof drawFigureHair==='function'&&
    !snapshot.parts.some(q=>q.part==='headwear'||q.part==='helmet');
  const face=!p.faceDown&&!c.backFacing&&f>.45&&typeof drawFallenFace==='function';
  if(!hair&&!face)return;
  const yaw=falling&&c.fall3D&&c.fall3D.cache?c.fall3D.cache.headHeading:
    (c.fall?figureFallYaw(c.fall,c.rag):(c.aA||0)+(c.rag&&c.rag.ang||0))+(typeof figureHeadTurn==='function'?figureHeadTurn(c.fall,f):0);
  const m=head.matrix,size=Math.hypot(m[0],m[1],m[2])/5.5,o={x:m[12],y:m[13],z:m[14]};
  const P=q=>player3DOverlayPoint(snapshot,q);
  const a=P(o),b=P({x:o.x+Math.cos(yaw)*size,y:o.y+Math.sin(yaw)*size,z:o.z}),d=P({x:o.x-Math.sin(yaw)*size,y:o.y+Math.cos(yaw)*size,z:o.z});
  r.push();
  try{r.applyMatrix(b.x-a.x,b.y-a.y,d.x-a.x,d.y-a.y,a.x,a.y);if(hair)drawFigureHair(r,id,0,0,0);if(face)drawFallenFace(r,p,f);}
  finally{r.pop();}
}

// The model's own open eyes and brows give way to the painted closed face.
function player3DCorpseCloseEyes(c, snapshot) {
  const p=c.fall||{faceDown:!!c.backFacing};
  if(p.faceDown||c.backFacing||!((c.fP||0)>.45))return;
  const head=snapshot.parts.find(q=>q.part==='head');if(!head)return;
  const skin=(snapshot.palette&&snapshot.palette.skin||head.color||[235,180,140]).map(v=>v/255);
  head.materials={...(head.materials||{}),ink:skin,wood:skin};
}

// A body that slumps down a wall starts where the living figure stood: over
// its first frames the slump's own pose takes over from the living one. The
// slump keeps its authored seat, relax and tip; only the start is blended.
const PLAYER3D_SLUMP_BLEND = 18;
function player3DSeatBlend(c, pose) {
  const s=c.model3D,age=c.wallSit&&c.wallSit.age||0;
  if(!s||age>=PLAYER3D_SLUMP_BLEND)return pose;
  const M=Player3DMath,Q=Player3DQuat,u=age/PLAYER3D_SLUMP_BLEND,w=u*u*(3-2*u),mix=(a,b)=>M.mix(a,b,w);
  const F0=Q.axes(s.q),lerp=(a,b)=>a+(b-a)*w,d2=(a,b)=>(a.x-b.x)**2+(a.y-b.y)**2+(a.z-b.z)**2;
  // Pair limbs by whichever way round they are nearer: the slump's own
  // numbering follows the wall, not the figure's left and right.
  const pair=(from,to,key)=>d2(from[0][key],to[0][key])+d2(from[1][key],to[1][key])<=
    d2(from[0][key],to[1][key])+d2(from[1][key],to[0][key])?[0,1]:[1,0];
  const ai=pair(s.arms,pose.arms,'shoulder'),li=pair(s.legs,pose.legs,'hip');
  const up1=M.norm(M.sub(pose.head,pose.pelvis));
  return {...pose,head:mix(s.head,pose.head),chest:mix(s.chest,pose.chest),pelvis:mix(s.pelvis,pose.pelvis),
    arms:pose.arms.map((a,j)=>{const a0=s.arms[ai[j]];return {...a,shoulder:mix(a0.shoulder,a.shoulder),elbow:mix(a0.elbow,a.elbow),fist:mix(a0.fist,a.fist)};}),
    legs:pose.legs.map((l,j)=>{const l0=s.legs[li[j]];return {...l,hip:mix(l0.hip,l.hip),knee:mix(l0.knee,l.knee),ankle:mix(l0.ankle,l.ankle)};}),
    up:M.norm(mix(F0.z,up1)),forward:M.norm(mix(F0.x,pose.forward||M.point(1,0,0))),
    torsoWidth:lerp(s.torsoWidth,pose.torsoWidth),torsoDepth:lerp(s.torsoDepth,pose.torsoDepth),
    torsoLength:lerp(s.torsoLength,Math.hypot(pose.head.x-pose.pelvis.x,pose.head.y-pose.pelvis.y,pose.head.z-pose.pelvis.z)*.48),
    headRadius:lerp(s.headRadius,pose.headRadius)};
}

