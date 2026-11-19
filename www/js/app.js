// App shell for the phone build: the "How to play" sheet and no long-press menus.
// The game itself lives in game.js and is unchanged from the web version.
(function () {
  "use strict";

  var help = document.getElementById("help");
  var opener = null;

  function openHelp(e) {
    opener = e.currentTarget;
    help.hidden = false;
    help.scrollTop = 0;
    document.getElementById("help-close").focus({ preventScroll: true });
  }

  function closeHelp() {
    help.hidden = true;
    if (opener) opener.focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-help-open]").forEach(function (btn) {
    btn.addEventListener("click", openHelp);
  });
  document.getElementById("help-close").addEventListener("click", closeHelp);

  // game.js re-measures the door on window resize. The stage can also change size
  // without one (e.g. when the notch insets arrive), so pass those changes on too.
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      window.dispatchEvent(new Event("resize"));
    }).observe(document.getElementById("stage"));
  }

  // Long-pressing the door while scanning shouldn't pop up a copy/save menu.
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
})();
