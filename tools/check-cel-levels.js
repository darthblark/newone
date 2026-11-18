// The comic depth system, level by level (CEL_LEVELS).
//
// Stick City was the first level drawn as inked cel solids; the Undercity is
// the second, and the table is how a level joins. Most of what this asserts
// fails SILENTLY when it breaks: a gate that forgets a level draws the old art
// without an error, a ruin given a roof is just a house in the wrong place, a
// shadow in the wrong hue is a colour, and a figure that is not darkened under
// a tree is a figure. So each piece is pinned by what it should produce.
//
//   node tools/check-cel-levels.js

const fs = require('fs');
const { probe } = require('./harness.js');
const P = (src) => probe('(' + src + ')');

let fails = 0, checks = 0;
const ok = (n, c, x) => {
  checks++;
  if (c) console.log('  ok   ' + n + (x !== undefined ? '  ' + x : ''));
  else { fails++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + x : '')); }
};

// A Path2D that remembers its polygons, and a context that remembers its fills.
probe(`
  Path2D = function () { this.polys = []; this.cur = null; };
  Path2D.prototype.moveTo = function (x, y) { this.cur = [[x, y]]; this.polys.push(this.cur); };
  Path2D.prototype.lineTo = function (x, y) { this.cur.push([x, y]); };
  Path2D.prototype.closePath = function () {};
  Path2D.prototype.addPath = function (p) { for (const q of p.polys) this.polys.push(q); };
  __fills = [];
  __ctx = { fillStyle: null, globalAlpha: 1, save(){}, restore(){}, translate(){},
    fill(p) { __fills.push({ path: p, style: this.fillStyle }); } };
  drawingContext = __ctx;
  __day = function (h) { worldTimeMs = h / 24 * DAY_MS; updateSunVector(); };
  __lv = function (l, b) { currentLevel = l; currentBiome = b === undefined ? l : b; };
  BIOME_ACTIVE = true; frameCount = 500;
  viewLeft = -2000; viewRight = 2000; viewTop = -2000; viewBottom = 2000;
  // seedWorldClock() picks a random time of year as well as an hour, and the
  // sun now follows it (SEASONS AND LATITUDE): pinned to midsummer, so the
  // 15:00 and 17:00 suns below are always up and never at their longest.
  seedWorldClock(); setSeason('SUMMER'); __day(15);
`);

console.log('\n== which levels are cel levels ==');
{
  const r = P(`(() => {
    const out = {};
    for (const [l, b] of [[1,1],[2,2],[3,3],[4,4],[5,5],[6,6],[7,7],[8,1],[9,1],[2,1],[1,2]]) {
      __lv(l, b); out[l + '/' + b] = celScene();
    }
    __lv(2); BIOME_ACTIVE = false; out.off = celScene(); out.offLevel = celLevel() !== null; BIOME_ACTIVE = true;
    return out;
  })()`);
  ok('Stick City and the Undercity are cel levels', r['1/1'] && r['2/2'], JSON.stringify(r));
  ok('no other level is', !r['3/3'] && !r['4/4'] && !r['5/5'] && !r['6/6'] && !r['7/7'] && !r['8/1'] && !r['9/1']);
  ok('a level loaded into another biome is not', !r['2/1'] && !r['1/2']);
  ok('the scene needs a live biome; the art (celLevel) does not', !r.off && r.offLevel);
}

