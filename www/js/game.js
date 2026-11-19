// Trick or Treat: scan the costume for the hidden sign, then Treat the kids and BOO the monsters.
(function () {
  "use strict";

  var VISITORS_PER_ROUND = 5;
  var MIN_POINTS = 10;
  var BEST_KEY = "tot-best";
  var MUTE_KEY = "tot-muted";
  // Height of the doorway opening in door-inside.webp, as a fraction of the image.
  var DOOR_HEIGHT = 0.663;
  var REACT_MS = 1500;

  // Round 1: 100 points for the first 1s, and the visitor leaves after 3s. Both get shorter
  // every round, down to 0.4s and 1.5s (round 9). Points fall from 100 to 10 over 80% of the visit.
  function roundConfig(r) {
    var full = Math.max(0.4, 1 - 0.1 * (r - 1));
    var leave = Math.max(1.5, 3 - 0.2 * (r - 1));
    return { full: full, drop: 90 / (leave * 0.8 - full), leave: leave };
  }

  // Scanner radius as a fraction of the doorway height: 10% smaller every round,
  // never below 0.065 (round 8 on), which is still usable on a phone.
  function scannerSize(r) {
    return Math.max(0.065, 0.13 * Math.pow(0.9, r - 1));
  }

  function pointsAt(t, cfg) {
    if (t <= cfg.full) return 100;
    return Math.max(MIN_POINTS, Math.round(100 - cfg.drop * (t - cfg.full)));
  }

  // ---------- Elements ----------

  function $(id) { return document.getElementById(id); }

  var game = $("game");
  var stage = $("stage");
  var scene = $("scene");
  var door = $("door");
  var visitorEl = $("visitor");
  var truthEl = $("truth");
  var costumeEl = $("costume");
  var scannerEl = $("scanner");
  var signNote = $("sign-note");
  var dingEl = $("ding");
  var bubbleEl = $("bubble");
  var booEl = $("boo-text");
  var popEl = $("pop");
  var bannerEl = $("banner");
  var roundEl = $("round");
  var countEl = $("visitor-count");
  var scoreEl = $("score");
  var bestEl = $("best");
  var worthEl = $("worth");
  var timeFill = $("time-fill");
  var lastEl = $("last");
  var treatBtn = $("treat-btn");
  var booBtn = $("boo-btn");
  var muteBtn = $("mute-btn");
  var pauseBtn = $("pause-btn");
  var pauseScreen = $("pause-screen");
  var startScreen = $("start-screen");
  var overScreen = $("over-screen");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- State ----------

  var state = "idle"; // idle | starting | ringing | waiting | reacting | over
  var score = 0;
  var endReason = null; // set by the one mistake that ends the game
  var paused = false;
  var round = 1;
  var visitorNum = 0;
  var visitor = null;
  var t0 = 0;
  var pausedAt = null;
  var raf = 0;
  var timers = [];
  var best = parseInt(load(BEST_KEY), 10) || 0;
  var muted = load(MUTE_KEY) === "1";
  var scan = { x: 0.33, y: 0.7 }; // scanner centre, as fractions of the scene
  var lastPointer = "touch";
  var dragging = false;

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage blocked: just don't persist */ }
  }

  // Timers remember when they are due, so pausing can freeze and resume them.
  function later(fn, ms) {
    var t = { fn: fn, due: performance.now() + ms };
    t.id = setTimeout(function () {
      timers.splice(timers.indexOf(t), 1);
      fn();
    }, ms);
    timers.push(t);
  }

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t.id); });
    timers = [];
    cancelAnimationFrame(raf);
  }

  function freezeTimers() {
    var now = performance.now();
    timers.forEach(function (t) {
      clearTimeout(t.id);
      t.left = Math.max(0, t.due - now);
    });
  }

  function thawTimers() {
    var frozen = timers;
    timers = [];
    frozen.forEach(function (t) { later(t.fn, t.left); });
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // ---------- Sound (Web Audio, no files) ----------

  var sound = (function () {
    var ac = null;
    var master = null;
    var VOLUME = 0.6;

    function unlock() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0 : VOLUME;
        master.connect(ac.destination);
      }
      if (ac.state === "suspended") ac.resume();
    }

    function setMuted(m) {
      if (master) master.gain.setTargetAtTime(m ? 0 : VOLUME, ac.currentTime, 0.02);
    }

    // One note: freqs is a list of [seconds, hz] points the pitch glides through.
    function voice(o) {
      if (!ac || muted) return;
      var t = ac.currentTime + (o.delay || 0);
      var osc = ac.createOscillator();
      osc.type = o.type || "sine";
      o.freqs.forEach(function (p, i) {
        if (i === 0) osc.frequency.setValueAtTime(p[1], t + p[0]);
        else osc.frequency.exponentialRampToValueAtTime(p[1], t + p[0]);
      });
      var gain = ac.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack || 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      var out = osc;
      if (o.filter) {
        var f = ac.createBiquadFilter();
        f.type = o.filter.type;
        f.frequency.value = o.filter.freq;
        f.Q.value = o.filter.q || 1;
        osc.connect(f);
        out = f;
      }
      if (o.vibrato) {
        var lfo = ac.createOscillator();
        var depth = ac.createGain();
        lfo.frequency.value = o.vibrato.rate;
        depth.gain.value = o.vibrato.depth;
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + o.dur + 0.05);
      }
      out.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + o.dur + 0.05);
    }

    return {
      unlock: unlock,
      setMuted: setMuted,
      pause: function () { if (ac) ac.suspend(); },
      resume: function () { if (ac) ac.resume(); },
      doorbell: function () {
        voice({ freqs: [[0, 659.25]], dur: 0.9, vol: 0.35 });
        voice({ type: "triangle", freqs: [[0, 1318.5]], dur: 0.5, vol: 0.05 });
        voice({ freqs: [[0, 523.25]], dur: 1.2, vol: 0.35, delay: 0.45 });
        voice({ type: "triangle", freqs: [[0, 1046.5]], dur: 0.6, vol: 0.05, delay: 0.45 });
      },
      boo: function () {
        voice({ type: "sawtooth", freqs: [[0, 240], [0.12, 290], [0.65, 120]], dur: 0.7, vol: 0.28, attack: 0.04,
          filter: { type: "lowpass", freq: 800, q: 4 }, vibrato: { rate: 7, depth: 10 } });
      },
      waah: function (delay) {
        voice({ type: "triangle", freqs: [[0, 480], [0.18, 620], [0.9, 380]], dur: 0.95, vol: 0.22, attack: 0.05,
          filter: { type: "lowpass", freq: 1800 }, vibrato: { rate: 9, depth: 25 }, delay: delay || 0 });
      },
      // Happy kid: quick, high "hee-hee-hee" that climbs.
      giggle: function () {
        [880, 990, 1110, 1250].forEach(function (hz, i) {
          voice({ type: "triangle", freqs: [[0, hz], [0.05, hz * 1.25], [0.11, hz * 0.95]], dur: 0.12, vol: 0.16,
            vibrato: { rate: 30, depth: 40 }, delay: i * 0.13 });
        });
      },
      // Spooky monster: low, raspy "heh-heh-heh-HAAH" that slides down, with a wobble.
      cackle: function () {
        var notes = [[420, 330], [400, 310], [380, 290], [440, 200]];
        notes.forEach(function (n, i) {
          var last = i === notes.length - 1;
          voice({ type: "sawtooth", freqs: [[0, n[0]], [last ? 0.5 : 0.13, n[1]]], dur: last ? 0.55 : 0.15, vol: 0.16,
            filter: { type: "bandpass", freq: 900, q: 3 }, vibrato: { rate: 14, depth: 18 }, delay: i * 0.17 });
        });
      },
      aww: function () {
        voice({ type: "triangle", freqs: [[0, 392], [0.5, 294]], dur: 0.55, vol: 0.15, attack: 0.03 });
      }
    };
  })();

  // ---------- Pictures (inline SVG, viewBox 100 x 185) ----------
  // Every figure has its head at (50, 44) so all costumes line up with all faces.

  function svg(inner) {
    return '<svg class="figure" viewBox="0 0 100 185" aria-hidden="true">' + inner + "</svg>";
  }

  function limbs(arm, hand, leg, foot) {
    return '<rect x="37" y="126" width="11" height="46" rx="5" fill="' + leg + '"/>' +
      '<rect x="52" y="126" width="11" height="46" rx="5" fill="' + leg + '"/>' +
      '<ellipse cx="41" cy="173" rx="9" ry="5" fill="' + foot + '"/>' +
      '<ellipse cx="59" cy="173" rx="9" ry="5" fill="' + foot + '"/>' +
      '<rect x="21" y="74" width="11" height="44" rx="5.5" fill="' + arm + '" transform="rotate(10 26 76)"/>' +
      '<rect x="68" y="74" width="11" height="44" rx="5.5" fill="' + arm + '" transform="rotate(-10 74 76)"/>' +
      '<circle cx="19.5" cy="118" r="6" fill="' + hand + '"/>' +
      '<circle cx="80.5" cy="118" r="6" fill="' + hand + '"/>';
  }

  // Wide sleeves for the cloak costumes, so they cover the arm zones.
  function sleeves(cloth, hand) {
    return '<path d="M34 66 L14 68 L12 128 L32 128Z" fill="' + cloth + '"/>' +
      '<path d="M66 66 L86 68 L88 128 L68 128Z" fill="' + cloth + '"/>' +
      '<circle cx="21" cy="130" r="5" fill="' + hand + '"/><circle cx="79" cy="130" r="5" fill="' + hand + '"/>';
  }

  var KID_LOOKS = {
    skin: ["#f3cba5", "#e0ac83", "#b97a50", "#7d4c2d"],
    hair: ["#3b2416", "#d9a441", "#1c1c1c", "#8a3b1c"],
    shirt: ["#e94f4f", "#4f8de9", "#3fb57a", "#f2b134"],
    shoes: ["#f4f4f4", "#e94f4f", "#4f8de9"]
  };

  function kidSvg() {
    var skin = pick(KID_LOOKS.skin);
    var hair = pick(KID_LOOKS.hair);
    var shirt = pick(KID_LOOKS.shirt);
    var pigtails = Math.random() < 0.5;
    return svg(
      limbs(shirt, skin, "#33507a", pick(KID_LOOKS.shoes)) +
      '<rect x="30" y="68" width="40" height="64" rx="13" fill="' + shirt + '"/>' +
      '<rect x="30" y="90" width="40" height="7" fill="rgba(255,255,255,0.35)"/>' +
      '<rect x="45" y="60" width="10" height="10" fill="' + skin + '"/>' +
      (pigtails ? '<circle cx="26" cy="34" r="7" fill="' + hair + '"/><circle cx="74" cy="34" r="7" fill="' + hair + '"/>' : "") +
      '<circle cx="29" cy="46" r="4" fill="' + skin + '"/><circle cx="71" cy="46" r="4" fill="' + skin + '"/>' +
      '<circle cx="50" cy="44" r="21" fill="' + skin + '"/>' +
      '<path d="M28 44 C27 22 40 18 50 19 C62 18 74 24 72 44 C68 34 60 30 50 31 C42 30 33 33 28 44Z" fill="' + hair + '"/>' +
      '<circle cx="42" cy="45" r="3" fill="#2b1a10"/><circle cx="58" cy="45" r="3" fill="#2b1a10"/>' +
      '<circle cx="43" cy="44" r="1" fill="#fff"/><circle cx="59" cy="44" r="1" fill="#fff"/>' +
      '<ellipse cx="36" cy="52" rx="4" ry="2.6" fill="#ff7b7b" opacity="0.45"/>' +
      '<ellipse cx="64" cy="52" rx="4" ry="2.6" fill="#ff7b7b" opacity="0.45"/>' +
      '<path class="happy" d="M43 53 Q50 60 57 53" fill="none" stroke="#7a2e1c" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path class="sad" d="M37 38 L45 40 M63 38 L55 40" stroke="#3b2416" stroke-width="2" stroke-linecap="round"/>' +
      '<ellipse class="sad" cx="50" cy="57" rx="5.5" ry="4.5" fill="#6b1d12"/>' +
      '<g class="sad tears" fill="#7cc8ff"><path d="M40 49 q-3 6 0 8 q3 -2 0 -8z"/><path d="M60 49 q-3 6 0 8 q3 -2 0 -8z"/></g>'
    );
  }

  var MONSTER_LOOKS = [
    { body: "#6fbf4a", dark: "#3f7a29", belly: "#a7dd85", head: "bolts" },
    { body: "#8e5cc8", dark: "#5b3590", belly: "#c2a3ea", head: "horns" },
    { body: "#4a90c8", dark: "#2c5f8a", belly: "#9cc8ea", head: "cyclops" }
  ];

  function monsterSvg() {
    var m = pick(MONSTER_LOOKS);
    var head = "";
    var eyes = "";
    if (m.head === "bolts") {
      head = '<rect x="22" y="42" width="7" height="6" rx="1" fill="#9aa3ad"/><rect x="71" y="42" width="7" height="6" rx="1" fill="#9aa3ad"/>' +
        '<rect x="31" y="23" width="38" height="9" rx="2" fill="#1d2b1a"/>' +
        '<path d="M56 30 L64 36 M58 31 l2 -2 M61 33 l2 -2" stroke="#2a3a24" stroke-width="1.4"/>';
    } else if (m.head === "horns") {
      head = '<path d="M33 30 L27 13 L41 26Z" fill="#f4e3c1"/><path d="M67 30 L73 13 L59 26Z" fill="#f4e3c1"/>';
    } else {
      head = '<path d="M50 24 V12" stroke="' + m.dark + '" stroke-width="2.5"/><circle cx="50" cy="11" r="3.5" fill="#ffdd55"/>';
    }
    if (m.head === "cyclops") {
      eyes = '<circle cx="50" cy="42" r="9" fill="#fff"/><circle cx="50" cy="43" r="4.5" fill="#e0562e"/><circle cx="50" cy="43" r="2" fill="#111"/>' +
        '<path d="M39 32 Q50 28 61 32" stroke="' + m.dark + '" stroke-width="3" fill="none"/>';
    } else {
      eyes = '<ellipse cx="42" cy="43" rx="5" ry="4" fill="#ffe14d"/><ellipse cx="58" cy="43" rx="5" ry="4" fill="#ffe14d"/>' +
        '<rect x="41.2" y="39.5" width="1.6" height="7" fill="#111"/><rect x="57.2" y="39.5" width="1.6" height="7" fill="#111"/>' +
        '<path d="M35 35 L46 38.5 M65 35 L54 38.5" stroke="' + m.dark + '" stroke-width="3" stroke-linecap="round"/>';
    }
    return svg(
      limbs(m.body, m.body, m.body, m.dark) +
      '<path d="M12 120 l3 6 M17 123 l1 6 M22 122 l-1 6 M88 120 l-3 6 M83 123 l-1 6 M78 122 l1 6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M34 176 l-2 4 M40 177 v4 M46 176 l2 4 M54 176 l-2 4 M60 177 v4 M66 176 l2 4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>' +
      '<rect x="30" y="68" width="40" height="64" rx="13" fill="' + m.body + '"/>' +
      '<ellipse cx="50" cy="102" rx="13" ry="20" fill="' + m.belly + '"/>' +
      '<rect x="45" y="60" width="10" height="10" fill="' + m.body + '"/>' +
      head +
      '<circle cx="50" cy="44" r="21" fill="' + m.body + '"/>' +
      (m.head === "bolts" ? '<rect x="29" y="23" width="42" height="9" rx="3" fill="#1d2b1a"/>' : "") +
      eyes +
      '<path d="M37 53 Q50 64 63 53 Q50 58 37 53Z" fill="#3a0d12"/>' +
      '<path d="M42 55.4 l2 4.2 l2 -3.8Z M54 55.8 l2 3.8 l2 -4.2Z" fill="#fff"/>'
    );
  }

  var COSTUMES = {
    ghost: function () {
      return svg(
        '<path d="M50 14 C24 14 17 38 17 66 L15 178 Q22 171 29 178 Q36 171 43 178 Q50 171 57 178 Q64 171 71 178 Q78 171 85 178 L83 66 C83 38 76 14 50 14Z" fill="#f4f1ea" stroke="#cfc7b8" stroke-width="1.5"/>' +
        '<path d="M35 80 Q32 120 34 170 M65 80 Q68 120 66 170" stroke="#d9d2c4" stroke-width="2" fill="none"/>' +
        '<ellipse cx="42" cy="44" rx="4.5" ry="6.5" fill="#1b1410"/><ellipse cx="58" cy="44" rx="4.5" ry="6.5" fill="#1b1410"/>' +
        '<ellipse cx="50" cy="58" rx="4" ry="3" fill="#1b1410"/>'
      );
    },
    pumpkin: function () {
      return svg(
        sleeves("#3a2550", "#f0862a") +
        '<path d="M32 64 L68 64 L84 178 L16 178Z" fill="#3a2550"/>' +
        '<ellipse cx="41" cy="177" rx="9" ry="5" fill="#1b1410"/><ellipse cx="59" cy="177" rx="9" ry="5" fill="#1b1410"/>' +
        '<ellipse cx="50" cy="42" rx="27" ry="24" fill="#f0862a"/>' +
        '<path d="M50 18 Q42 42 50 66 M50 18 Q58 42 50 66 M36 21 Q28 42 36 64 M64 21 Q72 42 64 64" stroke="#c9631a" stroke-width="2" fill="none"/>' +
        '<path d="M47 19 Q48 10 54 8 L55 11 Q51 13 52 19Z" fill="#4c7a2a"/>' +
        '<path d="M36 40 L42 31 L48 40Z M52 40 L58 31 L64 40Z M47 47 L50 43 L53 47Z" fill="#3a1606"/>' +
        '<path d="M34 51 Q50 62 66 51 L62 54 L58 51 L54 55 L50 52 L46 55 L42 51 L38 54Z" fill="#3a1606"/>'
      );
    },
    witch: function () {
      return svg(
        sleeves("#241c38", "#9fcf7a") +
        '<path d="M33 62 L67 62 L83 178 L17 178Z" fill="#241c38"/>' +
        '<path d="M27 104 L73 104 L74 110 L26 110Z" fill="#7a4fb0"/>' +
        '<ellipse cx="41" cy="177" rx="9" ry="5" fill="#15121f"/><ellipse cx="59" cy="177" rx="9" ry="5" fill="#15121f"/>' +
        '<path d="M27 34 Q21 60 30 72 L35 40Z M73 34 Q79 60 70 72 L65 40Z" fill="#e0752b"/>' +
        '<circle cx="50" cy="44" r="21" fill="#9fcf7a"/>' +
        '<path d="M50 41 L57 52 L49 50Z" fill="#86b862"/><circle cx="55" cy="47" r="1.4" fill="#5d8a3e"/>' +
        '<circle cx="42" cy="41" r="2.6" fill="#1b1410"/><circle cx="58" cy="41" r="2.6" fill="#1b1410"/>' +
        '<path d="M41 56 Q50 61 60 55" stroke="#1b1410" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="27" rx="31" ry="6" fill="#15121f"/>' +
        '<path d="M35 27 Q44 12 52 2 Q56 0 58 4 Q62 16 66 27Z" fill="#15121f"/>' +
        '<path d="M37.5 22 L63.5 22 L65 26.5 L36 26.5Z" fill="#7a4fb0"/>'
      );
    },
    skeleton: function () {
      return svg(
        limbs("#18151a", "#f2efe6", "#18151a", "#18151a") +
        sleeves("#18151a", "#f2efe6") +
        '<rect x="30" y="120" width="40" height="54" rx="3" fill="#18151a"/>' +
        '<rect x="30" y="64" width="40" height="68" rx="12" fill="#18151a"/>' +
        '<rect x="48.5" y="70" width="3" height="54" fill="#efe9dc"/>' +
        '<path d="M37 78 Q50 74 63 78 M36 86 Q50 82 64 86 M37 94 Q50 90 63 94 M39 102 Q50 98 61 102" stroke="#efe9dc" stroke-width="3" fill="none" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="126" rx="10" ry="4" fill="#efe9dc"/>' +
        '<path d="M42.5 132 V168 M57.5 132 V168 M24 82 L20 112 M76 82 L80 112" stroke="#efe9dc" stroke-width="2.5" stroke-linecap="round"/>' +
        '<circle cx="50" cy="42" r="22" fill="#f2efe6"/>' +
        '<rect x="39" y="52" width="22" height="14" rx="5" fill="#f2efe6"/>' +
        '<ellipse cx="42" cy="42" rx="5.5" ry="6" fill="#18151a"/><ellipse cx="58" cy="42" rx="5.5" ry="6" fill="#18151a"/>' +
        '<path d="M48 52 L50 47 L52 52Z" fill="#18151a"/>' +
        '<path d="M43 58 V64 M47 58 V65 M51 58 V65 M55 58 V64 M40 58 H60" stroke="#18151a" stroke-width="1.4"/>'
      );
    },
    vampire: function () {
      return svg(
        sleeves("#140c12", "#e9e4f0") +
        '<path d="M26 62 L74 62 L90 178 L10 178Z" fill="#140c12"/>' +
        '<path d="M38 64 L62 64 L70 176 L30 176Z" fill="#7d1426"/>' +
        '<path d="M42 64 L58 64 L54 130 L46 130Z" fill="#f2efe8"/>' +
        '<path d="M44 66 L50 70 L56 66 L56 74 L50 70 L44 74Z" fill="#7d1426"/>' +
        '<path d="M24 68 L28 28 L50 58 L72 28 L76 68Z" fill="#8b1a2b"/>' +
        '<circle cx="50" cy="44" r="21" fill="#e9e4f0"/>' +
        '<path d="M29 42 C29 21 42 19 50 30 C58 19 71 21 71 42 C67 31 58 28 50 35 C42 28 33 31 29 42Z" fill="#141018"/>' +
        '<ellipse cx="43" cy="45" rx="3" ry="2.4" fill="#2a1020"/><ellipse cx="57" cy="45" rx="3" ry="2.4" fill="#2a1020"/>' +
        '<path d="M38 40 L46 41.5 M62 40 L54 41.5" stroke="#141018" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M43 55 Q50 59 57 55" stroke="#5a1a2a" stroke-width="2" fill="none" stroke-linecap="round"/>' +
        '<path d="M45 56 l1.3 3.2 l1.3 -2.6Z M52.4 56.6 l1.3 2.6 l1.3 -3.2Z" fill="#fff"/>'
      );
    }
  };

  var COSTUME_NAMES = Object.keys(COSTUMES);

  // ---------- Hidden sign ----------
  // Body zones in figure units (viewBox 100 x 185). The head is a circle {x, y, r};
  // the rest are boxes [left, top, right, bottom]. Every costume covers every zone, so
  // the sign never shows off the visitor. The arms are the smallest, 14 x 54 units
  // (about 18 x 70px on a phone).
  var ZONES = {
    head: { x: 50, y: 44, r: 19 },
    chest: [31, 68, 69, 99],
    stomach: [31, 99, 69, 132],
    leftArm: [17, 72, 31, 126],
    rightArm: [69, 72, 83, 126],
    leftLeg: [31, 132, 50, 172],
    rightLeg: [50, 132, 69, 172]
  };

  function inZone(z, u, v) {
    if (z.r) return Math.hypot(u - z.x, v - z.y) <= z.r;
    return u >= z[0] && u <= z[2] && v >= z[1] && v <= z[3];
  }
  var ZONE_NAMES = Object.keys(ZONES);
  var FIGURE_BOTTOM = 0.235; // matches .figure { bottom: 23.5% }
  var shownSign = "";

  // The sign shows only while the scanner's centre is inside the visitor's hidden zone.
  function updateSign() {
    var sign = "";
    if (visitor && state === "waiting" && !paused) {
      // Work out the figure's box from its size settings, so no layout is read per move.
      var figH = visitor.fh / 100 * size.h;
      var figW = figH * 100 / 185;
      var figLeft = visitor.fx / 100 * size.w - figW / 2;
      var figTop = size.h * (1 - FIGURE_BOTTOM) - figH;
      var u = (scan.x * size.w - figLeft) / figW * 100;
      var v = (scan.y * size.h - figTop) / figH * 185;
      if (inZone(ZONES[visitor.zone], u, v)) sign = visitor.isKid ? "safe" : "danger";
    }
    if (sign === shownSign) return;
    shownSign = sign;
    scannerEl.classList.toggle("sign-safe", sign === "safe");
    scannerEl.classList.toggle("sign-danger", sign === "danger");
    signNote.textContent = sign === "safe" ? "Green safe sign found." : sign === "danger" ? "Red skull sign found." : "";
  }

  // ---------- Scanner ----------

  // Scene and stage sizes, measured once and again on resize (not on every move).
  var size = { w: 0, h: 0, left: 0, stageW: 0 };

  function measure() {
    size.w = scene.clientWidth;
    size.h = scene.clientHeight;
    size.left = scene.offsetLeft;
    size.stageW = stage.clientWidth;
  }

  function radiusPx() {
    return scannerSize(round) * DOOR_HEIGHT * size.h;
  }

  function drawScanner() {
    scannerEl.style.setProperty("--sx", (scan.x * size.w).toFixed(1) + "px");
    scannerEl.style.setProperty("--sy", (scan.y * size.h).toFixed(1) + "px");
    scannerEl.style.setProperty("--sr", radiusPx().toFixed(1) + "px");
    updateSign();
  }

  // Keep the scanner inside the part of the scene the stage actually shows.
  function moveScanner(px, py) {
    var w = size.w;
    var h = size.h;
    var minX = -size.left;
    var maxX = minX + size.stageW;
    scan.x = Math.min(maxX, Math.max(minX, px)) / w;
    scan.y = Math.min(h, Math.max(0, py)) / h;
    drawScanner();
  }

  function restScanner() {
    scan.x = 0.33;
    scan.y = 0.7;
    drawScanner();
  }

  function pointerToScanner(e) {
    var box = scene.getBoundingClientRect();
    // On touch, draw the scanner above the fingertip so the finger doesn't hide it.
    var lift = e.pointerType === "touch" ? radiusPx() + 24 : 0;
    moveScanner(e.clientX - box.left, e.clientY - box.top - lift);
  }

  scene.addEventListener("pointerdown", function (e) {
    lastPointer = e.pointerType;
    if (e.pointerType === "touch") {
      dragging = true;
      try { scene.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
    }
    pointerToScanner(e);
  });

  scene.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch" && !dragging) return;
    lastPointer = e.pointerType;
    pointerToScanner(e);
  });

  function endDrag() { dragging = false; }
  scene.addEventListener("pointerup", endDrag);
  scene.addEventListener("pointercancel", endDrag);

  stage.addEventListener("keydown", function (e) {
    var step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    lastPointer = "keyboard";
    moveScanner((scan.x + step[0] * 0.02) * size.w, (scan.y + step[1] * 0.03) * size.h);
  });

  window.addEventListener("resize", function () {
    measure();
    drawScanner();
  });

  // ---------- HUD ----------

  function updateHud() {
    roundEl.textContent = round;
    countEl.textContent = "· " + Math.max(1, visitorNum) + "/" + VISITORS_PER_ROUND;
    scoreEl.textContent = score;
    bestEl.textContent = best;
  }

  function setAnswerButtons(on) {
    treatBtn.disabled = !on;
    booBtn.disabled = !on;
  }

  function restartAnimation(el) {
    el.hidden = true;
    void el.offsetWidth;
    el.hidden = false;
  }

  function showPoints(text, good, note) {
    popEl.textContent = text;
    popEl.className = "pop " + (good ? "good" : "bad");
    restartAnimation(popEl);
    later(function () { popEl.hidden = true; }, 1200);
    lastEl.textContent = "Last visitor: " + text + " · " + note;
  }

  function showBanner(title, sub, ms) {
    $("banner-title").textContent = title;
    $("banner-sub").textContent = sub || "";
    bannerEl.hidden = false;
    later(function () { bannerEl.hidden = true; }, ms);
  }

  // ---------- A turn ----------

  function nextVisitor() {
    visitorNum += 1;
    var isKid = Math.random() < 0.5;
    visitor = { isKid: isKid, zone: pick(ZONE_NAMES), fx: +rand(48.5, 49.6).toFixed(2), fh: +rand(62, 64.5).toFixed(2) };
    truthEl.innerHTML = isKid ? kidSvg() : monsterSvg();
    costumeEl.innerHTML = COSTUMES[pick(COSTUME_NAMES)]();
    scene.className = "scene";
    scene.style.setProperty("--fx", visitor.fx.toFixed(2) + "%");
    scene.style.setProperty("--fh", visitor.fh.toFixed(2) + "%");
    if (lastPointer !== "mouse" && lastPointer !== "pen") restScanner();
    else drawScanner();
    updateHud();
    worthEl.textContent = 100;
    timeFill.style.width = "100%";

    state = "ringing";
    sound.doorbell();
    restartAnimation(dingEl);
    later(openDoor, 900);
  }

  function openDoor() {
    dingEl.hidden = true;
    visitorEl.hidden = false;
    door.classList.add("is-open");
    later(function () {
      state = "waiting";
      t0 = performance.now();
      setAnswerButtons(true);
      updateSign();
      raf = requestAnimationFrame(tick);
    }, reducedMotion.matches ? 0 : 450);
  }

  function tick(now) {
    if (state !== "waiting" || paused) return;
    var cfg = roundConfig(round);
    var t = (now - t0) / 1000;
    if (t >= cfg.leave) {
      missed();
      return;
    }
    worthEl.textContent = pointsAt(t, cfg);
    timeFill.style.width = (100 * (1 - t / cfg.leave)).toFixed(1) + "%";
    raf = requestAnimationFrame(tick);
  }

  function answer(choice) {
    if (state !== "waiting" || paused) return;
    cancelAnimationFrame(raf);
    var t = (performance.now() - t0) / 1000;
    var correct = (choice === "treat") === visitor.isKid;
    if (correct) {
      var pts = pointsAt(t, roundConfig(round));
      score += pts;
      showPoints("+" + pts, true, visitor.isKid ? "a real kid got a treat" : "a monster got BOO'd");
      react(visitor.isKid ? "thanks" : "flee");
    } else {
      endReason = visitor.isKid ? "You BOO'd a real kid! 😢" : "A monster got your candy! 😈";
      showPoints("0", false, visitor.isKid ? "oops, that was a kid" : "a monster took the candy");
      react(visitor.isKid ? "cry" : "laugh");
    }
    finishVisitor();
  }

  function missed() {
    endReason = "Too slow! The visitor left. 🚪";
    worthEl.textContent = 0;
    timeFill.style.width = "0%";
    showPoints("0", false, "too slow, the visitor left");
    react("leave");
    finishVisitor();
  }

  var REACTIONS = {
    thanks: { text: "Thank you! 🍬", play: function () { sound.giggle(); } },
    flee: { text: "Eek! 😱", boo: true, play: function () { sound.boo(); } },
    cry: { text: "Waaah! 😢", boo: true, play: function () { sound.boo(); sound.waah(0.45); } },
    laugh: { text: "Mwa-ha-ha! 🍬", play: function () { sound.cackle(); } },
    leave: { text: "Never mind…", play: function () { sound.aww(); } }
  };

  function react(kind) {
    var r = REACTIONS[kind];
    state = "reacting";
    updateSign();
    setAnswerButtons(false);
    scene.classList.add("reveal", kind);
    bubbleEl.textContent = r.text;
    bubbleEl.hidden = false;
    if (r.boo) restartAnimation(booEl);
    r.play();
  }

  function finishVisitor() {
    if (score > best) {
      best = score;
      save(BEST_KEY, String(best));
    }
    updateHud();
    later(function () {
      bubbleEl.hidden = true;
      booEl.hidden = true;
      door.classList.remove("is-open");
      later(afterDoorCloses, reducedMotion.matches ? 0 : 450);
    }, REACT_MS);
  }

  function afterDoorCloses() {
    visitorEl.hidden = true;
    scene.className = "scene";
    if (endReason) {
      gameOver();
      return;
    }
    if (visitorNum < VISITORS_PER_ROUND) {
      later(nextVisitor, 350);
      return;
    }
    round += 1;
    visitorNum = 0;
    var notes = [];
    if (scannerSize(round) < scannerSize(round - 1)) notes.push("Smaller scanner!");
    if (roundConfig(round).leave < roundConfig(round - 1).leave) notes.push("Less time!");
    updateHud();
    drawScanner();
    showBanner("Round " + round, notes.join(" "), 1600);
    later(nextVisitor, 1800);
  }

  // ---------- Start / end ----------

  function startGame() {
    sound.unlock();
    clearTimers();
    score = 0;
    endReason = null;
    round = 1;
    visitorNum = 0;
    paused = false;
    pausedAt = null;
    state = "starting";
    scene.className = "scene";
    visitorEl.hidden = true;
    door.classList.remove("is-open");
    startScreen.hidden = true;
    overScreen.hidden = true;
    pauseScreen.hidden = true;
    pauseBtn.disabled = false;
    showPause();
    lastEl.textContent = "Last visitor: —";
    updateHud();
    game.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" });
    stage.focus({ preventScroll: true });
    measure();
    drawScanner();
    showBanner("Round 1", "Scan, then Treat or BOO!", 1400);
    later(nextVisitor, 1600);
  }

  function gameOver() {
    state = "over";
    setAnswerButtons(false);
    pauseBtn.disabled = true;
    $("final-score").textContent = score;
    $("final-round").textContent = round;
    $("final-best").textContent = best;
    $("final-note").textContent = endReason + " " + (score > 0 && score === best ? "New best score! 🏆" : "Can you beat your best?");
    overScreen.hidden = false;
    $("again-btn").focus({ preventScroll: true });
  }

  // ---------- Controls ----------

  treatBtn.addEventListener("click", function () { answer("treat"); });
  booBtn.addEventListener("click", function () { answer("boo"); });
  $("start-btn").addEventListener("click", startGame);
  $("again-btn").addEventListener("click", startGame);

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var key = e.key.toLowerCase();
    if (key === "t") answer("treat");
    else if (key === "b") answer("boo");
    else if (key === "p" || key === "escape") togglePause();
  });

  function showMute() {
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }

  muteBtn.addEventListener("click", function () {
    muted = !muted;
    save(MUTE_KEY, muted ? "1" : "0");
    sound.unlock();
    sound.setMuted(muted);
    showMute();
  });

  // ---------- Pause ----------

  function inPlay() {
    return state === "starting" || state === "ringing" || state === "waiting" || state === "reacting";
  }

  function showPause() {
    pauseBtn.textContent = paused ? "▶" : "⏸";
    pauseBtn.setAttribute("aria-label", paused ? "Resume game" : "Pause game");
  }

  // Everything freezes: the visitor's clock, every pending timer and the sound.
  // The pause screen covers the door so nobody can scan while paused.
  function pauseGame() {
    if (paused || !inPlay()) return;
    paused = true;
    pausedAt = performance.now();
    cancelAnimationFrame(raf);
    freezeTimers();
    sound.pause();
    setAnswerButtons(false);
    updateSign();
    pauseScreen.hidden = false;
    showPause();
    $("resume-btn").focus({ preventScroll: true });
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    t0 += performance.now() - pausedAt;
    pausedAt = null;
    pauseScreen.hidden = true;
    showPause();
    sound.resume();
    thawTimers();
    if (state === "waiting") {
      setAnswerButtons(true);
      raf = requestAnimationFrame(tick);
    }
    updateSign();
    stage.focus({ preventScroll: true });
  }

  function togglePause() {
    if (paused) resumeGame();
    else pauseGame();
  }

  pauseBtn.addEventListener("click", togglePause);
  $("resume-btn").addEventListener("click", resumeGame);

  // Leaving the tab pauses the game; it waits for the player to press Resume.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pauseGame();
  });

  showMute();
  updateHud();
  measure();
  drawScanner();
})();
