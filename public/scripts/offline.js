"use strict";

(() => {
  const retryButton=document.getElementById("offlineRetry");
  const backLink=document.getElementById("offlineBack");
  const status=document.getElementById("offlineStatus");

  retryButton?.addEventListener("click",() => {
    retryButton.disabled=true;
    if(status)status.textContent="Trying this page again…";
    location.reload();
  });

  backLink?.addEventListener("click",(event) => {
    if(history.length<=1)return;
    event.preventDefault();
    history.back();
  });

  window.addEventListener("online",() => {
    if(status)status.textContent="You’re back online. Try this page again to continue.";
  });
})();