console.log('\n== one sun caster ==');
{
  const r = P(`(() => {
    const real = glRigActive; glRigActive = () => true;
    try {
      const out = {};
      for (const l of [1, 2, 3, 4]) { __lv(l); out[l] = glRigOwnsSunShadows(); }
      return out;
    } finally { glRigActive = real; }
  })()`);
  ok('with the rig running, the 2D pass owns the sun in both cel levels', r[1] === false && r[2] === false, JSON.stringify(r));
  ok('and the rig still owns it everywhere else', r[3] === !!P('GLRIG_OWN_SHADOWS') && r[4] === !!P('GLRIG_OWN_SHADOWS'));
  const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');
  ok('the rig skips its sun march wherever celScene() says so',
     /uniform1f\(p\._u\.uSunCast,\s*celScene\(\)\s*\?\s*0\s*:\s*1\)/.test(src));
  ok('the lamp haze budget asks whether the rig RUNS, not whether it owns the sun',
     /const pooled = \(typeof glRigActive === 'function' && glRigActive\(\) && BIOME_ACTIVE\)/.test(src));
  ok('nothing still asks for the Level-1-only gate', !/celCityScene/.test(src));
}

console.log('\n== the Undercity\'s city, and only its city ==');
{
  const r = P(`(() => {
    __lv(2);
    authoredChunks = null; authoredCore = null;
    const block = (o) => Object.assign({ x: 600, y: 600, w: 180, h: 150, isBlockBuilding: true, details: [], style: 1 }, o);
    const street = block({}), office = block({ style: 0, x: 900 }), shed = block({ style: 3, x: 300 });
    const ruin = block({ x: -3000, y: 600, chunkKey: '-3,0,9', isChunkSolid: true });
    const burnt = block({ burnt: true });
    const out = {
      street: CityBuildings3D.profile(street), office: CityBuildings3D.profile(office),
      ruin: CityBuildings3D.profile(ruin), burnt: CityBuildings3D.profile(burnt),
      riseStreet: buildingRise(street), riseShed: buildingRise(shed), riseRuin: buildingRise(ruin),
      foot: Math.min(street.w, street.h)
    };
    // The same ruin anywhere else gets the generic height: compare against Level 4.
    __lv(4); const twin = block({ x: -3000, y: 600, chunkKey: '-3,0,9', isChunkSolid: true }); out.riseTwin = buildingRise(twin);
    __lv(2);
    // A chunk solid on CITY_DENSE ground is city.
    authoredChunks = new Set(['0,0']);
    out.dense = CityBuildings3D.profile(block({ chunkKey: '0,0,3', isChunkSolid: true }));
    authoredChunks = null;
    // Every street block in the authored map lands in storeys.
    buildings = []; legacyGenerateMap();
    const blocks = buildings.filter(b => b.isBlockBuilding);
    out.n = blocks.length;
    out.kit = blocks.filter(b => CityBuildings3D.profile(b)).length;
    // Two storeys is 27 less its jitter, or as much as a narrow footprint allows.
    out.tall = blocks.filter(b => buildingRise(b) >= Math.min(CITY_RISE_STOREY[0] - 1.5, Math.min(b.w, b.h) * 0.28) - 0.01).length;
    out.maxRise = Math.max(...blocks.map(b => buildingRise(b)));
    out.reach = out.maxRise * (MASS_LEAN + MASS_TILT);
    return out;
  })()`);
  ok('an authored Undercity block takes the roof kit', !!r.street && !!r.office, r.street + ' / ' + r.office);
  ok('a forest ruin does not -- it stays a roofless shell', r.ruin === null);
  ok('nor does a burnt shell', r.burnt === null);
  ok('a block the streamer builds on CITY_DENSE ground does', !!r.dense, r.dense);
  ok('a street block stands in storeys', r.riseStreet >= 25.5 && r.riseStreet <= Math.min(P('CITY_RISE_TOP'), r.foot * 0.28) + 0.01,
     r.riseStreet.toFixed(1));
  ok('a warehouse stays a shed (two storeys at most)', r.riseShed <= P('CITY_RISE_STOREY[0]') + 1.6, r.riseShed.toFixed(1));
  ok('a ruin keeps exactly the height it had', Math.abs(r.riseRuin - r.riseTwin) < 1e-9, r.riseRuin.toFixed(2) + ' vs ' + r.riseTwin.toFixed(2));
  ok('every authored street block is drawn by the kit', r.n > 10 && r.kit === r.n, r.kit + '/' + r.n);
  ok('and stands at least two storeys', r.tall === r.n, r.tall + '/' + r.n);
  ok('the tallest wall still clears the alley', r.reach < P('BUILDING_GAP_MIN'), r.reach.toFixed(1) + ' < ' + P('BUILDING_GAP_MIN'));
}

