// The sun, by season and latitude (SEASONS AND LATITUDE in game.js).
//
// Where the sun is decides where every shadow in Sectors 1-5 points and how far
// it throws, so most of what can go wrong here goes wrong silently: a sign
// error puts the Antarctic noon sun in the south, a stale cache keeps a season
// the setter changed, a hull written for one quadrant draws a bow-tie in
// another, and a cull that ignores the sun drops a long shadow at the edge of
// the screen. Each is pinned here by what it should produce.
//
//   node tools/check-solar.js

const { probe, calls } = require('./harness.js');
const P = (src) => probe('(' + src + ')');

let fails = 0, checks = 0;
const ok = (n, c, x) => {
  checks++;
  if (c) console.log('  ok   ' + n + (x !== undefined ? '  ' + x : ''));
  else { fails++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + x : '')); }
};
const DEG = Math.PI / 180;

probe(`
  BIOME_ACTIVE = true; currentLevel = 1; currentBiome = 1; frameCount = 500;
  if (!player) player = { x: 0, y: 0 };
  player.x = 0; player.y = 0;
  __day = function (h) { worldTimeMs = h / 24 * DAY_MS; updateSunVector(); };
  __at = function (b, season, h, y) {
    currentBiome = b; player.y = y || 0; setSeason(season); __day(h);
    return { dx: LIGHT_DX, dy: LIGHT_DY, len: shadowLengthScale(), el: SUN.elev, fade: SUN.fade,
             den: shadowDensity(), solar: SUN.solar, lat: SUN.lat, decl: SUN.decl, az: SUN.azimuth };
  };
`);
const at = (b, season, h, y) => P(`__at(${b}, ${JSON.stringify(season)}, ${h}, ${y || 0})`);

console.log('== the season ==');
ok('a named season sits on its solstice or equinox',
   P("setSeason('SPRING')") === 0 && P("setSeason('summer')") === 0.25 &&
   P("setSeason('AUTUMN')") === 0.5 && P("setSeason('WINTER')") === 0.75);
ok('setSeasonDay(79) is the March equinox, 172 the June solstice',
   Math.abs(P('setSeasonDay(79)')) < 1e-9 && Math.abs(P('setSeasonDay(172)') - 93 / 365) < 1e-9);
P('setSeason(0.1)');
ok('advanceSeason counts in-game days', Math.abs(P('advanceSeason(7)') - (0.1 + 7 / 28)) < 1e-9,
   'seven days is a quarter of a SEASON_YEAR_DAYS = ' + P('SEASON_YEAR_DAYS') + ' year');
ok('and wraps either way', Math.abs(P('setSeason(1.25)') - 0.25) < 1e-9 && Math.abs(P('setSeason(-0.25)') - 0.75) < 1e-9);
ok('the declination swings between the tropics',
   Math.abs(at(1, 'SUMMER', 12).decl / DEG - 23.44) < 1e-6 && Math.abs(at(1, 'WINTER', 12).decl / DEG + 23.44) < 1e-6 &&
   Math.abs(at(1, 'SPRING', 12).decl) < 1e-9);
// The clock turns the year; a lock holds it.
probe(`setSeason(0.2); lockSeason(false); isPaused = false; started = true; inWorldBuildingMenu = false; inTravelMenu = false;
       clockLastMs = 1000; millis = () => 1016;`);
probe('updateWorldClock();');
const adv = P('seasonProgress') - 0.2, want = 16 / (P('DAY_MS') * 28);
ok('updateWorldClock() advances the season with the day', Math.abs(adv - want) < 1e-12, adv.toExponential(3));
probe('lockSeason(true); clockLastMs = 1000; updateWorldClock();');
ok('lockSeason(true) holds it while the clock runs', P('seasonProgress') === 0.2 + adv);
probe('seedWorldClock();');
ok('and a new run does not reseed a locked season', P('seasonProgress') === 0.2 + adv);
probe('lockSeason(false); seedWorldClock();');
ok('seasonName follows the hemisphere',
   P("seasonName(0.25, 48)") === 'SUMMER' && P("seasonName(0.25, -70)") === 'WINTER' &&
   P("seasonName(0.75, -5)") === 'SUMMER' && P("seasonName(0.1, 30)") === 'SPRING');

