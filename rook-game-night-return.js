(function () {
  const params = new URLSearchParams(location.hash.slice(1));
  const gameNight = params.get("gameNight");
  if (!gameNight || document.getElementById("gameNightReturn")) return;

  const style = document.createElement("style");
  style.textContent = "#gameNightReturn{position:fixed;right:18px;bottom:18px;z-index:9999;border:1px solid rgba(255,255,255,.28);border-radius:11px;padding:10px 13px;color:#fff4d0;background:rgba(18,10,22,.92);box-shadow:0 6px 22px rgba(0,0,0,.35);font:800 12px/1 Inter,Segoe UI,Arial,sans-serif;cursor:pointer}#gameNightReturn:hover{filter:brightness(1.18)}";
  document.head.append(style);

  const button = document.createElement("button");
  button.id = "gameNightReturn";
  button.type = "button";
  button.textContent = "← Game Night";
  button.onclick = () => location.assign(gameNight);
  document.body.append(button);
}());
