// kdsWorker.js
// Web Worker para manter o timer de polling vivo e protegido contra as agressivas
// políticas de economia de energia/hibernação de Smart TVs (Tizen, webOS).
// O Worker roda numa thread separada e é menos propenso a ter seus timers suspensos.

let timerId = null;

self.onmessage = function (e) {
  const { command, interval } = e.data;

  if (command === 'start') {
    if (timerId) clearInterval(timerId);
    
    timerId = setInterval(() => {
      // Dispara um ping para a thread principal buscar dados
      self.postMessage({ type: 'TICK' });
    }, interval || 2000);
    
  } else if (command === 'stop') {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
};
