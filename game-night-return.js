(function () {
  const returnUrl = new URLSearchParams(location.search).get("gameNight");
  if (!returnUrl || document.getElementById("gameNightReturn")) return;

  const target = document.querySelector(".top-actions") || document.querySelector(".topbar");
  if (!target) return;

  const style = document.createElement("style");
  style.textContent = "#gameNightReturn{border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:7px 10px;color:#fff4d0;background:rgba(255,255,255,.08);font:800 12px/1 Inter,Segoe UI,Arial,sans-serif;cursor:pointer;white-space:nowrap}#gameNightReturn:hover{filter:brightness(1.18)}";
  document.head.append(style);

  const button = document.createElement("button");
  button.id = "gameNightReturn";
  button.type = "button";
  button.textContent = "← Game Night";
  button.onclick = () => {
    if (window.parent !== window) window.parent.postMessage({ type: "judd-game-night:return" }, "*");
    else location.assign(returnUrl);
  };
  if (target.classList.contains("top-actions")) target.prepend(button);
  else target.append(button);

  if (new URLSearchParams(location.search).get("gameNightNew") === "1") {
    window.setTimeout(() => document.getElementById("newGameButton")?.click(), 900);
  }
}());