console.log('\n== the Undercity is the same kit in its own materials ==');
{
  const r = P(`(() => {
    // One height for both, so any difference is the materials.
    const b = { x: 600, y: 600, w: 180, h: 150, isBlockBuilding: true, details: [], style: 1, _rise: 33 };
    const lum = (p) => { let s = 0; for (const f of p.faces) s += f.color[0] * .3 + f.color[1] * .59 + f.color[2] * .11; return s / p.faces.length; };
    __lv(1); const p1 = CityBuildings3D.plan(Object.assign({}, b));
    __lv(2); const p2 = CityBuildings3D.plan(Object.assign({}, b));
    const wall1 = p1.faces.find(f => f.kind === 'wall').color;
    return { r1: p1.roofs, r2: p2.roofs, lit1: p1.lit, lit2: p2.lit, l1: lum(p1), l2: lum(p2),
      faces1: p1.faces.length, faces2: p2.faces.length, wall1: wall1.join(',') };
  })()`);
  ok('Stick City keeps its palette', r.r1 === 'STICK_CITY');
  ok('the Undercity paints its own', r.r2 === 'UNDERCITY');
  ok('same geometry: the kit is shared, only the materials change', r.faces1 === r.faces2, r.faces1 + ' faces');
  ok('and the Undercity stays the darker city', r.l2 < r.l1 * 0.85, r.l2.toFixed(1) + ' vs ' + r.l1.toFixed(1));
  // Stick City's soot-brick wall is exactly what it was before the table.
  const L = [151, 92, 70], l = L[0] * .3 + L[1] * .59 + L[2] * .11, q = v => Math.max(0, Math.min(255, Math.round(l + (v - l) * 1.5)));
  ok('Stick City\'s brick wall is unchanged', r.wall1 === [q(L[0]), q(L[1]), q(L[2])].join(','), r.wall1);
  ok('the blackout: far fewer windows lit after dark', r.lit2 > r.lit1 * 2, r.lit1 + ' vs ' + r.lit2);
}

console.log('\n== shadow hue ==');
{
  const r = P(`(() => {
    authoredChunks = new Set(['0,0']);
    __lv(1); const a = celShadowRGB().slice();
    __lv(2); const street = celShadowRGB(600, 600).slice(), forest = celShadowRGB(-3000, 600).slice(), none = celShadowRGB().slice();
    authoredChunks = null;
    return { a, street, forest, none, sky1: BIOMES[1].sky, sky2: BIOMES[2].sky, teal: CEL_FOREST_SHADE };
  })()`);
  const slate = s => [Math.round(s[0] * .30), Math.round(s[1] * .30), Math.round(s[2] * .34)].join(',');
  ok('Stick City\'s shadows are its sky at a third, as ever', r.a.join(',') === slate(r.sky1), r.a.join(','));
  ok('the Undercity\'s streets take their own sky the same way', r.street.join(',') === slate(r.sky2), r.street.join(','));
  ok('its forest keeps the teal the forest floor was always shaded in', r.forest.join(',') === r.teal.join(','), r.forest.join(','));
  ok('with no position given it falls back to the sky', r.none.join(',') === slate(r.sky2));
}