console.log('\n== latitude ==');
ok('each sector has the latitude the map gives it',
   P('solarLatitude(1, 0)') === 48 && P('solarLatitude(2, 0)') === 38 && P('solarLatitude(3, 0)') === 22 &&
   P('solarLatitude(4, 0)') === -5 && P('solarLatitude(5, 0)') === -70);
ok('north edge to south edge as the player walks south',
   P('solarLatitude(1, -1e9)') === 49 && P('solarLatitude(1, 1e9)') === 47 &&
   P('solarLatitude(5, -1e9)') === -65 && P('solarLatitude(5, 1e9)') === -75 &&
   P('solarLatitude(4, -1e9)') === 0 && P('solarLatitude(4, 1e9)') === -10);
{
  let worst = 0;
  for (let y = -40000; y < 40000; y += 50)
    worst = Math.max(worst, Math.abs(P(`solarLatitude(4, ${y + 50}) - solarLatitude(4, ${y})`)));
  ok('continuously, a fraction of a degree per kilometre', worst < 0.02, (worst * 20).toFixed(3) + ' deg per km at most');
}
ok('the alien worlds have none', P('solarLatitude(6, 0)') === null && P('solarLatitude(7, 0)') === null);
ok('the player\'s position drives the sun', Math.abs(at(4, 'SPRING', 12, -1e9).el - at(4, 'SPRING', 12, 1e9).el) > 9 * DEG);

console.log('\n== where the sun is ==');
// Noon elevation is 90 - |latitude - declination| everywhere it is above the horizon.
{
  let worst = 0;
  for (const b of [1, 2, 3, 4, 5]) for (const s of ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER']) {
    const r = at(b, s, 12), want = 90 - Math.abs(r.lat / DEG - r.decl / DEG);
    worst = Math.max(worst, Math.abs(r.el / DEG - want));
  }
  ok('noon elevation is 90 - |lat - decl| in every sector and season', worst < 1e-6, worst.toExponential(2));
}
ok('Stick City at noon: 42 deg at the equinox, 65 in summer, 19 in winter',
   Math.abs(at(1, 'SPRING', 12).el / DEG - 42) < 0.01 && Math.abs(at(1, 'SUMMER', 12).el / DEG - 65.44) < 0.01 &&
   Math.abs(at(1, 'WINTER', 12).el / DEG - 18.56) < 0.01);
ok('at an equinox the sun sets at 18:00 in every sector',
   [1, 2, 3, 4, 5].every(b => Math.abs(at(b, 'SPRING', 18).el) < 1e-6 && Math.abs(at(b, 'SPRING', 6).el) < 1e-6));
ok('the White Silence has a polar night in June and a midnight sun in December',
   at(5, 'SUMMER', 12).el < 0 && at(5, 'WINTER', 0).el > 0);