console.log('\n== a tree casts its crown ==');
const fir = `{ t: 'PINE', forestSpecies: 'DOUGLAS_FIR', forestRegion: 'TIMBER', x: 0, y: 0, s: 1, r: 0.3, c: 0.4 }`;
{
  const r = P(`(() => {
    __lv(2); __day(15); frameCount++;
    __fills.length = 0;
    const d = ${fir}, e = Object.assign(${fir}, { x: 60, y: 30 });
    celTreeShadowBegin();
    const took = celTreeShadow(d, false); celTreeShadow(e, false);
    celTreeShadowFlush();
    const fills = __fills.length, path = fills ? __fills[0].path : null, style = fills ? __fills[0].style : '';
    const cm = forestCanopyMass(d), R = cm[0] * d.s, kT = shadowLengthScale() * CEL_TREE_REACH;
    const L = Math.hypot(LIGHT_DX, LIGHT_DY), ux = LIGHT_DX / L, uy = LIGHT_DY / L;
    let wound = true, minAlong = Infinity, maxAlong = -Infinity, nearRoot = Infinity, area = 0;
    const own = path ? path.polys.slice(0, path.polys.length / 2) : [];
    for (const poly of own) {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
        const along = p[0] * ux + p[1] * uy;
        minAlong = Math.min(minAlong, along); maxAlong = Math.max(maxAlong, along);
        nearRoot = Math.min(nearRoot, Math.hypot(p[0], p[1]));
      }
      if (!(a > 0)) wound = false;
      area += a / 2;
    }
    // The same tree again: the cached path, not a rebuild.
    const rec0 = _celTreePaths.get(d).path;
    frameCount++; celTreeShadowBegin(); celTreeShadow(d, false); celTreeShadowFlush();
    const reused = _celTreePaths.get(d).path === rec0;
    __day(17); frameCount++; celTreeShadowBegin(); celTreeShadow(d, false); celTreeShadowFlush();
    const rebuilt = _celTreePaths.get(d).path !== rec0;
    __day(15);
    return { took, fills, polys: own.length, wound, minAlong, maxAlong, nearRoot, area,
      topFar: R * 0.98 * kT * L, crownR: cm[1] * 0.5, style, reused, rebuilt, n: celTreeCount() };
  })()`);
  ok('in a cel level a tree casts its own shadow', r.took === true);
  ok('every tree in view goes down in ONE fill, so overlaps are not shaded twice', r.fills === 1, r.fills + ' fill(s)');
  ok('the shadow is the bole and the swept crown, two polygons', r.polys === 2, r.polys + ' polygons');
  ok('every piece is wound the same way, so the nonzero fill is their union', r.wound);
  ok('it starts at the foot of the tree', r.nearRoot < 8, r.nearRoot.toFixed(2));
  ok('and runs out along the sun to the highest bough, plus the crown', r.maxAlong > r.topFar && r.maxAlong < r.topFar + r.crownR * 1.05,
     r.maxAlong.toFixed(0) + ' vs ' + r.topFar.toFixed(0) + '+' + r.crownR.toFixed(0));
  ok('nothing lies up-sun of the crown', r.minAlong > -r.crownR, r.minAlong.toFixed(0));
  ok('in the forest\'s own teal', /^rgba\(14,35,36,/.test(r.style), r.style);
  ok('the path is cached while the sun stands still', r.reused);
  ok('and rebuilt when it moves', r.rebuilt);
}
{
  const r = P(`(() => {
    __fills.length = 0;
    __lv(2); __day(23); frameCount++;
    celTreeShadowBegin(); const night = celTreeShadow(${fir}, false); celTreeShadowFlush();
    const nightFills = __fills.length;
    __day(15); __lv(4); frameCount++;
    const other = celTreeShadow(${fir}, false);
    __lv(2);
    return { night, nightFills, other };
  })()`);
  ok('at night there is nothing to cast, and the old shadow stays away too', r.night === true && r.nightFills === 0);
  ok('outside a cel level the tree keeps its old shadow', r.other === false);
}
{
  const r = P(`(() => {
    __lv(2); __day(15); frameCount++; __fills.length = 0;
    const far = Object.assign(${fir}, { x: 4000, y: 4000 });
    celTreeShadowBegin(); const took = celTreeShadow(far, false); celTreeShadowFlush();
    return { took, fills: __fills.length, crowns: celTreeCount() };
  })()`);
  ok('a shadow lying wholly off screen is not filled', r.took && r.fills === 0);
  ok('but its crown still shades any figure standing in it', r.crowns === 1);
}
{
  const r = P(`(() => {
    __lv(1); __day(15); frameCount++; __fills.length = 0;
    celTreeShadowBegin(); const took = celTreeShadow({ t: 'TREE', x: 0, y: 0, s: 1, r: 0, c: 0.3 }, false);
    const snag = celTreeShadow({ t: 'SNAG', x: 300, y: 0, s: 1, r: 0, c: 0.3 }, false);
    celTreeShadowFlush();
    return { took, snag, fills: __fills.length, crowns: celTreeCount(), style: __fills[0] && __fills[0].style };
  })()`);
  ok('a park tree in Stick City casts its crown the same way', r.took && r.fills === 1, JSON.stringify(r));
  ok('a bare snag casts, but has no crown to shade a figure', r.snag && r.crowns === 1);
  ok('in the city\'s slate', /^rgba\(29,34,44,/.test(r.style || ''), r.style);
}

console.log('\n== a figure in a crown\'s shadow is shaded ==');
{
  const r = P(`(() => {
    __lv(2); __day(15); frameCount++; __fills.length = 0;
    authoredChunks = null; activeBuildings = []; invalidateColIndex();
    const d = ${fir};
    celTreeShadowBegin(); celTreeShadow(d, false); celTreeShadowFlush();
    const cm = forestCanopyMass(d), R = cm[0], SL = shadowLengthScale(), kT = SL * CEL_TREE_REACH, zm = R * 0.8;
    const mid = { x: LIGHT_DX * kT * zm, y: LIGHT_DY * kT * zm };
    const out = {
      under: celTreeShadeAt(mid.x, mid.y, SL), root: celTreeShadeAt(0, 0, SL),
      upsun: celTreeShadeAt(-LIGHT_DX * 140, -LIGHT_DY * 140, SL), far: celTreeShadeAt(900, -900, SL),
      leaf: CEL_TREE_SHADE
    };
    const fig = { x: mid.x, y: mid.y, isPlayer: false };
    out.fig = celFigureShade(fig).feet;
    out.sun = celFigureShade({ x: -LIGHT_DX * 160, y: -LIGHT_DY * 160 }).feet;
    // The shader's test, done in JS against the descriptor the figure is drawn
    // with, must agree with the CPU's at every ground point: the painted shadow
    // and the shade on the figure are one question.
    const zs = CEL_FIGURE_H / PLAYER3D_STAND_Z, k = SL * CEL_SHADOW_REACH, sL = 0.6;
    const D = _celShadeDesc, n = celFigureShadeTrees(fig, D, sL, zs, k);
    const ux = -LIGHT_DX, uy = -LIGHT_DY, dz = sL / (k * zs), soft = 5 / sL;
    const shader = (wx, wy) => {
      const Px = (wx - fig.x) / sL, Py = (wy - fig.y) / sL; let s = 0;
      for (let i = 0; i < 6; i++) {
        const sp0 = D.spans[i * 2], sp1 = D.spans[i * 2 + 1]; if (sp1 <= 0) continue;
        const cx = D.discs[i * 4], cy = D.discs[i * 4 + 1], rx = D.discs[i * 4 + 2], ry = D.discs[i * 4 + 3];
        const ax = (Px + ux * sp0 / dz - cx) / rx, ay = (Py + uy * sp0 / dz - cy) / ry;
        const bx = (Px + ux * sp1 / dz - cx) / rx, by = (Py + uy * sp1 / dz - cy) / ry;
        const ex = bx - ax, ey = by - ay, t = Math.max(0, Math.min(1, -(ax * ex + ay * ey) / Math.max(ex * ex + ey * ey, 1e-6)));
        const rr = Math.hypot(ax + ex * t, ay + ey * t);
        s = Math.max(s, Math.max(0, Math.min(1, (1 - rr) * Math.min(rx, ry) / soft + 0.5)) * D.leaf);
      }
      return s;
    };
    let worst = 0, samples = 0;
    for (let gx = -120; gx <= 320; gx += 20) for (let gy = -120; gy <= 320; gy += 20) {
      worst = Math.max(worst, Math.abs(shader(gx, gy) - celTreeShadeAt(gx, gy, SL))); samples++;
    }
    out.n = n; out.worst = worst; out.samples = samples;
    return out;
  })()`);
  ok('the middle of a crown\'s shadow is shaded', r.under > r.leaf * 0.95, r.under.toFixed(3));
  ok('the foot of the tree is in the sun (the shadow falls away from it)', r.root < 0.05, r.root.toFixed(3));
  ok('up-sun of the tree is in the sun', r.upsun === 0);
  ok('and so is the far side of the clearing', r.far === 0);
  ok('a figure standing in it darkens', r.fig > r.leaf * 0.9, r.fig.toFixed(3));
  ok('a figure in the sun does not', r.sun < 0.05, r.sun.toFixed(3));
  ok('the crown is handed to the figure\'s shader', r.n === 1, r.n);
  ok('and the shader\'s test agrees with the painted shadow everywhere', r.worst < 0.02,
     'worst ' + r.worst.toFixed(4) + ' over ' + r.samples + ' points');
}

console.log('\n== the figure shader carries the crowns ==');
{
  const src = fs.readFileSync(__dirname + '/../game.js', 'utf8');
  for (const u of ['uShadeDisc', 'uShadeSpan', 'uShadeLeaf']) {
    ok(u + ' is declared by the figure shader', new RegExp('uniform\\s+\\w+\\s+' + u + '\\b').test(src));
    ok(u + ' is looked up', new RegExp("'" + u + "'").test(src));
    ok(u + ' is written', new RegExp('uniforms\\.' + u + '\\b').test(src));
  }
  ok('an actor drawn with no shade turns every crown off', /noShadeSpans=new Float32Array\(\[0,-1e6/.test(src));
}

// -- the soft layer -----------------------------------------------------------
//
// Buildings and trees cast into one screen-space layer at the figures' own
// cast resolution, softened by the figures' own four taps and laid down once.
// A recording canvas stands in for the browser's: every fill, clear and blit
// is logged with the transform and alpha it was made under.
console.log('\n== building and tree shadows are drawn the way a figure\'s is ==');
probe(`
  __layerLog = []; __cvN = 0;
  __mkCtx = function (name, cv) {
    return { name: name, canvas: cv, fillStyle: '#000000', globalAlpha: 1, imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low', T: [1, 0, 0, 1, 0, 0], _s: [],
      setTransform(a, b, c, d, e, f) { this.T = [a, b, c, d, e, f]; },
      getTransform() { const t = this.T; return { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] }; },
      save() { this._s.push([this.T.slice(), this.fillStyle, this.globalAlpha, this.imageSmoothingQuality]); },
      restore() { const s = this._s.pop(); this.T = s[0]; this.fillStyle = s[1]; this.globalAlpha = s[2]; this.imageSmoothingQuality = s[3]; },
      clearRect(x, y, w, h) { __layerLog.push({ ctx: name, op: 'clear', r: [x, y, w, h] }); },
      fill(p) { __layerLog.push({ ctx: name, op: 'fill', style: this.fillStyle, T: this.T.slice(), path: !!p }); },
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, translate() {},
      drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
        __layerLog.push({ ctx: name, op: 'draw', src: img.__name, a: this.globalAlpha, T: this.T.slice(),
          smooth: this.imageSmoothingEnabled, q: this.imageSmoothingQuality, s: [sx, sy, sw, sh], d: [dx, dy, dw, dh] });
      } };
  };
  document.createElement = function () {
    const cv = { width: 0, height: 0, __name: 'cv' + (__cvN++) };
    cv.getContext = function () { if (!this._c) this._c = __mkCtx(this.__name, this); return this._c; };
    return cv;
  };
  // The main canvas: a phone at density 2, the camera at zoom 0.65.
  __mainCv = { width: 824, height: 1784, __name: 'main' };
  __main = __mkCtx('main', __mainCv);
  __cam = function (cx, cy) {
    zoom = 0.65; const pd = 2;
    camX = cx - 412 / zoom * 0.5; camY = cy - 892 / zoom * 0.5;
    viewLeft = camX; viewRight = camX + 412 / zoom; viewTop = camY; viewBottom = camY + 892 / zoom;
    __main.T = [pd * zoom, 0, 0, pd * zoom, -camX * pd * zoom, -camY * pd * zoom];
  };
  __frame = function (cast) {
    frameCount++; __layerLog.length = 0; drawingContext = __main;
    drawBiomeShadows();
    celTreeShadowBegin();
    for (const d of cast) celTreeShadow(d, false);
    celTreeShadowFlush();
    return __layerLog.slice();
  };
`);
{
  const r = P(`(() => {
    __lv(1); __day(15); authoredChunks = null;
    const glWas = glRigActive; glRigActive = () => false;
    try {
      __cam(600, 600);
      const blk = { x: 600, y: 560, w: 180, h: 150, isBlockBuilding: true, details: [], style: 1 };
      activeBuildings = [blk]; invalidateColIndex();
      const was = __main.fillStyle;
      const log = __frame([{ t: 'TREE', x: 760, y: 700, s: 1.2, r: 0, c: 0.3 }]);
      const T = __main.T, S = CEL_SHADOW_RES;
      const fills = log.filter(e => e.op === 'fill');
      const mainFills = fills.filter(e => e.ctx === 'main');
      const layerFills = fills.filter(e => e.ctx !== 'main');
      const mainDraws = log.filter(e => e.ctx === 'main' && e.op === 'draw');
      const taps = log.filter(e => e.ctx !== 'main' && e.op === 'draw');
      const A = celShadowAlpha();
      const plan = CityBuildings3D.project(blk), rox = LIGHT_DX * shadowLengthScale() * CEL_SHADOW_REACH;
      const roy = LIGHT_DY * shadowLengthScale() * CEL_SHADOW_REACH;
      // The far corner of the roof's shadow, in device pixels.
      const fx = (blk.x + Math.sign(rox) * blk.w / 2 + rox * plan.maxZ) * T[0] + T[4];
      const fy = (blk.y + Math.sign(roy) * blk.h / 2 + roy * plan.maxZ) * T[3] + T[5];
      return { layerFills: layerFills.length, mainFills: mainFills.length, opaque: layerFills.every(e => /^rgb\\(/.test(e.style)),
        layerT: layerFills.map(e => e.T), mainT: T, S, mainDraws, taps, A, styleKept: __main.fillStyle === was, fx, fy,
        styles: layerFills.map(e => e.style) };
    } finally { glRigActive = glWas; activeBuildings = []; }
  })()`);
  ok('every building and tree shadow goes into the layer, none straight onto the screen',
     r.layerFills >= 2 && r.mainFills === 0, r.layerFills + ' into the layer, ' + r.mainFills + ' onto the screen');
  ok('each is filled opaque, in its own colour', r.opaque, r.styles.join(' '));
  ok('the layer sits at the figures\' cast resolution under the camera',
     r.S === 0.4 && r.layerT.every(t => Math.abs(t[0] - r.mainT[0] * r.S) < 1e-9 && Math.abs(t[3] - r.mainT[3] * r.S) < 1e-9 &&
       Math.abs(t[4] - r.mainT[4] * r.S) < 1e-9 && Math.abs(t[5] - r.mainT[5] * r.S) < 1e-9), JSON.stringify(r.layerT[0]));
  const tapA = r.taps.length ? r.taps[0].a : 0, off = r.taps.map(t => [t.d[0] - t.s[0], t.d[1] - t.s[1]]);
  ok('softened by the cast\'s own four taps, 0.85 of a texel apart', r.taps.length === 4 &&
     off.every(o => Math.abs(Math.abs(o[0]) - 0.85) < 1e-9 && Math.abs(Math.abs(o[1]) - 0.85) < 1e-9) &&
     new Set(off.map(o => o.join(','))).size === 4, JSON.stringify(off));
  ok('whose alphas composite to exactly the figures\' shadow alpha',
     r.taps.every(t => t.a === tapA) && Math.abs(1 - Math.pow(1 - tapA, 4) - r.A) < 1e-9, tapA.toFixed(4) + ' -> ' + r.A.toFixed(4));
  ok('laid on the screen in ONE blit, so overlapping shadows are shaded once', r.mainDraws.length === 1, r.mainDraws.length);
  const m = r.mainDraws[0] || { s: [0, 0, 0, 0], d: [0, 0, 0, 0], T: [], a: 0 };
  ok('stretched back up from the layer to device pixels, smoothed',
     m.T.join(',') === '1,0,0,1,0,0' && m.a === 1 && m.smooth && m.q === 'high' &&
     m.d.every((v, i) => Math.abs(v - m.s[i] / r.S) < 1e-9), JSON.stringify({ s: m.s, d: m.d }));
  ok('and only as much of it as the shadows touched, which reaches the roof\'s far corner',
     m.d[0] <= r.fx && m.d[0] + m.d[2] >= r.fx && m.d[1] <= r.fy && m.d[1] + m.d[3] >= r.fy && m.d[2] < 824,
     JSON.stringify(m.d.map(v => Math.round(v))) + ' corner ' + Math.round(r.fx) + ',' + Math.round(r.fy));
  ok('the screen\'s fill style is put back (p5 caches it)', r.styleKept);
}
{
  const r = P(`(() => {
    const glWas = glRigActive; glRigActive = () => false;
    try {
      const blk = { x: 600, y: 560, w: 180, h: 150, isBlockBuilding: true, details: [], style: 1 };
      const tree = { t: 'PINE', forestSpecies: 'DOUGLAS_FIR', forestRegion: 'TIMBER', x: -3000, y: 600, s: 1, r: 0.3, c: 0.4 };
      __lv(1); __day(23); __cam(600, 600); activeBuildings = [blk]; invalidateColIndex();
      const night = __frame([]).filter(e => e.ctx === 'main' && e.op === 'draw').length;
      __lv(2); __day(15); authoredChunks = null; __cam(-3000, 700); activeBuildings = [];
      const forest = __frame([tree]);
      const teal = forest.filter(e => e.op === 'fill' && e.ctx !== 'main').map(e => e.style);
      __lv(4); __cam(600, 600); activeBuildings = [blk];
      const other = __frame([]).filter(e => e.ctx !== 'main').length;
      return { night, teal, forestDraws: forest.filter(e => e.ctx === 'main' && e.op === 'draw').length, other };
    } finally { glRigActive = glWas; activeBuildings = []; }
  })()`);
  ok('at night nothing is laid down', r.night === 0, r.night);
  ok('the Undercity\'s forest crowns go in in the forest\'s teal', r.teal.length >= 1 && r.teal.every(s => s === 'rgb(14,35,36)'),
     r.teal.join(' '));
  ok('and the forest is one blit too', r.forestDraws === 1, r.forestDraws);
  ok('outside a cel level the layer is never touched', r.other === 0, r.other);
}

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