console.log('\n== which way shadows fall ==');
ok('north of the tropics a noon shadow points north (up the screen), all year',
   [1, 2].every(b => ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'].every(s => at(b, s, 12).dy < -0.999)));
ok('in Antarctica it points south (down the screen), whenever the sun is up',
   ['SPRING', 'AUTUMN', 'WINTER'].every(s => at(5, s, 12).dy > 0.999));
ok('on the Tropic of Cancer it swings south at midsummer and north in winter',
   at(3, 'SUMMER', 12).dy > 0.999 && at(3, 'WINTER', 12).dy < -0.999);
ok('at the equator it follows the sun across the line',
   at(4, 'SPRING', 12).dy > 0.999 && at(4, 'WINTER', 12).dy < -0.999 && at(4, 'SUMMER', 12).dy > 0.999);
ok('mornings throw west (left), evenings east (right)',
   [1, 2, 3, 4, 5].every(b => at(b, 'AUTUMN', 8).dx < -0.5 && at(b, 'AUTUMN', 16).dx > 0.5));
ok('the direction is a unit vector',
   [[1, 'SUMMER', 7], [5, 'WINTER', 23], [3, 'SPRING', 15.5]].every(a => { const r = at(...a); return Math.abs(Math.hypot(r.dx, r.dy) - 1) < 1e-9; }));
{
  // Through a day the bearing must move smoothly: no flips except where the sun
  // passes within a few degrees of the zenith, where real shadows spin too.
  let worst = 0, where = '';
  for (const b of [1, 2, 3, 5]) for (const s of ['SPRING', 'SUMMER', 'WINTER']) {
    let prev = at(b, s, 4);
    for (let m = 4 * 60 + 1; m <= 20 * 60; m++) {
      const r = at(b, s, m / 60);
      if (r.el > 0 && prev.el > 0 && r.el < 80 * DEG) {
        const d = Math.acos(Math.max(-1, Math.min(1, r.dx * prev.dx + r.dy * prev.dy)));
        if (d > worst) { worst = d; where = b + ' ' + s + ' ' + (m / 60).toFixed(2); }
      }
      prev = r;
    }
  }
  ok('the bearing sweeps smoothly through the day', worst < 1.2 * DEG, (worst / DEG).toFixed(3) + ' deg per game minute at most (' + where + ')');
}

console.log('\n== how far they throw ==');
{
  let worst = 0;
  for (const b of [1, 2, 3, 4, 5]) for (const s of ['SPRING', 'SUMMER', 'WINTER']) for (let h = 5; h <= 19; h += 0.5) {
    const r = at(b, s, h);
    const want = r.el > 0 ? Math.min(4.5, Math.max(0.25, 1 / Math.tan(r.el))) : 4.5;
    worst = Math.max(worst, Math.abs(r.len - want));
  }
  ok('shadowLengthScale() is 1/tan(elevation), clamped to 0.25..4.5', worst < 1e-9, worst.toExponential(2));
}
ok('an overhead sun holds at the floor', at(3, 'SUMMER', 12).len === 0.25, 'Dry Gulch, midsummer noon');
ok('a horizon sun holds at the ceiling', at(1, 'WINTER', 8.5).len === 4.5 && at(1, 'SPRING', 6.2).len === 4.5);
ok('a winter noon throws ~6x a summer one at Stick City',
   at(1, 'WINTER', 12).len / at(1, 'SUMMER', 12).len > 5.5, (at(1, 'WINTER', 12).len / at(1, 'SUMMER', 12).len).toFixed(2) + 'x');
ok('cloud fades a shadow but does not move the sun',
   (() => { const a = at(2, 'SPRING', 10); probe('isRaining = true;'); const b = at(2, 'SPRING', 10); probe('isRaining = false;');
            return a.len === b.len && a.dx === b.dx && b.den < a.den; })());

console.log('\n== sunrise and sunset ==');
ok('no shadow with the sun below the horizon, whatever the clock says',
   at(1, 'WINTER', 7.5).el < 0 && at(1, 'WINTER', 7.5).den === 0 && at(5, 'SUMMER', 12).den === 0,
   'Stick City 07:30 in December; the Antarctic polar night at noon');
{
  // Equinox dusk at Stick City, a minute at a time: down to zero by sunset, no step.
  let prev = at(1, 'SPRING', 17), worst = 0, mono = true;
  for (let m = 17 * 60 + 1; m <= 18 * 60; m++) {
    const r = at(1, 'SPRING', m / 60);
    worst = Math.max(worst, Math.abs(r.den - prev.den));
    if (r.den > prev.den + 1e-12) mono = false;
    prev = r;
  }
  ok('shadows fade out over the last few degrees, without a step', mono && prev.den < 1e-9 && worst < 0.06,
     'largest change ' + worst.toFixed(3) + ' per game minute');
}
ok('the fade is complete from 0.05 rad up', at(1, 'SPRING', 9).fade === 1 &&
   (() => { const r = at(1, 'SPRING', 17.86); return r.el > 0 && r.el < 0.05 && r.fade > 0 && r.fade < 1; })());

console.log('\n== day length ==');
{
  const dh = (b, season) => P(`Array.from(solarDayHours(solarLatitude(${b}, 0), setSeason(${JSON.stringify(season)})))`);
  const near = (a, b, e) => Math.abs(a - b) < e;
  const jun = dh(1, 'SUMMER'), dec = dh(1, 'WINTER');
  ok('Stick City: sunrise about 04:05 and sunset 19:55 in June, 07:55 and 16:05 in December',
     near(jun[0], 4.08, 0.05) && near(jun[1], 19.92, 0.05) && near(dec[0], 7.92, 0.05) && near(dec[1], 16.08, 0.05),
     jun.map(v => v.toFixed(2)).join('-') + ', ' + dec.map(v => v.toFixed(2)).join('-'));
  ok('at an equinox every sector has the 06:00 -> 18:00 day', [1, 2, 3, 4, 5].every(b => { const d = dh(b, 'SPRING'); return near(d[0], 6, 1e-6) && near(d[1], 18, 1e-6); }));
  ok('the Green Line keeps close to twelve hours all year', ['SUMMER', 'WINTER'].every(se => { const d = dh(4, se); return near(d[1] - d[0], 12, 0.6); }));
  ok('the White Silence: a polar night in June, a midnight sun in December',
     JSON.stringify(dh(5, 'SUMMER')) === '[12,12]' && JSON.stringify(dh(5, 'WINTER')) === '[0,24]');
  const day = (b, se, h) => { at(b, se, h); return P('daylight()'); };
  ok('daylight() follows the sun: dark at 07:00 in a Stick City December, light at 05:00 in June',
     day(1, 'WINTER', 7) < 0.05 && day(1, 'WINTER', 12) === 1 && day(1, 'SUMMER', 5) > 0.5 && day(1, 'SUMMER', 21) === 0);
  ok('and the polar night stays dark at noon, the midnight sun light at midnight',
     day(5, 'SUMMER', 12) < 0.05 && day(5, 'WINTER', 0) > 0.3, 'the December midnight sun stands 3.4 degrees up');
  const edge = P('(() => { const t = 0.10 / 0.36; return t * t * (3 - 2 * t); })()');
  ok('at an equinox sunrise and sunset are as light as the old 06:00 and 18:00',
     [1, 2, 3, 4, 5].every(b => near(day(b, 'SPRING', 6), edge, 1e-6) && near(day(b, 'SPRING', 18), edge, 1e-6)));
  at(1, 'SPRING', 12);
  const h1 = P('sunHeight()');
  ok('a temperate equinox noon is nearly full noon light, a 55-degree sun is full',
     h1 > 0.8 && h1 < 0.85 && (at(2, 'SUMMER', 12), P('sunHeight()')) === 1, h1.toFixed(2) + ' at Stick City');
  ok('a Stick City winter noon is a low winter sun', (at(1, 'WINTER', 12), P('sunHeight()')) < 0.45 &&
     P('goldenHour()') === 0, P('sunHeight()').toFixed(2));
  ok('SUN.up stays the true sin(elevation), which the shading frames need',
     (at(1, 'SPRING', 12), Math.abs(P('SUN.up') - Math.cos(48 * DEG)) < 1e-9));
  const temp = (b, se) => { at(b, se, 14); return P('worldTemperatureF()'); };
  ok('the air is warmer in summer than in winter, more so further from the equator',
     temp(1, 0.33) - temp(1, 0.83) > 30 && Math.abs(temp(4, 0.33) - temp(4, 0.83)) < 5,
     'Stick City ' + Math.round(temp(1, 0.33)) + ' / ' + Math.round(temp(1, 0.83)) + ' F');
  ok('and the other way round in Antarctica', temp(5, 0.83) > temp(5, 0.33) + 30);
  // A run opens in the light of ITS day: seeded against December's sunrise and sunset.
  probe("currentBiome = 1; lockSeason(false); setSeason('WINTER'); lockSeason(true);");
  let light = 0;
  for (let i = 0; i < 300; i++) { probe('seedWorldClock(); updateSunVector();'); if (P('daylight()') > 0.9) light++; }
  probe('lockSeason(false);');
  ok('a December run still opens in daylight most of the time', light > 300 * 0.55, light + ' of 300');
}

console.log('\n== the alien worlds keep the default sun ==');
{
  let worst = 0;
  for (const b of [6, 7]) for (const s of ['SPRING', 'WINTER']) for (let h = 6; h <= 18; h += 0.5) {
    const r = at(b, s, h);
    const ts = Math.max(0, Math.min(1, (h - 6) / 12)), ang = 0.21 + (Math.PI - 0.42) * (1 - ts);
    const height = Math.max(0, Math.min(1, Math.sin((h - 6) / 12 * Math.PI)));
    const diff = P('skyDiffusion()');
    const t = Math.max(0, Math.min(1, (Math.sin((h - 6) / 12 * Math.PI) + 0.10) / 0.36));
    worst = Math.max(worst, Math.abs(r.dx - Math.cos(ang)), Math.abs(r.dy - Math.sin(ang)),
                     Math.abs(r.len - (1.55 - 0.62 * height) * (1 - 0.25 * diff)),
                     Math.abs(P('daylight()') - t * t * (3 - 2 * t)), Math.abs(P('sunHeight()') - height));
    if (r.solar) worst = 1;
  }
  ok('Sectors 6 and 7: the camera-chosen arc and the 06:00 -> 18:00 day, unchanged, in any season', worst < 1e-9, worst.toExponential(2));
}
probe('BIOME_ACTIVE = false;');
ok('and so do the closed interiors', at(1, 'WINTER', 12).solar === false);
probe('BIOME_ACTIVE = true;');

console.log('\n== cost: computed once, from plain numbers ==');
{
  at(1, 'SPRING', 10);
  const r0 = P('_skRev');
  for (let i = 0; i < 50; i++) P('shadowLengthScale() + shadowDensity() + sunFade()');
  ok('the terms are memoised on their inputs', P('_skRev') === r0);
  probe("setSeason('WINTER');");
  P('shadowLengthScale()');
  ok('and a season change from the console moves the sun at once', P('_skRev') === r0 + 1 && P('SUN.decl') < 0);
  probe('player.y = 3;'); P('shadowLengthScale()');
  ok('a few steps do not invalidate it (the latitude is quantised)', P('_skRev') === r0 + 1);
}
{
  const src = P('_skyTerms.toString()');
  const body = src.replace(/\/\/.*$/gm, '');
  ok('_skyTerms() allocates nothing', !/\bnew\b/.test(body) && !/(=|\(|,|return|:)\s*\[/.test(body) &&
     !/(=|\(|,|return)\s*\{/.test(body) && !/=>/.test(body) && !/function\s*\(/.test(body.slice(20)),
     'no new, no array or object literals, no closures');
}
ok('a bake still takes the reference sun', (() => {
  at(5, 'WINTER', 9);
  const r = P('withBakedSun(() => [LIGHT_DX, LIGHT_DY])');
  return r[0] === P('SUN_REF_DX') && r[1] === P('SUN_REF_DY') && P('LIGHT_DY') > 0 && P('LIGHT_DX') !== P('SUN_REF_DX');
})());

console.log('\n== a box\'s shadow, for any sun ==');
{
  let bad = 0;
  for (const [dx, dy] of [[30, 20], [-30, 20], [-30, -20], [30, -20], [0, 40], [0, -40], [55, 0], [-55, 0], [90, -70]]) {
    const q = P(`Array.from(rectShadowHull(0, 0, 40, 25, ${dx}, ${dy}))`);
    let area = 0, sign = 0, convex = true;
    for (let i = 0; i < 6; i++) {
      const ax = q[i * 2], ay = q[i * 2 + 1], bx = q[(i + 1) % 6 * 2], by = q[(i + 1) % 6 * 2 + 1];
      const cx = q[(i + 2) % 6 * 2], cy = q[(i + 2) % 6 * 2 + 1];
      area += ax * by - bx * ay;
      const cr = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
      if (Math.abs(cr) > 1e-9) { const sg = Math.sign(cr); if (sign && sg !== sign) convex = false; sign = sg; }
    }
    const want = 40 * 25 + Math.abs(dx) * 25 + Math.abs(dy) * 40;
    if (!convex || Math.abs(Math.abs(area) / 2 - want) > 1e-6) bad++;
  }
  ok('rectShadowHull is the convex hull in every quadrant', bad === 0, bad + ' of 9 wrong');
}

console.log('\n== culling toward the sun ==');
probe('viewLeft = 0; viewRight = 600; viewTop = 0; viewBottom = 1000;');
at(1, 'SPRING', 7);             // a long shadow thrown west (left)
ok('a caster off the sun side is kept while its shadow reaches the view',
   P('LIGHT_DX < -0.9') && P('inShadowView(780, 500, 50, 400)') === true && P('inView(780, 500, 50)') === false);
ok('and dropped when its shadow cannot', P('inShadowView(780, 500, 50, 100)') === false);
ok('the shadow side of the view is not grown', P('inShadowView(-180, 500, 50, 400)') === false);
ok('a zero reach is the plain view', P('inShadowView(640, 500, 50, 0) === inView(640, 500, 50)') &&
   P('inShadowView(660, 500, 50, 0) === inView(660, 500, 50)'));
ok('maxShadowLength() covers the tallest crown at the lowest sun',
   P('maxShadowLength()') >= 136 * 1.3 * 1.35 * 1.15 * 4.5 - 1e-6, P('maxShadowLength()').toFixed(0) + ' units at dawn');
{
  // drawBiomeShadows(): a building off the right edge at sunrise, a building off
  // the left edge -- only the first may cast. The 2D pass owns the shadows in a
  // non-cel sector without the rig.
  probe(`currentLevel = 3; currentBiome = 3;
    __b = (x) => ({ x, y: 500, w: 60, h: 60, isBlockBuilding: true, _rise: 30 });
    __hulls = 0; __vtx = vertex; vertex = function () { __hulls++; return __vtx.apply(this, arguments); };`);
  at(3, 'SPRING', 6.5);
  probe('activeBuildings = [__b(900)]; __hulls = 0; drawBiomeShadows();');
  const east = P('__hulls');
  probe('activeBuildings = [__b(-300)]; __hulls = 0; drawBiomeShadows();');
  const west = P('__hulls');
  probe('vertex = __vtx; currentLevel = 1; currentBiome = 1;');
  ok('drawBiomeShadows keeps the building whose dawn shadow crosses the view', east > 0 && west === 0,
     east + ' vertices east, ' + west + ' west');
}
{
  // A tree just past the view toward the sun is handed over for its shadow
  // alone; one on the far side is not.
  probe(`_depthOn = true;
    __ch = { cx: 0, cy: 0, decor: [ { t: 'TREE', x: 800, y: 500, s: 1 }, { t: 'TREE', x: -250, y: 500, s: 1 },
                                    { t: 'TREE', x: 1100, y: 500, s: 1 } ] };
    __mgr = { biome: 1, chunks: new Map([['0,0', __ch]]) };`);
  at(1, 'SPRING', 6.4);
  probe('ChunkManager.prototype.drawDecor.call(__mgr);');
  const xs = P('_standShadow.map(d => d.x)');
  const drawn = P('_standDecor.length');
  probe('_depthOn = false; _standShadow.length = 0;');
  ok('drawDecor hands over the off-screen tree whose crown shadow reaches the view', xs.length === 1 && xs[0] === 800 && drawn === 0,
     JSON.stringify(xs) + ', ' + drawn + ' painted');
}

console.log('\n== the rig\'s height buffer reaches toward the sun ==');
{
  probe(`GLRig.hw = 412; GLRig.hh = 892; GLRig.hm = 206; GLRig.hcw = 618; GLRig.hch = 1098;
         width = 412; height = 892; zoom = 0.65; camX = 1000; camY = 2000;`);
  let worst = 0, side = true;
  for (const [s, h] of [['SPRING', 7], ['SPRING', 12], ['WINTER', 15], ['SUMMER', 17]]) {
    at(1, s, h);
    const w = P('Array.from(glRigHgtWindow())'), x = P('Array.from(GLRig.hgtXf)');
    // The sun's side gets the larger share of the margin, on both axes.
    if ((P('LIGHT_DX') > 0.2) !== (w[0] > 103) && Math.abs(P('LIGHT_DX')) > 0.2) side = false;
    if ((P('LIGHT_DY') > 0.2) !== (w[1] > 103) && Math.abs(P('LIGHT_DY')) > 0.2) side = false;
    for (const [wx, wy] of [[1000, 2000], [1300, 2700], [1633, 3372]]) {
      // Where glRigPaintHeight() puts the point in the buffer...
      const k = 412 / 412, px = w[0] + (wx - 1000) * k * 0.65, py = w[1] + (wy - 2000) * k * 0.65;
      const tu = px / 618, tv = 1 - py / 1098;
      // ...and where a shader looks for it from its screen uv.
      const su = (wx - 1000) * 0.65 / 412, sv = 1 - (wy - 2000) * 0.65 / 892;
      worst = Math.max(worst, Math.abs(su * x[0] + x[2] - tu), Math.abs(sv * x[1] + x[3] - tv));
    }
  }
  ok('screen uv maps onto the painted buffer exactly', worst < 1e-6, worst.toExponential(2));
  ok('the margin goes on the side the sun is on', side);
  const src = P('[GLRIG_FS_NORMAL, GLRIG_FS_SUN, GLRIG_FS_OCC, GLRIG_FS_LIGHT].join("\\n")');
  const reads = src.match(/texture\(uHgt,\s*[^)]*\)/g) || [];
  ok('every height-buffer read goes through uHgtXf', reads.length >= 8 &&
     reads.every(r => !/texture\(uHgt,\s*(vUV|uv)\s*[),+-]/.test(r)) &&
     [P('GLRIG_FS_NORMAL'), P('GLRIG_FS_SUN'), P('GLRIG_FS_OCC'), P('GLRIG_FS_LIGHT')].every(f => /uniform vec4\s+uHgtXf;/.test(f)),
     reads.length + ' reads');
  ok('the march stops once the ray clears the tallest height', /if \(ray > uHeightMax\) break;/.test(src));
  const reach = 3.5 * (Math.pow(1.14, P('GLRIG_SUN_STEPS')) - 1) / 0.14;
  ok('and is long enough for a crown at the lowest sun', reach > 136 * 1.35 * 4.5, reach.toFixed(0) + ' world units');
}

console.log('\n== a figure\'s shadow on a south wall ==');
{
  // A building in the top of the view shows its SOUTH face; a northern noon
  // throws the figure standing south of it onto that face.
  probe(`width = 412; height = 892; zoom = 0.65; camX = 0; camY = 0; currentLevel = 1; currentBiome = 1;
    invalidateColIndex();
    __wall = { x: 300, y: 200, w: 160, h: 120, isBlockBuilding: true, _rise: 33, _depthKey: 260 };
    activeBuildings = [__wall]; _cfsJobN = 0; _depthSplitOn = false;`);
  at(1, 'WINTER', 12);
  probe('__fig = { x: 300, y: 300, isPlayer: true }; celFigureWalls(__fig, 0, 0.5, shadowLengthScale() * CEL_SHADOW_REACH);');
  const job = P('_cfsJobN ? { wall: _cfsJobs[0].wall, plane: _cfsJobs[0].plane, key: String(_cfsJobs[0].key) } : null');
  ok('the fold lands on the south face, and is painted before the figure', job && job.wall === 1 && job.plane === 260 && job.key === '-Infinity',
     JSON.stringify(job));
  probe('_cfsJobN = 0; activeBuildings = [];');
}

console.log('\n' + (checks - fails) + '/' + checks + ' checks passed');
process.exit(fails ? 1 : 0);
